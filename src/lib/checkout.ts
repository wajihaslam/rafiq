/**
 * The payment mechanics, independent of *what* is being paid for.
 *
 * The cart checkout and the shop's "Pay now" both run the same three shapes —
 * saved token, OTP wallet, non-OTP wallet, plus the hosted page — so they live
 * here once and each route supplies its own lines and its own aftercare (the
 * cart route closes the cart; a direct product payment has nothing to close).
 */

import "server-only";

import * as gateway from "@/lib/collection/client";
import { OPERATORS } from "@/lib/collection/types";
import { publicEnv } from "@/lib/env";
import { applyOutcome, createOrder, recordTransaction } from "@/lib/orders";
import { getActiveFlow } from "@/lib/settings";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/lib/db-types";

export interface PayLine {
  product_id: string;
  name: string;
  qty: number;
  unit_price: number;
}

export type PayMethod =
  | { kind: "saved"; savedTokenId: string }
  | { kind: "wallet"; operatorId: string; msisdn: string }
  | { kind: "hosted" };

/** Everything the API layer needs to answer, plus what it needs to decide. */
export interface StartResult {
  code: string;
  orderId: string;
  orderRef: string;
  orderStatus: OrderStatus;
  needsOtp: boolean;
  redirectTo?: string;
  gatewayTransactionId?: string | null;
  /**
   * True when the gateway took the charge — i.e. anything that is not an
   * outright failure. The caller uses this to decide whether the source of the
   * lines (a cart) may still be spent again.
   */
  consumed: boolean;
  /** Set when the payment cannot start at all; the caller turns it into an error. */
  problem?: { code: string; message: string; status: number };
}

/** The OTP-flow second call, shared by both checkout entry points. */
export interface VerifyResult {
  code: string;
  orderId: string;
  orderRef: string;
  orderStatus: OrderStatus;
  canRetryOtp: boolean;
  consumed: boolean;
  problem?: { code: string; message: string; status: number };
}

/** A wrong or missing OTP leaves the transaction alive — the customer retries. */
const RETRYABLE_OTP_CODES = ["0011", "0095"];

export async function startPayment(params: {
  userId: string;
  amount: number;
  items: PayLine[];
  method: PayMethod;
}): Promise<StartResult> {
  const { userId, amount, items, method } = params;
  const admin = getSupabaseAdminClient();

  // ---- hosted page ------------------------------------------------------
  if (method.kind === "hosted") {
    const order = await createOrder({
      userId,
      amount,
      channel: "hosted_page",
      items,
    });

    const url = await gateway.hostedCheckoutUrl({
      orderId: order.order_ref,
      amount,
      redirectUrl: `${publicEnv.appUrl()}/pay/hosted/return`,
    });

    return {
      code: "0000",
      orderId: order.id,
      orderRef: order.order_ref,
      orderStatus: "pending",
      needsOtp: false,
      redirectTo: url,
      // The browser leaves for the gateway; nothing may be re-spent behind it.
      consumed: true,
    };
  }

  // ---- 1-click with a saved token ---------------------------------------
  if (method.kind === "saved") {
    const { data: token } = await admin
      .from("payment_tokens")
      .select("*")
      .eq("id", method.savedTokenId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!token) {
      return {
        code: "0036",
        orderId: "",
        orderRef: "",
        orderStatus: "failed",
        needsOtp: false,
        consumed: false,
        problem: {
          code: "0036",
          message: "That saved wallet is no longer usable.",
          status: 409,
        },
      };
    }

    const order = await createOrder({
      userId,
      amount,
      channel: "direct_payment",
      operatorId: token.operator_id,
      msisdn: token.msisdn,
      items,
    });

    const call = await gateway.directPayment({
      operatorId: token.operator_id as "100007" | "100008",
      amount,
      userKey: order.order_ref,
      sourceId: token.source_id,
    });

    await recordTransaction({
      orderId: order.id,
      userId,
      kind: "direct_payment",
      call,
      gatewayTransactionId: call.body?.transactionId,
      operatorId: token.operator_id,
    });

    // A token that is gone stays gone — reflect that locally so the UI stops
    // offering it. 0034 is a payload fault, not a dead token, so it's excluded.
    if (call.code === "0028" || call.code === "0036") {
      await admin
        .from("payment_tokens")
        .update({ status: call.code === "0028" ? "expired" : "delinked" })
        .eq("id", token.id);
    }

    const status = await applyOutcome({
      orderId: order.id,
      code: call.code,
      gatewayTransactionId: call.body?.transactionId,
    });

    return {
      code: call.code,
      orderId: order.id,
      orderRef: order.order_ref,
      orderStatus: status,
      needsOtp: false,
      // Anything short of an outright failure counts as spent, exactly as on
      // the verify path below. An indeterminate direct payment may well have
      // moved money, so leaving the cart open would invite paying it twice.
      consumed: status !== "failed",
    };
  }

  // ---- fresh wallet payment ---------------------------------------------
  const operatorId = method.operatorId as typeof OPERATORS.easypaisa;
  const msisdn = method.msisdn;
  const flow = await getActiveFlow();

  const order = await createOrder({
    userId,
    amount,
    channel: flow === "otp" ? "wallet_otp" : "wallet_non_otp",
    operatorId,
    msisdn,
    items,
  });

  if (flow === "otp") {
    const call = await gateway.initiate({
      operatorId,
      amount,
      userKey: order.order_ref,
      msisdn,
      transactionType: "0",
    });

    await recordTransaction({
      orderId: order.id,
      userId,
      kind: "payment",
      call,
      gatewayTransactionId: call.body?.transactionId,
      operatorId,
    });

    // initiate only creates the transaction; 0000 here means "OTP sent",
    // not "paid". The order stays pending until verify.
    if (call.code !== "0000") {
      const status = await applyOutcome({
        orderId: order.id,
        code: call.code,
        holdSuccess: true,
      });
      return {
        code: call.code,
        orderId: order.id,
        orderRef: order.order_ref,
        orderStatus: status,
        needsOtp: false,
        consumed: false,
      };
    }

    await admin
      .from("orders")
      .update({ status_code: call.code, message: "OTP sent" })
      .eq("id", order.id);

    return {
      code: call.code,
      orderId: order.id,
      orderRef: order.order_ref,
      orderStatus: "pending",
      needsOtp: true,
      gatewayTransactionId: call.body?.transactionId ?? null,
      // The money moves on verify, so nothing is spent yet.
      consumed: false,
    };
  }

  // Non-OTP: verify is the first and only call.
  const call = await gateway.verify({
    operatorId,
    amount,
    userKey: order.order_ref,
    msisdn,
    transactionType: "0",
  });

  await recordTransaction({
    orderId: order.id,
    userId,
    kind: "payment",
    call,
    gatewayTransactionId: call.body?.transactionId,
    operatorId,
  });

  // Verify is a payment attempt, not a settlement: a success code holds the
  // order pending until an inquiry confirms it.
  const status = await applyOutcome({
    orderId: order.id,
    code: call.code,
    gatewayTransactionId: call.body?.transactionId,
    holdSuccess: true,
  });

  return {
    code: call.code,
    orderId: order.id,
    orderRef: order.order_ref,
    orderStatus: status,
    needsOtp: false,
    consumed: status !== "failed",
  };
}

/**
 * Completes an OTP-flow payment.
 *
 * The transactionId is read back from our own audit trail rather than taken
 * from the request body: initiate and verify are one transaction, and letting a
 * client choose which transaction to verify would be both a double-charge and
 * an authorisation hole.
 */
export async function verifyOtpPayment(params: {
  userId: string;
  orderId: string;
  otp: string;
}): Promise<VerifyResult> {
  const admin = getSupabaseAdminClient();
  const blank = {
    code: "",
    orderId: params.orderId,
    orderRef: "",
    orderStatus: "pending" as OrderStatus,
    canRetryOtp: false,
    consumed: false,
  };

  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("id", params.orderId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!order) {
    return {
      ...blank,
      problem: { code: "NOT_FOUND", message: "Order not found.", status: 404 },
    };
  }
  if (order.status !== "pending") {
    return {
      ...blank,
      problem: {
        code: "ALREADY_SETTLED",
        message: "This order is no longer awaiting payment.",
        status: 409,
      },
    };
  }
  if (order.channel !== "wallet_otp") {
    return {
      ...blank,
      problem: {
        code: "0015",
        message: "This order does not use an OTP.",
        status: 409,
      },
    };
  }

  const { data: initiateTxn } = await admin
    .from("transactions")
    .select("gateway_transaction_id")
    .eq("order_id", order.id)
    .eq("kind", "payment")
    .not("gateway_transaction_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!initiateTxn?.gateway_transaction_id) {
    return {
      ...blank,
      problem: {
        code: "0097",
        message:
          "We could not match this order to a transaction. Please start again.",
        status: 409,
      },
    };
  }

  const call = await gateway.verify({
    operatorId: order.operator_id as "100007" | "100008",
    amount: Number(order.amount),
    userKey: order.order_ref,
    msisdn: order.msisdn as string,
    transactionType: "0",
    transactionId: initiateTxn.gateway_transaction_id,
    otp: params.otp,
  });

  await recordTransaction({
    orderId: order.id,
    userId: params.userId,
    kind: "payment",
    call,
    gatewayTransactionId: call.body?.transactionId,
    operatorId: order.operator_id,
  });

  const canRetryOtp = RETRYABLE_OTP_CODES.includes(call.code);
  // A retryable OTP failure must not burn the transaction — leave it pending.
  const status = canRetryOtp
    ? "pending"
    : await applyOutcome({
        orderId: order.id,
        code: call.code,
        gatewayTransactionId: call.body?.transactionId,
        holdSuccess: true,
      });

  return {
    code: call.code,
    orderId: order.id,
    orderRef: order.order_ref,
    orderStatus: status,
    canRetryOtp,
    consumed: !canRetryOtp && status !== "failed",
  };
}
