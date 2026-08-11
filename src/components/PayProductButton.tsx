"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { formatPkr } from "@/components/Money";
import { OPERATOR_LABELS } from "@/lib/collection/types";

export interface SavedWallet {
  id: string;
  operatorId: string;
  msisdn: string;
  label: string | null;
}

type Method = "saved" | "wallet" | "hosted";

/**
 * Pay for a single product without a cart: the CTA opens a modal that collects
 * just the payment details and, when the merchant is on the OTP flow, the OTP —
 * the customer never leaves the shop listing.
 */
export function PayProductButton({
  product,
  savedWallets,
  signedIn,
}: {
  product: { id: string; name: string; price: number };
  savedWallets: SavedWallet[];
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

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        Pay {formatPkr(product.price)}
      </button>
      {open && (
        <PayModal
          product={product}
          savedWallets={savedWallets}
          onClose={() => setOpen(false)}
          onPaid={(orderId) => router.push(`/orders/${orderId}`)}
        />
      )}
    </>
  );
}

function PayModal({
  product,
  savedWallets,
  onClose,
  onPaid,
}: {
  product: { id: string; name: string; price: number };
  savedWallets: SavedWallet[];
  onClose: () => void;
  onPaid: (orderId: string) => void;
}) {
  const [method, setMethod] = useState<Method>(
    savedWallets.length > 0 ? "saved" : "wallet",
  );
  const [savedId, setSavedId] = useState(savedWallets[0]?.id ?? "");
  const [operatorId, setOperatorId] = useState<"100007" | "100008">("100007");
  const [msisdn, setMsisdn] = useState("");
  const [qty, setQty] = useState(1);

  const [orderId, setOrderId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "info" | "error";
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

  async function pay() {
    setBusy(true);
    setNotice(null);

    const response = await fetch("/api/checkout/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: product.id,
        qty,
        method,
        ...(method === "saved" ? { savedTokenId: savedId } : {}),
        ...(method === "wallet" ? { operatorId, msisdn } : {}),
      }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!payload.ok) {
      // An indeterminate answer is not a failure — say so in those words.
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
      setOrderId(payload.data.orderId);
      setNotice({
        tone: "info",
        text: "We sent an OTP to your mobile. Enter it below to confirm payment.",
      });
      return;
    }

    onPaid(payload.data.orderId);
  }

  async function confirmOtp() {
    if (!orderId) return;
    setBusy(true);
    setNotice(null);

    const response = await fetch("/api/checkout/product/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, otp }),
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

    // A wrong OTP is recoverable: keep the customer on this step.
    if (payload.data.canRetryOtp) {
      setOtp("");
      setNotice({ tone: "error", text: payload.data.message });
      return;
    }

    onPaid(orderId);
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
      <div className="card max-h-[90vh] w-full max-w-md overflow-y-auto shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">{product.name}</h2>
            <p className="text-sm text-slate-500">
              {formatPkr(total)}
              {qty > 1 ? ` · ${qty} × ${formatPkr(product.price)}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="text-sm text-slate-500 hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {notice && (
          <p
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              notice.tone === "error"
                ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
                : "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
            }`}
          >
            {notice.text}
          </p>
        )}

        {orderId ? (
          <div className="mt-4 space-y-4">
            <div>
              <label className="label" htmlFor="pay-otp">
                One-time password
              </label>
              <input
                id="pay-otp"
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="1234"
              />
            </div>
            <button
              type="button"
              className="btn-primary w-full"
              disabled={busy || otp.length < 4}
              onClick={confirmOtp}
            >
              {busy ? "Confirming…" : `Confirm ${formatPkr(total)}`}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
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

            <div className="space-y-2">
              <span className="label">How would you like to pay?</span>

              {savedWallets.length > 0 && (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <input
                    type="radio"
                    name={`pay-method-${product.id}`}
                    className="mt-1"
                    checked={method === "saved"}
                    onChange={() => setMethod("saved")}
                  />
                  <div className="flex-1 space-y-2">
                    <p className="text-sm font-medium">
                      Pay in one click — no OTP
                    </p>
                    {method === "saved" && (
                      <select
                        className="input"
                        value={savedId}
                        onChange={(e) => setSavedId(e.target.value)}
                      >
                        {savedWallets.map((w) => (
                          <option key={w.id} value={w.id}>
                            {OPERATOR_LABELS[w.operatorId as "100007" | "100008"]}{" "}
                            · {w.msisdn}
                            {w.label ? ` · ${w.label}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </label>
              )}

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <input
                  type="radio"
                  name={`pay-method-${product.id}`}
                  className="mt-1"
                  checked={method === "wallet"}
                  onChange={() => setMethod("wallet")}
                />
                <div className="flex-1 space-y-3">
                  <p className="text-sm font-medium">Mobile wallet</p>
                  {method === "wallet" && (
                    <>
                      <div className="flex gap-2">
                        {(["100007", "100008"] as const).map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setOperatorId(id)}
                            className={
                              operatorId === id ? "btn-primary" : "btn-ghost"
                            }
                          >
                            {OPERATOR_LABELS[id]}
                          </button>
                        ))}
                      </div>
                      <input
                        className="input"
                        inputMode="tel"
                        aria-label="Mobile number"
                        value={msisdn}
                        onChange={(e) => setMsisdn(e.target.value)}
                        placeholder="03001234567"
                      />
                    </>
                  )}
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <input
                  type="radio"
                  name={`pay-method-${product.id}`}
                  className="mt-1"
                  checked={method === "hosted"}
                  onChange={() => setMethod("hosted")}
                />
                <div>
                  <p className="text-sm font-medium">
                    Pay on the gateway&apos;s page
                  </p>
                  <p className="text-sm text-slate-500">
                    We&apos;ll take you there and bring you back.
                  </p>
                </div>
              </label>
            </div>

            <button
              type="button"
              className="btn-primary w-full"
              disabled={
                busy ||
                (method === "wallet" && msisdn.trim().length < 10) ||
                (method === "saved" && !savedId)
              }
              onClick={pay}
            >
              {busy ? "Working…" : `Pay ${formatPkr(total)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
