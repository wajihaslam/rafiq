/**
 * Buy one product outright — no cart in between.
 *
 * The client sends a product id and a quantity, never an amount: the price is
 * read from the catalogue here, because a price on the wire is the easiest
 * thing in the app to tamper with.
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError, ok } from "@/lib/api";
import { startPayment, type PayMethod } from "@/lib/checkout";
import { OPERATORS } from "@/lib/collection/types";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

const schema = z
  .object({
    productId: z.string().uuid(),
    qty: z.number().int().min(1).max(99).default(1),
    method: z.enum(["saved", "wallet", "hosted"]),
    savedTokenId: z.string().uuid().optional(),
    operatorId: z.enum([OPERATORS.easypaisa, OPERATORS.jazzcash]).optional(),
    msisdn: z.string().min(10).optional(),
  })
  .refine((v) => v.method !== "saved" || Boolean(v.savedTokenId), {
    message: "Choose one of your saved wallets.",
  })
  .refine((v) => v.method !== "wallet" || Boolean(v.operatorId && v.msisdn), {
    message: "Choose a wallet and enter your mobile number.",
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

    const method: PayMethod =
      input.method === "hosted"
        ? { kind: "hosted" }
        : input.method === "saved"
          ? { kind: "saved", savedTokenId: input.savedTokenId! }
          : { kind: "wallet", operatorId: input.operatorId!, msisdn: input.msisdn! };

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
      method,
    });

    if (result.problem) {
      return err(result.problem.code, result.problem.message, result.problem.status);
    }

    if (result.redirectTo) {
      return ok({
        orderId: result.orderId,
        orderRef: result.orderRef,
        redirectTo: result.redirectTo,
      });
    }

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
