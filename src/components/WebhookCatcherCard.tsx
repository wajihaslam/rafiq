"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Shows the absolute webhook-catcher URL and lets an admin copy it or fire a
 * test call at it. The URL is resolved on the server from the incoming request,
 * so what is shown is genuinely the address the sender should use — including
 * behind a tunnel or a preview deployment.
 */
export function WebhookCatcherCard({ url }: { url: string }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Copied to the clipboard.");
    } catch {
      setNotice("Could not copy — select the URL above instead.");
    }
  }

  async function sendTest() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`${url}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "settings-page",
          sentAt: new Date().toISOString(),
          note: "Test payload from the Configuration page.",
        }),
      });
      setNotice(
        response.ok
          ? "Test webhook delivered — it is now in the API call log."
          : `The catcher answered HTTP ${response.status}.`,
      );
    } catch (error) {
      setNotice(`Could not reach the catcher: ${String(error)}`);
    }
    setBusy(false);
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-medium">Webhook catcher</h2>
        <p className="mt-1 text-sm text-slate-500">
          Give this URL to anyone who needs somewhere to send a webhook. It
          accepts any method and any body, records the whole thing in the{" "}
          <Link href="/logs" className="underline">
            API call log
          </Link>
          , and answers <code>200</code> with a success message.
        </p>
      </div>

      <code className="block break-all rounded-lg bg-slate-50 px-3 py-2.5 font-mono text-sm dark:bg-slate-950">
        {url}
      </code>

      <p className="text-xs text-slate-500">
        Any sub-path works too — <code>{url}/easypaisa</code> is caught as well
        and logged under its own name, so several senders can be told apart.
      </p>

      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost" onClick={copy}>
          Copy URL
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={sendTest}>
          {busy ? "Sending…" : "Send a test webhook"}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        This endpoint is unauthenticated and has no side effects — it never
        settles an order. Real gateway settlement still goes to{" "}
        <code>/api/collection/postback</code>, which checks the shared secret.
      </p>
    </section>
  );
}
