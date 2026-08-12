"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Charges a saved wallet — a direct payment against the stored token, with no
 * OTP and nobody present. It is the same call a subscription renewal makes; the
 * only difference is that the amount is typed here.
 *
 * Deliberately separate from `OrderActions`: that acts on a payment that already
 * exists, this creates one. Folding them together would put a button that
 * *spends money* next to buttons that only ask questions about it.
 */
export function WalletChargeActions({
  tokenId,
  disabled = false,
}: {
  tokenId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "info" | "error" | "good";
    text: string;
  } | null>(null);

  async function charge() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setNotice({ tone: "error", text: "Enter an amount greater than zero." });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/wallets/${tokenId}/charge`, {
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

      const outcome = payload.data.outcome as string;
      setNotice({
        tone:
          outcome === "failure" ? "error" : outcome === "success" ? "good" : "info",
        text: `${payload.data.code} · ${payload.data.gatewayMessage} — ${payload.data.orderRef}`,
      });
      setAmount("");
      // Stay put: the new charge appears in this wallet's own list, which is
      // where the Inquire and Refund controls for it live.
      router.refresh();
    } catch {
      setNotice({
        tone: "info",
        text: "We couldn't confirm that charge. Check this wallet's payments before trying again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-ghost"
        disabled={disabled}
        title={
          disabled ? "This wallet is no longer usable — link it again." : undefined
        }
        onClick={() => {
          setOpen((was) => !was);
          setNotice(null);
        }}
      >
        {open ? "Cancel charge" : "Charge"}
      </button>

      {open && !disabled && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
          <p className="text-xs text-slate-500">
            Charges this wallet straight away — no OTP, since consent was taken
            when it was linked.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-32 flex-1">
              <label className="label" htmlFor={`charge-${tokenId}`}>
                Amount (PKR)
              </label>
              <input
                id={`charge-${tokenId}`}
                className="input"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="500"
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || amount.trim() === ""}
              onClick={charge}
            >
              {busy ? "Charging…" : "Charge now"}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p
          className={`rounded-lg px-3 py-2 text-xs tabular-nums ${
            notice.tone === "error"
              ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
              : notice.tone === "good"
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          }`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
