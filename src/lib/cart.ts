import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Product } from "@/lib/db-types";

export interface LoadedCart {
  cartId: string;
  items: {
    product_id: string;
    name: string;
    qty: number;
    unit_price: number;
    product: Product;
  }[];
  total: number;
}

/**
 * Loads the open cart and computes the total server-side. The client never
 * sends an amount — it would be the easiest thing in the app to tamper with.
 */
export async function loadOpenCart(userId: string): Promise<LoadedCart | null> {
  const supabase = await getSupabaseServerClient();

  const { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "open")
    .maybeSingle();
  if (!cart) return null;

  const { data: rows } = await supabase
    .from("cart_items")
    .select("product_id, qty, unit_price, products(*)")
    .eq("cart_id", cart.id);

  const items = (rows ?? [])
    .filter((r) => r.products)
    .map((r) => {
      const product = r.products as unknown as Product;
      return {
        product_id: r.product_id as string,
        name: product.name,
        qty: r.qty as number,
        // re-read the live price rather than trusting the stored snapshot for
        // the charge itself
        unit_price: Number(product.price),
        product,
      };
    });

  const total = items.reduce((sum, i) => sum + i.unit_price * i.qty, 0);
  // amounts are PKR with at most 2 decimals
  return { cartId: cart.id, items, total: Math.round(total * 100) / 100 };
}

/** Marks the cart consumed so a second checkout can't spend the same lines. */
export async function closeCart(cartId: string) {
  const supabase = await getSupabaseServerClient();
  await supabase.from("carts").update({ status: "ordered" }).eq("id", cartId);
}
