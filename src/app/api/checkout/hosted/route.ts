/**
 * Hosted Page checkout (§4.9): we create the order, then hand back a URL for
 * the browser to follow. The gateway answers 302 to our redirectUrl, almost
 * always with status=0037 — the real outcome comes from POST /inquire, keyed by
 * orderId rather than transactionId.
 */

import { err, handleRouteError, ok } from "@/lib/api";
import { loadOpenCart } from "@/lib/cart";
import * as gateway from "@/lib/collection/client";
import { publicEnv } from "@/lib/env";
import { createOrder } from "@/lib/orders";
import { requireUser } from "@/lib/supabase/server";

export async function POST() {
  try {
    const user = await requireUser();
    const cart = await loadOpenCart(user.id);
    if (!cart || cart.items.length === 0) {
      return err("EMPTY_CART", "Your cart is empty.", 409);
    }

    const order = await createOrder({
      userId: user.id,
      amount: cart.total,
      channel: "hosted_page",
      items: cart.items.map(({ product_id, name, qty, unit_price }) => ({
        product_id,
        name,
        qty,
        unit_price,
      })),
    });

    const url = await gateway.hostedCheckoutUrl({
      orderId: order.order_ref,
      amount: cart.total,
      redirectUrl: `${publicEnv.appUrl()}/pay/hosted/return`,
    });

    return ok({ orderId: order.id, orderRef: order.order_ref, redirectTo: url });
  } catch (error) {
    return handleRouteError(error);
  }
}
