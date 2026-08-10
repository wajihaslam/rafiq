/**
 * Environment access. Split deliberately: `serverEnv` touches secrets and must
 * never be imported from a Client Component. Importing it in the browser
 * bundle throws at module load rather than silently shipping a merchant key.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const publicEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  /** Publishable key (`sb_publishable_…`). Safe in the browser; RLS gates it. */
  supabasePublishableKey: () => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  appUrl: () => optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
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
