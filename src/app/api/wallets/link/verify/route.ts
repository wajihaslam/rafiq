/**
 * Completes an Easypaisa wallet link: verify with transactionType "8" mints the
 * sourceId. A one-time payment never walks away with a reusable token, so the
 * presence of sourceId is itself the signal that tokenization succeeded.
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError } from "@/lib/api";
import * as gateway from "@/lib/collection/client";
import { recordTransaction } from "@/lib/orders";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

/** Must match the consent amount used on initiate. */
const LINK_AMOUNT = 1;

const schema = z.object({
  orderRef: z.string().min(1),
  otp: z.string().regex(/^\d{4,8}$/, "Enter the OTP you received."),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { orderRef, otp } = schema.parse(await request.json());
    const admin = getSupabaseAdminClient();

    const { data: reg } = await admin
      .from("wallet_registrations")
      .select("*")
      .eq("order_ref", orderRef)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!reg) return err("NOT_FOUND", "That wallet link has expired.", 404);
    if (reg.status === "linked") {
      return err("0005", "This wallet is already linked.", 409);
    }
    if (!reg.gateway_transaction_id) {
      return err("0097", "We lost track of this link. Please start again.", 409);
    }

    const call = await gateway.verify({
      operatorId: reg.operator_id as "100007" | "100008",
      amount: LINK_AMOUNT,
      userKey: reg.order_ref,
      msisdn: reg.msisdn,
      transactionType: "8",
      transactionId: reg.gateway_transaction_id,
      otp,
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
      // A duplicate sourceId means the gateway handed back a token we already
      // hold — that's a successful re-link, not an error.
      if (error && !error.message.includes("duplicate")) {
        throw new Error(error.message);
      }
      await admin
        .from("wallet_registrations")
        .update({ status: "linked", status_code: call.code })
        .eq("id", reg.id);
    } else {
      // 0011/0095 are retryable — leave the registration pending.
      const retryable = ["0011", "0095"];
      if (!retryable.includes(call.code)) {
        await admin
          .from("wallet_registrations")
          .update({ status: "failed", status_code: call.code })
          .eq("id", reg.id);
      }
    }

    return fromGateway(call.code, {
      linked: Boolean(sourceId),
      canRetryOtp: ["0011", "0095"].includes(call.code),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
