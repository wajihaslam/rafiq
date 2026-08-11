/**
 * Completes the OTP step of a direct product payment. There is no cart to
 * close here — the order stands on its own.
 */

import { z } from "zod";

import { err, fromGateway, handleRouteError } from "@/lib/api";
import { verifyOtpPayment } from "@/lib/checkout";
import { requireUser } from "@/lib/supabase/server";

const schema = z.object({
  orderId: z.string().uuid(),
  otp: z.string().regex(/^\d{4,8}$/, "Enter the OTP you received."),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { orderId, otp } = schema.parse(await request.json());

    const result = await verifyOtpPayment({ userId: user.id, orderId, otp });
    if (result.problem) {
      return err(result.problem.code, result.problem.message, result.problem.status);
    }

    return fromGateway(result.code, {
      orderId: result.orderId,
      orderRef: result.orderRef,
      orderStatus: result.orderStatus,
      canRetryOtp: result.canRetryOtp,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
