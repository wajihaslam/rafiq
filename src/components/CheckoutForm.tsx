"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OPERATOR_LABELS } from "@/lib/collection/types";

interface SavedWallet {
  id: string;
  operatorId: string;
  msisdn: string;
  label: string | null;
}

type Method = "saved" | "wallet" | "hosted";

/**
 * The server decides whether an OTP step is needed — it knows which flow the
 * MID is provisioned on, and the client must not guess. We simply render the OTP
 * step when the start call answers `needsOtp`.
 */
export function CheckoutForm({ savedWallets }: { savedWallets: SavedWallet[] }) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>(
    savedWallets.length > 0 ? "saved" : "wallet",
  );
  const [savedId, setSavedId] = useState(savedWallets[0]?.id ?? "");
  const [operatorId, setOperatorId] = useState("100007");
  const [msisdn, setMsisdn] = useState("");
  const [otp, setOtp] = useState("");

  const [orderId, setOrderId] = useState<string | null>(null);
  const [needsOtp, setNeedsOtp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "info" | "error";
    text: string;
  } | null>(null);

  async function start() {
    setBusy(true);
    setNotice(null);

    const endpoint =
      method === "hosted" ? "/api/checkout/hosted" : "/api/checkout/wallet/start";
    const body =
      method === "hosted"
        ? undefined
        : JSON.stringify(
            method === "saved"
              ? { savedTokenId: savedId }
              : { operatorId, msisdn },
          );

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
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

    // Hosted page: hand the browser over to the gateway.
    if (payload.data.redirectTo) {
      window.location.href = payload.data.redirectTo;
      return;
    }

    setOrderId(payload.data.orderId);

    if (payload.data.needsOtp) {
      setNeedsOtp(true);
      setNotice({
        tone: "info",
        text: "We sent an OTP to your mobile. Enter it below to confirm payment.",
      });
      return;
    }

    router.push(`/orders/${payload.data.orderId}`);
  }

  async function confirmOtp() {
    if (!orderId) return;
    setBusy(true);
    setNotice(null);

    const response = await fetch("/api/checkout/wallet/verify", {
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

    router.push(`/orders/${orderId}`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Payment</h1>

      {notice && (
        <p
          className={`rounded-lg px-4 py-3 text-sm ${
            notice.tone === "error"
              ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
              : "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          }`}
        >
          {notice.text}
        </p>
      )}

      {needsOtp ? (
        <div className="card space-y-4">
          <div>
            <label className="label" htmlFor="otp">
              One-time password
            </label>
            <input
              id="otp"
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
            className="btn-primary"
            disabled={busy || otp.length < 4}
            onClick={confirmOtp}
          >
            {busy ? "Confirming…" : "Confirm payment"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {savedWallets.length > 0 && (
            <label className="card flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="method"
                className="mt-1"
                checked={method === "saved"}
                onChange={() => setMethod("saved")}
              />
              <div className="flex-1 space-y-2">
                <p className="font-medium">Pay in one click</p>
                <p className="text-sm text-slate-500">
                  Charge a wallet you&apos;ve already linked — no OTP needed.
                </p>
                {method === "saved" && (
                  <select
                    className="input"
                    value={savedId}
                    onChange={(e) => setSavedId(e.target.value)}
                  >
                    {savedWallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {OPERATOR_LABELS[w.operatorId as "100007" | "100008"]} ·{" "}
                        {w.msisdn}
                        {w.label ? ` · ${w.label}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>
          )}

          <label className="card flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="method"
              className="mt-1"
              checked={method === "wallet"}
              onChange={() => setMethod("wallet")}
            />
            <div className="flex-1 space-y-3">
              <p className="font-medium">Mobile wallet</p>
              {method === "wallet" && (
                <>
                  <div>
                    <span className="label">Wallet</span>
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
                  </div>
                  <div>
                    <label className="label" htmlFor="msisdn">
                      Mobile number
                    </label>
                    <input
                      id="msisdn"
                      className="input"
                      inputMode="tel"
                      value={msisdn}
                      onChange={(e) => setMsisdn(e.target.value)}
                      placeholder="03001234567"
                    />
                  </div>
                </>
              )}
            </div>
          </label>

          <label className="card flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="method"
              className="mt-1"
              checked={method === "hosted"}
              onChange={() => setMethod("hosted")}
            />
            <div>
              <p className="font-medium">Pay on the gateway&apos;s page</p>
              <p className="text-sm text-slate-500">
                We&apos;ll take you to the operator&apos;s hosted checkout and bring
                you back.
              </p>
            </div>
          </label>

          <button
            type="button"
            className="btn-primary"
            disabled={
              busy ||
              (method === "wallet" && msisdn.trim().length < 10) ||
              (method === "saved" && !savedId)
            }
            onClick={start}
          >
            {busy ? "Working…" : "Pay now"}
          </button>
        </div>
      )}
    </div>
  );
}
