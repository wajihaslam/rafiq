/**
 * The API call log.
 *
 * Records both halves of every HTTP conversation the app takes part in: calls
 * we make to the Collection gateway ('outbound') and calls made to us
 * ('inbound' — the webhook catcher). The viewer lives at /logs.
 *
 * Two rules shape everything here:
 *
 *  1. Logging never breaks the thing it is logging. Every write is wrapped and
 *     swallowed; a missing table, a dead database or a body that will not
 *     serialise costs a console warning and nothing else. A payment must not
 *     fail because we could not write a diagnostic row.
 *
 *  2. Secrets never land in the table. Merchant keys, postback secrets, bearer
 *     tokens and OTPs are redacted on the way in, not on the way out — a
 *     redaction applied at render time is one `select` away from leaking.
 */

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/server";

export type ApiLogDirection = "outbound" | "inbound";

export interface ApiLogRow {
  id: string;
  direction: ApiLogDirection;
  label: string;
  method: string;
  url: string;
  request_headers: Json | null;
  request_body: Json | null;
  response_headers: Json | null;
  response_body: Json | null;
  status_code: number | null;
  gateway_code: string | null;
  outcome: string | null;
  request_id: string | null;
  duration_ms: number | null;
  error: string | null;
  user_id: string | null;
  created_at: string;
}

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export interface ApiLogInput {
  direction: ApiLogDirection;
  label: string;
  method: string;
  url: string;
  requestHeaders?: Record<string, string> | Headers | null;
  requestBody?: unknown;
  responseHeaders?: Record<string, string> | Headers | null;
  responseBody?: unknown;
  statusCode?: number | null;
  gatewayCode?: string | null;
  outcome?: string | null;
  requestId?: string | null;
  durationMs?: number | null;
  error?: string | null;
  userId?: string | null;
}

/**
 * Anything whose key contains one of these (case-insensitively) is replaced
 * with a marker. Substring matching on purpose: it catches `merchantKey`,
 * `x-postback-secret` and `Authorization` alike without a list of every spelling.
 *
 * `merchantId` is deliberately absent — it is not a secret, and it is the first
 * thing you need when a call comes back 0003.
 */
const REDACTED_KEYS = [
  "key",
  "secret",
  "password",
  "authorization",
  "auth",
  "token",
  "signature",
  "otp",
  "cookie",
];

const REDACTED = "[redacted]";

/** Bodies are truncated at this length before storage. */
const MAX_RAW_LENGTH = 20_000;

function isRedacted(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_KEYS.some((needle) => lower.includes(needle));
}

/**
 * Deep-copies a value into something jsonb accepts, redacting as it goes.
 * Depth-limited because a cycle would otherwise hang the request — and a
 * gateway payload nested more than eight deep is not something we log anyway.
 */
function sanitise(value: unknown, depth = 0): Json {
  if (value === null || value === undefined) return null;
  if (depth > 8) return "[truncated]";

  if (typeof value === "string") {
    return value.length > MAX_RAW_LENGTH
      ? `${value.slice(0, MAX_RAW_LENGTH)}… [truncated]`
      : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitise(v, depth + 1));

  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isRedacted(key) ? REDACTED : sanitise(inner, depth + 1);
    }
    return out;
  }

  return String(value);
}

function headersToJson(input: Record<string, string> | Headers | null | undefined): Json {
  if (!input) return null;
  const entries =
    input instanceof Headers ? [...input.entries()] : Object.entries(input);
  const out: Record<string, Json> = {};
  for (const [key, value] of entries) {
    out[key] = isRedacted(key) ? REDACTED : value;
  }
  return out;
}

/**
 * Turns whatever the body was into jsonb. A non-JSON body (an HTML error page,
 * a form post) is wrapped as `{ raw }` rather than dropped: when a call goes
 * wrong, that page is usually the only thing that explains why.
 */
export function bodyToJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    try {
      return sanitise(JSON.parse(trimmed));
    } catch {
      return { raw: sanitise(trimmed) };
    }
  }
  try {
    return sanitise(value);
  } catch (error) {
    return { raw: `[unserialisable: ${String(error)}]` };
  }
}

/**
 * Writes one row. Awaited by callers rather than fired and forgotten: on a
 * serverless host the function can be frozen the moment the response is
 * returned, and a detached insert would simply never land.
 */
export async function logApiCall(input: ApiLogInput): Promise<void> {
  try {
    const { error } = await getSupabaseAdminClient()
      .from("api_logs")
      .insert({
        direction: input.direction,
        label: input.label,
        method: input.method.toUpperCase(),
        url: input.url,
        request_headers: headersToJson(input.requestHeaders) as never,
        request_body: bodyToJson(input.requestBody) as never,
        response_headers: headersToJson(input.responseHeaders) as never,
        response_body: bodyToJson(input.responseBody) as never,
        status_code: input.statusCode ?? null,
        gateway_code: input.gatewayCode || null,
        outcome: input.outcome ?? null,
        request_id: input.requestId ?? null,
        duration_ms: input.durationMs ?? null,
        error: input.error ?? null,
        user_id: input.userId ?? null,
      });

    if (error) console.warn("[api-logs] could not record call:", error.message);
  } catch (error) {
    // Includes the case where migration 0003 has not been run yet.
    console.warn("[api-logs] could not record call:", error);
  }
}

export interface ApiLogQuery {
  direction?: ApiLogDirection;
  label?: string;
  /** Matches the URL, the label or the gateway code. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ApiLogPage {
  rows: ApiLogRow[];
  total: number;
}

export async function listApiLogs(query: ApiLogQuery = {}): Promise<ApiLogPage> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  let request = getSupabaseAdminClient()
    .from("api_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.direction) request = request.eq("direction", query.direction);
  if (query.label) request = request.eq("label", query.label);
  if (query.search) {
    // Commas separate the branches of an `or`, so one in the search term would
    // otherwise be read as a filter separator.
    const term = query.search.replace(/[,()]/g, " ").trim();
    if (term) {
      request = request.or(
        `url.ilike.%${term}%,label.ilike.%${term}%,gateway_code.ilike.%${term}%`,
      );
    }
  }

  const { data, error, count } = await request;
  if (error) throw new Error(`Could not read the API log: ${error.message}`);

  return { rows: (data ?? []) as ApiLogRow[], total: count ?? 0 };
}

export async function getApiLog(id: string): Promise<ApiLogRow | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("api_logs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not read the API log: ${error.message}`);
  return (data as ApiLogRow | null) ?? null;
}

/** The distinct operations seen, newest first — populates the filter chips. */
export async function listApiLogLabels(): Promise<string[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from("api_logs")
    .select("label")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return [];
  return [...new Set((data ?? []).map((r) => (r as { label: string }).label))].sort();
}

/** Empties the log. Admin-triggered from the viewer. */
export async function clearApiLogs(): Promise<number> {
  const admin = getSupabaseAdminClient();
  const { count, error } = await admin
    .from("api_logs")
    .delete({ count: "exact" })
    // `delete` without a filter is rejected by PostgREST; this matches every row.
    .not("id", "is", null);

  if (error) throw new Error(`Could not clear the API log: ${error.message}`);
  return count ?? 0;
}
