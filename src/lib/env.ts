/**
 * Environment access. Split deliberately: `serverEnv` touches secrets and must
 * never be imported from a Client Component. Importing it in the browser
 * bundle throws at module load rather than silently shipping a merchant key.
 */

function demand(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/** Server-side only: `process.env` is a real object here, so a dynamic key works. */
function required(name: string): string {
  return demand(name, process.env[name]);
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/**
 * Public values, readable in the browser.
 *
 * Each one MUST be written as a literal `process.env.NEXT_PUBLIC_…` expression.
 * Next.js inlines these into the client bundle by static analysis at build
 * time; a computed lookup like `process.env[name]` is invisible to that pass, so
 * in the browser it resolves against an empty object and every read comes back
 * undefined. Do not refactor these back through a helper that takes the name.
 */
export const publicEnv = {
  supabaseUrl: () =>
    demand("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  /** Publishable key (`sb_publishable_…`). Safe in the browser; RLS gates it. */
  supabasePublishableKey: () =>
    demand(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  appUrl: () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
};

export type CollectionFlow = "otp" | "non_otp";

export const serverEnv = {
  /** Secret key (`sb_secret_…`). Bypasses RLS — server only, never logged. */
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),

  collectionBaseUrl: () => required("COLLECTION_BASE_URL").replace(/\/+$/, ""),
  collectionPrefix: () =>
    optional("COLLECTION_GATEWAY_PREFIX", "/mock/collection").replace(/\/+$/, ""),
  merchantId: () => required("COLLECTION_MERCHANT_ID"),
  merchantKey: () => required("COLLECTION_MERCHANT_KEY"),
  refundSigningSecret: () => required("COLLECTION_REFUND_SIGNING_SECRET"),

  /**
   * Which sequence this MID is provisioned on. Calling the other flow's
   * sequence answers 0015 Invalid-Flow, so this is not a preference — it must
   * match how the merchant was provisioned.
   */
  flow: (): CollectionFlow =>
    optional("COLLECTION_FLOW", "otp") === "non_otp" ? "non_otp" : "otp",

  region: () => optional("COLLECTION_REGION", "PK"),
  mode: () => optional("COLLECTION_MODE", "payin"),
  /**
   * Keep this at 3.0. On direct-payment and delink the version header doubles
   * as the QA fixture selector — `3.009` returns a canned 0009 instead of
   * touching the real token store.
   */
  version: () => optional("COLLECTION_VERSION", "3.0"),

  postbackSecret: () => required("COLLECTION_POSTBACK_SECRET"),
  cronSecret: () => required("CRON_SECRET"),
};
