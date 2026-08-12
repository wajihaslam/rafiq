"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { formatPkr } from "@/components/Money";
import { StepTrail } from "@/components/StepTrail";
import { OPERATOR_LABELS } from "@/lib/collection/types";
import { oneTimeSteps, type Flow } from "@/lib/steps";
import type { TxnOperation } from "@/lib/db-types";

/**
 * Pay for a single product: one item, one payment, no cart.
 *
 * The modal is the payment's own step trail — Initiate → Verify → Inquire →
 * Refund on the OTP flow, Verify → Inquire → Refund on Non-OTP — and every
 * button is enabled by what has actually happened rather than by what the
 * customer might want to do next. A step that cannot be taken says why.
 *
 * Which sequence applies is the *server's* answer, not a guess: the merchant is
 * provisioned for exactly one flow, so the page passes it in.
 */
export function PayProductButton({
  product,
  flow,
  signedIn,
}: {
  product: { id: string; name: string; price: number };
  flow: Flow | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!signedIn) {
    // Link, not <a>: a full document reload here throws away the shop listing
    // the customer is standing on.
    return (
      <Link href="/login?next=/" className="btn-primary">
        Sign in to pay
      </Link>
    );
  }

  if (!flow) {
    return (
      <span
        className="btn-ghost cursor-not-allowed opacity-60"
        title="No payment flow is configured yet — an administrator can set one on the Configuration page."
      >
        Payments off
      </span>
    );
  }

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        Pay {formatPkr(product.price)}
      </button>
      {open && (
        <PayModal
          product={product}
          flow={flow}
          onClose={() => setOpen(false)}
          onDone={(orderId) => router.push(`/orders/${orderId}`)}
        />
      )}
    </>
  );
}

function PayModal({
  product,
  flow,
  onClose,
  onDone,
}: {
  product: { id: string; name: string; price: number };
  flow: Flow;
  onClose: () => void;
  onDone: (orderId: string) => void;
}) {
  const [operatorId, setOperatorId] = useState<"100007" | "100008">("100007");
  const [msisdn, setMsisdn] = useState("");
  const [qty, setQty] = useState(1);
  const [otp, setOtp] = useState("");

  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderRef, setOrderRef] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState("pending");
  /** What has actually been called, which is what drives the trail. */
  const [operations, setOperations] = useState<TxnOperation[]>([]);
  const [needsOtp, setNeedsOtp] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: "info" | "error" | "good";
    text: string;
  } | null>(null);

  // A modal that ignores Escape is a trap when the payment has not started yet.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const total = Math.round(product.price * qty * 100) / 100;
  const steps = oneTimeSteps({ flow, operations, orderStatus });
  const started = orderId !== null;

  // --- what each CTA may do right now ------------------------------------
  const canStart = !started && !busy && msisdn.trim().length >= 10;
  const canVerify = started && needsOtp && !busy && otp.length >= 4;
  const canInquire = started && orderStatus === "pending" && !busy && !needsOtp;
  const canRefund = started && orderStatus === "paid" && !busy;

  function report(payload: {
    ok: boolean;
    message?: string;
    indeterminate?: boolean;
    data?: { outcome?: string; message?: string };
  }) {
    if (!payload.ok) {
      // An indeterminate answer is not a failure — say so in those words.
      setNotice({
        tone: payload.indeterminate ? "info" : "error",
        text: payload.message ?? "Something went wrong.",
      });
      return false;
    }
    const outcome = payload.data?.outcome;
    setNotice({
      tone: outcome === "failure" ? "error" : outcome === "success" ? "good" : "info",
      text: payload.data?.message ?? "Done.",
    });
    return true;
  }

  /** Step 1 — initiate (OTP flow) or verify outright (Non-OTP). */
  async function start() {
    setBusy("start");
    setNotice(null);
    try {
      const response = await fetch("/api/checkout/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, qty, operatorId, msisdn }),
      });
      const payload = await response.json();
      if (!report(payload)) return;

      setOrderId(payload.data.orderId);
      setOrderRef(payload.data.orderRef);
      setOrderStatus(payload.data.orderStatus);
      setOperations([flow === "otp" ? "initiate" : "verify"]);
      setNeedsOtp(Boolean(payload.data.needsOtp));

      if (payload.data.needsOtp) {
        setNotice({
          tone: "info",
          text: "We sent an OTP to your mobile. Enter it below to confirm payment.",
        });
      }
    } finally {
      setBusy(null);
    }
  }

  /** Step 2 — verify with the OTP. Only ever reached on the OTP flow. */
  async function verify() {
    if (!orderId) return;
    setBusy("verify");
    setNotice(null);
    try {
      const response = await fetch("/api/checkout/product/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, otp }),
      });
      const payload = await response.json();
      if (!report(payload)) return;

      // A wrong OTP is recoverable: keep the customer on this step.
      if (payload.data.canRetryOtp) {
        setOtp("");
        setNotice({ tone: "error", text: payload.data.message });
        return;
      }

      setOtp("");
      setNeedsOtp(false);
      setOrderStatus(payload.data.orderStatus);
      setOperations((prev) => [...prev, "verify"]);
    } finally {
      setBusy(null);
    }
  }

  /** Step 3 — inquire. This is what actually settles a pending order (§6). */
  async function inquire() {
    if (!orderId) return;
    setBusy("inquire");
    setNotice(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/inquire`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!report(payload)) return;
      setOrderStatus(payload.data.orderStatus);
      setOperations((prev) => [...prev, "inquiry"]);
    } finally {
      setBusy(null);
    }
  }

  /** Step 4 — refund. Success is 0135, and it means submitted, not returned. */
  async function refund() {
    if (!orderId) return;
    setBusy("refund");
    setNotice(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/refund`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!report(payload)) return;
      setOrderStatus(payload.data.orderStatus);
      setOperations((prev) => [...prev, "refund"]);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Pay for ${product.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="card max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">{product.name}</h2>
            <p className="text-sm text-slate-500">
              {formatPkr(total)}
              {qty > 1 ? ` · ${qty} × ${formatPkr(product.price)}` : ""}
              {orderRef ? ` · ${orderRef}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="text-sm text-slate-500 hover:underline disabled:opacity-50"
            disabled={Boolean(busy)}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div>
          <p className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">
            One-time payment · {flow === "otp" ? "OTP flow" : "Non-OTP flow"}
          </p>
          <StepTrail steps={steps} />
        </div>

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

        {!started && (
          <>
            <div>
              <label className="label" htmlFor={`qty-${product.id}`}>
                Quantity
              </label>
              <input
                id={`qty-${product.id}`}
                className="input"
                inputMode="numeric"
                value={qty}
                onChange={(e) => {
                  const next = Number(e.target.value.replace(/\D/g, ""));
                  setQty(Math.min(99, Math.max(1, next || 1)));
                }}
              />
            </div>

            <div>
              <span className="label">Wallet</span>
              <div className="flex gap-2">
                {(["100007", "100008"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setOperatorId(id)}
                    className={operatorId === id ? "btn-primary" : "btn-ghost"}
                  >
                    {OPERATOR_LABELS[id]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor={`msisdn-${product.id}`}>
                Mobile number
              </label>
              <input
                id={`msisdn-${product.id}`}
                className="input"
                inputMode="tel"
                value={msisdn}
                onChange={(e) => setMsisdn(e.target.value)}
                placeholder="03001234567"
              />
            </div>
          </>
        )}

        {needsOtp && (
          <div>
            <label className="label" htmlFor={`otp-${product.id}`}>
              One-time password
            </label>
            <input
              id={`otp-${product.id}`}
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="1234"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={!canStart}
            onClick={start}
          >
            {busy === "start"
              ? "Working…"
              : started
                ? flow === "otp"
                  ? "Initiated ✓"
                  : "Verified ✓"
                : flow === "otp"
                  ? `Initiate ${formatPkr(total)}`
                  : `Pay ${formatPkr(total)}`}
          </button>

          {/* Only the OTP flow has a second call to make. Rendering a Verify
              button on Non-OTP would offer a step that does not exist there. */}
          {flow === "otp" && (
            <button
              type="button"
              className="btn-ghost"
              disabled={!canVerify}
              onClick={verify}
            >
              {busy === "verify" ? "Confirming…" : needsOtp ? "Verify" : "Verified ✓"}
            </button>
          )}

          <button
            type="button"
            className="btn-ghost"
            disabled={!canInquire}
            onClick={inquire}
            title={
              canInquire ? undefined : "Available while the payment is unsettled."
            }
          >
            {busy === "inquire" ? "Inquiring…" : "Inquire"}
          </button>

          <button
            type="button"
            className="btn-ghost text-rose-600"
            disabled={!canRefund}
            onClick={refund}
            title={canRefund ? undefined : "Available once the payment has settled."}
          >
            {busy === "refund" ? "Refunding…" : "Refund"}
          </button>
        </div>

        {started && (
          <button
            type="button"
            className="text-sm text-slate-500 hover:underline"
            onClick={() => onDone(orderId!)}
          >
            Open this payment →
          </button>
        )}
      </div>
    </div>
  );
}
