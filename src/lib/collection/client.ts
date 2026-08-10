/**
 * Server-only client for the Collection gateway.
 *
 * Nothing here may run in the browser: it carries the merchant id, the
 * merchant key and the refund signing secret.
 *
 * Design notes worth keeping in mind when editing:
 *  - Wallet endpoints always answer HTTP 200. The outcome lives in the body's
 *    `status`, so a non-200 is a transport fault, not a declined payment.
 *  - `/checkout` is the exception and answers 302.
 *  - Never retry a call that came back indeterminate (§6) — resolve by inquiry.
 */

import "server-only";
import { createHmac } from "node:crypto";

import { serverEnv } from "@/lib/env";
import { getGatewayConfig } from "@/lib/settings";
import { classify, type Outcome } from "./codes";
import {
  assertMerchantId,
  assertOperatorId,
  assertSourceId,
  assertTransactionDate,
  assertTransactionId,
  assertTransactionType,
  assertUserKey,
  formatAmount,
  normaliseMsisdn,
} from "./validate";
import type {
  DelinkRequest,
  DirectPaymentRequest,
  FinalizeRequest,
  HostedInquiryResponse,
  InitiateRequest,
  InquiryRequest,
  InquiryResponse,
  OperatorId,
  RefundRequest,
  RefundResponse,
  VerifyRequest,
  WalletResponse,
} from "./types";

const TIMEOUT_MS = 30_000;

export interface GatewayCall<T> {
  body: T;
  code: string;
  outcome: Outcome;
  /** What we sent, minus secrets — stored on `transactions.request`. */
  request: Record<string, unknown>;
  requestId: string;
}

/** A transport-level failure: no usable body came back. */
export class GatewayUnreachableError extends Error {
  /** Treated as indeterminate: the request may well have been processed. */
  readonly outcome: Outcome = "indeterminate";
  constructor(
    readonly path: string,
    readonly cause_: unknown,
  ) {
    super(`Collection gateway did not answer ${path}`);
    this.name = "GatewayUnreachableError";
  }
}

/**
 * Base URL and merchant id are resolved per call, not at module load: both are
 * runtime-configurable from /settings (falling back to the environment), so
 * reading them once would pin the process to whatever was set at boot.
 */
async function endpoint(path: string): Promise<string> {
  const { baseUrl } = await getGatewayConfig();
  return `${baseUrl}${serverEnv.collectionPrefix()}${path}`;
}

async function merchantId(): Promise<string> {
  return assertMerchantId((await getGatewayConfig()).merchantId);
}

/**
 * `version` is separated out because on direct-payment and delink it is also
 * the QA fixture selector — callers that want a fixture pass it explicitly.
 */
function walletHeaders(operatorId: OperatorId, requestId: string, version?: string) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    region: serverEnv.region(),
    mode: serverEnv.mode(),
    version: version ?? serverEnv.version(),
    // must equal the body's operatorId
    operatorId,
    "Request-Id": requestId,
  };
}

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  requestId: string,
): Promise<GatewayCall<T>> {
  let response: Response;
  try {
    response = await fetch(await endpoint(path), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new GatewayUnreachableError(path, cause);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GatewayUnreachableError(
      path,
      new Error(`HTTP ${response.status}, non-JSON body: ${text.slice(0, 200)}`),
    );
  }

  // Wallet endpoints always answer 200; a non-200 with a JSON body still tells
  // us something, so keep the body if it carries a status we can classify.
  const asRecord = parsed as { status?: unknown };
  const code = typeof asRecord.status === "string" ? asRecord.status : undefined;

  if (!response.ok && !code) {
    throw new GatewayUnreachableError(
      path,
      new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`),
    );
  }

  return {
    body: parsed as T,
    // an absent status classifies as indeterminate, which is what we want
    code: code ?? "",
    outcome: classify(code),
    request: body,
    requestId,
  };
}

function newRequestId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Wallet endpoints
// ---------------------------------------------------------------------------

/**
 * §4.1 — starts a one-time payment or a tokenization and sends the OTP.
 * Only available on the OTP flow (and always, for tokenization).
 */
export async function initiate(
  input: InitiateRequest,
): Promise<GatewayCall<WalletResponse>> {
  const requestId = newRequestId();
  const operatorId = assertOperatorId(input.operatorId);
  const body = {
    merchantId: await merchantId(),
    operatorId,
    amount: formatAmount(input.amount),
    userKey: assertUserKey(input.userKey),
    msisdn: normaliseMsisdn(input.msisdn),
    transactionType: assertTransactionType(input.transactionType),
  };
  return post<WalletResponse>(
    "/v2/wallets/transaction/initiate",
    body,
    walletHeaders(operatorId, requestId),
    requestId,
  );
}

/**
 * §4.2 — completes the payment with the OTP (OTP flow), or *is* the payment
 * (Non-OTP flow). Mints a `sourceId` when transactionType is "8".
 *
 * Passing `transactionId` continues initiate's transaction; omitting it starts
 * a new one. Getting that wrong is the single easiest way to double-charge on
 * the OTP flow, so callers pass it explicitly.
 */
export async function verify(
  input: VerifyRequest,
): Promise<GatewayCall<WalletResponse>> {
  const requestId = newRequestId();
  const operatorId = assertOperatorId(input.operatorId);
  const body: Record<string, unknown> = {
    merchantId: await merchantId(),
    operatorId,
    amount: formatAmount(input.amount),
    userKey: assertUserKey(input.userKey),
    msisdn: normaliseMsisdn(input.msisdn),
    transactionType: assertTransactionType(input.transactionType),
  };
  if (input.transactionId) body.transactionId = input.transactionId;
  if (input.otp) body.otp = input.otp;

  return post<WalletResponse>(
    "/v2/wallets/transaction/verify",
    body,
    walletHeaders(operatorId, requestId),
    requestId,
  );
}

/**
 * §4.4 — redeems a JazzCash hosted registration for a `sourceId`.
 * Idempotent per orderId: re-finalizing returns the same token, so a missed
 * redirect is safe to retry.
 */
export async function finalize(
  input: FinalizeRequest,
): Promise<GatewayCall<WalletResponse>> {
  const requestId = newRequestId();
  const operatorId = assertOperatorId(input.operatorId);
  const body = {
    merchantId: await merchantId(),
    operatorId,
    orderId: assertUserKey(input.orderId),
    msisdn: normaliseMsisdn(input.msisdn),
  };
  return post<WalletResponse>(
    "/v2/wallets/transaction/finalize",
    body,
    walletHeaders(operatorId, requestId),
    requestId,
  );
}

/**
 * §4.5 — charges a stored token with the customer absent. This is 1-click
 * checkout and the engine behind subscription renewals.
 *
 * `versionOverride` exists only for driving §7 fixtures in tests; normal
 * traffic must leave it unset.
 */
export async function directPayment(
  input: DirectPaymentRequest,
  versionOverride?: string,
): Promise<GatewayCall<WalletResponse>> {
  const requestId = newRequestId();
  const operatorId = assertOperatorId(input.operatorId);
  const body = {
    merchantId: await merchantId(),
    operatorId,
    transactionType: "8" as const,
    amount: formatAmount(input.amount),
    userKey: assertUserKey(input.userKey),
    sourceId: assertSourceId(input.sourceId),
    platform: input.platform ?? "web",
  };
  return post<WalletResponse>(
    "/v2/wallets/transaction/direct-payment",
    body,
    walletHeaders(operatorId, requestId, versionOverride),
    requestId,
  );
}

/** §4.6 — retires a token. Charging it afterwards answers 0028. */
export async function delink(
  input: DelinkRequest,
): Promise<GatewayCall<WalletResponse>> {
  const requestId = newRequestId();
  const operatorId = assertOperatorId(input.operatorId);
  const body = {
    merchantId: await merchantId(),
    operatorId,
    sourceId: assertSourceId(input.sourceId),
  };
  return post<WalletResponse>(
    "/v2/wallets/transaction/delink",
    body,
    walletHeaders(operatorId, requestId),
    requestId,
  );
}

/**
 * §4.7 — reads a transaction's live status. This is how an indeterminate
 * response gets resolved. Note the code lives at `transaction.status`, not at
 * the top level, so it is lifted here.
 */
export async function inquiry(
  input: InquiryRequest,
): Promise<GatewayCall<InquiryResponse>> {
  const requestId = newRequestId();
  if (!input.transactionId && !input.userKey) {
    throw new Error("inquiry requires transactionId or userKey");
  }
  const body: Record<string, unknown> = {
    merchantId: await merchantId(),
  };
  if (input.transactionId) body.transactionId = input.transactionId;
  if (input.userKey) body.userKey = input.userKey;

  const call = await post<InquiryResponse>(
    "/v2/inquire/wallet/transaction/inquiry",
    body,
    {
      "Content-Type": "application/json",
      Accept: "application/json",
      region: serverEnv.region(),
      mode: serverEnv.mode(),
      version: serverEnv.version(),
      "Request-Id": requestId,
    },
    requestId,
  );

  const inner = call.body?.transaction?.status;
  return { ...call, code: inner ?? call.code, outcome: classify(inner) };
}

/**
 * §4.8 — refunds a settled transaction. Success is **0135**, not 0000, and the
 * order moves to RefundSubmitted until the postback confirms it.
 */
export async function refund(
  input: RefundRequest,
): Promise<GatewayCall<RefundResponse>> {
  const requestId = newRequestId();
  const mid = await merchantId();
  const transactionId = assertTransactionId(input.transactionId);
  const transactionDate = assertTransactionDate(input.transactionDate);

  const body: Record<string, unknown> = {
    transactionId,
    merchantId: mid,
    transactionDate,
    type: "WALLETS",
  };
  // Omitting amount means a full refund.
  if (input.amount) body.amount = formatAmount(input.amount);
  body.signature = signRefund(body);

  return post<RefundResponse>(
    "/v3/transaction/refund",
    body,
    {
      "Content-Type": "application/json",
      Accept: "application/json",
      region: serverEnv.region(),
      mode: serverEnv.mode(),
      version: serverEnv.version(),
      "Request-Id": requestId,
    },
    requestId,
  );
}

/**
 * Refund signature. The guide does not pin the algorithm, so this is a
 * placeholder: HMAC-SHA256 over the sorted field values.
 * ⚠️ Confirm the real scheme with the gateway team — a mismatch answers 0054.
 */
function signRefund(body: Record<string, unknown>): string {
  const payload = Object.keys(body)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => `${k}=${String(body[k])}`)
    .join("&");
  return createHmac("sha256", serverEnv.refundSigningSecret())
    .update(payload)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Hosted flows (browser redirects — we only build the URLs)
// ---------------------------------------------------------------------------

/**
 * §4.3 — JazzCash wallet linking. Returns a URL to redirect the browser to.
 * All of MerchantId, OrderId, Amount, ReturnUrl and transactionType=8 are
 * required; an illegal launch renders a 400 page and does not redirect.
 */
export async function jazzCashRegistrationUrl(input: {
  orderId: string;
  amount: number | string;
  returnUrl: string;
  msisdn?: string;
}): Promise<string> {
  const params = new URLSearchParams({
    MerchantId: await merchantId(),
    OrderId: assertUserKey(input.orderId),
    Amount: formatAmount(input.amount),
    ReturnUrl: input.returnUrl,
    transactionType: "8",
  });
  if (input.msisdn) params.set("MobileNo", normaliseMsisdn(input.msisdn));
  return `${await endpoint("/jc/registrationfull")}?${params.toString()}`;
}

/**
 * §4.9 — Hosted Page checkout. Answers 302 to `redirectUrl` with a
 * `status=0037` in most cases; the real outcome comes from hostedInquiry().
 */
export async function hostedCheckoutUrl(input: {
  orderId: string;
  amount: number | string;
  redirectUrl: string;
  operatorId?: OperatorId;
}): Promise<string> {
  const params = new URLSearchParams({
    merchantId: await merchantId(),
    key: serverEnv.merchantKey(),
    orderId: assertUserKey(input.orderId),
    amount: formatAmount(input.amount),
    redirectUrl: input.redirectUrl,
  });
  if (input.operatorId) params.set("operator", assertOperatorId(input.operatorId));
  return `${await endpoint("/checkout")}?${params.toString()}`;
}

/** §4.9 — poll the hosted-page outcome. Keyed by orderId, not transactionId. */
export async function hostedInquiry(
  orderId: string,
): Promise<GatewayCall<HostedInquiryResponse>> {
  const requestId = newRequestId();
  return post<HostedInquiryResponse>(
    "/inquire",
    {
      merchantId: await merchantId(),
      orderId: assertUserKey(orderId),
    },
    {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Request-Id": requestId,
    },
    requestId,
  );
}
