import Link from "next/link";
import { redirect } from "next/navigation";

import { ApiLogControls } from "@/components/ApiLogControls";
import { ApiLogEntry } from "@/components/ApiLogEntry";
import { listApiLogLabels, listApiLogs, type ApiLogDirection } from "@/lib/api-logs";
import { getCurrentUser, isAdmin } from "@/lib/supabase/server";

/** A log that is a page-cache behind is worse than no log. */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/logs");
  if (!(await isAdmin(user.id))) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">API call log</h1>
        <p className="mt-2 text-sm text-slate-500">
          This page is limited to administrators. Ask one to set{" "}
          <code>profiles.is_admin</code> for your account.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const directionParam = one(params.direction);
  const direction =
    directionParam === "outbound" || directionParam === "inbound"
      ? (directionParam as ApiLogDirection)
      : undefined;
  const label = one(params.label) || undefined;
  const search = one(params.q) || undefined;
  const transactionId = one(params.txn) || undefined;
  const userKey = one(params.userKey) || undefined;
  const page = Math.max(Number(one(params.page)) || 1, 1);

  const [{ rows, total }, labels] = await Promise.all([
    listApiLogs({
      direction,
      label,
      search,
      transactionId,
      userKey,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    listApiLogLabels(),
  ]);

  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  /** Preserves the current filters while changing one of them. */
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = {
      direction: directionParam,
      label,
      q: search,
      txn: transactionId,
      userKey,
      ...patch,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    const query = next.toString();
    return query ? `/logs?${query}` : "/logs";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API call log</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every request this app sends to the Collection gateway, and every
          webhook sent to us — the catcher, the postback endpoint and the
          gateway&apos;s return URLs alike. Newest first, searchable by
          transaction id and user key.{" "}
          <Link href="/settings" className="underline">
            Configuration
          </Link>{" "}
          has the catcher URL.
        </p>
      </div>

      <div className="card space-y-4">
        <form className="flex flex-wrap items-end gap-3" action="/logs">
          <div className="min-w-56 flex-1">
            <label className="label" htmlFor="log-q">
              Search
            </label>
            <input
              id="log-q"
              name="q"
              className="input"
              defaultValue={search ?? ""}
              placeholder="URL, operation, code, transaction id or user key"
            />
          </div>

          {/* The two exact fields sit alongside the free-text box rather than
              replacing it: a transaction id quoted by the gateway is worth
              matching exactly, but pasting one into "Search" should still work. */}
          <div>
            <label className="label" htmlFor="log-txn">
              Transaction ID
            </label>
            <input
              id="log-txn"
              name="txn"
              className="input"
              defaultValue={transactionId ?? ""}
              placeholder="95190001"
            />
          </div>

          <div>
            <label className="label" htmlFor="log-user-key">
              User key
            </label>
            <input
              id="log-user-key"
              name="userKey"
              className="input"
              defaultValue={userKey ?? ""}
              placeholder="RFQ-0123456789A"
            />
          </div>

          <div>
            <label className="label" htmlFor="log-direction">
              Direction
            </label>
            <select
              id="log-direction"
              name="direction"
              className="input"
              defaultValue={directionParam}
            >
              <option value="">All</option>
              <option value="outbound">Outbound — we called them</option>
              <option value="inbound">Inbound — they called us</option>
            </select>
          </div>

          <div>
            <label className="label" htmlFor="log-label">
              Operation
            </label>
            <select
              id="log-label"
              name="label"
              className="input"
              defaultValue={label ?? ""}
            >
              <option value="">All</option>
              {labels.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-primary">
            Apply
          </button>
          {(direction || label || search || transactionId || userKey) && (
            <Link href="/logs" className="btn-ghost">
              Reset
            </Link>
          )}
        </form>

        {/* One click for the question asked most often of this page: "did they
            call us at all?" */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Quick view</span>
          <Link
            href="/logs?direction=inbound"
            className={direction === "inbound" ? "btn-primary" : "btn-ghost"}
          >
            Webhooks received
          </Link>
          <Link
            href="/logs?direction=outbound"
            className={direction === "outbound" ? "btn-primary" : "btn-ghost"}
          >
            Calls we made
          </Link>
        </div>

        <ApiLogControls total={total} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            {total === 0 &&
            !direction &&
            !label &&
            !search &&
            !transactionId &&
            !userKey
              ? "Nothing logged yet. Make a payment, or POST to the webhook catcher URL on the Configuration page."
              : "No calls match these filters."}
          </p>
        ) : (
          rows.map((row) => <ApiLogEntry key={row.id} row={row} />)
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>
          {total} call{total === 1 ? "" : "s"} · page {page} of {pages}
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link className="btn-ghost" href={href({ page: String(page - 1) })}>
              Newer
            </Link>
          )}
          {page < pages && (
            <Link className="btn-ghost" href={href({ page: String(page + 1) })}>
              Older
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
