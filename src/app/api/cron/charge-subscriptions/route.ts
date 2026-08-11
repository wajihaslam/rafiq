/**
 * Renewal run. Wired to Vercel Cron (see vercel.json), which sends
 * `Authorization: Bearer $CRON_SECRET`.
 *
 * Charges are sequential on purpose: firing a batch of direct-payments in
 * parallel at one operator is how you get rate-limited into a pile of
 * indeterminate responses.
 */

import { handleRouteError, err, ok } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { chargeSubscription, dueSubscriptions } from "@/lib/subscriptions";

export const maxDuration = 60;

async function run(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${serverEnv.cronSecret()}`) {
    return err("UNAUTHORIZED", "Not authorised.", 401);
  }

  const due = await dueSubscriptions();
  const results = [];
  for (const sub of due) {
    try {
      results.push(await chargeSubscription(sub));
    } catch (error) {
      console.error("[cron] subscription", sub.id, error);
      results.push({
        subscriptionId: sub.id,
        orderId: null,
        code: "9999",
        outcome: "indeterminate" as const,
      });
    }
  }

  return ok({
    considered: due.length,
    charged: results.filter((r) => r.outcome === "success").length,
    // Counted apart from `pending`: a skipped period was already billed by a
    // manual charge, so it needs no reconciliation of its own.
    skipped: results.filter((r) => "skipped" in r && r.skipped).length,
    pending: results.filter((r) => r.outcome === "indeterminate" && !("skipped" in r && r.skipped))
      .length,
    failed: results.filter((r) => r.outcome === "failure").length,
    results,
  });
}

export async function GET(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return handleRouteError(error);
  }
}
