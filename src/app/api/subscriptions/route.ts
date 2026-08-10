/**
 * Starts a subscription against a saved wallet, and charges the first period
 * immediately so the customer knows straight away whether the token works.
 */

import { z } from "zod";

import { err, handleRouteError, ok } from "@/lib/api";
import { customerMessage } from "@/lib/collection/codes";
import { chargeSubscription } from "@/lib/subscriptions";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";
import type { Subscription } from "@/lib/db-types";

const schema = z.object({
  productId: z.string().uuid(),
  paymentTokenId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { productId, paymentTokenId } = schema.parse(await request.json());
    const admin = getSupabaseAdminClient();

    const { data: product } = await admin
      .from("products")
      .select("*")
      .eq("id", productId)
      .eq("active", true)
      .eq("kind", "subscription")
      .maybeSingle();
    if (!product?.interval_days) {
      return err("NOT_FOUND", "That plan is unavailable.", 404);
    }

    const { data: token } = await admin
      .from("payment_tokens")
      .select("id")
      .eq("id", paymentTokenId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!token) {
      return err(
        "0036",
        "Link a wallet before starting a subscription.",
        409,
      );
    }

    const { data: existing } = await admin
      .from("subscriptions")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("product_id", productId)
      .maybeSingle();

    if (existing && existing.status !== "cancelled") {
      return err("0005", "You are already subscribed to this plan.", 409);
    }

    // A previously cancelled subscription is revived rather than duplicated —
    // (user_id, product_id) is unique.
    const payload = {
      user_id: user.id,
      product_id: productId,
      payment_token_id: paymentTokenId,
      interval_days: product.interval_days,
      amount: product.price,
      status: "active" as const,
      next_charge_at: new Date().toISOString(),
      failed_attempts: 0,
      last_charge_at: null,
    };

    const { data: sub, error } = existing
      ? await admin
          .from("subscriptions")
          .update(payload)
          .eq("id", existing.id)
          .select("*, products(*)")
          .single()
      : await admin
          .from("subscriptions")
          .insert(payload)
          .select("*, products(*)")
          .single();

    if (error) throw new Error(error.message);

    const result = await chargeSubscription(sub as unknown as Subscription);

    // An indeterminate first charge is not a failure — the subscription stands
    // and the order resolves by postback or inquiry.
    if (result.outcome === "failure") {
      await admin
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("id", sub.id);
    }

    return ok({
      subscriptionId: sub.id,
      orderId: result.orderId,
      code: result.code,
      outcome: result.outcome,
      message: customerMessage(result.code),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
