"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatPkr } from "@/components/Money";
import type { SubStatus } from "@/lib/db-types";

interface Row {
  id: string;
  name: string;
  amount: number;
  intervalDays: number;
  status: SubStatus;
  nextChargeAt: string;
  walletMsisdn: string | null;
}

const STATUS_COPY: Record<SubStatus, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
  // past_due is where a dead token or repeated declines land it — the customer
  // has to fix the wallet, not just wait.
  past_due: "Payment problem",
};

export function MySubscriptions({ subscriptions }: { subscriptions: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "pause" | "resume" | "cancel") {
    setBusy(id);
    await fetch(`/api/subscriptions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="space-y-2">
      <h2 className="font-medium">Your subscriptions</h2>
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {subscriptions.map((sub) => (
          <li key={sub.id} className="flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-48 flex-1">
              <p className="font-medium">{sub.name}</p>
              <p className="text-sm text-slate-500">
                {formatPkr(sub.amount)} every {sub.intervalDays} days
                {sub.walletMsisdn ? ` · ${sub.walletMsisdn}` : ""}
              </p>
            </div>

            <div className="text-sm text-slate-500">
              <p>{STATUS_COPY[sub.status]}</p>
              {sub.status === "active" && (
                <p>Next: {new Date(sub.nextChargeAt).toLocaleDateString()}</p>
              )}
            </div>

            <div className="flex gap-2">
              {sub.status === "active" && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy === sub.id}
                  onClick={() => act(sub.id, "pause")}
                >
                  Pause
                </button>
              )}
              {(sub.status === "paused" || sub.status === "past_due") && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy === sub.id}
                  onClick={() => act(sub.id, "resume")}
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                className="text-sm text-slate-400 hover:text-rose-600"
                disabled={busy === sub.id}
                onClick={() => act(sub.id, "cancel")}
              >
                Cancel
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
