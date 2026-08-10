import Image from "next/image";
import Link from "next/link";

import { AddToCartButton } from "@/components/AddToCartButton";
import { Money } from "@/components/Money";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Product } from "@/lib/db-types";

export default async function ShopPage() {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .eq("kind", "one_time")
    .order("created_at");

  const products = (data ?? []) as Product[];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Shop</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pay with Easypaisa or JazzCash — or in one click with a wallet you&apos;ve
          already linked.{" "}
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
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <article key={product.id} className="card flex flex-col gap-3">
              {product.image_url && (
                <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover"
                  />
                </div>
              )}
              <div className="flex-1">
                <h2 className="font-medium">{product.name}</h2>
                {product.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                    {product.description}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  <Money amount={product.price} />
                </span>
                <AddToCartButton productId={product.id} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
