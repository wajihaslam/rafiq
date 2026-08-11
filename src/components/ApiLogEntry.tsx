import type { ApiLogRow } from "@/lib/api-logs";

/**
 * One row of the API call log, collapsed to a summary line and expanding to the
 * full request and response. Native <details> rather than React state: the list
 * is a server component, and several entries are usually open at once while
 * comparing a failed call with a working one.
 */

const OUTCOME_STYLES: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  failure: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  indeterminate: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
};

const NEUTRAL = "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${className ?? NEUTRAL}`}
    >
      {children}
    </span>
  );
}

function Block({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0">
      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </h4>
      <pre className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed dark:bg-slate-950">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function ApiLogEntry({ row }: { row: ApiLogRow }) {
  const failed = row.error !== null || (row.status_code !== null && row.status_code >= 400);
  const outcomeStyle = row.outcome ? OUTCOME_STYLES[row.outcome] : undefined;

  return (
    <details className="group border-b border-slate-200 last:border-b-0 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <Pill
          className={
            row.direction === "inbound"
              ? "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
              : "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
          }
        >
          {row.direction === "inbound" ? "↓ in" : "↑ out"}
        </Pill>

        <span className="font-mono text-xs text-slate-500">{row.method}</span>
        <span className="text-sm font-medium">{row.label}</span>

        {row.gateway_code && (
          <Pill className={outcomeStyle}>{row.gateway_code}</Pill>
        )}
        {!row.gateway_code && row.outcome && (
          <Pill className={outcomeStyle}>{row.outcome}</Pill>
        )}
        {row.status_code !== null && (
          <span
            className={`font-mono text-xs ${failed ? "text-rose-600 dark:text-rose-400" : "text-slate-500"}`}
          >
            HTTP {row.status_code}
          </span>
        )}
        {row.error && (
          <Pill className={OUTCOME_STYLES.failure}>error</Pill>
        )}

        <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
          {row.duration_ms !== null && <span>{row.duration_ms} ms</span>}
          <time dateTime={row.created_at}>
            {new Date(row.created_at).toLocaleString()}
          </time>
        </span>
      </summary>

      <div className="space-y-4 border-t border-slate-100 px-4 py-4 dark:border-slate-800">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-slate-500">URL</dt>
          <dd className="break-all font-mono">{row.url}</dd>
          {row.request_id && (
            <>
              <dt className="text-slate-500">Request-Id</dt>
              <dd className="font-mono">{row.request_id}</dd>
            </>
          )}
          <dt className="text-slate-500">Log entry</dt>
          <dd className="font-mono">{row.id}</dd>
        </dl>

        {row.error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
            {row.error}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Block title="Request headers" value={row.request_headers} />
          <Block title="Response headers" value={row.response_headers} />
          <Block title="Request body" value={row.request_body} />
          <Block title="Response body" value={row.response_body} />
        </div>

        <p className="text-xs text-slate-500">
          Keys that look like secrets (key, token, signature, OTP, authorization)
          are stored redacted, so this is the whole of what was kept.
        </p>
      </div>
    </details>
  );
}
