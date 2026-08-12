import Link from "next/link";
import { notFound } from "next/navigation";

import { Money } from "@/components/Money";
import { OrderActions } from "@/components/OrderActions";
import { OrderResolver } from "@/components/OrderResolver";
import { StatusBadge } from "@/components/StatusBadge";
import { StepTrail } from "@/components/StepTrail";
import { codeMessage } from "@/lib/collection/codes";
import { OPERATOR_LABELS } from "@/lib/collection/types";
import { oneTimeSteps, tokenSteps } from "@/lib/steps";
import { getSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import type {
  Order,
  OrderItem,
  Transaction,
  TxnOperation,
} from "@/lib/db-types";

/** The trail has to reflect calls made a second ago, not a cached render. */
export const dynamic = "force-dynamic";

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const supabase = await getSupabaseServerClient();

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!order) notFound();

  const [{ data: items }, { data: txns }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", id),
    supabase
      .from("transactions")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const typed = order as Order;
  const trail = (txns ?? []) as Transaction[];
  const operations = trail
    .map((t) => t.operation)
    .filter(Boolean) as TxnOperation[];

  /**
   * A token charge is not a one-time payment and does not get a one-time
   * payment's trail: it has no initiate and no OTP, because consent was taken
   * once when the wallet was linked. Showing it the four-step wallet sequence
   * instead is what keeps the two ledgers honest on this page too.
   */
  const tokenized = typed.channel === "direct_payment";
  const refunded =
    typed.status === "refund_submitted" || typed.status === "refunded";

  const steps = tokenized
    ? tokenSteps({
        initiated: true,
        verified: true,
        charges: 1,
        refunds: refunded ? 1 : 0,
        live: true,
      })
    : oneTimeSteps({
        flow: typed.channel === "wallet_otp" ? "otp" : "non_otp",
        operations,
        orderStatus: typed.status,
      });

  const gatewayTxnId =
    trail.find((t) => t.gateway_transaction_id)?.gateway_transaction_id ?? null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href={tokenized ? "/orders?track=tokenization" : "/orders"}
          className="text-sm text-slate-500 hover:underline"
        >
          ← All payments
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {typed.order_ref}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {tokenized
            ? "Tokenization — a direct payment against a saved wallet."
            : "One-time payment."}
        </p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <StatusBadge status={typed.status} />
          <span className="text-xl font-semibold">
            <Money amount={typed.amount} />
          </span>
        </div>

        <StepTrail steps={steps} />

        {/* Pending means the gateway has not told us the outcome yet, so the
            page resolves it by inquiry rather than leaving the customer guessing. */}
        {typed.status === "pending" && <OrderResolver orderId={typed.id} />}

        <OrderActions
          orderId={typed.id}
          status={typed.status}
          amount={Number(typed.amount)}
        />

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-slate-500">Placed</dt>
            <dd>{new Date(typed.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Method</dt>
            <dd className="capitalize">{typed.channel.replace(/_/g, " ")}</dd>
          </div>
          {typed.msisdn && (
            <div>
              <dt className="text-slate-500">Mobile</dt>
              <dd>
                {typed.msisdn}
                {typed.operator_id
                  ? ` · ${OPERATOR_LABELS[typed.operator_id as "100007" | "100008"] ?? typed.operator_id}`
                  : ""}
              </dd>
            </div>
          )}
          {gatewayTxnId && (
            <div>
              <dt className="text-slate-500">Gateway transaction</dt>
              <dd className="font-mono text-xs">{gatewayTxnId}</dd>
            </div>
          )}
          {typed.status_code && (
            <div>
              <dt className="text-slate-500">Gateway code</dt>
              <dd className="tabular-nums">
                {typed.status_code} · {codeMessage(typed.status_code)}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {trail.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-medium">Gateway calls</h2>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {trail.map((txn) => (
              <li key={txn.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="w-32 font-medium capitalize">
                  {(txn.operation ?? txn.kind).replace(/_/g, " ")}
                </span>
                <span className="tabular-nums text-slate-500">
                  {txn.status_code} · {txn.message ?? codeMessage(txn.status_code)}
                </span>
                {txn.indeterminate && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    indeterminate
                  </span>
                )}
                <time
                  className="ml-auto text-xs text-slate-500"
                  dateTime={txn.created_at}
                >
                  {new Date(txn.created_at).toLocaleTimeString()}
                </time>
              </li>
            ))}
          </ul>
        </div>
      )}

      {((items ?? []) as OrderItem[]).length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-medium">Items</h2>
          <ul className="space-y-2 text-sm">
            {((items ?? []) as OrderItem[]).map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span className="text-slate-500">
                  {item.name} × {item.qty}
                </span>
                <Money amount={item.unit_price * item.qty} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
