/** Pause, resume or cancel a subscription. The token stays linked either way —
 *  removing it is a separate, explicit action on the wallets page. */

import { z } from "zod";

import { err, handleRouteError, ok } from "@/lib/api";
import { getSupabaseServerClient, requireUser } from "@/lib/supabase/server";

const schema = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { action } = schema.parse(await request.json());
    const supabase = await getSupabaseServerClient();

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id, status, interval_days")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!sub) return err("NOT_FOUND", "Subscription not found.", 404);
    if (sub.status === "cancelled") {
      return err("ALREADY_CANCELLED", "This subscription is already cancelled.", 409);
    }

    const patch: Record<string, unknown> = {};
    if (action === "pause") patch.status = "paused";
    if (action === "cancel") patch.status = "cancelled";
    if (action === "resume") {
      patch.status = "active";
      patch.failed_attempts = 0;
      // Resume at the start of a fresh period rather than immediately billing
      // for the time the subscription was paused.
      const next = new Date();
      next.setUTCDate(next.getUTCDate() + sub.interval_days);
      patch.next_charge_at = next.toISOString();
    }

    const { error } = await supabase.from("subscriptions").update(patch).eq("id", id);
    if (error) throw new Error(error.message);

    return ok({ subscriptionId: id, status: patch.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
