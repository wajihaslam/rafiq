/**
 * Order lifecycle, server side. Every gateway outcome funnels through
 * `applyOutcome` so the pending → paid/failed rules live in exactly one place.
 */

import "server-only";
import { randomBytes } from "node:crypto";

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { classify, codeMessage, REFUND_SUBMITTED } from "@/lib/collection/codes";
import type { GatewayCall } from "@/lib/collection/client";
import type { OrderStatus, TxnKind, TxnOperation } from "@/lib/db-types";

/**
 * Order references double as the gateway's `userKey` / `orderId`, and §7 turns
 * the last 4 digits of those into a fixture selector. So the reference always
 * ends in a letter — a numeric tail would silently return a canned response
 * code instead of hitting the real gateway.
 */
export function newOrderRef(prefix = "RFQ"): string {
  const digits = randomBytes(4).readUInt32BE(0).toString().padStart(10, "0");
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const tail = letters[randomBytes(1)[0]! % letters.length]!;
  return `${prefix}-${digits}${tail}`;
}

export interface CreateOrderInput {
  userId: string;
  amount: number;
  channel: "wallet_otp" | "wallet_non_otp" | "hosted_page" | "direct_payment";
  operatorId?: string;
  msisdn?: string;
  items: { product_id: string; name: string; qty: number; unit_price: number }[];
}

export async function createOrder(input: CreateOrderInput) {
  const admin = getSupabaseAdminClient();
  const orderRef = newOrderRef();

  const { data: order, error } = await admin
    .from("orders")
    .insert({
      user_id: input.userId,
      order_ref: orderRef,
      amount: input.amount,
      channel: input.channel,
      operator_id: input.operatorId ?? null,
      msisdn: input.msisdn ?? null,
      status: "pending" satisfies OrderStatus,
    })
    .select()
    .single();

  if (error) throw new Error(`Could not create order: ${error.message}`);

  if (input.items.length > 0) {
    const { error: itemsError } = await admin.from("order_items").insert(
      input.items.map((item) => ({ ...item, order_id: order.id })),
    );
    if (itemsError) {
      // Leave no half-written order behind.
      await admin.from("orders").delete().eq("id", order.id);
      throw new Error(`Could not create order items: ${itemsError.message}`);
    }
  }

  return order;
}

/**
 * Append a gateway exchange to the audit trail.
 *
 * `operation` is required rather than inferred: initiate and verify are both
 * `kind: "payment"`, and a step breadcrumb that had to tell them apart by
 * inspecting the payload would be wrong exactly where it matters — a Non-OTP
 * verify is byte-for-byte the shape of an initiate.
 */
export async function recordTransaction(params: {
  orderId: string | null;
  userId: string | null;
  kind: TxnKind;
  operation: TxnOperation;
  call: Pick<GatewayCall<unknown>, "code" | "request" | "body">;
  gatewayTransactionId?: string | null;
  operatorId?: string | null;
}) {
  const admin = getSupabaseAdminClient();
  const outcome = classify(params.call.code);
  const { error } = await admin.from("transactions").insert({
    order_id: params.orderId,
    user_id: params.userId,
    kind: params.kind,
    operation: params.operation,
    gateway_transaction_id: params.gatewayTransactionId ?? null,
    operator_id: params.operatorId ?? null,
    status_code: params.call.code || "",
    message: codeMessage(params.call.code),
    indeterminate: outcome === "indeterminate",
    request: params.call.request as never,
    response: params.call.body as never,
  });

  /**
   * Deliberately loud but not fatal. This table is the record of what happened
   * to money, so losing a row matters — but the gateway call has already been
   * made by the time we get here, and throwing now would report a payment as
   * failed that may well have succeeded.
   *
   * The likeliest cause by far is a schema that is behind the code: migration
   * 0009 adds `operation`, and without it every insert here is rejected while
   * everything else carries on working. Silence was how that went unnoticed.
   */
  if (error) {
    console.error(
      `[orders] could not record ${params.operation} (${params.call.code}):`,
      error.message,
    );
  }
}

/**
 * Moves an order according to a gateway code.
 *
 * Indeterminate codes leave the order `pending` on purpose (§6): the outcome is
 * unknown and money may have moved, so we neither fail it nor settle it — the
 * postback or an inquiry resolves it later.
 *
 * A terminal status is never walked back: once an order is paid, a late
 * duplicate response cannot fail it.
 *
 * `holdSuccess` is for initiate/verify: a success code there means the gateway
 * accepted the request, not that the money is settled, so the order is held
 * `pending` until an inquiry (or the postback) confirms it. Failures are still
 * failures — only the success side is held.
 */
export async function applyOutcome(params: {
  orderId: string;
  code: string;
  gatewayTransactionId?: string | null;
  operatorId?: string | null;
  holdSuccess?: boolean;
}): Promise<OrderStatus> {
  const admin = getSupabaseAdminClient();
  const outcome = classify(params.code);

  const { data: current } = await admin
    .from("orders")
    .select("status")
    .eq("id", params.orderId)
    .single();

  const settled: OrderStatus[] = ["paid", "refund_submitted", "refunded"];
  if (current && settled.includes(current.status as OrderStatus)) {
    return current.status as OrderStatus;
  }

  const next: OrderStatus =
    outcome === "success"
      ? params.holdSuccess
        ? "pending"
        : "paid"
      : outcome === "failure"
        ? "failed"
        : "pending";

  const patch: Record<string, unknown> = {
    status: next,
    status_code: params.code,
    message: codeMessage(params.code),
  };
  if (params.operatorId) patch.operator_id = params.operatorId;

  await admin.from("orders").update(patch).eq("id", params.orderId);
  return next;
}

/**
 * Moves an order according to a *refund* answer, which `applyOutcome` cannot:
 * a paid order is terminal there, and rightly so — a late duplicate payment
 * response must never disturb it. A refund is the one thing that legitimately
 * moves an order on from `paid`, so it gets its own door.
 *
 * Success is **0135**, not 0000 (§4.8), and it means *submitted* — the money
 * comes back when the gateway says so, which arrives later as a postback. A
 * refund the gateway refused leaves the order exactly where it was: it is still
 * paid, and saying otherwise would invent a refund that never happened.
 */
export async function applyRefundOutcome(params: {
  orderId: string;
  code: string;
}): Promise<OrderStatus> {
  const admin = getSupabaseAdminClient();
  if (params.code !== REFUND_SUBMITTED) {
    const { data } = await admin
      .from("orders")
      .select("status")
      .eq("id", params.orderId)
      .single();
    return (data?.status as OrderStatus) ?? "paid";
  }

  await admin
    .from("orders")
    .update({
      status: "refund_submitted" satisfies OrderStatus,
      status_code: params.code,
      message: codeMessage(params.code),
    })
    .eq("id", params.orderId);

  return "refund_submitted";
}
