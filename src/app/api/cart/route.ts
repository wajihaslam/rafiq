import { z } from "zod";

import { err, handleRouteError, ok } from "@/lib/api";
import { getSupabaseServerClient, requireUser } from "@/lib/supabase/server";

const addSchema = z.object({
  productId: z.string().uuid(),
  qty: z.number().int().min(1).max(99).default(1),
});

const patchSchema = z.object({
  productId: z.string().uuid(),
  /** 0 removes the line. */
  qty: z.number().int().min(0).max(99),
});

/** Returns the user's open cart, creating it on first use. */
async function openCartId(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  userId: string,
) {
  const { data: existing } = await supabase
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "open")
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data, error } = await supabase
    .from("carts")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function GET() {
  try {
    const user = await requireUser();
    const supabase = await getSupabaseServerClient();
    const cartId = await openCartId(supabase, user.id);
    const { data, error } = await supabase
      .from("cart_items")
      .select("id, qty, unit_price, product_id, products(*)")
      .eq("cart_id", cartId);
    if (error) throw new Error(error.message);
    return ok({ cartId, items: data ?? [] });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { productId, qty } = addSchema.parse(await request.json());
    const supabase = await getSupabaseServerClient();

    const { data: product } = await supabase
      .from("products")
      .select("id, price, kind")
      .eq("id", productId)
      .eq("active", true)
      .maybeSingle();
    if (!product) return err("NOT_FOUND", "That product is unavailable.", 404);

    // Subscriptions are not cart lines — they need a saved wallet token and
    // their own recurring schedule, so they go through /api/subscriptions.
    if (product.kind === "subscription") {
      return err(
        "NOT_A_CART_ITEM",
        "Subscription plans are started from the plan page, not the cart.",
        409,
      );
    }

    const cartId = await openCartId(supabase, user.id);

    // Adding a product already in the cart bumps its quantity.
    const { data: line } = await supabase
      .from("cart_items")
      .select("id, qty")
      .eq("cart_id", cartId)
      .eq("product_id", productId)
      .maybeSingle();

    if (line) {
      const { error } = await supabase
        .from("cart_items")
        .update({ qty: Math.min(99, line.qty + qty) })
        .eq("id", line.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("cart_items").insert({
        cart_id: cartId,
        product_id: productId,
        qty,
        // price is snapshotted so a later catalogue change can't alter a
        // cart the customer has already seen
        unit_price: product.price,
      });
      if (error) throw new Error(error.message);
    }

    return ok({ cartId });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const { productId, qty } = patchSchema.parse(await request.json());
    const supabase = await getSupabaseServerClient();
    const cartId = await openCartId(supabase, user.id);

    if (qty === 0) {
      const { error } = await supabase
        .from("cart_items")
        .delete()
        .eq("cart_id", cartId)
        .eq("product_id", productId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("cart_items")
        .update({ qty })
        .eq("cart_id", cartId)
        .eq("product_id", productId);
      if (error) throw new Error(error.message);
    }
    return ok({ cartId });
  } catch (error) {
    return handleRouteError(error);
  }
}
