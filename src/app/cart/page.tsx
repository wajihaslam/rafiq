import Link from "next/link";

import { CartLines } from "@/components/CartLines";
import { Money } from "@/components/Money";
import { loadOpenCart } from "@/lib/cart";
import { requireUser } from "@/lib/supabase/server";

export default async function CartPage() {
  const user = await requireUser();
  const cart = await loadOpenCart(user.id);
  const items = cart?.items ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your cart</h1>

      {items.length === 0 ? (
        <div className="card space-y-3 text-sm text-slate-500">
          <p>Your cart is empty.</p>
          <Link href="/" className="btn-primary w-fit">
            Browse the shop
          </Link>
        </div>
      ) : (
        <>
          <CartLines
            items={items.map((i) => ({
              productId: i.product_id,
              name: i.name,
              qty: i.qty,
              unitPrice: i.unit_price,
            }))}
          />

          <div className="card flex items-center justify-between">
            <span className="text-sm text-slate-500">Total</span>
            <span className="text-xl font-semibold">
              <Money amount={cart!.total} />
            </span>
          </div>

          <Link href="/checkout" className="btn-primary">
            Continue to payment
          </Link>
        </>
      )}
    </div>
  );
}
