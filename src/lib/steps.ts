/**
 * The step model behind every breadcrumb in the app.
 *
 * Two sequences exist and they are not variations of one another — they run
 * under different merchants, mint different things and fail in different ways:
 *
 *   One-time payment   OTP flow      initiate → verify → inquire → refund
 *                      Non-OTP flow  verify → inquire → refund
 *   Tokenization       link          initiate → verify → direct payment → refund
 *
 * The tokenization sequence has one deliberate asymmetry: **however many direct
 * payments a token takes, they are one step.** A saved wallet charged forty
 * times has not travelled forty steps — it reached "charged" once and stayed
 * there. The count is carried alongside the step instead, as a tally.
 *
 * Nothing here touches the database or React; both the server pages and the
 * client panels derive their breadcrumbs from the same function so a step
 * cannot read as done in one place and pending in another.
 */

import type { TxnOperation } from "@/lib/db-types";

export type StepState = "done" | "current" | "todo" | "unavailable";

export interface Step {
  /** Stable id, matching the gateway operation where there is one. */
  id: TxnOperation;
  label: string;
  state: StepState;
  /** Shown as "×3" — only ever set on a step that legitimately repeats. */
  count?: number;
  /** Why a step cannot be taken, when it is `unavailable`. */
  note?: string;
}

export type Flow = "otp" | "non_otp";

/** What a one-time payment's breadcrumb looks like before anything has run. */
export function oneTimeStepLabels(flow: Flow): { id: TxnOperation; label: string }[] {
  return [
    ...(flow === "otp"
      ? [{ id: "initiate" as const, label: "Initiate" }]
      : []),
    { id: "verify" as const, label: "Verify" },
    { id: "inquiry" as const, label: "Inquire" },
    { id: "refund" as const, label: "Refund" },
  ];
}

export interface OneTimeProgress {
  flow: Flow;
  /** Operations recorded against the order, in the order they happened. */
  operations: TxnOperation[];
  /** Where the order stands now — refund availability hangs off this. */
  orderStatus: string;
}

/**
 * The breadcrumb for one one-time payment.
 *
 * `current` is the first step not yet done, so a payment always shows exactly
 * one place to be. Refund is `unavailable` rather than `todo` until the order
 * is paid: it is not the next thing to do, it is a thing that cannot be done —
 * and a breadcrumb that fails to say so invites a click that 409s.
 */
export function oneTimeSteps({
  flow,
  operations,
  orderStatus,
}: OneTimeProgress): Step[] {
  const done = new Set(operations);
  const refunded =
    orderStatus === "refund_submitted" || orderStatus === "refunded";
  const settled = orderStatus === "paid" || refunded;

  const steps: Step[] = oneTimeStepLabels(flow).map(({ id, label }) => {
    if (id === "refund") {
      return {
        id,
        label,
        state: refunded ? "done" : settled ? "todo" : "unavailable",
        note: settled ? undefined : "Available once the payment has settled.",
      };
    }
    // An inquiry counts as taken once the order has an outcome, however it
    // arrived — a postback settles an order without anyone pressing Inquire,
    // and showing that step as outstanding afterwards would be a lie.
    const taken =
      done.has(id) ||
      (id === "inquiry" && (settled || orderStatus === "failed"));
    return { id, label, state: taken ? "done" : "todo" };
  });

  return markCurrent(steps);
}

export interface TokenProgress {
  /** A link was started — the registration row exists. */
  initiated: boolean;
  /** The OTP was verified (or the hosted registration finalized): a token exists. */
  verified: boolean;
  /** How many direct payments this token has taken. All of them are one step. */
  charges: number;
  /** How many of those have been refunded. */
  refunds: number;
  /** A delinked or expired token can take no further step. */
  live: boolean;
}

/**
 * The breadcrumb for one linked wallet.
 *
 * Note what is *not* here: delink. Retiring a token is not a step along the
 * sequence, it is the end of it — putting it in the breadcrumb would suggest a
 * wallet is unfinished until you have thrown it away.
 */
export function tokenSteps({
  initiated,
  verified,
  charges,
  refunds,
  live,
}: TokenProgress): Step[] {
  const steps: Step[] = [
    { id: "initiate", label: "Initiate", state: initiated ? "done" : "todo" },
    { id: "verify", label: "Verify", state: verified ? "done" : "todo" },
    {
      id: "direct_payment",
      label: "Direct payment",
      // However many charges, one step: the token reached "charged" once.
      state: charges > 0 ? "done" : verified && live ? "todo" : "unavailable",
      count: charges > 0 ? charges : undefined,
      note:
        charges === 0 && !verified
          ? "Verify the wallet first."
          : charges === 0 && !live
            ? "This wallet is no longer usable."
            : undefined,
    },
    {
      id: "refund",
      label: "Refund",
      state: refunds > 0 ? "done" : charges > 0 ? "todo" : "unavailable",
      count: refunds > 0 ? refunds : undefined,
      note: charges === 0 ? "Available once this wallet has been charged." : undefined,
    },
  ];

  return markCurrent(steps);
}

/** The first step that is merely `todo` becomes `current`. */
function markCurrent(steps: Step[]): Step[] {
  const at = steps.findIndex((s) => s.state === "todo");
  if (at === -1) return steps;
  return steps.map((s, i) => (i === at ? { ...s, state: "current" } : s));
}
