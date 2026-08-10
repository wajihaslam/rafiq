/**
 * Order lifecycle, server side. Every gateway outcome funnels through
 * `applyOutcome` so the pending → paid/failed rules live in exactly one place.
 */

import "server-only";
import { randomBytes } from "node:crypto";

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { classify, codeMessage } from "@/lib/collection/codes";
import type { GatewayCall } from "@/lib/collection/client";
import type { OrderStatus, TxnKind } from "@/lib/db-types";

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

/** Append a gateway exchange to the audit trail. */
export async function recordTransaction(params: {
  orderId: string | null;
  userId: string | null;
  kind: TxnKind;
  call: Pick<GatewayCall<unknown>, "code" | "request" | "body">;
  gatewayTransactionId?: string | null;
  operatorId?: string | null;
}) {
  const admin = getSupabaseAdminClient();
  const outcome = classify(params.call.code);
  await admin.from("transactions").insert({
    order_id: params.orderId,
    user_id: params.userId,
    kind: params.kind,
    gateway_transaction_id: params.gatewayTransactionId ?? null,
    operator_id: params.operatorId ?? null,
    status_code: params.call.code || "",
    message: codeMessage(params.call.code),
    indeterminate: outcome === "indeterminate",
    request: params.call.request as never,
    response: params.call.body as never,
  });
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
 */
export async function applyOutcome(params: {
  orderId: string;
  code: string;
  gatewayTransactionId?: string | null;
  operatorId?: string | null;
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
    outcome === "success" ? "paid" : outcome === "failure" ? "failed" : "pending";

  const patch: Record<string, unknown> = {
    status: next,
    status_code: params.code,
    message: codeMessage(params.code),
  };
  if (params.operatorId) patch.operator_id = params.operatorId;

  await admin.from("orders").update(patch).eq("id", params.orderId);
  return next;
}
