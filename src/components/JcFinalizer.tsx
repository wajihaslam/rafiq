"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Redeems a JazzCash registration for a sourceId. `0037` means the customer's
 * consent is still in flight, so we retry a few times before giving up —
 * finalize returns the same token every time, so retrying cannot mint two.
 */
const RETRY_DELAYS_MS = [2000, 4000, 7000];

export function JcFinalizer({
  orderRef,
  redirectStatus,
}: {
  orderRef: string;
  redirectStatus: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"working" | "linked" | "failed">("working");
  const [message, setMessage] = useState("Finishing up…");
  const attempt = useRef(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;

    async function run() {
      while (!cancelled) {
        const response = await fetch("/api/wallets/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderRef }),
        });
        const payload = await response.json();

        if (payload.ok && payload.data.linked) {
          setState("linked");
          setMessage("Wallet linked.");
          router.refresh();
          return;
        }

        const code = payload.ok ? payload.data.code : payload.code;
        const consentPending = code === "0037" || payload.indeterminate;

        if (!consentPending || attempt.current >= RETRY_DELAYS_MS.length) {
          setState(consentPending ? "working" : "failed");
          setMessage(
            consentPending
              ? "Your consent is still being confirmed. Check back on the wallets page in a moment."
              : (payload.ok ? payload.data.message : payload.message),
          );
          return;
        }

        const delay = RETRY_DELAYS_MS[attempt.current]!;
        attempt.current += 1;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [orderRef, router]);

  return (
    <div className="card space-y-3 text-sm">
      <p
        className={
          state === "failed"
            ? "text-rose-600"
            : state === "linked"
              ? "text-emerald-600"
              : "text-slate-500"
        }
      >
        {message}
      </p>
      {redirectStatus && state !== "linked" && (
        <p className="text-xs text-slate-400">Gateway status {redirectStatus}</p>
      )}
      {state !== "working" && (
        <Link href="/wallets" className="btn-primary w-fit">
          Back to wallets
        </Link>
      )}
    </div>
  );
}
