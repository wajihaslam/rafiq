/**
 * Completes an Easypaisa wallet link: verify with transactionType "8" mints the
 * sourceId. A one-time payment never walks away with a reusable token, so the
 * presence of sourceId is itself the signal that tokenization succeeded — and
 * that is taken literally here, because this gateway returns a perfectly good
 * sourceId alongside `0015 Invalid-Flow`. Insisting on `0000` as well threw the
 * token away and reported a failure to a customer who had just been linked.
 *
 * On the `verify_only` sequence there is no initiate to continue, so there is no
 * transactionId to send: verify starts and finishes the transaction by itself.
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError, ok } from "@/lib/api";
import * as gateway from "@/lib/collection/client";
import { codeMessage } from "@/lib/collection/codes";
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

    const call = await gateway.verify({
      operatorId: reg.operator_id as "100007" | "100008",
      amount: LINK_AMOUNT,
      userKey: reg.order_ref,
      msisdn: reg.msisdn,
      transactionType: "8",
      // Only when there is an initiate to continue. Sending a transactionId we
      // never received would answer 0097; omitting it on the OTP sequence would
      // start a second transaction and orphan the first.
      ...(reg.gateway_transaction_id
        ? { transactionId: reg.gateway_transaction_id }
        : {}),
      otp,
    });

    await recordTransaction({
      orderId: null,
      userId: user.id,
      kind: "tokenization",
      operation: "verify",
      call,
      gatewayTransactionId: call.body?.transactionId,
      operatorId: reg.operator_id,
    });

    const sourceId = call.body?.sourceId;
    // The token, not the code, is the evidence — see the note at the top.
    if (sourceId) {
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

    /**
     * Reported as a success when a token came back, whatever code came with it.
     * `fromGateway` would classify 0015 as a failure and attach "The payment
     * could not be completed" — a flat contradiction of the wallet that is now
     * sitting in the customer's list, and a message no consumer should have to
     * know to ignore.
     */
    if (sourceId) {
      return ok({
        code: call.code,
        outcome: "success",
        message: "Wallet linked.",
        gatewayMessage: codeMessage(call.code),
        linked: true,
        canRetryOtp: false,
      });
    }

    return fromGateway(call.code, {
      linked: false,
      canRetryOtp: ["0011", "0095"].includes(call.code),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
