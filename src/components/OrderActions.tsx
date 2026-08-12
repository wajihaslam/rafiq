"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { OrderStatus } from "@/lib/db-types";

/**
 * The two things you can still do to a payment once it has been made: ask the
 * gateway what became of it, and give the money back.
 *
 * Each button is enabled by the order's own status, and a disabled one says why
 * rather than merely refusing. The rule they encode is the one from §6: a
 * pending order is resolved by *inquiry*, never by paying again — so there is
 * deliberately no "retry" here.
 */
export function OrderActions({
  orderId,
  status,
  amount,
  compact = false,
}: {
  orderId: string;
  status: OrderStatus;
  /** Enables a partial refund. Omitted means the refund box is full-amount only. */
  amount?: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [partial, setPartial] = useState("");
  const [result, setResult] = useState<{
    tone: "info" | "error" | "good";
    text: string;
  } | null>(null);

  const canInquire = status === "pending" && !busy;
  const canRefund = status === "paid" && !busy;

  async function run(
    action: "inquire" | "refund",
    body?: Record<string, unknown>,
  ) {
    setBusy(action);
    setResult(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/${action}`, {
        method: "POST",
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const payload = await response.json();

      if (!payload.ok) {
        // An indeterminate answer is not a failure — money may have moved.
        setResult({
          tone: payload.indeterminate ? "info" : "error",
          text: payload.message ?? "That did not work.",
        });
        return;
      }

      const outcome = payload.data.outcome as string;
      setResult({
        tone:
          outcome === "failure" ? "error" : outcome === "success" ? "good" : "info",
        text: `${payload.data.code} · ${payload.data.gatewayMessage} — ${payload.data.orderStatus.replace(/_/g, " ")}`,
      });
      setRefunding(false);
      router.refresh();
    } catch {
      setResult({
        tone: "info",
        text: "We couldn't reach the gateway. Nothing has changed here.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={compact ? "space-y-1.5" : "space-y-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-ghost"
          disabled={!canInquire}
          onClick={(event) => {
            // A row may sit inside a link to the payment; acting must not
            // navigate away from the list.
            event.preventDefault();
            event.stopPropagation();
            void run("inquire");
          }}
          title={
            canInquire
              ? "Ask the gateway what became of this payment."
              : status === "pending"
                ? undefined
                : "Only an unsettled payment needs an inquiry."
          }
        >
          {busy === "inquire" ? "Inquiring…" : "Inquire"}
        </button>

        <button
          type="button"
          className="btn-ghost text-rose-600"
          disabled={!canRefund}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (amount === undefined) {
              void run("refund");
              return;
            }
            setRefunding((open) => !open);
            setResult(null);
          }}
          title={
            canRefund
              ? "Refund this payment."
              : status === "refund_submitted" || status === "refunded"
                ? "This payment has already been refunded."
                : "Only a settled payment can be refunded."
          }
        >
          {busy === "refund" ? "Refunding…" : "Refund"}
        </button>
      </div>

      {refunding && amount !== undefined && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
          <div className="min-w-40 flex-1">
            <label className="label" htmlFor={`refund-${orderId}`}>
              Amount (PKR){" "}
              <span className="font-normal text-slate-400">
                — blank refunds all {amount}
              </span>
            </label>
            <input
              id={`refund-${orderId}`}
              className="input"
              inputMode="decimal"
              value={partial}
              onChange={(e) => setPartial(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={String(amount)}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={busy === "refund"}
            onClick={() => {
              const value = Number(partial);
              void run(
                "refund",
                partial.trim() === "" || !Number.isFinite(value)
                  ? undefined
                  : { amount: value },
              );
            }}
          >
            {busy === "refund" ? "Refunding…" : "Submit refund"}
          </button>
        </div>
      )}

      {result && (
        <p
          className={`rounded-lg px-3 py-2 text-xs tabular-nums ${
            result.tone === "error"
              ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
              : result.tone === "good"
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          }`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
