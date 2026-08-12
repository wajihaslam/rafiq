import Link from "next/link";

import { Money } from "@/components/Money";
import { MySubscriptions } from "@/components/MySubscriptions";
import { SubscribeButton } from "@/components/SubscribeButton";
import {
  WalletSubscriptionPanel,
  type PanelSubscription,
} from "@/components/WalletSubscriptionPanel";
import { OPERATORS } from "@/lib/collection/types";
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

  const [tokens, subs, registrations] = user
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
        // A link that was started but never OTP-verified is what re-enables the
        // Verify CTA after a reload — otherwise the flow dead-ends on refresh.
        supabase
          .from("wallet_registrations")
          .select("order_ref, operator_id, status, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
      ])
    : [null, null, null];

  const wallets = (tokens?.data ?? []) as PaymentToken[];
  const mySubs = (subs?.data ?? []) as unknown as Subscription[];
  const pending = (registrations?.data ?? []) as {
    order_ref: string;
    operator_id: string;
  }[];
  const subscribedProductIds = new Set(mySubs.map((s) => s.product_id));

  const panelPlans = plans
    .filter((p) => p.interval_days)
    .map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      intervalDays: p.interval_days as number,
    }));

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="mt-1 text-sm text-slate-500">
          Subscriptions are charged to a wallet you link once. After that we bill
          each period with you absent — no OTP, no reminders to approve.
        </p>
      </div>

      {user && panelPlans.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="font-medium">Subscribe with your wallet</h2>
            <p className="text-sm text-slate-500">
              Subscribe the number, get a token, then pay, verify and unsubscribe
              from here. Each button turns on only once the step before it is
              done.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {([OPERATORS.easypaisa, OPERATORS.jazzcash] as const).map(
              (operatorId) => {
                // Several wallets may be linked on one operator; the panel picks
                // between them, and each carries its own subscription.
                const operatorWallets = wallets.filter(
                  (w) => w.operator_id === operatorId,
                );
                const byToken: Record<string, PanelSubscription> = {};
                for (const sub of mySubs) {
                  if (sub.payment_tokens?.operator_id !== operatorId) continue;
                  byToken[sub.payment_token_id] = {
                    id: sub.id,
                    status: sub.status,
                    nextChargeAt: sub.next_charge_at,
                    planId: sub.product_id,
                  };
                }

                return (
                  <WalletSubscriptionPanel
                    key={operatorId}
                    operatorId={operatorId}
                    plans={panelPlans}
                    tokens={operatorWallets.map((w) => ({
                      id: w.id,
                      msisdn: w.msisdn,
                      label: w.label,
                    }))}
                    pendingOrderRef={
                      pending.find((r) => r.operator_id === operatorId)
                        ?.order_ref ?? null
                    }
                    subscriptionsByToken={byToken}
                  />
                );
              },
            )}
          </div>
        </section>
      )}

      {!user && (
        <p className="card text-sm text-slate-500">
          <Link href="/login?next=/subscriptions" className="text-brand-600 hover:underline">
            Sign in
          </Link>{" "}
          to subscribe a wallet number to a plan.
        </p>
      )}

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

      <div className="space-y-3">
        <h2 className="font-medium">All plans</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          {plans.map((plan) => (
            <article key={plan.id} className="card flex flex-col gap-3">
              <div className="flex-1">
                <h3 className="font-medium">{plan.name}</h3>
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
                <Link
                  href="/login?next=/subscriptions"
                  className="btn-primary w-fit"
                >
                  Sign in to subscribe
                </Link>
              ) : subscribedProductIds.has(plan.id) ? (
                // Saying "subscribed" without offering the way out is a dead end;
                // the controls live in the panel at the top of this page.
                <div className="space-y-1">
                  <p className="text-sm font-medium text-emerald-600">
                    You&apos;re subscribed.
                  </p>
                  <Link
                    href="#your-subscriptions"
                    className="text-sm text-slate-500 hover:underline"
                  >
                    Manage or unsubscribe
                  </Link>
                </div>
              ) : wallets.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Subscribe a wallet number above to start this plan.
                </p>
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
    </div>
  );
}
