"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Finishes a wallet link that was started and left hanging.
 *
 * Without this a pending registration was a dead end: the OTP field only existed
 * inside the "Link a wallet" form, and only for a link started in that same
 * browser session. Reload the page, or come back tomorrow, and the registration
 * sat there marked *Verify* with nothing anywhere on the page that could verify
 * it.
 *
 * How it is finished depends on the operator, and the difference is not
 * cosmetic:
 *
 *   Easypaisa  an OTP, redeemed by `verify` (transactionType 8).
 *   JazzCash   no OTP at all — consent was given on the gateway's own page, and
 *              `finalize` redeems it. It is idempotent per orderId, so pressing
 *              it twice cannot mint two tokens, and pressing it after the
 *              customer abandoned the page simply answers 0037 again.
 *
 * Offering an OTP box for a JazzCash link would be asking for a code the
 * customer was never sent.
 */
export function ResumeLinkForm({
  orderRef,
  operatorId,
}: {
  orderRef: string;
  operatorId: string;
}) {
  const router = useRouter();
  const hosted = operatorId === "100008";
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "info" | "error" | "good";
    text: string;
  } | null>(null);

  async function submit() {
    setBusy(true);
    setNotice(null);
    try {
      const response = hosted
        ? await fetch("/api/wallets/finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderRef }),
          })
        : await fetch("/api/wallets/link/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderRef, otp }),
          });
      const payload = await response.json();

      if (!payload.ok) {
        setNotice({
          tone: payload.indeterminate ? "info" : "error",
          text: payload.message,
        });
        return;
      }

      if (payload.data.linked) {
        setOtp("");
        setNotice({ tone: "good", text: "Wallet linked." });
        router.refresh();
        return;
      }

      setOtp("");
      setNotice({
        // 0037 on a hosted link means consent is still in flight, which is a
        // "not yet", not a "no".
        tone: payload.data.code === "0037" ? "info" : "error",
        text:
          payload.data.code === "0037"
            ? "The operator has not confirmed this consent yet. Try again in a moment."
            : payload.data.message,
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
      <p className="text-xs text-slate-500">
        {hosted
          ? "Consent was taken on the JazzCash page. Redeem it to finish — safe to press more than once."
          : "Enter the OTP sent to this number to finish linking."}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        {!hosted && (
          <div className="min-w-32 flex-1">
            <label className="label" htmlFor={`resume-otp-${orderRef}`}>
              One-time password
            </label>
            <input
              id={`resume-otp-${orderRef}`}
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="1234"
            />
          </div>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={busy || (!hosted && otp.length < 4)}
          onClick={submit}
        >
          {busy
            ? hosted
              ? "Redeeming…"
              : "Verifying…"
            : hosted
              ? "Redeem consent"
              : "Verify and link"}
        </button>
      </div>

      {notice && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
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
