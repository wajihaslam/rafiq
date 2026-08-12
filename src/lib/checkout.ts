/**
 * The payment mechanics for a one-time purchase, independent of *what* is being
 * paid for.
 *
 * There is exactly one shape now: a mobile wallet, run as the merchant's flow
 * demands — `initiate → OTP → verify` on the OTP flow, `verify` alone on
 * Non-OTP. The saved-token and hosted-page paths that used to live here are
 * gone: a stored token is charged from the wallet it belongs to (`direct
 * payment`, which is tokenization and tracked as such), and the hosted page is
 * no longer offered at checkout.
 *
 * Keeping this out of the route handler still earns its place — the OTP and
 * Non-OTP branches differ in ways (which call, which channel, whether success
 * is held) that no route should have to remember.
 */

import "server-only";

import * as gateway from "@/lib/collection/client";
import type { OperatorId } from "@/lib/collection/types";
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

/** Everything the API layer needs to answer, plus what it needs to decide. */
export interface StartResult {
  code: string;
  orderId: string;
  orderRef: string;
  orderStatus: OrderStatus;
  /** True on the OTP flow when initiate was accepted and the OTP is on its way. */
  needsOtp: boolean;
  gatewayTransactionId?: string | null;
}

/** The OTP-flow second call. */
export interface VerifyResult {
  code: string;
  orderId: string;
  orderRef: string;
  orderStatus: OrderStatus;
  canRetryOtp: boolean;
  problem?: { code: string; message: string; status: number };
}

/** A wrong or missing OTP leaves the transaction alive — the customer retries. */
const RETRYABLE_OTP_CODES = ["0011", "0095"];

export async function startPayment(params: {
  userId: string;
  amount: number;
  items: PayLine[];
  operatorId: OperatorId;
  msisdn: string;
}): Promise<StartResult> {
  const { userId, amount, items, operatorId, msisdn } = params;
  const admin = getSupabaseAdminClient();
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
      operation: "initiate",
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
    operation: "verify",
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
    operatorId: order.operator_id as OperatorId,
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
    operation: "verify",
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
  };
}
