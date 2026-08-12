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

/**
 * How linking a wallet runs. Guide §2 says tokenization is exempt from the flow
 * split and always runs `initiate` → `verify`; some gateway builds refuse
 * `initiate` outright when `transactionType` is `8` and mint the token from
 * `verify` alone. Which one you are talking to is a fact about the deployment.
 */
export type TokenizationSequence = "initiate_verify" | "verify_only";

export const serverEnv = {
  /** Secret key (`sb_secret_…`). Bypasses RLS — server only, never logged. */
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),

  /**
   * The three values below are *optional* overrides for bootstrapping only.
   * `gateway_settings` in the database is the real home for them, so an unset
   * variable is a normal state and must not throw — the caller reports a
   * missing value against the settings page instead. See `@/lib/settings`.
   */
  /**
   * The full base URL **including** the gateway prefix, e.g.
   * `http://3.127.43.66:8001/mock/collection`. Endpoint paths are appended to
   * it exactly as written, starting at `/v2`, `/v3` or the hosted route.
   */
  collectionBaseUrl: (): string | undefined =>
    process.env.COLLECTION_BASE_URL?.trim().replace(/\/+$/, "") || undefined,
  /**
   * The merchant provisioned for a given job. A MID belongs to exactly one, so
   * they are separate variables.
   *
   * `COLLECTION_MERCHANT_ID` remains as a legacy fallback for the two payment
   * slots — the behaviour it always had when there was only one of it. It is
   * deliberately *not* a fallback for tokenization: a token minted under one
   * merchant cannot be charged under another, so inheriting the payment MID
   * there would mint tokens that later answer 0003.
   */
  merchantIdFor: (slot: "otp" | "non_otp" | "tokenization"): string | undefined => {
    if (slot === "tokenization") {
      return process.env.COLLECTION_MERCHANT_ID_TOKENIZATION?.trim() || undefined;
    }
    const perFlow =
      slot === "otp"
        ? process.env.COLLECTION_MERCHANT_ID_OTP
        : process.env.COLLECTION_MERCHANT_ID_NON_OTP;
    return perFlow?.trim() || process.env.COLLECTION_MERCHANT_ID?.trim() || undefined;
  },
  /**
   * Which sequence the MID is provisioned on. Calling the other flow's sequence
   * answers 0015 Invalid-Flow, so this is not a preference — it must match how
   * the merchant was provisioned. There is deliberately **no default**: silently
   * guessing "otp" would send half of all merchants down the wrong sequence.
   */
  flow: (): CollectionFlow | undefined => {
    const value = process.env.COLLECTION_FLOW?.trim();
    if (value === "otp" || value === "non_otp") return value;
    return undefined;
  },

  /**
   * Unlike `flow`, this one *does* default — to the documented behaviour. An
   * unset flow is a coin toss between two live merchants; this is a fallback to
   * what the guide says the gateway does, which is the right thing to assume
   * when nobody has said otherwise.
   */
  tokenizationSequence: (): TokenizationSequence | undefined => {
    const value = process.env.COLLECTION_TOKENIZATION_SEQUENCE?.trim();
    if (value === "initiate_verify" || value === "verify_only") return value;
    return undefined;
  },

  merchantKey: () => required("COLLECTION_MERCHANT_KEY"),
  refundSigningSecret: () => required("COLLECTION_REFUND_SIGNING_SECRET"),

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
