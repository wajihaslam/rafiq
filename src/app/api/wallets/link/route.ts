/**
 * Starts linking a wallet (tokenization, transactionType "8").
 *
 * JazzCash does not tokenize over JSON at all — it uses a real hosted page, so
 * we answer with a redirect URL instead of a transaction.
 *
 * Easypaisa runs one of two sequences, and which one is a property of the
 * gateway rather than a preference (see `tokenizationSequence` in /settings):
 *
 *   initiate_verify  §2 as documented — initiate sends the OTP, verify redeems
 *                    it and mints the sourceId.
 *   verify_only      the gateway refuses `initiate` whenever transactionType is
 *                    8 (0015 Invalid-Flow, on every merchant, whatever flow it
 *                    is on) and mints the token from `verify` alone. There is
 *                    nothing to call here, so we go straight to the OTP step.
 *
 * Sending an initiate we know will be refused is not harmless: it answers 0015,
 * which reads as a misconfigured merchant and sends whoever is debugging it
 * straight to the settings page to fix something that is not broken.
 *
 * The nominal amount is what the operator shows the customer while taking
 * consent; it is not a charge we settle.
 */

import { z } from "zod";

import { fromGateway, handleRouteError, ok } from "@/lib/api";
import * as gateway from "@/lib/collection/client";
import { OPERATORS, TOKENIZATION_STYLE } from "@/lib/collection/types";
import { publicEnv } from "@/lib/env";
import { newOrderRef, recordTransaction } from "@/lib/orders";
import { getTokenizationSequence } from "@/lib/settings";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";

/** Consent amount shown on the linking screen. */
const LINK_AMOUNT = 1;

const schema = z.object({
  operatorId: z.enum([OPERATORS.easypaisa, OPERATORS.jazzcash]),
  msisdn: z.string().min(10),
  label: z.string().max(40).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { operatorId, msisdn, label } = schema.parse(await request.json());
    const admin = getSupabaseAdminClient();
    const orderRef = newOrderRef("LINK");

    // --- JazzCash: hosted page --------------------------------------------
    if (TOKENIZATION_STYLE[operatorId] === "hosted") {
      const { error } = await admin.from("wallet_registrations").insert({
        user_id: user.id,
        order_ref: orderRef,
        operator_id: operatorId,
        msisdn,
        label: label ?? null,
      });
      if (error) throw new Error(error.message);

      const url = await gateway.jazzCashRegistrationUrl({
        orderId: orderRef,
        amount: LINK_AMOUNT,
        returnUrl: `${publicEnv.appUrl()}/pay/jc/return`,
        msisdn,
      });

      return ok({ style: "hosted", orderRef, redirectTo: url, label: label ?? null });
    }

    // --- Easypaisa, verify_only: nothing to call yet ----------------------
    // The OTP reaches the customer by the operator's own means; `verify` is the
    // one call, and ../link/verify makes it. Park the registration so that step
    // can find it, exactly as the initiate branch does.
    if ((await getTokenizationSequence()) === "verify_only") {
      const { error } = await admin.from("wallet_registrations").insert({
        user_id: user.id,
        order_ref: orderRef,
        operator_id: operatorId,
        msisdn,
        label: label ?? null,
      });
      if (error) throw new Error(error.message);

      return ok({
        style: "otp",
        orderRef,
        needsOtp: true,
        code: "",
        outcome: "pending",
        message: "Enter the OTP for this wallet to finish linking.",
      });
    }

    // --- Easypaisa: initiate, then the customer posts the OTP -------------
    const call = await gateway.initiate({
      operatorId,
      amount: LINK_AMOUNT,
      userKey: orderRef,
      msisdn,
      transactionType: "8",
    });

    await recordTransaction({
      orderId: null,
      userId: user.id,
      kind: "tokenization",
      operation: "initiate",
      call,
      gatewayTransactionId: call.body?.transactionId,
      operatorId,
    });

    if (call.code !== "0000") {
      return fromGateway(call.code, { style: "otp", orderRef, needsOtp: false });
    }

    // Park the pending link so ../link/verify can find the transactionId
    // without trusting the client to supply it.
    const { error } = await admin.from("wallet_registrations").insert({
      user_id: user.id,
      order_ref: orderRef,
      operator_id: operatorId,
      msisdn,
      label: label ?? null,
      gateway_transaction_id: call.body?.transactionId ?? null,
    });
    if (error) throw new Error(error.message);

    return fromGateway(call.code, { style: "otp", orderRef, needsOtp: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
