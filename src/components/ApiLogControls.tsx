"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The bits of the log viewer that cannot be a server render: manual refresh,
 * a polling toggle for watching a call arrive live, and clearing the log.
 *
 * Refreshing is `router.refresh()` rather than a client-side fetch, so the list
 * keeps being rendered on the server and there is only one query in one place.
 */
export function ApiLogControls({ total }: { total: number }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [live, router]);

  async function clear() {
    if (!confirm(`Delete all ${total} logged calls? This cannot be undone.`)) return;
    setBusy(true);
    await fetch("/api/logs", { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-ghost" onClick={() => router.refresh()}>
        Refresh
      </button>

      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={live}
          onChange={(e) => setLive(e.target.checked)}
        />
        Auto-refresh every 5s
      </label>

      <button
        type="button"
        className="btn-ghost ml-auto text-rose-700 dark:text-rose-400"
        disabled={busy || total === 0}
        onClick={clear}
      >
        {busy ? "Clearing…" : "Clear log"}
      </button>
    </div>
  );
}
