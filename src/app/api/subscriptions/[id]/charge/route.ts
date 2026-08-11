/**
 * Charge one period of an existing subscription now, on demand.
 *
 * The scheduler does this on its own, but a customer who has just fixed a
 * wallet — or who wants to settle a past-due period — shouldn't have to wait
 * for the next cron run to find out whether it works.
 */

import { err, handleRouteError, ok } from "@/lib/api";
import { customerMessage } from "@/lib/collection/codes";
import { chargeSubscription } from "@/lib/subscriptions";
import { getSupabaseAdminClient, requireUser } from "@/lib/supabase/server";
import type { Subscription } from "@/lib/db-types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const { data: sub } = await admin
      .from("subscriptions")
      .select("*, products(*), payment_tokens(*)")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!sub) return err("NOT_FOUND", "Subscription not found.", 404);
    if (sub.status === "cancelled") {
      return err(
        "ALREADY_CANCELLED",
        "This subscription is cancelled — resubscribe to charge it.",
        409,
      );
    }
    if (sub.status === "paused") {
      return err("PAUSED", "Resume this subscription before charging it.", 409);
    }

    const result = await chargeSubscription(sub as unknown as Subscription);

    return ok({
      subscriptionId: sub.id,
      orderId: result.orderId,
      code: result.code,
      outcome: result.outcome,
      skipped: result.skipped ?? false,
      message: result.skipped
        ? "This period has already been charged."
        : customerMessage(result.code),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
