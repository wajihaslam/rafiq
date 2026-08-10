"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatPkr } from "@/components/Money";

interface Line {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
}

export function CartLines({ items }: { items: Line[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function setQty(productId: string, qty: number) {
    setBusy(productId);
    await fetch("/api/cart", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, qty }),
    });
    setBusy(null);
    router.refresh();
  }

  return (
    <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
      {items.map((item) => (
        <li key={item.productId} className="flex items-center gap-4 p-4">
          <div className="flex-1">
            <p className="font-medium">{item.name}</p>
            <p className="text-sm text-slate-500">
              {formatPkr(item.unitPrice)} each
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost h-9 w-9 px-0!"
              disabled={busy === item.productId}
              aria-label={`Decrease quantity of ${item.name}`}
              onClick={() => setQty(item.productId, item.qty - 1)}
            >
              −
            </button>
            <span className="w-8 text-center tabular-nums">{item.qty}</span>
            <button
              type="button"
              className="btn-ghost h-9 w-9 px-0!"
              disabled={busy === item.productId || item.qty >= 99}
              aria-label={`Increase quantity of ${item.name}`}
              onClick={() => setQty(item.productId, item.qty + 1)}
            >
              +
            </button>
          </div>

          <div className="w-28 text-right font-medium tabular-nums">
            {formatPkr(item.unitPrice * item.qty)}
          </div>

          <button
            type="button"
            className="text-sm text-slate-400 hover:text-rose-600"
            disabled={busy === item.productId}
            onClick={() => setQty(item.productId, 0)}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
