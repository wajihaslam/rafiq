"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Resolves a pending order by inquiry (guide §6) — the *only* correct response
 * to an indeterminate code. It never re-sends the payment.
 *
 * Initiate and verify deliberately leave every non-failed order pending, so
 * inquiry is what actually settles an order: the button below is the customer's
 * (and the tester's) way to run it on demand, alongside the background poll.
 *
 * The poll widens its interval and gives up after a bounded number of attempts —
 * an order can legitimately sit pending for longer than a page visit, and the
 * postback will settle it regardless.
 */
const DELAYS_MS = [3000, 5000, 8000, 13000, 21000];

export function OrderResolver({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/inquire`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!payload.ok) {
        setLastResult(payload.message ?? "The inquiry could not be completed.");
        return false;
      }

      setLastResult(
        `${payload.data.code} · ${payload.data.gatewayMessage} — order ${payload.data.orderStatus}`,
      );

      if (payload.data.orderStatus !== "pending") {
        router.refresh();
        return true;
      }
    } catch {
      // A failed inquiry tells us nothing new; the next attempt or the postback
      // will. Deliberately silent apart from the notice above.
      setLastResult("We couldn't reach the gateway. Please try again.");
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

      {lastResult && (
        <p className="mt-2 tabular-nums opacity-80">Last inquiry: {lastResult}</p>
      )}

      <button
        type="button"
        className="btn-ghost mt-3"
        disabled={checking}
        onClick={async () => {
          const settled = await check();
          // A manual inquiry that came back pending restarts the background
          // poll, so the page keeps watching from here.
          if (!settled) {
            setExhausted(false);
            setAttempt(0);
          }
        }}
      >
        {checking ? "Inquiring…" : exhausted ? "Inquire again" : "Inquire now"}
      </button>
    </div>
  );
}
