/**
 * Async settlement pushed by the gateway (§9.5).
 *
 * This is how indeterminate orders get resolved without polling. The payload is
 * matched to an order by userKey/orderId first — that is our own reference and
 * therefore the one field we can trust to belong to us — falling back to the
 * gateway transactionId recorded on our audit trail.
 *
 * Every payload is stored before it is acted on, so a handler bug never loses a
 * settlement.
 */

import { handleRouteError, err, ok } from "@/lib/api";
import { logApiCall } from "@/lib/api-logs";
import { classify } from "@/lib/collection/codes";
import { serverEnv } from "@/lib/env";
import { applyOutcome } from "@/lib/orders";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Recorded in the API call log as well as in `postbacks`: that table is the
 * settlement record, this is the HTTP conversation — headers, status and all —
 * which is what you need when the gateway insists it sent something.
 *
 * The body is read once here and handed to the handler, because a request body
 * is a stream and can only be consumed once.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await request.text();
  const response = await handle(request, body);

  await logApiCall({
    direction: "inbound",
    label: "collection.postback",
    method: "POST",
    url: request.url,
    requestHeaders: request.headers,
    requestBody: body,
    // Cloned so the body the caller receives is still unread.
    responseBody: await response
      .clone()
      .text()
      .catch(() => null),
    statusCode: response.status,
    outcome: response.ok ? "success" : "failure",
    durationMs: Date.now() - startedAt,
  });

  return response;
}

async function handle(request: Request, body: string): Promise<Response> {
  const admin = getSupabaseAdminClient();
  let postbackId: string | null = null;

  try {
    // Shared secret, since the mock gateway does not sign postbacks. Accept it
    // from either header the gateway might use.
    const presented =
      request.headers.get("x-postback-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    if (presented !== serverEnv.postbackSecret()) {
      return err("UNAUTHORIZED", "Not authorised.", 401);
    }

    const payload = JSON.parse(body) as Record<string, unknown>;

    const { data: stored } = await admin
      .from("postbacks")
      .insert({ payload: payload as never })
      .select("id")
      .single();
    postbackId = stored?.id ?? null;

    const orderRef =
      (payload.userKey as string) ?? (payload.orderId as string) ?? null;
    const gatewayTxnId = (payload.transactionId as string) ?? null;
    const code = (payload.status as string) ?? "";

    if (!code) {
      throw new Error("postback carried no status code");
    }

    let orderId: string | null = null;

    if (orderRef) {
      const { data } = await admin
        .from("orders")
        .select("id")
        .eq("order_ref", orderRef)
        .maybeSingle();
      orderId = data?.id ?? null;
    }

    if (!orderId && gatewayTxnId) {
      const { data } = await admin
        .from("transactions")
        .select("order_id")
        .eq("gateway_transaction_id", gatewayTxnId)
        .not("order_id", "is", null)
        .limit(1)
        .maybeSingle();
      orderId = data?.order_id ?? null;
    }

    if (!orderId) {
      // Unmatched postbacks are kept, not rejected — the gateway should not
      // retry forever over a reference we simply don't recognise.
      if (postbackId) {
        await admin
          .from("postbacks")
          .update({ processed: true, error: "no matching order" })
          .eq("id", postbackId);
      }
      return ok({ matched: false });
    }

    await admin.from("transactions").insert({
      order_id: orderId,
      kind: "payment",
      gateway_transaction_id: gatewayTxnId,
      status_code: code,
      message: (payload.message as string) ?? null,
      indeterminate: classify(code) === "indeterminate",
      response: payload as never,
    });

    const status = await applyOutcome({
      orderId,
      code,
      gatewayTransactionId: gatewayTxnId,
    });

    if (postbackId) {
      await admin.from("postbacks").update({ processed: true }).eq("id", postbackId);
    }

    return ok({ matched: true, orderId, orderStatus: status });
  } catch (error) {
    if (postbackId) {
      await admin
        .from("postbacks")
        .update({ error: String(error) })
        .eq("id", postbackId);
    }
    return handleRouteError(error);
  }
}
