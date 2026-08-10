import Link from "next/link";

import { Money } from "@/components/Money";
import { MySubscriptions } from "@/components/MySubscriptions";
import { SubscribeButton } from "@/components/SubscribeButton";
import {
  getCurrentUser,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import type { PaymentToken, Product, Subscription } from "@/lib/db-types";

export default async function SubscriptionsPage() {
  const supabase = await getSupabaseServerClient();
  const user = await getCurrentUser();

  const { data: plansData } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .eq("kind", "subscription")
    .order("price");
  const plans = (plansData ?? []) as Product[];

  const [tokens, subs] = user
    ? await Promise.all([
        supabase
          .from("payment_tokens")
          .select("*")
          .eq("status", "active")
          .order("linked_at", { ascending: false }),
        supabase
          .from("subscriptions")
          .select("*, products(*), payment_tokens(*)")
          .neq("status", "cancelled"),
      ])
    : [null, null];

  const wallets = (tokens?.data ?? []) as PaymentToken[];
  const mySubs = (subs?.data ?? []) as unknown as Subscription[];
  const subscribedProductIds = new Set(mySubs.map((s) => s.product_id));

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="mt-1 text-sm text-slate-500">
          Subscriptions are charged to a wallet you link once. After that we bill
          each period with you absent — no OTP, no reminders to approve.
        </p>
      </div>

      {user && mySubs.length > 0 && (
        <MySubscriptions
          subscriptions={mySubs.map((s) => ({
            id: s.id,
            name: s.products?.name ?? "Plan",
            amount: Number(s.amount),
            intervalDays: s.interval_days,
            status: s.status,
            nextChargeAt: s.next_charge_at,
            walletMsisdn: s.payment_tokens?.msisdn ?? null,
          }))}
        />
      )}

      {user && wallets.length === 0 && (
        <p className="card text-sm text-slate-500">
          You need a linked wallet before you can subscribe.{" "}
          <Link href="/wallets" className="text-brand-600 hover:underline">
            Link a wallet
          </Link>
          .
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {plans.map((plan) => (
          <article key={plan.id} className="card flex flex-col gap-3">
            <div className="flex-1">
              <h2 className="font-medium">{plan.name}</h2>
              {plan.description && (
                <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
              )}
            </div>
            <p className="text-lg font-semibold">
              <Money amount={plan.price} />
              <span className="ml-1 text-sm font-normal text-slate-500">
                / {plan.interval_days} days
              </span>
            </p>

            {!user ? (
              <Link href="/login?next=/subscriptions" className="btn-primary w-fit">
                Sign in to subscribe
              </Link>
            ) : subscribedProductIds.has(plan.id) ? (
              <p className="text-sm text-emerald-600">You&apos;re subscribed.</p>
            ) : (
              <SubscribeButton
                productId={plan.id}
                wallets={wallets.map((w) => ({
                  id: w.id,
                  operatorId: w.operator_id,
                  msisdn: w.msisdn,
                  label: w.label,
                }))}
              />
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
