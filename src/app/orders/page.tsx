import Link from "next/link";

import { Money } from "@/components/Money";
import { StatusBadge } from "@/components/StatusBadge";
import { getSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import type { Order } from "@/lib/db-types";

export default async function OrdersPage() {
  await requireUser();
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  const orders = (data ?? []) as Order[];

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>

      {orders.length === 0 ? (
        <p className="card text-sm text-slate-500">No orders yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className="flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-900"
              >
                <div className="flex-1">
                  <p className="font-medium">{order.order_ref}</p>
                  <p className="text-sm text-slate-500">
                    {new Date(order.created_at).toLocaleString()}
                  </p>
                </div>
                <StatusBadge status={order.status} />
                <span className="w-28 text-right font-medium">
                  <Money amount={order.amount} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
