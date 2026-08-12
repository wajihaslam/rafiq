import Link from "next/link";

import { LinkWalletForm } from "@/components/LinkWalletForm";
import { SavedWalletList, type WalletRow } from "@/components/SavedWalletList";
import { getGatewayConfigState } from "@/lib/settings";
import { requireUser } from "@/lib/supabase/server";
import { tokenizations } from "@/lib/tracking";

/** A wallet list that is a render behind is worse than none — actions act on it. */
export const dynamic = "force-dynamic";

export default async function WalletsPage() {
  const user = await requireUser();
  const [rows, { tokenizationSequence }] = await Promise.all([
    tokenizations(user.id),
    getGatewayConfigState(),
  ]);

  const wallets: WalletRow[] = rows.map((row) => ({
    id: row.tokenId,
    registrationOrderRef: row.registrationOrderRef,
    operatorId: row.operatorId,
    msisdn: row.msisdn,
    label: row.label,
    status: row.status,
    expiresAt: row.expiresAt,
    chargeCount: row.chargeCount,
    charges: row.charges.map((c) => ({
      orderId: c.orderId,
      orderRef: c.orderRef,
      amount: c.amount,
      status: c.status,
      createdAt: c.createdAt,
    })),
    steps: row.steps,
  }));

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Saved wallets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Link as many wallets as you like — Easypaisa or JazzCash, several of
          each. Each one is verified once with an OTP, and can then be charged,
          inquired about, refunded or delinked on its own. A linked wallet stays
          usable for one year.{" "}
          <Link
            href="/orders?track=tokenization"
            className="text-brand-600 hover:underline"
          >
            See all tokenization activity
          </Link>
          .
        </p>
      </div>

      <SavedWalletList wallets={wallets} />

      <LinkWalletForm sequence={tokenizationSequence} />
    </div>
  );
}
