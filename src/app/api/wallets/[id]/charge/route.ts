/**
 * Charges a saved wallet on demand (§4.5) — a top-up that goes through the
 * tokenization merchant and needs no cart, no OTP and no customer present.
 *
 * This is the same direct-payment call the 1-click checkout and the subscription
 * charger make; the only difference is that the amount comes from the request
 * instead of from a cart or a plan. It deliberately does not touch the cart: a
 * recharge is not a cart checkout, and closing an open cart here would lose a
 * basket the customer is still filling.
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError } from "@/lib/api";
import * as gateway from "@/lib/collection/client";
import { applyOutcome, createOrder, recordTransaction } from "@/lib/orders";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

const schema = z.object({
  /**
   * Two decimals at most, matching what `formatAmount` will accept — rejecting
   * it here gives a field-level message instead of a bare 0002 from the gateway.
   */
  amount: z
    .number()
    .positive("Enter an amount greater than zero.")
    .max(1_000_000, "That amount is beyond what this app will send.")
    // Compared through toFixed rather than `v * 100 % 1`, which floating point
    // makes false for values like 10.05.
    .refine((v) => Number(v.toFixed(2)) === v, {
      message: "Amounts can have at most two decimal places.",
    }),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { amount } = schema.parse(await request.json());
    const admin = getSupabaseAdminClient();

    const { data: token } = await admin
      .from("payment_tokens")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!token) {
      return err("0036", "That saved wallet is no longer usable.", 409);
    }

    const order = await createOrder({
      userId: user.id,
      amount,
      channel: "direct_payment",
      operatorId: token.operator_id,
      msisdn: token.msisdn,
      items: [],
    });

    const call = await gateway.directPayment({
      operatorId: token.operator_id as "100007" | "100008",
      amount,
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

    // A token that is gone stays gone — mirror it locally so the UI stops
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

    return fromGateway(call.code, {
      orderId: order.id,
      orderRef: order.order_ref,
      orderStatus: status,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
