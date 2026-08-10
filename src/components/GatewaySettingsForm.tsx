"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface GatewaySettingsFormProps {
  /** Effective values — what the next gateway call will use. */
  effective: { merchantId: string; flow: "otp" | "non_otp"; baseUrl: string };
  /** The stored overrides. A null field is currently taken from the env. */
  stored: { merchantId: string | null; flow: string | null; baseUrl: string | null };
}

/**
 * Leaving a field empty is meaningful: it clears the override and hands that
 * value back to the environment, which is why each input shows the effective
 * value as its placeholder rather than pre-filling it.
 */
export function GatewaySettingsForm({ effective, stored }: GatewaySettingsFormProps) {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState(stored.merchantId ?? "");
  const [flow, setFlow] = useState(stored.flow ?? "");
  const [baseUrl, setBaseUrl] = useState(stored.baseUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(
    null,
  );

  async function save() {
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/settings/gateway", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId, flow, baseUrl }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!payload.ok) {
      setNotice({ tone: "error", text: payload.message });
      return;
    }

    setNotice({
      tone: "info",
      text: `Saved. Calls now go to ${payload.data.baseUrl} as ${payload.data.merchantId} on the ${payload.data.flow === "otp" ? "OTP" : "Non-OTP"} flow.`,
    });
    router.refresh();
  }

  return (
    <section className="card space-y-4">
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
        <label className="label" htmlFor="cfg-merchant-id">
          Merchant ID
        </label>
        <input
          id="cfg-merchant-id"
          className="input"
          inputMode="numeric"
          value={merchantId}
          onChange={(e) => setMerchantId(e.target.value.replace(/\D/g, "").slice(0, 7))}
          placeholder={effective.merchantId}
        />
        <p className="mt-1 text-xs text-slate-500">
          Seven digits, as provisioned by the gateway. A wrong or unseeded MID
          answers 0003 on every call.
        </p>
      </div>

      <div>
        <span className="label">Flow</span>
        <div className="flex gap-2">
          {(
            [
              ["otp", "OTP"],
              ["non_otp", "Non-OTP"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              className={flow === value ? "btn-primary" : "btn-ghost"}
              onClick={() => setFlow(flow === value ? "" : value)}
            >
              {text}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          This is not a preference — it must match how the MID was provisioned.
          Calling the other flow&apos;s sequence answers 0015 Invalid-Flow. Wallet
          linking always uses an OTP regardless.
          {flow === "" && ` Currently from the environment: ${effective.flow}.`}
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
          placeholder={effective.baseUrl}
        />
        <p className="mt-1 text-xs text-slate-500">
          Origin only, without the gateway prefix — the client appends that and
          the endpoint path itself.
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
