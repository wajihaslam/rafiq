/**
 * Refunds a settled order (§4.8).
 *
 * Three things about a refund are easy to get wrong and are all decided here
 * rather than by the caller:
 *
 *  1. **Which transaction.** A refund names the gateway's `transactionId`, not
 *     our order reference — and an order can carry several transactions (an
 *     initiate, a verify, a handful of inquiries). The one to refund is the
 *     last one that actually succeeded.
 *  2. **Which merchant.** A transaction is only visible to the MID that created
 *     it, so a token charge is refunded under the tokenization merchant and a
 *     wallet payment under the payment one. Both are read back off the audit
 *     trail rather than from the configuration, which may have been switched
 *     since.
 *  3. **Which date.** `transactionDate` is the date the original ran, in
 *     `YYYY-MM-DD` — the gateway validates it against the stored original, so
 *     "today" is wrong for anything refunded the morning after.
 *
 * Success is `0135`, not `0000`: the refund is *submitted*, and the money comes
 * back when the gateway confirms it.
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError } from "@/lib/api";
import * as gateway from "@/lib/collection/client";
import { classify } from "@/lib/collection/codes";
import { applyRefundOutcome, recordTransaction } from "@/lib/orders";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

const schema = z
  .object({
    /** Omitted means a full refund, which is what the gateway assumes too. */
    amount: z
      .number()
      .positive("Enter an amount greater than zero.")
      .refine((v) => Number(v.toFixed(2)) === v, {
        message: "Amounts can have at most two decimal places.",
      })
      .optional(),
  })
  // A refund with no body at all is the common case; don't make callers post
  // an empty object.
  .default({});

/** `2026-08-12T09:14:22Z` → `2026-08-12`, in UTC, as §4.8 wants it. */
function gatewayDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const raw = await request.text();
    const { amount } = schema.parse(raw ? JSON.parse(raw) : {});
    const admin = getSupabaseAdminClient();

    const { data: order } = await admin
      .from("orders")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!order) return err("NOT_FOUND", "Order not found.", 404);

    if (order.status !== "paid") {
      return err(
        "NOT_REFUNDABLE",
        order.status === "pending"
          ? "This payment has not settled yet. Inquire first, then refund it."
          : `A ${order.status.replace(/_/g, " ")} order cannot be refunded.`,
        409,
      );
    }

    if (amount !== undefined && amount > Number(order.amount)) {
      // 0137 is what the gateway would answer; saying it here costs no round
      // trip and names the field.
      return err(
        "0137",
        "That is more than the order was charged.",
        422,
      );
    }

    // The successful call is the one that took the money — a later inquiry row
    // carries the same transactionId but a request that is not a payment.
    const { data: paid } = await admin
      .from("transactions")
      .select("gateway_transaction_id, request, created_at, kind")
      .eq("order_id", order.id)
      .eq("status_code", "0000")
      .not("gateway_transaction_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!paid?.gateway_transaction_id) {
      return err(
        "0090",
        "We have no gateway transaction to refund for this order.",
        409,
      );
    }

    const merchantId = (paid.request as { merchantId?: unknown } | null)
      ?.merchantId;

    const call = await gateway.refund({
      transactionId: paid.gateway_transaction_id,
      transactionDate: gatewayDate(paid.created_at as string),
      ...(amount !== undefined ? { amount: String(amount) } : {}),
      ...(typeof merchantId === "string" && merchantId
        ? { merchantId }
        : {
            // No recorded merchant: fall back to the role the original call
            // played, which the order's channel still tells us.
            role:
              order.channel === "direct_payment"
                ? ("tokenization" as const)
                : ("payment" as const),
          }),
    });

    await recordTransaction({
      orderId: order.id,
      userId: user.id,
      kind: "refund",
      operation: "refund",
      call,
      gatewayTransactionId: call.body?.transactionId ?? paid.gateway_transaction_id,
      operatorId: order.operator_id,
    });

    const status = await applyRefundOutcome({ orderId: order.id, code: call.code });

    return fromGateway(call.code, {
      orderId: order.id,
      orderStatus: status,
      refundSubmitted: classify(call.code) === "success",
      referenceNumber: call.body?.referenceNumber ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
