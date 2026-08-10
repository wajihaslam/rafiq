"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OPERATOR_LABELS } from "@/lib/collection/types";
import type { TokenStatus } from "@/lib/db-types";

interface Row {
  id: string;
  operatorId: string;
  msisdn: string;
  label: string | null;
  status: TokenStatus;
  expiresAt: string;
}

export function SavedWalletList({ tokens }: { tokens: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    const response = await fetch(`/api/wallets/${id}/delink`, { method: "POST" });
    const payload = await response.json();
    setBusy(null);
    if (!payload.ok) {
      setError(payload.message);
      return;
    }
    router.refresh();
  }

  if (tokens.length === 0) {
    return (
      <p className="card text-sm text-slate-500">
        No wallets linked yet. Link one below to unlock one-click checkout and
        subscriptions.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {tokens.map((token) => (
          <li key={token.id} className="flex items-center gap-4 p-4">
            <div className="flex-1">
              <p className="font-medium">
                {OPERATOR_LABELS[token.operatorId as "100007" | "100008"]} ·{" "}
                {token.msisdn}
              </p>
              <p className="text-sm text-slate-500">
                {token.label ? `${token.label} · ` : ""}
                {token.status === "active"
                  ? `expires ${new Date(token.expiresAt).toLocaleDateString()}`
                  : token.status}
              </p>
            </div>
            {token.status === "active" && (
              <button
                type="button"
                className="text-sm text-slate-400 hover:text-rose-600"
                disabled={busy === token.id}
                onClick={() => remove(token.id)}
              >
                {busy === token.id ? "Removing…" : "Remove"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        Removing a wallet also cancels any subscription billed to it.
      </p>
    </div>
  );
}
