/**
 * The API call log, for the viewer at /logs.
 *
 * Admin-only: the rows carry msisdns, order references and gateway payloads.
 */

import { handleRouteError, ok } from "@/lib/api";
import { clearApiLogs, listApiLogs, type ApiLogDirection } from "@/lib/api-logs";
import { requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const params = new URL(request.url).searchParams;
    const direction = params.get("direction");

    return ok(
      await listApiLogs({
        direction:
          direction === "outbound" || direction === "inbound"
            ? (direction as ApiLogDirection)
            : undefined,
        label: params.get("label") || undefined,
        search: params.get("q") || undefined,
        limit: Number(params.get("limit")) || 50,
        offset: Number(params.get("offset")) || 0,
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE() {
  try {
    await requireAdmin();
    return ok({ deleted: await clearApiLogs() });
  } catch (error) {
    return handleRouteError(error);
  }
}
