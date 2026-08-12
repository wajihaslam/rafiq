"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { StepTrail } from "@/components/StepTrail";
import { OPERATOR_LABELS } from "@/lib/collection/types";
import { tokenSteps } from "@/lib/steps";

/**
 * Linking differs by operator and the server tells us which path we're on:
 *   Easypaisa → initiate/verify with an OTP, right here
 *   JazzCash  → a real hosted page, so we hand the browser over
 *
 * Tokenization always uses an OTP regardless of the merchant's flow (guide §2) —
 * that's the whole point: consent once, then charge with the customer absent.
 *
 * There is no limit of one wallet per operator: the form stays available with
 * wallets already linked, and each link is a fresh registration.
 */
export function LinkWalletForm({
  sequence = "initiate_verify",
}: {
  /** Whether an initiate call sends the OTP, or verify is the only call. */
  sequence?: "initiate_verify" | "verify_only";
}) {
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
      setNotice({
        tone: "info",
        // The route knows whether it just sent an OTP or is waiting for one the
        // operator sent; prefer its wording over a guess made here.
        text: payload.data.message ?? "Enter the OTP sent to your mobile.",
      });
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
        <h2 className="font-medium">Link a wallet</h2>
        {/* Tokenization is always verified before it can be charged, whatever
            flow the payment merchant is on — so the sequence is fixed and can be
            stated up front rather than discovered. */}
        <p className="mt-1 text-sm text-slate-500">
          {orderRef
            ? "Confirm the OTP to finish linking."
            : operatorId === "100008"
              ? "JazzCash takes consent on its own page — we'll send you there and redeem the result when you come back."
              : sequence === "verify_only"
                ? // No initiate on this gateway, so we are not the ones sending
                  // it — claiming otherwise would leave the customer waiting for
                  // a message we never asked for.
                  "Enter the OTP for this wallet to approve the link."
                : "We'll send an OTP to approve the link."}{" "}
          Linking saves your consent once so later charges need no OTP. It does
          not move any money.
        </p>
      </div>

      {/* The same trail the wallet itself will carry once it exists, so the
          steps do not get renamed the moment linking succeeds. */}
      <StepTrail
        steps={tokenSteps({
          initiated: Boolean(orderRef),
          verified: false,
          charges: 0,
          refunds: 0,
          live: true,
        })}
      />

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
