"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Runs an inquiry against one order and refreshes the page.
 *
 * Since initiate and verify now leave every non-failed order `pending`, inquiry
 * is what actually settles it — so the control belongs anywhere a pending order
 * is listed, not only on its detail page. This is the bare button; the detail
 * page wraps the same call in `OrderResolver`, which also polls.
 */
export function InquireButton({
  orderId,
  className = "btn-ghost",
}: {
  orderId: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async (event) => {
          // The row around this button is a link to the order; inquiring must
          // not navigate away from the list.
          event.preventDefault();
          event.stopPropagation();

          setBusy(true);
          setResult(null);
          try {
            const response = await fetch(`/api/orders/${orderId}/inquire`, {
              method: "POST",
            });
            const payload = await response.json();

            if (!payload.ok) {
              setResult(payload.message ?? "Inquiry failed.");
              return;
            }
            setResult(`${payload.data.code} · ${payload.data.orderStatus}`);
            router.refresh();
          } catch {
            setResult("Couldn't reach the gateway.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Inquiring…" : "Inquire"}
      </button>
      {result && (
        <span className="text-xs tabular-nums text-slate-500">{result}</span>
      )}
    </span>
  );
}
