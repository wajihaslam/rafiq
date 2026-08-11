-- ===========================================================================
-- Rafiq — API call log
--
-- Every HTTP conversation this app takes part in, in one table:
--   'outbound' — a call we made to the Collection gateway
--   'inbound'  — a call something made to us (the webhook catcher, postbacks)
--
-- This is a diagnostic trail, not an audit trail: `transactions` remains the
-- record of what happened to money. Logging is therefore best-effort and must
-- never fail a payment — see `@/lib/api-logs`.
-- ===========================================================================

create type api_log_direction as enum ('outbound', 'inbound');

create table api_logs (
  id               uuid primary key default gen_random_uuid(),

  direction        api_log_direction not null,
  -- Short operation name, e.g. 'collection.initiate' or 'webhook.catch'.
  -- Grouping by this is the fastest way to answer "is delink broken?".
  label            text not null,

  method           text not null,
  url              text not null,

  -- Headers and bodies are stored redacted; see REDACTED_KEYS in the library.
  -- A body that is not JSON is wrapped as {"raw": "..."} so the column stays
  -- jsonb and the viewer has exactly one shape to render.
  request_headers  jsonb,
  request_body     jsonb,
  response_headers jsonb,
  response_body    jsonb,

  -- HTTP status. Null when the request never completed (see `error`).
  status_code      int,
  -- The gateway's own code from the body (`status`), which is where the real
  -- outcome lives — wallet endpoints answer HTTP 200 even when they decline.
  gateway_code     text,
  -- classify(gateway_code): 'success' | 'failure' | 'pending' | 'indeterminate'
  outcome          text,

  -- The Request-Id header we sent, so a log line can be quoted to the gateway.
  request_id       text,
  duration_ms      int,
  -- Transport failure or handler exception. Present iff the call did not
  -- produce a usable response.
  error            text,

  -- Who triggered it, when there was a session. Null for cron and webhooks.
  user_id          uuid references auth.users(id) on delete set null,

  created_at       timestamptz not null default now()
);

-- The viewer is "newest first, optionally filtered"; these cover both.
create index api_logs_created_at_idx on api_logs (created_at desc);
create index api_logs_direction_idx  on api_logs (direction, created_at desc);
create index api_logs_label_idx      on api_logs (label, created_at desc);

alter table api_logs enable row level security;

-- Admins only: request bodies carry msisdns and source tokens. Writes go
-- through the service role, so there is deliberately no insert policy.
create policy api_logs_read_admin on api_logs
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ---------------------------------------------------------------------------
-- Default the Payment API base URL, so a fresh install points somewhere real
-- instead of refusing every call. Overridable from /settings at any time.
-- ---------------------------------------------------------------------------
update gateway_settings
   set base_url = 'http://3.127.43.66:8001'
 where id and base_url is null;
