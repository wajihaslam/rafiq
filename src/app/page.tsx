import Image from "next/image";
import Link from "next/link";

import { Money } from "@/components/Money";
import { PayProductButton } from "@/components/PayProductButton";
import { getGatewayConfigState } from "@/lib/settings";
import {
  getCurrentUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import type { Product } from "@/lib/db-types";

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

  /**
   * Which sequence a payment runs is a property of the merchant, not a choice —
   * so the step trail is decided here and handed down. `getGatewayConfigState`
   * never throws, so an unconfigured install still renders the shop and says
   * payments are off rather than erroring on the catalogue.
   */
  const { flow } = await getGatewayConfigState();

  return (
    <div className="max-w-4xl space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Shop</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pay for any item straight from this list — one item, one payment. Each
          payment runs its own steps:{" "}
          {flow === "otp"
            ? "initiate, verify, inquire, refund"
            : flow === "non_otp"
              ? "verify, inquire, refund"
              : "the flow is not configured yet"}
          .{" "}
          <Link href="/subscriptions" className="text-brand-600 hover:underline">
            See subscription plans
          </Link>
          , or{" "}
          <Link href="/wallets" className="text-brand-600 hover:underline">
            charge a saved wallet
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

              <PayProductButton
                product={{
                  id: product.id,
                  name: product.name,
                  price: Number(product.price),
                }}
                flow={flow}
                signedIn={Boolean(user)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
