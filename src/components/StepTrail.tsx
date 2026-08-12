import type { Step } from "@/lib/steps";

/**
 * Renders a step sequence. Deliberately a plain server component with no state
 * of its own: the steps are computed in one place (`@/lib/steps`) and this only
 * draws them, so a breadcrumb can never disagree with the buttons beside it.
 *
 * Four states, four readings:
 *   done         ✓ — it happened
 *   current      • — this is where you are
 *   todo           — you can get here
 *   unavailable  – — you cannot, and the title says why
 */
const STYLES: Record<Step["state"], string> = {
  done: "border-emerald-500/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  // brand only has 50/100/500/600/700 defined, so the dark side borrows 100.
  current:
    "border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-100",
  todo: "border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400",
  unavailable:
    "border-dashed border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-600",
};

const MARKS: Record<Step["state"], string> = {
  done: "✓",
  current: "•",
  todo: "",
  unavailable: "–",
};

export function StepTrail({
  steps,
  className = "",
}: {
  steps: Step[];
  className?: string;
}) {
  return (
    <ol className={`flex flex-wrap items-center gap-1.5 text-xs ${className}`}>
      {steps.map((step, i) => (
        <li key={step.id} className="flex items-center gap-1.5">
          <span
            title={step.note}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 ${STYLES[step.state]}`}
          >
            {MARKS[step.state] && (
              <span aria-hidden className="text-[10px]">
                {MARKS[step.state]}
              </span>
            )}
            {step.label}
            {step.count !== undefined && step.count > 1 && (
              <span
                className="rounded bg-white/70 px-1 text-[10px] tabular-nums dark:bg-black/30"
                // A tally, not a step count — say so, since "×12" next to a
                // sequence otherwise reads as twelve steps.
                title={`${step.count} charges, counted as one step`}
              >
                ×{step.count}
              </span>
            )}
          </span>
          {i < steps.length - 1 && (
            <span aria-hidden className="text-slate-300 dark:text-slate-700">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
