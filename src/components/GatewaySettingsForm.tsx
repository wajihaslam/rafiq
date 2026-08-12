"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Flow = "otp" | "non_otp";
type Slot = Flow | "tokenization";
type TokenizationSequence = "initiate_verify" | "verify_only";

export interface GatewaySettingsFormProps {
  /**
   * Effective values — what the next gateway call will use. A null means the
   * value is set neither here nor in the environment, so payments are blocked
   * until it is filled in.
   */
  effective: {
    merchantId: string | null;
    flow: Flow | null;
    tokenizationSequence: TokenizationSequence;
    baseUrl: string | null;
    /** All three merchants, resolved. Shown as the placeholder on each input. */
    merchants: Record<Slot, string | null>;
  };
  /** The stored overrides. A null field falls back to the env, if set there. */
  stored: {
    merchantIdOtp: string | null;
    merchantIdNonOtp: string | null;
    merchantIdTokenization: string | null;
    flow: string | null;
    tokenizationSequence: string | null;
    baseUrl: string | null;
  };
}

const FLOWS: { value: Flow; label: string }[] = [
  { value: "otp", label: "OTP" },
  { value: "non_otp", label: "Non-OTP" },
];

const SEQUENCES: { value: TokenizationSequence; label: string; hint: string }[] = [
  {
    value: "initiate_verify",
    label: "Initiate + verify",
    hint: "Guide §2: initiate sends the OTP, verify redeems it and mints the token.",
  },
  {
    value: "verify_only",
    label: "Verify only",
    hint: "For gateways that answer 0015 to any initiate with transactionType 8. Verify mints the token on its own.",
  },
];

/**
 * Both merchants are kept side by side and the flow selects which one is live,
 * so switching between them is one click and cannot leave the pair mismatched.
 *
 * Leaving a field empty is meaningful: it clears the override and hands that
 * value back to the environment, which is why each input shows the effective
 * value as its placeholder rather than pre-filling it.
 */
export function GatewaySettingsForm({ effective, stored }: GatewaySettingsFormProps) {
  const router = useRouter();
  const [merchantIds, setMerchantIds] = useState<Record<Slot, string>>({
    otp: stored.merchantIdOtp ?? "",
    non_otp: stored.merchantIdNonOtp ?? "",
    tokenization: stored.merchantIdTokenization ?? "",
  });
  const [flow, setFlow] = useState(stored.flow ?? "");
  const [sequence, setSequence] = useState(stored.tokenizationSequence ?? "");
  const [baseUrl, setBaseUrl] = useState(stored.baseUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(
    null,
  );

  const setMerchantId = (target: Slot, value: string) =>
    setMerchantIds((current) => ({
      ...current,
      [target]: value.replace(/\D/g, "").slice(0, 7),
    }));

  async function save() {
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/settings/gateway", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantIdOtp: merchantIds.otp,
        merchantIdNonOtp: merchantIds.non_otp,
        merchantIdTokenization: merchantIds.tokenization,
        flow,
        tokenizationSequence: sequence,
        baseUrl,
      }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!payload.ok) {
      setNotice({ tone: "error", text: payload.message });
      return;
    }

    const saved = payload.data;
    setNotice({
      tone: "info",
      text: saved.flow
        ? `Saved. Calls now go to ${saved.baseUrl} as ${saved.merchantId} on the ${
            saved.flow === "otp" ? "OTP" : "Non-OTP"
          } flow.`
        : "Saved. No flow is selected, so payments stay blocked until you pick one.",
    });
    router.refresh();
  }

  return (
    <section className="card space-y-5">
      <h2 className="font-medium">Payment API</h2>

      {notice && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            notice.tone === "error"
              ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
              : "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200"
          }`}
        >
          {notice.text}
        </p>
      )}

      <div>
        <span className="label">Payment merchants</span>
        <p className="mb-3 text-xs text-slate-500">
          A MID is provisioned on one flow only. Keep both here and switch
          between them below — the merchant and the flow always move together.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {FLOWS.map(({ value, label }) => {
            const active = flow === value;
            return (
              <div
                key={value}
                className={`rounded-lg border p-3 ${
                  active
                    ? "border-brand-500 bg-brand-50/50 dark:bg-brand-500/5"
                    : "border-slate-200 dark:border-slate-800"
                }`}
              >
                <label
                  className="mb-1.5 flex items-center justify-between text-sm font-medium"
                  htmlFor={`cfg-mid-${value}`}
                >
                  {label} merchant
                  {active && (
                    <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-medium text-white">
                      In use
                    </span>
                  )}
                </label>
                <input
                  id={`cfg-mid-${value}`}
                  className="input"
                  inputMode="numeric"
                  value={merchantIds[value]}
                  onChange={(e) => setMerchantId(value, e.target.value)}
                  placeholder={effective.merchants[value] ?? "7 digits — not set"}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  {value === "otp"
                    ? "initiate → OTP → verify"
                    : "verify alone, no OTP"}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Seven digits, as provisioned by the gateway. A wrong or unseeded MID
          answers 0003 on every call.
        </p>
      </div>

      {/* Separated from the pair above because it is not part of the choice:
          it is used alongside whichever payment merchant is live. */}
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <label className="label" htmlFor="cfg-mid-tokenization">
          Tokenization merchant
        </label>
        <input
          id="cfg-mid-tokenization"
          className="input"
          inputMode="numeric"
          value={merchantIds.tokenization}
          onChange={(e) => setMerchantId("tokenization", e.target.value)}
          placeholder={effective.merchants.tokenization ?? "7 digits — not set"}
        />
        <p className="mt-1.5 text-xs text-slate-500">
          Always used for saved wallets — linking, direct charges, refunds of
          those charges, subscription renewals and delink — whichever flow is
          selected. A
          token belongs to the merchant that minted it, so charging it under a
          payment MID answers 0003.
        </p>
      </div>

      <div>
        <span className="label">Tokenization sequence</span>
        <p className="mb-2 text-xs text-slate-500">
          How linking an Easypaisa wallet runs. Independent of the flow below —
          it is a property of the gateway, not of the merchant. Leave it alone
          unless linking answers <code>0015 Invalid-Flow</code>; that is the
          symptom of a gateway that refuses <code>initiate</code> for
          <code> transactionType 8</code>.
        </p>
        <div className="flex flex-wrap gap-2">
          {SEQUENCES.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              className={sequence === option.value ? "btn-primary" : "btn-ghost"}
              onClick={() => setSequence(option.value)}
            >
              {option.label}
            </button>
          ))}
          {sequence && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setSequence("")}
              title="Clear the override and fall back to the environment, then to initiate + verify."
            >
              Clear
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          In use: <strong>{effective.tokenizationSequence === "verify_only"
            ? "verify only"
            : "initiate + verify"}</strong>
          {sequence ? "" : " (default — nothing stored)"}. JazzCash is unaffected:
          it tokenizes through its hosted page either way.
        </p>
      </div>

      <div>
        <span className="label">Active flow</span>
        <div className="flex gap-2">
          {FLOWS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={flow === value ? "btn-primary" : "btn-ghost"}
              onClick={() => setFlow(flow === value ? "" : value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Picks which merchant above every call is made under, and which sequence
          checkout runs. This is not a preference — each MID must be called on the
          flow it was provisioned for, or the gateway answers 0015 Invalid-Flow.
          Wallet linking always uses an OTP regardless.
          {flow !== "" && !merchantIds[flow as Flow] && !effective.merchants[flow as Flow] && (
            <span className="text-amber-700 dark:text-amber-400">
              {" "}
              There is no merchant for this flow yet, so payments stay blocked.
            </span>
          )}
          {flow === "" &&
            (effective.flow
              ? ` Currently from the environment: ${effective.flow}.`
              : " Not set anywhere — pick one, or payments stay blocked.")}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="cfg-base-url">
          Base URL for Payment API
        </label>
        <input
          id="cfg-base-url"
          className="input"
          inputMode="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={
            effective.baseUrl ?? "http://3.127.43.66:8001/mock/collection — required"
          }
        />
        <p className="mt-1 text-xs text-slate-500">
          Everything up to but not including the version segment — the gateway
          prefix belongs here. Endpoint paths are appended verbatim, so{" "}
          <code>http://3.127.43.66:8001/mock/collection</code> means a payment
          goes to{" "}
          <code>
            http://3.127.43.66:8001/mock/collection/v2/wallets/transaction/verify
          </code>
          .
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save configuration"}
        </button>
        <span className="text-xs text-slate-500">
          Empty field = use the environment value.
        </span>
      </div>
    </section>
  );
}
