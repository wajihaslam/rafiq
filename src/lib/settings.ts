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

import {
  serverEnv,
  type CollectionFlow,
  type TokenizationSequence,
} from "@/lib/env";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export interface GatewaySettingsRow {
  merchant_id_otp: string | null;
  merchant_id_non_otp: string | null;
  merchant_id_tokenization: string | null;
  /** Which of the two *payment* merchants above is live. */
  flow: CollectionFlow | null;
  /** How a wallet link runs. Independent of `flow`. */
  tokenization_sequence: TokenizationSequence | null;
  base_url: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** What the guide documents, and so what we assume when nobody has said. */
export const DEFAULT_TOKENIZATION_SEQUENCE: TokenizationSequence = "initiate_verify";

const SELECT_COLUMNS =
  "merchant_id_otp, merchant_id_non_otp, merchant_id_tokenization, flow, tokenization_sequence, base_url, updated_at, updated_by";

/**
 * The three merchant slots. `otp` and `non_otp` are the two payment merchants,
 * one of which `flow` selects; `tokenization` runs alongside whichever of them
 * is live and is never selected — it is chosen by what the call does.
 */
export type MerchantSlot = CollectionFlow | "tokenization";
export type MerchantIds = Record<MerchantSlot, string | null>;

/**
 * What a call needs a merchant *for*, which is what decides which of the three
 * is used:
 *
 *  - `payment`      — a customer paying now. Uses the active flow's merchant.
 *  - `tokenization` — minting, charging or retiring a stored token. Always the
 *    tokenization merchant, whatever the payment flow is set to.
 */
export type MerchantRole = "payment" | "tokenization";

export type ConfigField =
  | "merchantId"
  | "tokenizationMerchantId"
  | "flow"
  | "baseUrl";
// `tokenizationSequence` is deliberately not a ConfigField: it always resolves
// to something, so it can never be a configuration *gap* that blocks a call.
export type ConfigSource = "settings" | "env" | "unset";

/** What is configured right now, gaps included. Safe to render. */
export interface GatewayConfigState {
  /**
   * The merchant belonging to the active flow — the one a payment is made
   * under. Null when no flow is selected, or when the selected flow has no
   * merchant: an OTP merchant is of no use while Non-OTP is live.
   */
  merchantId: string | null;
  /** The merchant every token call is made under, whatever the flow is. */
  tokenizationMerchantId: string | null;
  flow: CollectionFlow | null;
  /** Never null: falls back to the environment, then to the documented default. */
  tokenizationSequence: TokenizationSequence;
  baseUrl: string | null;
  /** All three slots, for the settings screen. Not what a call uses. */
  merchants: MerchantIds;
  source: Record<ConfigField, ConfigSource>;
}

/**
 * A configuration complete enough for one particular kind of call. Which
 * fields had to be present depends on the role asked for, so this is only ever
 * obtained through `getGatewayConfig(role)`.
 */
export interface GatewayConfig {
  /** The merchant to send, already chosen for the requested role. */
  merchantId: string;
  baseUrl: string;
  /**
   * Null is reachable on a tokenization call: minting a token does not depend
   * on which payment flow is live, so it must not be blocked by an unset one.
   */
  flow: CollectionFlow | null;
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
  merchantId: "Merchant ID for the selected flow",
  tokenizationMerchantId: "Tokenization Merchant ID",
  flow: "Flow (OTP or Non-OTP)",
  baseUrl: "Base URL for the Payment API",
};

/** What each role insists on. Anything else missing is not this call's problem. */
const REQUIRED_FIELDS: Record<MerchantRole, ConfigField[]> = {
  payment: ["baseUrl", "flow", "merchantId"],
  // Deliberately not `flow`: a token is minted, charged and retired under the
  // tokenization merchant whatever the payment flow is, so an unset flow must
  // not block wallet linking or a subscription renewal.
  tokenization: ["baseUrl", "tokenizationMerchantId"],
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

/**
 * The base URL is used verbatim by the client — endpoint paths are appended to
 * it starting at `/v2`, `/v3` or the hosted route — so it must carry the
 * gateway prefix itself, e.g. `http://3.127.43.66:8001/mock/collection`.
 *
 * Trailing slashes are stripped so `endpoint()` never doubles them, and an
 * accidentally repeated path is collapsed: pasting the prefix twice is an easy
 * mistake to make and produces 404s that look like a dead gateway.
 */
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
  parsed.pathname = collapseRepeatedPath(parsed.pathname);
  return parsed.toString().replace(/\/+$/, "");
}

/**
 * `/mock/collection/mock/collection` → `/mock/collection`. Only an exact
 * doubling of the whole path is collapsed; a path that merely repeats one
 * segment (`/api/v2/api`) is left alone, because that may well be real.
 */
function collapseRepeatedPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "");
  if (path.length % 2 === 0) {
    const half = path.slice(0, path.length / 2);
    if (half.length > 1 && half === path.slice(path.length / 2)) return half;
  }
  return path;
}

export function assertSettingsMerchantId(value: string, field = "merchantId"): string {
  const trimmed = value.trim();
  if (!MERCHANT_ID.test(trimmed)) {
    throw new SettingsError(field, "Merchant ID must be exactly 7 digits.");
  }
  return trimmed;
}

export function assertSettingsFlow(value: string): CollectionFlow {
  if (value !== "otp" && value !== "non_otp") {
    throw new SettingsError("flow", "Flow must be either OTP or Non-OTP.");
  }
  return value;
}

export function assertTokenizationSequence(value: string): TokenizationSequence {
  if (value !== "initiate_verify" && value !== "verify_only") {
    throw new SettingsError(
      "tokenizationSequence",
      "Tokenization sequence must be either initiate + verify, or verify only.",
    );
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
      .select(SELECT_COLUMNS)
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
 * The configuration a gateway call is made with, for the role that call plays.
 * Throws `ConfigurationError` if something that role needs is missing, rather
 * than sending a request certain to come back 0003 Invalid-Merchant — or worse,
 * one aimed at the wrong host.
 *
 * Only the fields that role actually uses are demanded. An unconfigured
 * tokenization merchant must not stop a plain card-free payment, and an unset
 * payment flow must not stop a subscription renewal.
 */
export async function getGatewayConfig(
  role: MerchantRole = "payment",
): Promise<GatewayConfig> {
  const state = await getGatewayConfigState();
  const missing = REQUIRED_FIELDS[role].filter((field) => state[field] === null);
  if (missing.length > 0) throw new ConfigurationError(missing);

  return {
    merchantId: (role === "tokenization"
      ? state.tokenizationMerchantId
      : state.merchantId) as string,
    baseUrl: state.baseUrl as string,
    flow: state.flow,
  };
}

/**
 * The live payment flow, for the one caller that has to branch on it — checkout
 * choosing between the initiate→verify pair and verify alone. Demands the whole
 * payment configuration, because branching on a flow whose merchant is missing
 * only defers the failure by one step.
 */
export async function getActiveFlow(): Promise<CollectionFlow> {
  return (await getGatewayConfig("payment")).flow as CollectionFlow;
}

/**
 * How a wallet link runs. Separate from `getActiveFlow` on purpose: tokenization
 * does not follow the payment flow, and reading one for the other is exactly the
 * mistake that produced 0015 on every link attempt.
 */
export async function getTokenizationSequence(): Promise<TokenizationSequence> {
  return (await getGatewayConfigState()).tokenizationSequence;
}

/** Just the host, for building a URL. Never a reason to demand a merchant. */
export async function getBaseUrl(): Promise<string> {
  const { baseUrl } = await getGatewayConfigState();
  if (baseUrl === null) throw new ConfigurationError(["baseUrl"]);
  return baseUrl;
}

/**
 * Row-then-env, per column. The merchant is resolved *after* the flow, because
 * which of the two stored merchants counts is exactly what the flow selects —
 * switching the flow switches the merchant with it, in one step, which is the
 * point of keeping both.
 */
function resolve(row: GatewaySettingsRow | null): GatewayConfigState {
  const flow = row?.flow ?? serverEnv.flow() ?? null;
  const baseUrl = row?.base_url ?? serverEnv.collectionBaseUrl() ?? null;

  const stored: MerchantIds = {
    otp: row?.merchant_id_otp ?? null,
    non_otp: row?.merchant_id_non_otp ?? null,
    tokenization: row?.merchant_id_tokenization ?? null,
  };
  const merchants: MerchantIds = {
    otp: stored.otp ?? serverEnv.merchantIdFor("otp") ?? null,
    non_otp: stored.non_otp ?? serverEnv.merchantIdFor("non_otp") ?? null,
    tokenization: stored.tokenization ?? serverEnv.merchantIdFor("tokenization") ?? null,
  };

  const merchantId = flow ? merchants[flow] : null;

  return {
    merchantId,
    tokenizationMerchantId: merchants.tokenization,
    flow,
    // Row, then env, then the guide's documented behaviour. Unlike `flow` this
    // one has a defensible default, so it never reads as a gap.
    tokenizationSequence:
      row?.tokenization_sequence ??
      serverEnv.tokenizationSequence() ??
      DEFAULT_TOKENIZATION_SEQUENCE,
    baseUrl,
    merchants,
    source: {
      // Reported for the merchant actually in use, so the page answers "where
      // did this value come from" about the value being used.
      merchantId: flow && stored[flow] ? "settings" : merchantId ? "env" : "unset",
      tokenizationMerchantId: stored.tokenization
        ? "settings"
        : merchants.tokenization
          ? "env"
          : "unset",
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
  merchantIdOtp: string | null;
  merchantIdNonOtp: string | null;
  merchantIdTokenization: string | null;
  flow: string | null;
  tokenizationSequence: string | null;
  baseUrl: string | null;
  updatedBy: string;
}): Promise<GatewayConfigState> {
  const patch = {
    merchant_id_otp:
      input.merchantIdOtp === null
        ? null
        : assertSettingsMerchantId(input.merchantIdOtp, "merchantIdOtp"),
    merchant_id_non_otp:
      input.merchantIdNonOtp === null
        ? null
        : assertSettingsMerchantId(input.merchantIdNonOtp, "merchantIdNonOtp"),
    merchant_id_tokenization:
      input.merchantIdTokenization === null
        ? null
        : assertSettingsMerchantId(
            input.merchantIdTokenization,
            "merchantIdTokenization",
          ),
    flow: input.flow === null ? null : assertSettingsFlow(input.flow),
    tokenization_sequence:
      input.tokenizationSequence === null
        ? null
        : assertTokenizationSequence(input.tokenizationSequence),
    base_url: input.baseUrl === null ? null : normaliseBaseUrl(input.baseUrl),
    updated_by: input.updatedBy,
  };

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("gateway_settings")
    .upsert({ id: true, ...patch }, { onConflict: "id" })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw new Error(`Could not save gateway settings: ${error.message}`);

  // Resolved from the row we just wrote, not through readGatewaySettings():
  // that one is request-memoised and would still answer with the old values.
  return resolve(data as GatewaySettingsRow);
}
