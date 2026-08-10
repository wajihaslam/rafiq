/**
 * Starts a cart checkout over a wallet.
 *
 * Three shapes, all handled here because they all consume the same cart:
 *   savedTokenId  → direct-payment, customer absent, settles in one call
 *   OTP flow      → initiate, then the customer posts the OTP to ../verify
 *   Non-OTP flow  → verify with no otp and no transactionId; this *is* the
 *                   payment, so there is no second call
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError } from "@/lib/api";
import { closeCart, loadOpenCart } from "@/lib/cart";
import * as gateway from "@/lib/collection/client";
import { OPERATORS } from "@/lib/collection/types";
import { applyOutcome, createOrder, recordTransaction } from "@/lib/orders";
import { getGatewayConfig } from "@/lib/settings";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

const schema = z
  .object({
    operatorId: z.enum([OPERATORS.easypaisa, OPERATORS.jazzcash]).optional(),
    msisdn: z.string().min(10).optional(),
    /** Pay with a previously linked wallet — 1-click. */
    savedTokenId: z.string().uuid().optional(),
  })
  .refine((v) => v.savedTokenId || (v.operatorId && v.msisdn), {
    message: "Choose a saved wallet, or give an operator and mobile number.",
  });

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());

    const cart = await loadOpenCart(user.id);
    if (!cart || cart.items.length === 0) {
      return err("EMPTY_CART", "Your cart is empty.", 409);
    }

    // ---- 1-click with a saved token -------------------------------------
    if (input.savedTokenId) {
      const admin = getSupabaseAdminClient();
      const { data: token } = await admin
        .from("payment_tokens")
        .select("*")
        .eq("id", input.savedTokenId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      if (!token) {
        return err("0036", "That saved wallet is no longer usable.", 409);
      }

      const order = await createOrder({
        userId: user.id,
        amount: cart.total,
        channel: "direct_payment",
        operatorId: token.operator_id,
        msisdn: token.msisdn,
        items: cart.items.map(({ product_id, name, qty, unit_price }) => ({
          product_id,
          name,
          qty,
          unit_price,
        })),
      });

      const call = await gateway.directPayment({
        operatorId: token.operator_id as "100007" | "100008",
        amount: cart.total,
        userKey: order.order_ref,
        sourceId: token.source_id,
      });

      await recordTransaction({
        orderId: order.id,
        userId: user.id,
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
      if (status === "paid") await closeCart(cart.cartId);

      return fromGateway(call.code, {
        orderId: order.id,
        orderRef: order.order_ref,
        orderStatus: status,
        needsOtp: false,
      });
    }

    // ---- fresh wallet payment -------------------------------------------
    const operatorId = input.operatorId!;
    const msisdn = input.msisdn!;
    const { flow } = await getGatewayConfig();

    const order = await createOrder({
      userId: user.id,
      amount: cart.total,
      channel: flow === "otp" ? "wallet_otp" : "wallet_non_otp",
      operatorId,
      msisdn,
      items: cart.items.map(({ product_id, name, qty, unit_price }) => ({
        product_id,
        name,
        qty,
        unit_price,
      })),
    });

    if (flow === "otp") {
      const call = await gateway.initiate({
        operatorId,
        amount: cart.total,
        userKey: order.order_ref,
        msisdn,
        transactionType: "0",
      });

      await recordTransaction({
        orderId: order.id,
        userId: user.id,
        kind: "payment",
        call,
        gatewayTransactionId: call.body?.transactionId,
        operatorId,
      });

      // initiate only creates the transaction; 0000 here means "OTP sent",
      // not "paid". The order stays pending until verify.
      if (call.code !== "0000") {
        const status = await applyOutcome({ orderId: order.id, code: call.code });
        return fromGateway(call.code, {
          orderId: order.id,
          orderRef: order.order_ref,
          orderStatus: status,
          needsOtp: false,
        });
      }

      // The transactionId must come back on verify or the gateway starts a
      // *second* transaction — i.e. a double charge. Persist it now.
      const admin = getSupabaseAdminClient();
      await admin
        .from("orders")
        .update({ status_code: call.code, message: "OTP sent" })
        .eq("id", order.id);

      return fromGateway(call.code, {
        orderId: order.id,
        orderRef: order.order_ref,
        orderStatus: "pending",
        needsOtp: true,
        gatewayTransactionId: call.body?.transactionId ?? null,
      });
    }

    // Non-OTP: verify is the first and only call.
    const call = await gateway.verify({
      operatorId,
      amount: cart.total,
      userKey: order.order_ref,
      msisdn,
      transactionType: "0",
    });

    await recordTransaction({
      orderId: order.id,
      userId: user.id,
      kind: "payment",
      call,
      gatewayTransactionId: call.body?.transactionId,
      operatorId,
    });

    const status = await applyOutcome({
      orderId: order.id,
      code: call.code,
      gatewayTransactionId: call.body?.transactionId,
    });
    if (status === "paid") await closeCart(cart.cartId);

    return fromGateway(call.code, {
      orderId: order.id,
      orderRef: order.order_ref,
      orderStatus: status,
      needsOtp: false,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
