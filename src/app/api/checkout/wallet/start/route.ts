/**
 * Starts a cart checkout over a wallet.
 *
 * The mechanics live in `@/lib/checkout` — this route only decides *what* is
 * being paid for (the open cart, priced server-side) and what happens after
 * (the cart closes so the same lines can't be spent twice).
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError } from "@/lib/api";
import { closeCart, loadOpenCart } from "@/lib/cart";
import { startPayment, type PayMethod } from "@/lib/checkout";
import { OPERATORS } from "@/lib/collection/types";
import { requireUser } from "@/lib/supabase/server";

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

    const method: PayMethod = input.savedTokenId
      ? { kind: "saved", savedTokenId: input.savedTokenId }
      : { kind: "wallet", operatorId: input.operatorId!, msisdn: input.msisdn! };

    const result = await startPayment({
      userId: user.id,
      amount: cart.total,
      items: cart.items.map(({ product_id, name, qty, unit_price }) => ({
        product_id,
        name,
        qty,
        unit_price,
      })),
      method,
    });

    if (result.problem) {
      return err(result.problem.code, result.problem.message, result.problem.status);
    }

    // The cart closes on anything that isn't an outright failure — the gateway
    // has taken the charge and the customer must not be able to pay it twice.
    if (result.consumed) await closeCart(cart.cartId);

    return fromGateway(result.code, {
      orderId: result.orderId,
      orderRef: result.orderRef,
      orderStatus: result.orderStatus,
      needsOtp: result.needsOtp,
      ...(result.needsOtp
        ? { gatewayTransactionId: result.gatewayTransactionId ?? null }
        : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
