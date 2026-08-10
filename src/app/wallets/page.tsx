import { LinkWalletForm } from "@/components/LinkWalletForm";
import { SavedWalletList } from "@/components/SavedWalletList";
import { getSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import type { PaymentToken } from "@/lib/db-types";

export default async function WalletsPage() {
  await requireUser();
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("payment_tokens")
    .select("*")
    .order("linked_at", { ascending: false });

  const tokens = (data ?? []) as PaymentToken[];

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Saved wallets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Link a wallet once with an OTP, then pay in one click and run
          subscriptions without being asked again. A linked wallet stays usable for
          one year.
        </p>
      </div>

      <SavedWalletList
        tokens={tokens.map((t) => ({
          id: t.id,
          operatorId: t.operator_id,
          msisdn: t.msisdn,
          label: t.label,
          status: t.status,
          expiresAt: t.expires_at,
        }))}
      />

      <LinkWalletForm />
    </div>
  );
}
