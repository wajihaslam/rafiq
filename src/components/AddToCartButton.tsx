"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function AddToCartButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "added" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function add() {
    setState("idle");
    setMessage(null);
    const response = await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, qty: 1 }),
    });

    if (response.status === 401) {
      router.push(`/login?next=/cart`);
      return;
    }

    const payload = await response.json();
    if (!payload.ok) {
      setState("error");
      setMessage(payload.message ?? "Could not add to cart.");
      return;
    }
    setState("added");
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn-primary" disabled={pending} onClick={add}>
        {state === "added" ? "Added ✓" : "Add to cart"}
      </button>
      {message && <span className="text-xs text-rose-600">{message}</span>}
    </div>
  );
}
