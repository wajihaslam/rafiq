"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OPERATOR_LABELS } from "@/lib/collection/types";
import type { TokenStatus } from "@/lib/db-types";

interface Row {
  id: string;
  operatorId: string;
  msisdn: string;
  label: string | null;
  status: TokenStatus;
  expiresAt: string;
}

export function SavedWalletList({ tokens }: { tokens: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which wallet has its recharge box open, and what's typed in it. */
  const [recharging, setRecharging] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState<{
    tone: "info" | "error" | "success";
    text: string;
  } | null>(null);

  async function recharge(id: string) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setNotice({ tone: "error", text: "Enter an amount greater than zero." });
      return;
    }

    setBusy(id);
    setNotice(null);
    try {
      const response = await fetch(`/api/wallets/${id}/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value }),
      });
      const payload = await response.json();

      if (!payload.ok) {
        // An indeterminate answer is not a failure — money may have moved, so
        // say so in those words rather than inviting a second charge.
        setNotice({
          tone: payload.indeterminate ? "info" : "error",
          text: payload.message,
        });
        return;
      }

      setRecharging(null);
      setAmount("");
      // Send them to the order, where the Inquire CTA can settle it.
      router.push(`/orders/${payload.data.orderId}`);
    } catch {
      setNotice({
        tone: "info",
        text: "We couldn't confirm that charge. Check your orders before trying again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    const response = await fetch(`/api/wallets/${id}/delink`, { method: "POST" });
    const payload = await response.json();
    setBusy(null);
    if (!payload.ok) {
      setError(payload.message);
      return;
    }
    router.refresh();
  }

  if (tokens.length === 0) {
    return (
      <p className="card text-sm text-slate-500">
        No wallets linked yet. Link one below to unlock one-click checkout and
        subscriptions.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {tokens.map((token) => (
          <li key={token.id} className="space-y-3 p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="font-medium">
                  {OPERATOR_LABELS[token.operatorId as "100007" | "100008"]} ·{" "}
                  {token.msisdn}
                </p>
                <p className="text-sm text-slate-500">
                  {token.label ? `${token.label} · ` : ""}
                  {token.status === "active"
                    ? `expires ${new Date(token.expiresAt).toLocaleDateString()}`
                    : token.status}
                </p>
              </div>
              {token.status === "active" && (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setNotice(null);
                      setRecharging(
                        recharging === token.id ? null : token.id,
                      );
                    }}
                  >
                    Recharge
                  </button>
                  <button
                    type="button"
                    className="text-sm text-slate-400 hover:text-rose-600"
                    disabled={busy === token.id}
                    onClick={() => remove(token.id)}
                  >
                    {busy === token.id ? "Removing…" : "Remove"}
                  </button>
                </>
              )}
            </div>

            {recharging === token.id && (
              <div className="space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                <p className="text-sm text-slate-500">
                  Charges this wallet straight away — no OTP, since it&apos;s
                  already linked.
                </p>
                {notice && (
                  <p
                    className={`rounded-lg px-3 py-2 text-sm ${
                      notice.tone === "error"
                        ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
                        : "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                    }`}
                  >
                    {notice.text}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="label" htmlFor={`amount-${token.id}`}>
                      Amount (PKR)
                    </label>
                    <input
                      id={`amount-${token.id}`}
                      className="input"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) =>
                        setAmount(e.target.value.replace(/[^\d.]/g, ""))
                      }
                      placeholder="500"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy === token.id || amount.trim() === ""}
                    onClick={() => recharge(token.id)}
                  >
                    {busy === token.id ? "Charging…" : "Charge now"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        Removing a wallet also cancels any subscription billed to it.
      </p>
    </div>
  );
}
