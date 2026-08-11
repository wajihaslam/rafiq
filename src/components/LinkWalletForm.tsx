"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OPERATOR_LABELS } from "@/lib/collection/types";

/**
 * Linking differs by operator and the server tells us which path we're on:
 *   Easypaisa → initiate/verify with an OTP, right here
 *   JazzCash  → a real hosted page, so we hand the browser over
 *
 * Tokenization always uses an OTP regardless of the merchant's flow (guide §2) —
 * that's the whole point: consent once, then charge with the customer absent.
 */
export function LinkWalletForm() {
  const router = useRouter();
  const [operatorId, setOperatorId] = useState<"100007" | "100008">("100007");
  const [msisdn, setMsisdn] = useState("");
  const [label, setLabel] = useState("");
  const [orderRef, setOrderRef] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(
    null,
  );

  async function start() {
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/wallets/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorId, msisdn, label: label || undefined }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!payload.ok) {
      setNotice({
        tone: payload.indeterminate ? "info" : "error",
        text: payload.message,
      });
      return;
    }

    if (payload.data.redirectTo) {
      window.location.href = payload.data.redirectTo;
      return;
    }

    if (payload.data.needsOtp) {
      setOrderRef(payload.data.orderRef);
      setNotice({ tone: "info", text: "Enter the OTP sent to your mobile." });
      return;
    }

    setNotice({ tone: "error", text: payload.data.message });
  }

  async function confirm() {
    if (!orderRef) return;
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/wallets/link/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderRef, otp }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!payload.ok) {
      setNotice({
        tone: payload.indeterminate ? "info" : "error",
        text: payload.message,
      });
      return;
    }

    if (payload.data.linked) {
      setOrderRef(null);
      setOtp("");
      setMsisdn("");
      setLabel("");
      setNotice({ tone: "info", text: "Wallet linked." });
      router.refresh();
      return;
    }

    setOtp("");
    setNotice({ tone: "error", text: payload.data.message });
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-medium">Link a new wallet</h2>
        {/* Tokenization is two steps and always OTP-verified, whatever flow the
            payment merchant is on — so the step count is fixed and can be
            stated up front rather than discovered. */}
        <p className="mt-1 text-sm text-slate-500">
          {orderRef
            ? "Step 2 of 2 — confirm the OTP to finish linking."
            : "Step 1 of 2 — we'll send an OTP to approve the link."}{" "}
          Linking saves your consent once so later charges need no OTP. It does
          not move any money.
        </p>
      </div>

      <ol className="flex gap-2 text-xs">
        {[
          { n: 1, label: "Wallet details" },
          { n: 2, label: "Confirm OTP" },
        ].map((step) => {
          const current = orderRef ? 2 : 1;
          const state =
            step.n === current
              ? "border-brand-500 text-brand-600 font-medium"
              : step.n < current
                ? "border-emerald-500 text-emerald-600"
                : "border-slate-200 text-slate-400 dark:border-slate-800";
          return (
            <li
              key={step.n}
              className={`flex-1 rounded-lg border px-3 py-2 ${state}`}
            >
              {step.n < current ? "✓" : step.n}. {step.label}
            </li>
          );
        })}
      </ol>

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

      {orderRef ? (
        <>
          <div>
            <label className="label" htmlFor="link-otp">
              One-time password
            </label>
            <input
              id="link-otp"
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="1234"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || otp.length < 4}
              onClick={confirm}
            >
              {busy ? "Linking…" : "Confirm and link"}
            </button>
            {/* Without this, a customer who mistyped their number on step 1 is
                stuck on a step they cannot complete. */}
            <button
              type="button"
              className="text-sm text-slate-500 hover:underline"
              disabled={busy}
              onClick={() => {
                setOrderRef(null);
                setOtp("");
                setNotice(null);
              }}
            >
              Start over
            </button>
          </div>
        </>
      ) : (
        <>
          <div>
            <span className="label">Wallet</span>
            <div className="flex gap-2">
              {(["100007", "100008"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={operatorId === id ? "btn-primary" : "btn-ghost"}
                  onClick={() => setOperatorId(id)}
                >
                  {OPERATOR_LABELS[id]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="link-msisdn">
              Mobile number
            </label>
            <input
              id="link-msisdn"
              className="input"
              inputMode="tel"
              value={msisdn}
              onChange={(e) => setMsisdn(e.target.value)}
              placeholder="03001234567"
            />
          </div>

          <div>
            <label className="label" htmlFor="link-label">
              Label <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="link-label"
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My main wallet"
            />
          </div>

          <button
            type="button"
            className="btn-primary"
            disabled={busy || msisdn.trim().length < 10}
            onClick={start}
          >
            {busy ? "Starting…" : "Link wallet"}
          </button>
        </>
      )}
    </section>
  );
}
