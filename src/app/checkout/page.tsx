import Link from "next/link";

import { CheckoutForm } from "@/components/CheckoutForm";
import { Money } from "@/components/Money";
import { loadOpenCart } from "@/lib/cart";
import { getSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import type { PaymentToken } from "@/lib/db-types";

export default async function CheckoutPage() {
  const user = await requireUser();
  const cart = await loadOpenCart(user.id);

  if (!cart || cart.items.length === 0) {
    return (
      <div className="card max-w-lg space-y-3 text-sm text-slate-500">
        <p>Your cart is empty, so there is nothing to pay for.</p>
        <Link href="/" className="btn-primary w-fit">
          Browse the shop
        </Link>
      </div>
    );
  }

  const supabase = await getSupabaseServerClient();
  const { data: tokens } = await supabase
    .from("payment_tokens")
    .select("*")
    .eq("status", "active")
    .order("linked_at", { ascending: false });

  return (
    <div className="grid max-w-4xl gap-8 lg:grid-cols-[1fr_320px]">
      <CheckoutForm
        savedWallets={(tokens ?? []).map((t: PaymentToken) => ({
          id: t.id,
          operatorId: t.operator_id,
          msisdn: t.msisdn,
          label: t.label,
        }))}
      />

      <aside className="card h-fit space-y-3">
        <h2 className="font-medium">Order summary</h2>
        <ul className="space-y-2 text-sm">
          {cart.items.map((item) => (
            <li key={item.product_id} className="flex justify-between gap-3">
              <span className="text-slate-500">
                {item.name} × {item.qty}
              </span>
              <Money amount={item.unit_price * item.qty} />
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-slate-200 pt-3 font-semibold dark:border-slate-800">
          <span>Total</span>
          <Money amount={cart.total} />
        </div>
      </aside>
    </div>
  );
}
