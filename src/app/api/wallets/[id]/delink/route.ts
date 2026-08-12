/**
 * Retires a saved wallet (§4.6). Any subscription riding on it is left with no
 * chargeable token, so those are cancelled in the same breath rather than
 * failing silently at the next renewal.
 */

import { err, fromGateway, handleRouteError } from "@/lib/api";
import * as gateway from "@/lib/collection/client";
import { recordTransaction } from "@/lib/orders";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const { data: token } = await admin
      .from("payment_tokens")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!token) return err("0036", "That saved wallet no longer exists.", 404);

    const call = await gateway.delink({
      operatorId: token.operator_id as "100007" | "100008",
      sourceId: token.source_id,
    });

    await recordTransaction({
      orderId: null,
      userId: user.id,
      kind: "delink",
      operation: "delink",
      call,
      operatorId: token.operator_id,
    });

    // 0028/0036 mean it was already gone upstream — the customer's intent is
    // satisfied either way, so treat those as done.
    const gone = ["0000", "0028", "0036"].includes(call.code);
    if (gone) {
      await admin
        .from("payment_tokens")
        .update({ status: "delinked" })
        .eq("id", token.id);
      await admin
        .from("subscriptions")
        .update({ status: "cancelled" })
        .eq("payment_token_id", token.id)
        .neq("status", "cancelled");
    }

    return fromGateway(call.code, { delinked: gone });
  } catch (error) {
    return handleRouteError(error);
  }
}
