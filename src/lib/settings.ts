/**
 * Runtime gateway configuration.
 *
 * Three values — merchant id, flow and the Payment API base URL — are editable
 * at runtime from /settings instead of only through the environment. Everything
 * else (merchant key, secrets, headers) stays in `serverEnv`.
 *
 * Resolution is row-then-env, per column: a null in `gateway_settings` means
 * "use the environment", so an untouched install behaves exactly as it did when
 * these were env-only. That also means the env vars remain required — the row
 * overrides them, it does not replace them.
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

export interface GatewayConfig {
  merchantId: string;
  flow: CollectionFlow;
  baseUrl: string;
  /** Where each value came from, so the settings page can say so. */
  source: Record<"merchantId" | "flow" | "baseUrl", "settings" | "env">;
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

/** The effective configuration every gateway call is made with. */
export async function getGatewayConfig(): Promise<GatewayConfig> {
  return resolve(await readGatewaySettings());
}

function resolve(row: GatewaySettingsRow | null): GatewayConfig {
  return {
    merchantId: row?.merchant_id ?? serverEnv.merchantId(),
    flow: row?.flow ?? serverEnv.flow(),
    baseUrl: row?.base_url ?? serverEnv.collectionBaseUrl(),
    source: {
      merchantId: row?.merchant_id ? "settings" : "env",
      flow: row?.flow ? "settings" : "env",
      baseUrl: row?.base_url ? "settings" : "env",
    },
  };
}

/**
 * Writes the singleton. Passing `null` for a field clears the override and
 * hands that value back to the environment.
 */
export async function saveGatewaySettings(input: {
  merchantId: string | null;
  flow: string | null;
  baseUrl: string | null;
  updatedBy: string;
}): Promise<GatewayConfig> {
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
