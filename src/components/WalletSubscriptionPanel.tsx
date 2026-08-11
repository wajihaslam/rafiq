"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatPkr } from "@/components/Money";
import { OPERATOR_LABELS } from "@/lib/collection/types";
import type { SubStatus } from "@/lib/db-types";

export interface PanelPlan {
  id: string;
  name: string;
  price: number;
  intervalDays: number;
}

export interface PanelToken {
  id: string;
  msisdn: string;
}

export interface PanelSubscription {
  id: string;
  status: SubStatus;
  nextChargeAt: string;
  planId: string;
}

/**
 * One wallet, one panel: subscribe the number → get a token → pay → verify →
 * unsubscribe, each as its own CTA. Every CTA is enabled or disabled purely by
 * what we know about this operator — there is no step to guess at, because a
 * step you cannot yet take is visibly unavailable rather than silently broken.
 *
 * The two operators genuinely differ: Easypaisa tokenizes over JSON with an OTP
 * we collect here, JazzCash hands the browser to a hosted page and comes back.
 */
export function WalletSubscriptionPanel({
  operatorId,
  plans,
  token,
  pendingOrderRef,
  subscription,
}: {
  operatorId: "100007" | "100008";
  plans: PanelPlan[];
  token: PanelToken | null;
  /** An Easypaisa link that has been started but not yet OTP-verified. */
  pendingOrderRef: string | null;
  subscription: PanelSubscription | null;
}) {
  const router = useRouter();
  const hosted = operatorId === "100008";

  const [planId, setPlanId] = useState(subscription?.planId ?? plans[0]?.id ?? "");
  const [msisdn, setMsisdn] = useState("");
  const [otp, setOtp] = useState("");
  const [showNumber, setShowNumber] = useState(false);
  const [orderRef, setOrderRef] = useState<string | null>(pendingOrderRef);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "info" | "error" | "good";
    text: string;
  } | null>(null);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const liveSub =
    subscription && subscription.status !== "cancelled" ? subscription : null;

  // --- what each CTA is allowed to do right now -------------------------
  const canSubscribe = !token && !busy;
  /**
   * Whether the OTP step *applies* is separate from whether it can be actioned
   * right now. Folding `busy` into the first would unmount the OTP field for
   * the duration of the verify call — the customer watches what they just
   * typed vanish and reappear.
   */
  const onVerifyStep = Boolean(!token && orderRef && !hosted);
  const canVerify = onVerifyStep && !busy;
  const canPay = Boolean(token && plan) && liveSub?.status !== "paused" && !busy;
  const canUnsubscribe = Boolean(liveSub) && !busy;

  function fail(payload: { indeterminate?: boolean; message: string }) {
    setNotice({
      tone: payload.indeterminate ? "info" : "error",
      text: payload.message,
    });
  }

  /** Step 1 — subscribe this number, i.e. start tokenization. */
  async function subscribeNumber() {
    if (!showNumber) {
      setShowNumber(true);
      setNotice(null);
      return;
    }
    setBusy("subscribe");
    setNotice(null);
    try {
      const response = await fetch("/api/wallets/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorId, msisdn }),
      });
      const payload = await response.json();
      if (!payload.ok) return fail(payload);

      if (payload.data.redirectTo) {
        window.location.href = payload.data.redirectTo;
        return;
      }
      if (payload.data.needsOtp) {
        setOrderRef(payload.data.orderRef);
        setShowNumber(false);
        setNotice({
          tone: "info",
          text: "OTP sent. Verify it to get your token.",
        });
        return;
      }
      fail({ message: payload.data.message });
    } finally {
      setBusy(null);
    }
  }

  /** Step 2 — verify the OTP; a success mints the token we charge against. */
  async function verifyOtp() {
    if (!orderRef) return;
    setBusy("verify");
    setNotice(null);
    try {
      const response = await fetch("/api/wallets/link/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderRef, otp }),
      });
      const payload = await response.json();
      if (!payload.ok) return fail(payload);

      if (payload.data.linked) {
        setOtp("");
        setOrderRef(null);
        setNotice({ tone: "good", text: "Token received — you can pay now." });
        router.refresh();
        return;
      }
      setOtp("");
      fail({ message: payload.data.message });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Step 3 — pay. The first payment also starts the subscription; after that
   * the same CTA charges the current period against the stored token.
   */
  async function pay() {
    if (!plan) return;
    setBusy("pay");
    setNotice(null);
    try {
      const response = liveSub
        ? await fetch(`/api/subscriptions/${liveSub.id}/charge`, {
            method: "POST",
          })
        : await fetch("/api/subscriptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productId: plan.id,
              paymentTokenId: token!.id,
            }),
          });
      const payload = await response.json();
      if (!payload.ok) return fail(payload);

      // An indeterminate charge is not a failure — the subscription stands and
      // the order resolves by postback or inquiry.
      if (payload.data.outcome === "failure") {
        setNotice({ tone: "error", text: payload.data.message });
      } else if (payload.data.outcome === "indeterminate") {
        setNotice({ tone: "info", text: payload.data.message });
      } else {
        setNotice({ tone: "good", text: payload.data.message });
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  /** Step 4 — unsubscribe. The token stays linked; only the billing stops. */
  async function unsubscribe() {
    if (!liveSub) return;
    setBusy("cancel");
    setNotice(null);
    try {
      const response = await fetch(`/api/subscriptions/${liveSub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const payload = await response.json();
      if (!payload.ok) return fail(payload);
      setConfirming(false);
      setNotice({ tone: "good", text: "Unsubscribed. Your wallet stays linked." });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{OPERATOR_LABELS[operatorId]}</h3>
          <p className="text-sm text-slate-500">
            {token
              ? `Token active · ${token.msisdn}`
              : orderRef && !hosted
                ? "Awaiting OTP verification"
                : hosted
                  ? "Subscribe on the JazzCash page to get a token"
                  : "No token yet — subscribe a number first"}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs ${
            liveSub
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          }`}
        >
          {liveSub ? `Subscribed · ${liveSub.status}` : "Not subscribed"}
        </span>
      </div>

      {plans.length > 1 && (
        <div>
          <label className="label" htmlFor={`plan-${operatorId}`}>
            Plan
          </label>
          <select
            id={`plan-${operatorId}`}
            className="input"
            value={planId}
            // Changing the plan of a live subscription would silently bill a
            // different amount, so it is fixed once subscribed.
            disabled={Boolean(liveSub)}
            onChange={(e) => setPlanId(e.target.value)}
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatPkr(p.price)} / {p.intervalDays} days
              </option>
            ))}
          </select>
        </div>
      )}

      {showNumber && !token && (
        <div>
          <label className="label" htmlFor={`msisdn-${operatorId}`}>
            Mobile number
          </label>
          <input
            id={`msisdn-${operatorId}`}
            className="input"
            inputMode="tel"
            value={msisdn}
            onChange={(e) => setMsisdn(e.target.value)}
            placeholder="03001234567"
          />
        </div>
      )}

      {onVerifyStep && (
        <div>
          <label className="label" htmlFor={`otp-${operatorId}`}>
            One-time password
          </label>
          <input
            id={`otp-${operatorId}`}
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            placeholder="1234"
          />
        </div>
      )}

      {notice && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
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

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={
            !canSubscribe || (showNumber && msisdn.trim().length < 10)
          }
          onClick={subscribeNumber}
        >
          {busy === "subscribe"
            ? "Subscribing…"
            : token
              ? "Subscribed ✓"
              : showNumber
                ? hosted
                  ? "Continue to JazzCash"
                  : "Send OTP"
                : "Subscribe number"}
        </button>

        <button
          type="button"
          className="btn-ghost"
          disabled={!canVerify || otp.length < 4}
          onClick={verifyOtp}
        >
          {busy === "verify" ? "Verifying…" : token ? "Verified ✓" : "Verify"}
        </button>

        <button
          type="button"
          className="btn-ghost"
          disabled={!canPay}
          onClick={pay}
        >
          {busy === "pay"
            ? "Charging…"
            : plan
              ? `Pay ${formatPkr(plan.price)}`
              : "Pay"}
        </button>

        {confirming ? (
          <>
            <button
              type="button"
              className="btn-ghost text-rose-600"
              disabled={busy === "cancel"}
              onClick={unsubscribe}
            >
              {busy === "cancel" ? "Unsubscribing…" : "Yes, unsubscribe"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy === "cancel"}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-ghost text-rose-600"
            disabled={!canUnsubscribe}
            onClick={() => setConfirming(true)}
          >
            Unsubscribe
          </button>
        )}
      </div>

      {liveSub?.status === "active" && (
        <p className="text-xs text-slate-500">
          Next automatic charge{" "}
          {new Date(liveSub.nextChargeAt).toLocaleDateString()} · &ldquo;Pay&rdquo;
          charges the current period now.
        </p>
      )}
    </section>
  );
}
