/**
 * Webhook catcher.
 *
 * A public endpoint that accepts anything, records it in the API call log and
 * answers 200. It is a diagnostic tool: point a gateway, a partner or a curl
 * command at it to see exactly what they send, without needing that payload to
 * be understood first.
 *
 * Deliberately unlike `/api/collection/postback`:
 *   - no shared secret, because the whole point is to catch calls you have not
 *     configured yet;
 *   - no side effects. It never touches an order, a token or a subscription.
 *     Real settlement goes through the postback handler, which authenticates.
 *
 * Any sub-path is caught too, so several senders can be given distinguishable
 * URLs — /api/webhooks/catch/easypaisa and /api/webhooks/catch/jazzcash both
 * land here and are logged under their own label.
 */

import { NextResponse } from "next/server";

import { logApiCall } from "@/lib/api-logs";

/** Nothing here may be cached or statically rendered. */
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path?: string[] }> };

async function capture(request: Request, context: Context) {
  const startedAt = Date.now();
  const { path } = await context.params;
  const segments = path ?? [];
  const url = new URL(request.url);

  // A body may be JSON, form-encoded or anything else; read it as text and let
  // the log library decide how to store it. `.text()` never throws on an empty
  // body, so GET and DELETE are handled by the same path.
  let body: string | Record<string, string> = "";
  try {
    const raw = await request.text();
    const contentType = request.headers.get("content-type") ?? "";
    body = contentType.includes("application/x-www-form-urlencoded")
      ? Object.fromEntries(new URLSearchParams(raw))
      : raw;
  } catch (error) {
    body = `[unreadable body: ${String(error)}]`;
  }

  const received = {
    // The query string is part of the payload for GET-style webhooks.
    query: Object.fromEntries(url.searchParams),
    body,
  };

  const response = {
    ok: true,
    message: "Webhook received.",
    receivedAt: new Date().toISOString(),
    path: segments.length ? `/${segments.join("/")}` : "/",
  };

  await logApiCall({
    direction: "inbound",
    label: segments.length ? `webhook.${segments.join(".")}` : "webhook.catch",
    method: request.method,
    url: url.toString(),
    requestHeaders: request.headers,
    requestBody: received,
    responseBody: response,
    statusCode: 200,
    outcome: "success",
    requestId: request.headers.get("request-id"),
    durationMs: Date.now() - startedAt,
  });

  // Always 200, even if the log write failed: a sender that gets a 5xx will
  // retry, and a retry storm is a worse outcome than one missing log line.
  return NextResponse.json(response, { status: 200 });
}

export const GET = capture;
export const POST = capture;
export const PUT = capture;
export const PATCH = capture;
export const DELETE = capture;
export const HEAD = capture;
