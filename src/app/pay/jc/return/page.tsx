/**
 * Landing page for the JazzCash hosted registration redirect (§4.3).
 *
 * The redirect's status is only a hint — the token itself comes from finalize,
 * so we always call it rather than trusting the query string. Finalize is
 * idempotent per orderId, so a refresh here is harmless.
 */

import Link from "next/link";

import { JcFinalizer } from "@/components/JcFinalizer";
import { logApiCall } from "@/lib/api-logs";
import { codeMessage } from "@/lib/collection/codes";
import { requireUser } from "@/lib/supabase/server";

/** The gateway drives this URL, so each arrival is a real inbound call to log. */
export const dynamic = "force-dynamic";

export default async function JcReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const orderRef = typeof params.orderId === "string" ? params.orderId : null;
  const status = typeof params.status === "string" ? params.status : null;

  /**
   * A return URL is a webhook that happens to arrive in a browser: the gateway
   * chose the moment and the query string, and without a log line the trail for
   * a JazzCash link has a hole in it exactly where the customer came back. Logged
   * before anything is decided, so a redirect we could not interpret is still on
   * the record.
   */
  await logApiCall({
    direction: "inbound",
    label: "webhook.jc.return",
    method: "GET",
    url: "/pay/jc/return",
    requestBody: { query: params },
    statusCode: 200,
    outcome: status ? undefined : "pending",
    gatewayCode: status,
  });

  // 0003 and 0005 come back without a transactionId and there is nothing to
  // finalize — 0005 in particular means this wallet is already linked.
  const nothingToRedeem = status === "0003" || status === "0005";

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Linking your wallet</h1>

      {!orderRef || nothingToRedeem ? (
        <div className="card space-y-3 text-sm">
          <p>
            {status === "0005"
              ? "This wallet is already linked to your account."
              : `We could not complete the link${status ? `: ${codeMessage(status)}` : "."}`}
          </p>
          <Link href="/wallets" className="btn-primary w-fit">
            Back to wallets
          </Link>
        </div>
      ) : (
        <JcFinalizer orderRef={orderRef} redirectStatus={status} />
      )}
    </div>
  );
}
