/**
 * Subscription billing. Renewals are direct-payment charges against a stored
 * token with the customer absent — which is exactly what tokenization exists
 * for on the Non-OTP flow.
 */

import "server-only";

import * as gateway from "@/lib/collection/client";
import { GatewayUnreachableError } from "@/lib/collection/client";
import { classify } from "@/lib/collection/codes";
import { applyOutcome, createOrder, recordTransaction } from "@/lib/orders";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import type { Subscription } from "@/lib/db-types";

/** PostgREST surfaces a unique-constraint breach as SQLSTATE 23505. */
function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" || Boolean(error.message?.includes("duplicate key"));
}

/** Give up on a subscription after this many consecutive failed renewals. */
const MAX_FAILED_ATTEMPTS = 3;

export interface ChargeResult {
  subscriptionId: string;
  orderId: string | null;
  code: string;
  outcome: "success" | "failure" | "indeterminate";
  /**
   * True when this period had already been charged and we stopped before
   * calling the gateway. Not a failure — the money is already on its way — so
   * callers must not mark the subscription past-due on it.
   */
  skipped?: boolean;
}

/**
 * Charges one subscription period.
 *
 * The order is created before the call so an indeterminate outcome still leaves
 * a pending record to reconcile against — a charge we cannot see is worse than
 * a duplicate order row.
 */
export async function chargeSubscription(sub: Subscription): Promise<ChargeResult> {
  const admin = getSupabaseAdminClient();

  const { data: token } = await admin
    .from("payment_tokens")
    .select("*")
    .eq("id", sub.payment_token_id)
    .maybeSingle();

  if (!token || token.status !== "active") {
    await admin
      .from("subscriptions")
      .update({ status: "past_due" })
      .eq("id", sub.id);
    return { subscriptionId: sub.id, orderId: null, code: "0036", outcome: "failure" };
  }

  const periodStart = new Date(sub.next_charge_at);

  const order = await createOrder({
    userId: sub.user_id,
    amount: Number(sub.amount),
    channel: "direct_payment",
    operatorId: token.operator_id,
    msisdn: token.msisdn,
    items: [
      {
        product_id: sub.product_id,
        name: sub.products?.name ?? "Subscription",
        qty: 1,
        unit_price: Number(sub.amount),
      },
    ],
  });

  // The period is unique per subscription, so this insert is the lock that
  // stops a manual "Pay now" and the scheduler from billing the same period
  // twice. It runs *before* the gateway call: losing the race costs an unused
  // order row, which is far cheaper than a duplicate charge.
  const { error: claimError } = await admin.from("subscription_charges").insert({
    subscription_id: sub.id,
    order_id: order.id,
    period_start: periodStart.toISOString(),
  });

  if (claimError) {
    if (!isUniqueViolation(claimError)) throw new Error(claimError.message);
    await admin.from("orders").delete().eq("id", order.id);
    return {
      subscriptionId: sub.id,
      orderId: null,
      code: "0005",
      outcome: "indeterminate",
      skipped: true,
    };
  }

  let code: string;
  let gatewayTransactionId: string | null | undefined;
  try {
    const call = await gateway.directPayment({
      operatorId: token.operator_id as "100007" | "100008",
      amount: Number(sub.amount),
      userKey: order.order_ref,
      sourceId: token.source_id,
    });
    code = call.code;
    gatewayTransactionId = call.body?.transactionId;
    await recordTransaction({
      orderId: order.id,
      userId: sub.user_id,
      kind: "direct_payment",
      operation: "direct_payment",
      call,
      gatewayTransactionId,
      operatorId: token.operator_id,
    });
  } catch (error) {
    if (!(error instanceof GatewayUnreachableError)) throw error;
    // Unreachable is indeterminate, not failed: the charge may have landed.
    // Leave the order pending for the postback or a later inquiry, and do not
    // advance the schedule — but do not count it as a decline either.
    return {
      subscriptionId: sub.id,
      orderId: order.id,
      code: "0037",
      outcome: "indeterminate",
    };
  }

  const outcome = classify(code);
  await applyOutcome({ orderId: order.id, code, gatewayTransactionId });

  // A dead token can never be charged again — stop trying.
  if (code === "0028" || code === "0036") {
    await admin
      .from("payment_tokens")
      .update({ status: code === "0028" ? "expired" : "delinked" })
      .eq("id", token.id);
    await admin.from("subscriptions").update({ status: "past_due" }).eq("id", sub.id);
    return { subscriptionId: sub.id, orderId: order.id, code, outcome };
  }

  if (outcome === "success") {
    const next = new Date(periodStart);
    next.setUTCDate(next.getUTCDate() + sub.interval_days);
    // If we're catching up on a long-overdue subscription, don't schedule the
    // next charge in the past — that would bill several periods at once.
    const now = new Date();
    while (next <= now) next.setUTCDate(next.getUTCDate() + sub.interval_days);

    await admin
      .from("subscriptions")
      .update({
        next_charge_at: next.toISOString(),
        last_charge_at: now.toISOString(),
        failed_attempts: 0,
        status: "active",
      })
      .eq("id", sub.id);
  } else if (outcome === "failure") {
    const attempts = sub.failed_attempts + 1;
    // Back off a day per attempt rather than hammering a declining wallet.
    const retryAt = new Date();
    retryAt.setUTCDate(retryAt.getUTCDate() + 1);
    await admin
      .from("subscriptions")
      .update({
        failed_attempts: attempts,
        status: attempts >= MAX_FAILED_ATTEMPTS ? "past_due" : "active",
        next_charge_at: retryAt.toISOString(),
      })
      .eq("id", sub.id);
  }
  // indeterminate: leave next_charge_at where it is. The postback settles the
  // order, and the next run either sees it paid or retries the same period.

  return { subscriptionId: sub.id, orderId: order.id, code, outcome };
}

/** Every active subscription whose period has come due. */
export async function dueSubscriptions(limit = 50): Promise<Subscription[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .select("*, products(*), payment_tokens(*)")
    .eq("status", "active")
    .lte("next_charge_at", new Date().toISOString())
    .order("next_charge_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Subscription[];
}
