-- ===========================================================================
-- Rafiq — runtime gateway configuration
--
-- Merchant id, flow and Payment API base URL move out of the environment and
-- into a single editable row, so switching MID or pointing at a different
-- gateway host no longer needs a redeploy. Env stays the fallback: an empty
-- table behaves exactly like before this migration.
-- ===========================================================================

-- Who may edit that row. Deliberately a column and not a Supabase role: this
-- is app-level authorisation, and RLS below reads it.
alter table profiles add column is_admin boolean not null default false;

create table gateway_settings (
  -- One row, forever. The check is what makes that true.
  id          boolean primary key default true check (id),

  -- null on any column means "keep using the environment value".
  merchant_id text check (merchant_id is null or merchant_id ~ '^\d{7}$'),
  -- 'otp' | 'non_otp'. Must match how the MID was provisioned — the other
  -- flow's sequence answers 0015 Invalid-Flow.
  flow        text check (flow is null or flow in ('otp','non_otp')),
  -- Base URL WITHOUT the gateway prefix, e.g. https://gateway.example.com
  base_url    text check (base_url is null or base_url ~ '^https?://'),

  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

create trigger gateway_settings_touch before update on gateway_settings
  for each row execute function touch_updated_at();

alter table gateway_settings enable row level security;

-- Readable by admins so the settings page can render without the secret key;
-- writes go through the server (service role), which also validates the values
-- against the same rules the gateway enforces.
create policy gateway_settings_read_admin on gateway_settings
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );

-- Seed the singleton with all-null so the settings page always has a row to
-- show; every column falls back to the environment until someone fills it in.
insert into gateway_settings (id) values (true) on conflict (id) do nothing;
