import { redirect } from "next/navigation";

import { GatewaySettingsForm } from "@/components/GatewaySettingsForm";
import { getGatewayConfig, readGatewaySettings } from "@/lib/settings";
import { getCurrentUser, isAdmin } from "@/lib/supabase/server";

/** The configuration is read per request; never serve it from the route cache. */
export const dynamic = "force-dynamic";

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

  const [effective, row] = await Promise.all([
    getGatewayConfig(),
    readGatewaySettings(),
  ]);

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuration</h1>
        <p className="mt-1 text-sm text-slate-500">
          How this app talks to the Collection gateway. Changes apply to the next
          call — no redeploy — so they also change where live payments go.
        </p>
      </div>

      <GatewaySettingsForm
        effective={{
          merchantId: effective.merchantId,
          flow: effective.flow,
          baseUrl: effective.baseUrl,
        }}
        stored={{
          merchantId: row?.merchant_id ?? null,
          flow: row?.flow ?? null,
          baseUrl: row?.base_url ?? null,
        }}
      />

      <dl className="card grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-slate-500">In use — Merchant ID</dt>
        <dd>
          {effective.merchantId}{" "}
          <span className="text-xs text-slate-500">({effective.source.merchantId})</span>
        </dd>
        <dt className="text-slate-500">In use — Flow</dt>
        <dd>
          {effective.flow === "otp" ? "OTP" : "Non-OTP"}{" "}
          <span className="text-xs text-slate-500">({effective.source.flow})</span>
        </dd>
        <dt className="text-slate-500">In use — Base URL</dt>
        <dd className="break-all">
          {effective.baseUrl}{" "}
          <span className="text-xs text-slate-500">({effective.source.baseUrl})</span>
        </dd>
        {row?.updated_at && (
          <>
            <dt className="text-slate-500">Last changed</dt>
            <dd>{new Date(row.updated_at).toLocaleString()}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
