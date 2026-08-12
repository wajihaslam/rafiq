"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Money } from "@/components/Money";
import { OrderActions } from "@/components/OrderActions";
import { StatusBadge } from "@/components/StatusBadge";
import { StepTrail } from "@/components/StepTrail";
import { OPERATOR_LABELS } from "@/lib/collection/types";
import { ResumeLinkForm } from "@/components/ResumeLinkForm";
import { WalletChargeActions } from "@/components/WalletChargeActions";
import type { Step } from "@/lib/steps";
import type { OrderStatus, TokenStatus } from "@/lib/db-types";

export interface WalletRow {
  id: string | null;
  registrationOrderRef: string | null;
  operatorId: string;
  msisdn: string;
  label: string | null;
  status: TokenStatus | "pending" | "failed" | "declined";
  expiresAt: string | null;
  chargeCount: number;
  charges: {
    orderId: string;
    orderRef: string;
    amount: number;
    status: OrderStatus;
    createdAt: string;
  }[];
  steps: Step[];
}

/**
 * Every linked wallet, each with the full set of things you can do to it:
 * charge it, ask about a charge, refund one, or retire it. There is no
 * artificial limit of one wallet per operator — a customer may hold several
 * Easypaisa numbers and several JazzCash ones at the same time, and each is
 * tracked on its own.
 *
 * A control is enabled by what this particular wallet supports right now, and a
 * disabled one carries the reason. Delink is last and separated, because it is
 * the only irreversible thing here.
 */
export function SavedWalletList({ wallets }: { wallets: WalletRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    id: string;
    tone: "info" | "error" | "good";
    text: string;
  } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function delink(id: string) {
    setBusy(id);
    setNotice(null);
    try {
      const response = await fetch(`/api/wallets/${id}/delink`, { method: "POST" });
      const payload = await response.json();

      if (!payload.ok) {
        setNotice({
          id,
          tone: payload.indeterminate ? "info" : "error",
          text: payload.message,
        });
        return;
      }
      setConfirming(null);
      setNotice({
        id,
        tone: payload.data.delinked ? "good" : "error",
        text: `${payload.data.code} · ${payload.data.gatewayMessage}`,
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (wallets.length === 0) {
    return (
      <p className="card text-sm text-slate-500">
        No wallets linked yet. Link one below — it takes an OTP once, and after
        that this wallet can be charged with nobody present.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {wallets.map((wallet) => {
        const key = wallet.id ?? wallet.registrationOrderRef ?? wallet.msisdn;
        const active = wallet.status === "active";
        const rowNotice = notice?.id === wallet.id ? notice : null;

        return (
          <section key={key} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-40 flex-1">
                <p className="font-medium">
                  {OPERATOR_LABELS[wallet.operatorId as "100007" | "100008"] ??
                    wallet.operatorId}{" "}
                  · {wallet.msisdn}
                </p>
                <p className="text-sm text-slate-500">
                  {wallet.label ? `${wallet.label} · ` : ""}
                  {wallet.expiresAt
                    ? `expires ${new Date(wallet.expiresAt).toLocaleDateString()}`
                    : (wallet.registrationOrderRef ?? "not linked")}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs capitalize ${
                  active
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {wallet.status}
              </span>
            </div>

            <StepTrail steps={wallet.steps} />

            {rowNotice && (
              <p
                className={`rounded-lg px-3 py-2 text-xs tabular-nums ${
                  rowNotice.tone === "error"
                    ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
                    : rowNotice.tone === "good"
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                }`}
              >
                {rowNotice.text}
              </p>
            )}

            {wallet.charges.length > 0 && (
              <details className="rounded-lg border border-slate-200 dark:border-slate-800">
                <summary className="cursor-pointer px-3 py-2 text-sm text-slate-500">
                  {wallet.chargeCount} direct payment
                  {wallet.chargeCount === 1 ? "" : "s"} — inquire or refund any of
                  them
                </summary>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {wallet.charges.map((charge) => (
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

            {wallet.id ? (
              <div className="flex flex-wrap items-start gap-3">
                <WalletChargeActions tokenId={wallet.id} disabled={!active} />

                {confirming === wallet.id ? (
                  <>
                    <button
                      type="button"
                      className="btn-ghost text-rose-600"
                      disabled={busy === wallet.id}
                      onClick={() => delink(wallet.id!)}
                    >
                      {busy === wallet.id ? "Delinking…" : "Yes, delink"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy === wallet.id}
                      onClick={() => setConfirming(null)}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost text-rose-600"
                    disabled={!active || busy === wallet.id}
                    title={
                      active
                        ? "Retires this token at the gateway. Any subscription billed to it is cancelled."
                        : "This wallet is already retired."
                    }
                    onClick={() => setConfirming(wallet.id)}
                  >
                    Delink
                  </button>
                )}
              </div>
            ) : wallet.status === "pending" && wallet.registrationOrderRef ? (
              // Finishable right here. Previously this said "finish the OTP step
              // below" and there was no such step — for JazzCash there never is
              // one, because consent is given on the gateway's page.
              <ResumeLinkForm
                orderRef={wallet.registrationOrderRef}
                operatorId={wallet.operatorId}
              />
            ) : (
              <p className="text-sm text-slate-500">
                This link never produced a token: {wallet.status}. Start again
                below to try this number afresh.
              </p>
            )}
          </section>
        );
      })}

      <p className="text-xs text-slate-500">
        Delinking a wallet also cancels any subscription billed to it. Refunds
        are per charge, in the list above.
      </p>
    </div>
  );
}
