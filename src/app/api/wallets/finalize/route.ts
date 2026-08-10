/**
 * Redeems a JazzCash hosted registration for a sourceId (§4.4).
 *
 * Safe to call more than once: re-finalizing the same orderId returns the same
 * token, so a customer refreshing the return page cannot produce a second one.
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError } from "@/lib/api";
import * as gateway from "@/lib/collection/client";
import { recordTransaction } from "@/lib/orders";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

const schema = z.object({ orderRef: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { orderRef } = schema.parse(await request.json());
    const admin = getSupabaseAdminClient();

    const { data: reg } = await admin
      .from("wallet_registrations")
      .select("*")
      .eq("order_ref", orderRef)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!reg) return err("0042", "We have no record of that wallet link.", 404);

    const call = await gateway.finalize({
      operatorId: reg.operator_id as "100007" | "100008",
      orderId: reg.order_ref,
      msisdn: reg.msisdn,
    });

    await recordTransaction({
      orderId: null,
      userId: user.id,
      kind: "tokenization",
      call,
      gatewayTransactionId: call.body?.transactionId,
      operatorId: reg.operator_id,
    });

    const sourceId = call.body?.sourceId;
    if (call.code === "0000" && sourceId) {
      const { error } = await admin.from("payment_tokens").insert({
        user_id: user.id,
        operator_id: reg.operator_id,
        source_id: sourceId,
        msisdn: reg.msisdn,
        label: reg.label,
      });
      if (error && !error.message.includes("duplicate")) {
        throw new Error(error.message);
      }
      await admin
        .from("wallet_registrations")
        .update({ status: "linked", status_code: call.code })
        .eq("id", reg.id);
    } else {
      // 0037 means consent is still pending — keep the registration open so the
      // customer (or a later retry) can finish it.
      const status =
        call.code === "0037" ? "pending" : call.code === "0091" ? "declined" : "failed";
      await admin
        .from("wallet_registrations")
        .update({ status, status_code: call.code })
        .eq("id", reg.id);
    }

    return fromGateway(call.code, { linked: Boolean(sourceId) });
  } catch (error) {
    return handleRouteError(error);
  }
}
