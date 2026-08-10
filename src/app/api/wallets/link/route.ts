/**
 * Starts linking a wallet (tokenization, transactionType "8").
 *
 * Tokenization is exempt from the flow split (§2): it always runs
 * initiate → verify with an OTP on Easypaisa, on *both* flows. JazzCash does
 * not tokenize over JSON at all — it uses a real hosted page, so we answer with
 * a redirect URL instead of a transaction.
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
