import Image from "next/image";
import Link from "next/link";

import { AddToCartButton } from "@/components/AddToCartButton";
import { Money } from "@/components/Money";
import { PayProductButton } from "@/components/PayProductButton";
import {
  getCurrentUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import type { PaymentToken, Product } from "@/lib/db-types";

export default async function ShopPage() {
  const supabase = await getSupabaseServerClient();
  const user = await getCurrentUser();

  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .eq("kind", "one_time")
    .order("created_at");

  const products = (data ?? []) as Product[];

  // Offered inside the pay modal, so a linked wallet is one click from here.
  const { data: tokenRows } = user
    ? await supabase
        .from("payment_tokens")
        .select("*")
        .eq("status", "active")
        .order("linked_at", { ascending: false })
    : { data: null };

  const savedWallets = ((tokenRows ?? []) as PaymentToken[]).map((t) => ({
    id: t.id,
    operatorId: t.operator_id,
    msisdn: t.msisdn,
    label: t.label,
  }));

  return (
    <div className="max-w-4xl space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Shop</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pay for any item straight from this list — the payment details open
          right here, no cart in between.{" "}
          <Link href="/subscriptions" className="text-brand-600 hover:underline">
            See subscription plans
          </Link>
          .
        </p>
      </section>

      {products.length === 0 ? (
        <p className="card text-sm text-slate-500">
          No products yet. Run <code>supabase/seed.sql</code> against your database.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {products.map((product) => (
            <li
              key={product.id}
              className="flex flex-wrap items-center gap-4 p-4"
            >
              {product.image_url && (
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </div>
              )}

              <div className="min-w-48 flex-1">
                <h2 className="font-medium">{product.name}</h2>
                {product.description && (
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">
                    {product.description}
                  </p>
                )}
              </div>

              <span className="font-semibold">
                <Money amount={product.price} />
              </span>

              <div className="flex items-center gap-2">
                <PayProductButton
                  product={{
                    id: product.id,
                    name: product.name,
                    price: Number(product.price),
                  }}
                  savedWallets={savedWallets}
                  signedIn={Boolean(user)}
                />
                {/* The cart still exists for anyone buying several things at
                    once — it is just no longer the way through. */}
                <AddToCartButton productId={product.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
