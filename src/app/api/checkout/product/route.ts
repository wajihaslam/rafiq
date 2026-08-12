/**
 * Buy one product outright — one item, one payment, no cart.
 *
 * The client sends a product id and a quantity, never an amount: the price is
 * read from the catalogue here, because a price on the wire is the easiest
 * thing in the app to tamper with.
 *
 * The only method is a mobile wallet. Charging a saved token is a *tokenization*
 * payment and lives on the wallet it belongs to (`/api/wallets/[id]/charge`),
 * which is what keeps the two kinds of traffic separately trackable.
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError } from "@/lib/api";
import { startPayment } from "@/lib/checkout";
import { OPERATORS } from "@/lib/collection/types";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

const schema = z.object({
  productId: z.string().uuid(),
  qty: z.number().int().min(1).max(99).default(1),
  operatorId: z.enum([OPERATORS.easypaisa, OPERATORS.jazzcash]),
  msisdn: z.string().min(10),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    const admin = getSupabaseAdminClient();

    const { data: product } = await admin
      .from("products")
      .select("*")
      .eq("id", input.productId)
      .eq("active", true)
      .eq("kind", "one_time")
      .maybeSingle();

    if (!product) return err("NOT_FOUND", "That product is unavailable.", 404);

    // amounts are PKR with at most 2 decimals
    const amount = Math.round(Number(product.price) * input.qty * 100) / 100;

    const result = await startPayment({
      userId: user.id,
      amount,
      items: [
        {
          product_id: product.id,
          name: product.name,
          qty: input.qty,
          unit_price: Number(product.price),
        },
      ],
      operatorId: input.operatorId,
      msisdn: input.msisdn,
    });

    return fromGateway(result.code, {
      orderId: result.orderId,
      orderRef: result.orderRef,
      orderStatus: result.orderStatus,
      needsOtp: result.needsOtp,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
