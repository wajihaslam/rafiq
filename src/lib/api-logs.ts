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
  /** The gateway's transactionId, lifted out of the bodies so it is searchable. */
  transaction_id: string | null;
  /** Our own reference — userKey on wallet calls, orderId on hosted ones. */
  user_key: string | null;
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
 * thing you need when a call comes back 0003. Substring matching does overreach
 * on a few field names, so see `KEPT_KEYS` below for the exemptions.
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

/**
 * Exempt from the substring rule above, and it has to be an exemption rather
 * than a cleverer pattern: `userKey` *contains* "key" and was being redacted,
 * which quietly destroyed the one reference that ties a log line to an order —
 * every wallet call recorded `"userKey": "[redacted]"`.
 *
 * Neither of these is a secret. They are references we generated ourselves and
 * print on the order page, and they are the first thing you need when a call has
 * to be traced or quoted to the gateway — the same argument that keeps
 * `merchantId`, which survives only by not happening to contain a listed word.
 */
const KEPT_KEYS = ["userkey", "orderid", "merchantid", "transactionid", "sourceid"];

const REDACTED = "[redacted]";

/** Bodies are truncated at this length before storage. */
const MAX_RAW_LENGTH = 20_000;

function isRedacted(key: string): boolean {
  const lower = key.toLowerCase();
  if (KEPT_KEYS.includes(lower)) return false;
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
 * The two references that identify one conversation, wherever they turn up.
 *
 * Searching the log by URL or operation is nearly useless in practice — every
 * call goes to the same host and half of them are `collection.verify`. What a
 * tester actually holds is a transaction id the gateway quoted, or the order
 * reference we generated. Both are buried at varying depths (`transactionId` at
 * the top level on a wallet call, under `transaction` on an inquiry, inside
 * `{query, body}` on a caught webhook), so they are pulled out on the way in and
 * stored in their own columns. Extracting at read time would mean scanning every
 * body in the table for every search.
 */
const TRANSACTION_ID_KEYS = ["transactionid", "txnid"];
const USER_KEY_KEYS = ["userkey", "orderid"];

/**
 * Depth-first search for the first non-empty string under any of `keys`.
 * Case-insensitive because the hosted endpoints capitalise (`OrderId`) where the
 * JSON ones do not.
 */
function findKey(value: Json, keys: string[], depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const [key, inner] of Object.entries(value)) {
    if (keys.includes(key.toLowerCase())) {
      if (typeof inner === "string" && inner.trim() !== "") return inner;
      if (typeof inner === "number") return String(inner);
    }
  }
  // Only descend once the whole level has been checked, so a top-level match
  // wins over one nested inside an echoed request.
  for (const inner of Object.values(value)) {
    const found = findKey(inner, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function firstOf(bodies: Json[], keys: string[]): string | null {
  for (const body of bodies) {
    const found = findKey(body, keys);
    if (found) return found.slice(0, 120);
  }
  return null;
}

/**
 * Writes one row. Awaited by callers rather than fired and forgotten: on a
 * serverless host the function can be frozen the moment the response is
 * returned, and a detached insert would simply never land.
 */
export async function logApiCall(input: ApiLogInput): Promise<void> {
  try {
    const requestBody = bodyToJson(input.requestBody);
    const responseBody = bodyToJson(input.responseBody);
    const bodies = [requestBody, responseBody];

    const { error } = await getSupabaseAdminClient()
      .from("api_logs")
      .insert({
        direction: input.direction,
        label: input.label,
        method: input.method.toUpperCase(),
        url: input.url,
        request_headers: headersToJson(input.requestHeaders) as never,
        request_body: requestBody as never,
        response_headers: headersToJson(input.responseHeaders) as never,
        response_body: responseBody as never,
        status_code: input.statusCode ?? null,
        gateway_code: input.gatewayCode || null,
        outcome: input.outcome ?? null,
        request_id: input.requestId ?? null,
        duration_ms: input.durationMs ?? null,
        error: input.error ?? null,
        user_id: input.userId ?? null,
        transaction_id: firstOf(bodies, TRANSACTION_ID_KEYS),
        user_key: firstOf(bodies, USER_KEY_KEYS),
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
  /**
   * Free text across the URL, the operation, the gateway code and — the two
   * that actually narrow anything down — the transaction id and user key.
   */
  search?: string;
  /** Exact transaction id. Cheaper and less ambiguous than the free-text field. */
  transactionId?: string;
  /** Exact user key / order reference. */
  userKey?: string;
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
  // Exact, and deliberately so: a transaction id is quoted to you in full, and
  // a prefix match on one would silently pull in a neighbouring transaction.
  if (query.transactionId?.trim()) {
    request = request.eq("transaction_id", query.transactionId.trim());
  }
  if (query.userKey?.trim()) {
    request = request.eq("user_key", query.userKey.trim());
  }
  if (query.search) {
    // Commas separate the branches of an `or`, so one in the search term would
    // otherwise be read as a filter separator.
    const term = query.search.replace(/[,()]/g, " ").trim();
    if (term) {
      request = request.or(
        [
          `url.ilike.%${term}%`,
          `label.ilike.%${term}%`,
          `gateway_code.ilike.%${term}%`,
          // Pasting a transaction id or an order ref into the one box people
          // actually use should find it, without them having to know which
          // field it belongs in.
          `transaction_id.ilike.%${term}%`,
          `user_key.ilike.%${term}%`,
          `request_id.ilike.%${term}%`,
        ].join(","),
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
