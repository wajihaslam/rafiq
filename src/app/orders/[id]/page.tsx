import Link from "next/link";
import { notFound } from "next/navigation";

import { Money } from "@/components/Money";
import { OrderResolver } from "@/components/OrderResolver";
import { StatusBadge } from "@/components/StatusBadge";
import { codeMessage } from "@/lib/collection/codes";
import { getSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import type { Order, OrderItem } from "@/lib/db-types";

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

  const { data: items } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", id);

  const typed = order as Order;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/orders" className="text-sm text-slate-500 hover:underline">
          ← All orders
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {typed.order_ref}
        </h1>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <StatusBadge status={typed.status} />
          <span className="text-xl font-semibold">
            <Money amount={typed.amount} />
          </span>
        </div>

        {/* Pending means the gateway has not told us the outcome yet, so the
            page resolves it by inquiry rather than leaving the customer guessing. */}
        {typed.status === "pending" && <OrderResolver orderId={typed.id} />}

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
              <dd>{typed.msisdn}</dd>
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
    </div>
  );
}
