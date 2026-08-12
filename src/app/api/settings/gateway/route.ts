/**
 * Reads and writes the runtime gateway configuration (merchant id, flow,
 * Payment API base URL). Admin-only — these values decide where real money is
 * sent and under whose MID.
 */

import { z } from "zod";

import { handleRouteError, ok } from "@/lib/api";
import { getGatewayConfigState, saveGatewaySettings } from "@/lib/settings";
import { requireAdmin } from "@/lib/supabase/server";

/**
 * An empty string means "clear the override and fall back to the env" — or to
 * nothing at all, if the env does not define it either.
 */
const blankToNull = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v));

const schema = z.object({
  /** The merchant provisioned on each flow. `flow` selects which one is live. */
  merchantIdOtp: blankToNull,
  merchantIdNonOtp: blankToNull,
  /** Not selectable: used by every token call whatever the flow is. */
  merchantIdTokenization: blankToNull,
  flow: blankToNull,
  /**
   * How a wallet link runs. Independent of `flow`. Absent and blank both mean
   * "no override", so an older client that does not send the field keeps
   * working instead of having its stored value rejected.
   */
  tokenizationSequence: blankToNull
    .nullish()
    .transform((v) => v ?? null),
  baseUrl: blankToNull,
});

export async function GET() {
  try {
    await requireAdmin();
    // State, not the strict config: an admin must be able to read a half-set
    // configuration in order to finish setting it.
    return ok(await getGatewayConfigState());
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
