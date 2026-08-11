/**
 * Which environment variables the *running deployment* can actually see.
 *
 * Reports presence only — never a value, never a prefix — so it is safe to hit
 * from anywhere while an environment is being wired up. That is enough to tell
 * the three failure modes apart: a variable that was never set, one set on the
 * wrong Vercel environment, and one set after the deployment was built.
 *
 * Delete this route once the environment is stable; it exists to answer one
 * question and has no place in a finished app.
 */

import { NextResponse } from "next/server";

/** Must not be cached: the whole point is what this instance sees right now. */
export const dynamic = "force-dynamic";

const PUBLIC_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

const SERVER_VARS = [
  "SUPABASE_SECRET_KEY",
  "COLLECTION_MERCHANT_KEY",
  "COLLECTION_REFUND_SIGNING_SECRET",
  "COLLECTION_POSTBACK_SECRET",
  "CRON_SECRET",
  "COLLECTION_MERCHANT_ID_OTP",
  "COLLECTION_MERCHANT_ID_NON_OTP",
  "COLLECTION_MERCHANT_ID_TOKENIZATION",
  "COLLECTION_BASE_URL",
  "COLLECTION_FLOW",
] as const;

/**
 * Read as literal expressions, not `process.env[name]`. Next inlines
 * NEXT_PUBLIC_* by static analysis, and a computed lookup is invisible to that
 * pass — the same trap documented in `@/lib/env`. Checking them the dynamic way
 * would report "missing" for variables that are in fact inlined correctly.
 */
const PUBLIC_READS: Record<(typeof PUBLIC_VARS)[number], string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

export async function GET() {
  const present = (value: string | undefined) =>
    typeof value === "string" && value.trim().length > 0;

  return NextResponse.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    // Which commit is actually running, so "I redeployed" can be verified.
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    public: Object.fromEntries(
      PUBLIC_VARS.map((name) => [name, present(PUBLIC_READS[name])]),
    ),
    server: Object.fromEntries(
      SERVER_VARS.map((name) => [name, present(process.env[name])]),
    ),
  });
}
