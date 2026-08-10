import type { OrderStatus } from "@/lib/db-types";

/**
 * Note that `pending` is never worded as a failure — an order sits pending
 * precisely when the gateway gave us an indeterminate code and money may have
 * moved (guide §6).
 */
const STYLES: Record<OrderStatus, { label: string; className: string }> = {
  pending: {
    label: "Awaiting confirmation",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  paid: {
    label: "Paid",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    className: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  refund_submitted: {
    label: "Refund submitted",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  },
  refunded: {
    label: "Refunded",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}
