import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { GatewaySettingsForm } from "@/components/GatewaySettingsForm";
import { WebhookCatcherCard } from "@/components/WebhookCatcherCard";
import { publicEnv } from "@/lib/env";
import { getGatewayConfigState, readGatewaySettings } from "@/lib/settings";
import { getCurrentUser, isAdmin } from "@/lib/supabase/server";

/**
 * The origin this page was actually served from, so the webhook URL is right
 * on localhost, on a tunnel and on a preview deployment alike.
 * `NEXT_PUBLIC_APP_URL` is only the fallback, for the case where the proxy
 * headers are missing.
 */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return publicEnv.appUrl().replace(/\/+$/, "");
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The configuration is read per request; never serve it from the route cache. */
export const dynamic = "force-dynamic";

function NotSet() {
  return <span className="text-amber-700 dark:text-amber-400">Not set</span>;
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");
  if (!(await isAdmin(user.id))) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Configuration</h1>
        <p className="mt-2 text-sm text-slate-500">
          This page is limited to administrators. Ask one to set{" "}
          <code>profiles.is_admin</code> for your account.
        </p>
      </div>
    );
  }

  const [effective, row, origin] = await Promise.all([
    getGatewayConfigState(),
    readGatewaySettings(),
    requestOrigin(),
  ]);

  /**
   * Reported separately because the two halves fail independently: a missing
   * tokenization merchant blocks saved wallets and subscription renewals while
   * ordinary payments keep working, and vice versa. One combined "not
   * configured" banner would misreport both cases.
   */
  const paymentsMissing = (["merchantId", "flow", "baseUrl"] as const).filter(
    (field) => effective[field] === null,
  );
  const walletsMissing = (["tokenizationMerchantId", "baseUrl"] as const).filter(
    (field) => effective[field] === null,
  );

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuration</h1>
        <p className="mt-1 text-sm text-slate-500">
          How this app talks to the Collection gateway. Changes apply to the next
          call — no redeploy — so they also change where live payments go.
        </p>
      </div>

      {(paymentsMissing.length > 0 || walletsMissing.length > 0) && (
        <div className="space-y-2">
          {paymentsMissing.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              Payments are switched off until this is complete —{" "}
              {paymentsMissing.length === 3
                ? "nothing is configured yet"
                : `${paymentsMissing.length} value${paymentsMissing.length > 1 ? "s" : ""} still missing`}
              . Checkout will refuse rather than send a request that cannot
              succeed.
            </p>
          )}
          {walletsMissing.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              Saved wallets are switched off — wallet linking, one-click checkout
              and subscription renewals need the tokenization merchant.
            </p>
          )}
        </div>
      )}

      <GatewaySettingsForm
        effective={{
          merchantId: effective.merchantId,
          flow: effective.flow,
          baseUrl: effective.baseUrl,
          merchants: effective.merchants,
        }}
        stored={{
          merchantIdOtp: row?.merchant_id_otp ?? null,
          merchantIdNonOtp: row?.merchant_id_non_otp ?? null,
          merchantIdTokenization: row?.merchant_id_tokenization ?? null,
          flow: row?.flow ?? null,
          baseUrl: row?.base_url ?? null,
        }}
      />

      <dl className="card grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-slate-500">Payments use</dt>
        <dd>
          {effective.merchantId ?? <NotSet />}{" "}
          <span className="text-xs text-slate-500">({effective.source.merchantId})</span>
        </dd>
        <dt className="text-slate-500">Saved wallets use</dt>
        <dd>
          {effective.tokenizationMerchantId ?? <NotSet />}{" "}
          <span className="text-xs text-slate-500">
            ({effective.source.tokenizationMerchantId})
          </span>
        </dd>
        {/* The payment merchant that is not live is still worth showing: its
            absence is what a flow switch would run into. */}
        <dt className="text-slate-500">Standing by</dt>
        <dd>
          {effective.flow === null ? (
            <span className="text-slate-500">— no flow selected</span>
          ) : (
            <>
              {effective.merchants[effective.flow === "otp" ? "non_otp" : "otp"] ?? (
                <NotSet />
              )}{" "}
              <span className="text-xs text-slate-500">
                ({effective.flow === "otp" ? "Non-OTP" : "OTP"})
              </span>
            </>
          )}
        </dd>
        <dt className="text-slate-500">In use — Flow</dt>
        <dd>
          {effective.flow === null ? (
            <NotSet />
          ) : effective.flow === "otp" ? (
            "OTP"
          ) : (
            "Non-OTP"
          )}{" "}
          <span className="text-xs text-slate-500">({effective.source.flow})</span>
        </dd>
        <dt className="text-slate-500">In use — Base URL</dt>
        <dd className="break-all">
          {effective.baseUrl ?? <NotSet />}{" "}
          <span className="text-xs text-slate-500">({effective.source.baseUrl})</span>
        </dd>
        {/* A real endpoint, spelled out. The base URL is used verbatim and the
            path is appended, so seeing one worked example is the quickest way
            to catch a doubled or missing gateway prefix. */}
        <dt className="text-slate-500">Example endpoint</dt>
        <dd className="break-all font-mono text-xs">
          {effective.baseUrl ? (
            `${effective.baseUrl}/v2/wallets/transaction/verify`
          ) : (
            <NotSet />
          )}
        </dd>
        {row?.updated_at && (
          <>
            <dt className="text-slate-500">Last changed</dt>
            <dd>{new Date(row.updated_at).toLocaleString()}</dd>
          </>
        )}
      </dl>

      <WebhookCatcherCard url={`${origin}/api/webhooks/catch`} />

      <section className="card">
        <h2 className="font-medium">API call log</h2>
        <p className="mt-1 text-sm text-slate-500">
          Every gateway request and response, and every caught webhook, with
          headers and bodies.{" "}
          <Link href="/logs" className="underline">
            Open the log
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
