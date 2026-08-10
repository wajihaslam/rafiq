"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OPERATOR_LABELS } from "@/lib/collection/types";

interface Wallet {
  id: string;
  operatorId: string;
  msisdn: string;
  label: string | null;
}

export function SubscribeButton({
  productId,
  wallets,
}: {
  productId: string;
  wallets: Wallet[];
}) {
  const router = useRouter();
  const [tokenId, setTokenId] = useState(wallets[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(
    null,
  );

  if (wallets.length === 0) return null;

  async function subscribe() {
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, paymentTokenId: tokenId }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!payload.ok) {
      setNotice({
        tone: payload.indeterminate ? "info" : "error",
        text: payload.message,
      });
      return;
    }

    // The first period is charged immediately. An indeterminate outcome leaves
    // the subscription in place and the order resolving on its own.
    if (payload.data.outcome === "failure") {
      setNotice({ tone: "error", text: payload.data.message });
      router.refresh();
      return;
    }

    if (payload.data.orderId) {
      router.push(`/orders/${payload.data.orderId}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {wallets.length > 1 && (
        <select
          className="input"
          value={tokenId}
          onChange={(e) => setTokenId(e.target.value)}
        >
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {OPERATOR_LABELS[w.operatorId as "100007" | "100008"]} · {w.msisdn}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="btn-primary w-fit"
        disabled={busy || !tokenId}
        onClick={subscribe}
      >
        {busy ? "Starting…" : "Subscribe"}
      </button>
      {notice && (
        <p
          className={`text-sm ${
            notice.tone === "error" ? "text-rose-600" : "text-amber-700"
          }`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
