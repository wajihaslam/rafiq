/**
 * Resolves an order whose outcome we don't know (§6). This is the *only*
 * correct response to an indeterminate code — never re-fire the payment.
 *
 * Hosted-page orders are inquired by orderId; wallet orders by transactionId
 * with userKey as the fallback.
 */

import { err, fromGateway, handleRouteError } from "@/lib/api";
import { closeCart, loadOpenCart } from "@/lib/cart";
import * as gateway from "@/lib/collection/client";
import { applyOutcome, recordTransaction } from "@/lib/orders";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const { data: order } = await admin
      .from("orders")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!order) return err("NOT_FOUND", "Order not found.", 404);

    // Already settled — nothing to resolve.
    if (order.status !== "pending") {
      return fromGateway(order.status_code ?? "0000", {
        orderId: order.id,
        orderStatus: order.status,
      });
    }

    let code: string;
    let gatewayTransactionId: string | null | undefined;
    let operatorId: string | null | undefined = order.operator_id;

    if (order.channel === "hosted_page") {
      const call = await gateway.hostedInquiry(order.order_ref);
      code = call.code;
      gatewayTransactionId = call.body?.transactionId;
      operatorId = call.body?.operatorId ?? operatorId;
      await recordTransaction({
        orderId: order.id,
        userId: user.id,
        kind: "payment",
        call,
        gatewayTransactionId,
        operatorId,
      });
    } else {
      const { data: txn } = await admin
        .from("transactions")
        .select("gateway_transaction_id")
        .eq("order_id", order.id)
        .not("gateway_transaction_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const call = await gateway.inquiry({
        transactionId: txn?.gateway_transaction_id ?? undefined,
        userKey: order.order_ref,
      });
      code = call.code;
      gatewayTransactionId =
        call.body?.transaction?.transactionId ?? txn?.gateway_transaction_id;
      operatorId = call.body?.transaction?.operatorId ?? operatorId;
      await recordTransaction({
        orderId: order.id,
        userId: user.id,
        kind: "payment",
        call,
        gatewayTransactionId,
        operatorId,
      });
    }

    // 0090 means no such transaction was ever created — for a pending order
    // that is a genuine failure, not an unknown.
    const status =
      code === "0090"
        ? await applyOutcome({ orderId: order.id, code: "0012" })
        : await applyOutcome({
            orderId: order.id,
            code,
            gatewayTransactionId,
            operatorId,
          });

    if (status === "paid") {
      const cart = await loadOpenCart(user.id);
      if (cart) await closeCart(cart.cartId);
    }

    return fromGateway(code, { orderId: order.id, orderStatus: status });
  } catch (error) {
    return handleRouteError(error);
  }
}
