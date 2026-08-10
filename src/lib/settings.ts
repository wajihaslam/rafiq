/**
 * Runtime gateway configuration.
 *
 * Three values — merchant id, flow and the Payment API base URL — are editable
 * at runtime from /settings instead of only through the environment. Everything
 * else (merchant key, secrets, headers) stays in `serverEnv`.
 *
 * The database is the home for these: `gateway_settings` alone is enough to run
 * the app. Resolution is row-then-env per column, but the environment is only a
 * bootstrap fallback now — an unset variable is a normal state, not an error.
 *
 * A value that is missing from *both* is reported as a configuration gap
 * pointing at /settings, and only at the moment a gateway call actually needs
 * it. Nothing throws at import or on a page render, so the settings page can
 * always be reached to fix the gap — which is the whole point.
 */

import "server-only";
import { cache } from "react";

import { serverEnv, type CollectionFlow } from "@/lib/env";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export interface GatewaySettingsRow {
  merchant_id: string | null;
  flow: CollectionFlow | null;
  base_url: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type ConfigField = "merchantId" | "flow" | "baseUrl";
export type ConfigSource = "settings" | "env" | "unset";

/** What is configured right now, gaps included. Safe to render. */
export interface GatewayConfigState {
  merchantId: string | null;
  flow: CollectionFlow | null;
  baseUrl: string | null;
  source: Record<ConfigField, ConfigSource>;
}

/** A complete configuration. Only obtainable when nothing is missing. */
export interface GatewayConfig {
  merchantId: string;
  flow: CollectionFlow;
  baseUrl: string;
  source: Record<ConfigField, ConfigSource>;
}

const MERCHANT_ID = /^\d{7}$/;

export class SettingsError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "SettingsError";
  }
}

const FIELD_LABELS: Record<ConfigField, string> = {
  merchantId: "Merchant ID",
  flow: "Flow (OTP or Non-OTP)",
  baseUrl: "Base URL for the Payment API",
};

/**
 * Raised when a gateway call cannot proceed because the app has not been
 * configured. Distinct from a gateway *failure*: no request was sent, so no
 * money can have moved — which is why callers may safely treat it as a hard
 * error rather than an indeterminate outcome.
 */
export class ConfigurationError extends Error {
  constructor(readonly missing: ConfigField[]) {
    const names = missing.map((f) => FIELD_LABELS[f]).join(", ");
    super(
      `The Collection gateway is not configured yet — missing: ${names}. An administrator can set this on the Configuration page.`,
    );
    this.name = "ConfigurationError";
  }
}

/** Trailing slashes are stripped here so `endpoint()` never doubles them. */
export function normaliseBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SettingsError("baseUrl", "Base URL must be a full http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SettingsError("baseUrl", "Base URL must be a full http(s) URL.");
  }
  return trimmed;
}

export function assertSettingsMerchantId(value: string): string {
  const trimmed = value.trim();
  if (!MERCHANT_ID.test(trimmed)) {
    throw new SettingsError("merchantId", "Merchant ID must be exactly 7 digits.");
  }
  return trimmed;
}

export function assertSettingsFlow(value: string): CollectionFlow {
  if (value !== "otp" && value !== "non_otp") {
    throw new SettingsError("flow", "Flow must be either OTP or Non-OTP.");
  }
  return value;
}

/**
 * Reads the singleton row. Memoised per request: a single checkout touches the
 * config several times and one round trip is enough.
 *
 * A read failure is not fatal — the table may not exist yet on an install that
 * has not run migration 0002 — so it degrades to the environment.
 */
export const readGatewaySettings = cache(
  async (): Promise<GatewaySettingsRow | null> => {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from("gateway_settings")
      .select("merchant_id, flow, base_url, updated_at, updated_by")
      .eq("id", true)
      .maybeSingle();

    if (error) {
      console.warn("[settings] falling back to env:", error.message);
      return null;
    }
    return (data as GatewaySettingsRow | null) ?? null;
  },
);

/**
 * What is configured right now, including what isn't. Never throws, so the
 * settings page and its GET route can always render — including on a fresh
 * install where nothing has been set.
 */
export async function getGatewayConfigState(): Promise<GatewayConfigState> {
  return resolve(await readGatewaySettings());
}

/**
 * The configuration a gateway call is made with. Throws `ConfigurationError`
 * if anything is missing, rather than sending a request that is certain to come
 * back 0003 Invalid-Merchant — or worse, one aimed at the wrong host.
 */
export async function getGatewayConfig(): Promise<GatewayConfig> {
  const state = await getGatewayConfigState();
  const missing = (Object.keys(FIELD_LABELS) as ConfigField[]).filter(
    (field) => state[field] === null,
  );
  if (missing.length > 0) throw new ConfigurationError(missing);
  return state as GatewayConfig;
}

function resolve(row: GatewaySettingsRow | null): GatewayConfigState {
  const merchantId = row?.merchant_id ?? serverEnv.merchantId() ?? null;
  const flow = row?.flow ?? serverEnv.flow() ?? null;
  const baseUrl = row?.base_url ?? serverEnv.collectionBaseUrl() ?? null;

  return {
    merchantId,
    flow,
    baseUrl,
    source: {
      merchantId: row?.merchant_id ? "settings" : merchantId ? "env" : "unset",
      flow: row?.flow ? "settings" : flow ? "env" : "unset",
      baseUrl: row?.base_url ? "settings" : baseUrl ? "env" : "unset",
    },
  };
}

/**
 * Writes the singleton. Passing `null` for a field clears the override and
 * hands that value back to the environment — or leaves it unset, if the
 * environment does not define it either. Saving a partial configuration is
 * allowed on purpose: it is the natural intermediate state while filling the
 * form in, and only a gateway call insists on completeness.
 */
export async function saveGatewaySettings(input: {
  merchantId: string | null;
  flow: string | null;
  baseUrl: string | null;
  updatedBy: string;
}): Promise<GatewayConfigState> {
  const patch = {
    merchant_id:
      input.merchantId === null ? null : assertSettingsMerchantId(input.merchantId),
    flow: input.flow === null ? null : assertSettingsFlow(input.flow),
    base_url: input.baseUrl === null ? null : normaliseBaseUrl(input.baseUrl),
    updated_by: input.updatedBy,
  };

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("gateway_settings")
    .upsert({ id: true, ...patch }, { onConflict: "id" })
    .select("merchant_id, flow, base_url, updated_at, updated_by")
    .single();

  if (error) throw new Error(`Could not save gateway settings: ${error.message}`);

  // Resolved from the row we just wrote, not through readGatewaySettings():
  // that one is request-memoised and would still answer with the old values.
  return resolve(data as GatewaySettingsRow);
}
