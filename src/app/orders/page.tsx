import Link from "next/link";

import { Money } from "@/components/Money";
import { OrderActions } from "@/components/OrderActions";
import { StatusBadge } from "@/components/StatusBadge";
import { StepTrail } from "@/components/StepTrail";
import { WalletChargeActions } from "@/components/WalletChargeActions";
import { codeMessage } from "@/lib/collection/codes";
import { OPERATOR_LABELS } from "@/lib/collection/types";
import { oneTimePayments, tokenizations } from "@/lib/tracking";
import { requireUser } from "@/lib/supabase/server";

/**
 * Two ledgers, deliberately not merged.
 *
 * A one-time payment is a customer paying now; a tokenization is a wallet that
 * was linked once and can be charged repeatedly afterwards. Listing them
 * together buries the second: forty identical rows where what you actually want
 * is one wallet with a tally of forty. Hence the tabs — and hence "×40" on a
 * single step rather than forty steps.
 */
export const dynamic = "force-dynamic";

type Track = "one_time" | "tokenization";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const raw = Array.isArray(params.track) ? params.track[0] : params.track;
  const track: Track = raw === "tokenization" ? "tokenization" : "one_time";

  const [oneTime, tokens] = await Promise.all([
    oneTimePayments(user.id),
    tokenizations(user.id),
  ]);

  const tabs: { id: Track; label: string; count: number }[] = [
    { id: "one_time", label: "One-time payments", count: oneTime.length },
    { id: "tokenization", label: "Tokenization", count: tokens.length },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
        <p className="mt-1 text-sm text-slate-500">
          One-time payments and wallet tokenization are tracked apart — they run
          under different merchants and settle in different ways. Every charge
          against a saved wallet counts as one step on that wallet, not as a
          payment of its own.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.id === "one_time" ? "/orders" : `/orders?track=${tab.id}`}
            className={track === tab.id ? "btn-primary" : "btn-ghost"}
          >
            {tab.label}
            <span className="tabular-nums opacity-70">{tab.count}</span>
          </Link>
        ))}
      </nav>

      {track === "one_time" ? (
        oneTime.length === 0 ? (
          <p className="card text-sm text-slate-500">
            No one-time payments yet.{" "}
            <Link href="/" className="underline">
              Pay for something from the shop
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-3">
            {oneTime.map((row) => (
              <li key={row.orderId} className="card space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`/orders/${row.orderId}`}
                    className="min-w-40 flex-1 hover:underline"
                  >
                    <p className="font-medium">{row.orderRef}</p>
                    <p className="text-sm text-slate-500">
                      {new Date(row.createdAt).toLocaleString()}
                      {row.msisdn ? ` · ${row.msisdn}` : ""}
                      {row.operatorId
                        ? ` · ${OPERATOR_LABELS[row.operatorId as "100007" | "100008"] ?? row.operatorId}`
                        : ""}
                    </p>
                  </Link>
                  <StatusBadge status={row.status} />
                  <span className="w-24 text-right font-medium">
                    <Money amount={row.amount} />
                  </span>
                </div>

                <StepTrail steps={row.steps} />

                <div className="flex flex-wrap items-end justify-between gap-3">
                  <p className="text-xs tabular-nums text-slate-500">
                    {row.statusCode
                      ? `${row.statusCode} · ${codeMessage(row.statusCode)}`
                      : "No gateway code yet"}
                    {row.gatewayTransactionId
                      ? ` · txn ${row.gatewayTransactionId}`
                      : ""}
                  </p>
                  <OrderActions
                    orderId={row.orderId}
                    status={row.status}
                    amount={row.amount}
                    compact
                  />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : tokens.length === 0 ? (
        <p className="card text-sm text-slate-500">
          No wallets linked yet.{" "}
          <Link href="/wallets" className="underline">
            Link one
          </Link>{" "}
          to charge it without an OTP.
        </p>
      ) : (
        <ul className="space-y-3">
          {tokens.map((row) => (
            <li
              key={row.tokenId ?? row.registrationOrderRef ?? row.msisdn}
              className="card space-y-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-40 flex-1">
                  <p className="font-medium">
                    {OPERATOR_LABELS[row.operatorId as "100007" | "100008"] ??
                      row.operatorId}{" "}
                    · {row.msisdn}
                  </p>
                  <p className="text-sm text-slate-500">
                    {row.label ? `${row.label} · ` : ""}
                    {row.linkedAt
                      ? `linked ${new Date(row.linkedAt).toLocaleDateString()}`
                      : row.registrationOrderRef ?? "not linked"}
                    {row.expiresAt
                      ? ` · expires ${new Date(row.expiresAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize dark:bg-slate-800">
                  {row.status}
                </span>
              </div>

              <StepTrail steps={row.steps} />

              {row.charges.length > 0 && (
                <details className="rounded-lg border border-slate-200 dark:border-slate-800">
                  <summary className="cursor-pointer px-3 py-2 text-sm text-slate-500">
                    {row.chargeCount} direct payment
                    {row.chargeCount === 1 ? "" : "s"}
                    {row.refundCount > 0 ? ` · ${row.refundCount} refunded` : ""}
                  </summary>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {row.charges.map((charge) => (
                      <li
                        key={charge.orderId}
                        className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                      >
                        <Link
                          href={`/orders/${charge.orderId}`}
                          className="min-w-32 flex-1 text-sm hover:underline"
                        >
                          {charge.orderRef}
                          <span className="block text-xs text-slate-500">
                            {new Date(charge.createdAt).toLocaleString()}
                          </span>
                        </Link>
                        <StatusBadge status={charge.status} />
                        <span className="w-20 text-right text-sm font-medium">
                          <Money amount={charge.amount} />
                        </span>
                        <OrderActions
                          orderId={charge.orderId}
                          status={charge.status}
                          amount={charge.amount}
                          compact
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {row.tokenId && (
                <WalletChargeActions
                  tokenId={row.tokenId}
                  disabled={row.status !== "active"}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
