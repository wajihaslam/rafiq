/**
 * Two ledgers, kept apart on purpose.
 *
 * A one-time payment and a tokenization are not the same transaction with a
 * different setting. They run under different merchants, they are resolved by
 * different calls, and a wallet that has been charged forty times is one
 * tokenization — not forty payments. Mixing them into a single "orders" list
 * makes the second kind unreadable: forty rows that all say the same thing,
 * with the fact that matters (which *wallet*) nowhere in sight.
 *
 * So:
 *   `oneTimePayments()`  — one row per payment, each with its own step trail.
 *   `tokenizations()`    — one row per linked wallet, its charges tallied into
 *                          a single step.
 */

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { oneTimeSteps, tokenSteps, type Flow, type Step } from "@/lib/steps";
import type {
  OrderChannel,
  OrderStatus,
  PaymentToken,
  TokenStatus,
  TxnOperation,
} from "@/lib/db-types";

/** Channels that are a customer paying now, as opposed to a token being charged. */
const ONE_TIME_CHANNELS: OrderChannel[] = [
  "wallet_otp",
  "wallet_non_otp",
  // No longer offered, but historical orders still have to appear somewhere.
  "hosted_page",
];

export interface OneTimeRow {
  orderId: string;
  orderRef: string;
  amount: number;
  status: OrderStatus;
  channel: OrderChannel;
  operatorId: string | null;
  msisdn: string | null;
  statusCode: string | null;
  createdAt: string;
  /** The gateway transaction, once there is one — this is what a refund names. */
  gatewayTransactionId: string | null;
  steps: Step[];
}

export async function oneTimePayments(
  userId: string,
  limit = 50,
): Promise<OneTimeRow[]> {
  const admin = getSupabaseAdminClient();

  const { data: orders } = await admin
    .from("orders")
    .select("*")
    .eq("user_id", userId)
    .in("channel", ONE_TIME_CHANNELS)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = orders ?? [];
  if (rows.length === 0) return [];

  const trail = await operationsByOrder(rows.map((o) => o.id as string));

  return rows.map((order) => {
    const entries = trail.get(order.id as string) ?? [];
    return {
      orderId: order.id as string,
      orderRef: order.order_ref as string,
      amount: Number(order.amount),
      status: order.status as OrderStatus,
      channel: order.channel as OrderChannel,
      operatorId: (order.operator_id as string | null) ?? null,
      msisdn: (order.msisdn as string | null) ?? null,
      statusCode: (order.status_code as string | null) ?? null,
      createdAt: order.created_at as string,
      gatewayTransactionId:
        entries.find((e) => e.gatewayTransactionId)?.gatewayTransactionId ?? null,
      steps: oneTimeSteps({
        flow: flowOfChannel(order.channel as OrderChannel),
        operations: entries.map((e) => e.operation).filter(Boolean) as TxnOperation[],
        orderStatus: order.status as string,
      }),
    };
  });
}

/**
 * The step trail of a *finished* payment has to come from what happened, not
 * from what is configured now: an order placed on the OTP flow keeps its
 * initiate step after an administrator switches the merchant to Non-OTP.
 */
function flowOfChannel(channel: OrderChannel): Flow {
  return channel === "wallet_otp" ? "otp" : "non_otp";
}

interface TrailEntry {
  operation: TxnOperation | null;
  gatewayTransactionId: string | null;
}

async function operationsByOrder(
  orderIds: string[],
): Promise<Map<string, TrailEntry[]>> {
  const admin = getSupabaseAdminClient();
  const { data } = await admin
    .from("transactions")
    .select("order_id, operation, gateway_transaction_id, created_at")
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  const byOrder = new Map<string, TrailEntry[]>();
  for (const row of data ?? []) {
    const key = row.order_id as string;
    const list = byOrder.get(key) ?? [];
    list.push({
      operation: (row.operation as TxnOperation | null) ?? null,
      gatewayTransactionId: (row.gateway_transaction_id as string | null) ?? null,
    });
    byOrder.set(key, list);
  }
  return byOrder;
}

export interface TokenChargeRow {
  orderId: string;
  orderRef: string;
  amount: number;
  status: OrderStatus;
  createdAt: string;
  statusCode: string | null;
}

export interface TokenizationRow {
  tokenId: string | null;
  /** Present while a link is still in flight and no token exists yet. */
  registrationOrderRef: string | null;
  operatorId: string;
  msisdn: string;
  label: string | null;
  status: TokenStatus | "pending" | "failed" | "declined";
  linkedAt: string | null;
  expiresAt: string | null;
  /** Every direct payment made against this token, newest first. */
  charges: TokenChargeRow[];
  chargeCount: number;
  refundCount: number;
  steps: Step[];
}

/**
 * One row per wallet — linked or merely attempted — with its charges gathered
 * underneath rather than scattered through a payment list.
 *
 * Charges are matched to a token by `(operator, msisdn)` rather than by a
 * foreign key, because orders record the wallet they charged but not which
 * token row minted it. That is exact in practice: a token *is* an operator and
 * a number, and re-linking the same number yields the same pairing.
 */
export async function tokenizations(userId: string): Promise<TokenizationRow[]> {
  const admin = getSupabaseAdminClient();

  const [{ data: tokenRows }, { data: registrations }, { data: charges }] =
    await Promise.all([
      admin
        .from("payment_tokens")
        .select("*")
        .eq("user_id", userId)
        .order("linked_at", { ascending: false }),
      admin
        .from("wallet_registrations")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      admin
        .from("orders")
        .select("*")
        .eq("user_id", userId)
        .eq("channel", "direct_payment")
        .order("created_at", { ascending: false }),
    ]);

  const tokens = (tokenRows ?? []) as PaymentToken[];
  const chargeRows = charges ?? [];

  /** `operator:msisdn` — the pairing a token actually is. */
  const key = (operatorId: string, msisdn: string) => `${operatorId}:${msisdn}`;

  const chargesByWallet = new Map<string, TokenChargeRow[]>();
  for (const order of chargeRows) {
    const k = key(
      (order.operator_id as string) ?? "",
      (order.msisdn as string) ?? "",
    );
    const list = chargesByWallet.get(k) ?? [];
    list.push({
      orderId: order.id as string,
      orderRef: order.order_ref as string,
      amount: Number(order.amount),
      status: order.status as OrderStatus,
      createdAt: order.created_at as string,
      statusCode: (order.status_code as string | null) ?? null,
    });
    chargesByWallet.set(k, list);
  }

  const rows: TokenizationRow[] = tokens.map((token) => {
    const mine = chargesByWallet.get(key(token.operator_id, token.msisdn)) ?? [];
    const refundCount = mine.filter(
      (c) => c.status === "refund_submitted" || c.status === "refunded",
    ).length;

    return {
      tokenId: token.id,
      registrationOrderRef: null,
      operatorId: token.operator_id,
      msisdn: token.msisdn,
      label: token.label,
      status: token.status,
      linkedAt: token.linked_at,
      expiresAt: token.expires_at,
      charges: mine,
      chargeCount: mine.length,
      refundCount,
      steps: tokenSteps({
        initiated: true,
        verified: true,
        charges: mine.length,
        refunds: refundCount,
        live: token.status === "active",
      }),
    };
  });

  // A link that never produced a token is still tokenization traffic, and it is
  // the case you most want to see — it is the one that went wrong.
  const linkedNumbers = new Set(
    tokens.map((t) => key(t.operator_id, t.msisdn)),
  );

  for (const reg of registrations ?? []) {
    const k = key(reg.operator_id as string, reg.msisdn as string);
    if (reg.status === "linked" || linkedNumbers.has(k)) continue;

    rows.push({
      tokenId: null,
      registrationOrderRef: reg.order_ref as string,
      operatorId: reg.operator_id as string,
      msisdn: reg.msisdn as string,
      label: (reg.label as string | null) ?? null,
      status: reg.status as "pending" | "failed" | "declined",
      linkedAt: null,
      expiresAt: null,
      charges: [],
      chargeCount: 0,
      refundCount: 0,
      steps: tokenSteps({
        initiated: true,
        verified: false,
        charges: 0,
        refunds: 0,
        live: reg.status === "pending",
      }),
    });
  }

  return rows;
}
