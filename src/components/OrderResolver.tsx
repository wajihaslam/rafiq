"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Resolves a pending order by inquiry (guide §6) — the *only* correct response
 * to an indeterminate code. It never re-sends the payment.
 *
 * Polls with a widening interval and gives up after a bounded number of
 * attempts, leaving a manual button: an order can legitimately sit pending for
 * longer than a page visit, and the postback will settle it regardless.
 */
const DELAYS_MS = [3000, 5000, 8000, 13000, 21000];

export function OrderResolver({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/inquire`, {
        method: "POST",
      });
      const payload = await response.json();
      if (payload.ok && payload.data.orderStatus !== "pending") {
        router.refresh();
        return true;
      }
    } catch {
      // A failed inquiry tells us nothing new; the next attempt or the postback
      // will. Deliberately silent.
    } finally {
      setChecking(false);
    }
    return false;
  }, [orderId, router]);

  useEffect(() => {
    if (attempt >= DELAYS_MS.length) {
      setExhausted(true);
      return;
    }
    timer.current = setTimeout(async () => {
      const settled = await check();
      if (!settled) setAttempt((a) => a + 1);
    }, DELAYS_MS[attempt]);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [attempt, check]);

  return (
    <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
      <p>
        We&apos;re confirming this payment with the operator. Don&apos;t pay again —
        this page updates itself, and we&apos;ll settle the order as soon as we hear
        back.
      </p>
      {exhausted && (
        <button
          type="button"
          className="btn-ghost mt-3"
          disabled={checking}
          onClick={async () => {
            const settled = await check();
            if (!settled) setAttempt(0);
          }}
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      )}
    </div>
  );
}
