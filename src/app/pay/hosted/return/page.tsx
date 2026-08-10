/**
 * Landing page for the Hosted Page redirect (§4.9).
 *
 * The redirect almost always carries status=0037, which is the *expected* first
 * answer of an async flow rather than an error. The real outcome comes from
 * POST /inquire, so we just find the order and hand off to the order page,
 * where the resolver polls it.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getSupabaseServerClient, requireUser } from "@/lib/supabase/server";

export default async function HostedReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const orderRef = typeof params.orderId === "string" ? params.orderId : null;

  if (orderRef) {
    const supabase = await getSupabaseServerClient();
    const { data: order } = await supabase
      .from("orders")
      .select("id")
      .eq("order_ref", orderRef)
      .maybeSingle();
    if (order) redirect(`/orders/${order.id}`);
  }

  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Payment received</h1>
      <div className="card space-y-3 text-sm text-slate-500">
        <p>
          We couldn&apos;t match that reference to one of your orders. If you were
          charged, it will appear in your order history shortly.
        </p>
        <Link href="/orders" className="btn-primary w-fit">
          View orders
        </Link>
      </div>
    </div>
  );
}
