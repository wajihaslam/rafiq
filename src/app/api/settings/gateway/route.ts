/**
 * Reads and writes the runtime gateway configuration (merchant id, flow,
 * Payment API base URL). Admin-only — these values decide where real money is
 * sent and under whose MID.
 */

import { z } from "zod";

import { handleRouteError, ok } from "@/lib/api";
import { getGatewayConfig, saveGatewaySettings } from "@/lib/settings";
import { requireAdmin } from "@/lib/supabase/server";

/** An empty string means "clear the override and fall back to the env". */
const blankToNull = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v));

const schema = z.object({
  merchantId: blankToNull,
  flow: blankToNull,
  baseUrl: blankToNull,
});

export async function GET() {
  try {
    await requireAdmin();
    return ok(await getGatewayConfig());
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireAdmin();
    const input = schema.parse(await request.json());

    // Echoed back so the form shows what the next gateway call will use,
    // including any field that fell back to the environment.
    return ok(await saveGatewaySettings({ ...input, updatedBy: user.id }));
  } catch (error) {
    return handleRouteError(error);
  }
}
