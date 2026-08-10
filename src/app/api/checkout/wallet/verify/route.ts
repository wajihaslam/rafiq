/**
 * Completes an OTP-flow cart payment.
 *
 * The transactionId is read back from our own audit trail rather than taken
 * from the request body: initiate and verify are one transaction, and letting a
 * client choose which transaction to verify would be both a double-charge and
 * an authorisation hole.
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError } from "@/lib/api";
import { closeCart, loadOpenCart } from "@/lib/cart";
import * as gateway from "@/lib/collection/client";
import { applyOutcome, recordTransaction } from "@/lib/orders";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

const schema = z.object({
  orderId: z.string().uuid(),
  otp: z.string().regex(/^\d{4,8}$/, "Enter the OTP you received."),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { orderId, otp } = schema.parse(await request.json());
    const admin = getSupabaseAdminClient();

    const { data: order } = await admin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!order) return err("NOT_FOUND", "Order not found.", 404);
    if (order.status !== "pending") {
      return err("ALREADY_SETTLED", "This order is no longer awaiting payment.", 409);
    }
    if (order.channel !== "wallet_otp") {
      return err("0015", "This order does not use an OTP.", 409);
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
      return err(
        "0097",
        "We could not match this order to a transaction. Please start again.",
        409,
      );
    }

    const call = await gateway.verify({
      operatorId: order.operator_id as "100007" | "100008",
      amount: Number(order.amount),
      userKey: order.order_ref,
      msisdn: order.msisdn as string,
      transactionType: "0",
      transactionId: initiateTxn.gateway_transaction_id,
      otp,
    });

    await recordTransaction({
      orderId: order.id,
      userId: user.id,
      kind: "payment",
      call,
      gatewayTransactionId: call.body?.transactionId,
      operatorId: order.operator_id,
    });

    // A wrong or missing OTP is recoverable — leave the order pending so the
    // customer can retry, and don't burn the transaction.
    const retryable = ["0011", "0095"];
    const status = retryable.includes(call.code)
      ? "pending"
      : await applyOutcome({
          orderId: order.id,
          code: call.code,
          gatewayTransactionId: call.body?.transactionId,
        });

    if (status === "paid") {
      const cart = await loadOpenCart(user.id);
      if (cart) await closeCart(cart.cartId);
    }

    return fromGateway(call.code, {
      orderId: order.id,
      orderRef: order.order_ref,
      orderStatus: status,
      canRetryOtp: retryable.includes(call.code),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
