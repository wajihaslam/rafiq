-- ===========================================================================
-- Rafiq — one-paste setup for a fresh Supabase project.
--
-- Paste this whole file into the Supabase SQL editor and run it. It is the
-- concatenation of every file in migrations/ (in order) followed by seed.sql,
-- generated for convenience — those files remain the source of truth, so edit
-- them and regenerate rather than editing this one.
-- ===========================================================================
-- >>> migrations/0001_init.sql

-- ===========================================================================
-- Rafiq — Stage 1 (Collection): shopping cart + subscriptions/tokenization
-- ===========================================================================

create extension if not exists "pgcrypto";

-- --- enums -----------------------------------------------------------------
create type product_kind   as enum ('one_time', 'subscription');
create type order_status    as enum ('pending','paid','failed','cancelled','refund_submitted','refunded');
create type token_status    as enum ('active','delinked','expired');
create type sub_status      as enum ('active','paused','cancelled','past_due');
create type txn_kind        as enum ('payment','tokenization','direct_payment','refund','delink');

-- --- profiles --------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  -- national significant digits are what the gateway compares on; store as
  -- entered and normalise at call time.
  msisdn      text check (msisdn is null or msisdn ~ '^0?3\d{9}$'),
  created_at  timestamptz not null default now()
);

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- --- catalogue -------------------------------------------------------------
create table products (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  description   text,
  image_url     text,
  -- PKR, 2 decimals max: the gateway rejects more (0002 Invalid-Product/Amount)
  price         numeric(12,2) not null check (price > 0),
  kind          product_kind not null default 'one_time',
  -- billing period for kind = 'subscription'
  interval_days int check (interval_days is null or interval_days > 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint subscription_needs_interval
    check (kind <> 'subscription' or interval_days is not null)
);

-- --- cart ------------------------------------------------------------------
create table carts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'open' check (status in ('open','ordered','abandoned')),
  created_at timestamptz not null default now()
);
-- at most one open cart per user
create unique index carts_one_open_per_user on carts (user_id) where status = 'open';

create table cart_items (
  id         uuid primary key default gen_random_uuid(),
  cart_id    uuid not null references carts(id) on delete cascade,
  product_id uuid not null references products(id),
  qty        int  not null default 1 check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price > 0),
  unique (cart_id, product_id)
);

-- --- saved wallets (tokenization) -----------------------------------------
create table payment_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  operator_id text not null check (operator_id in ('100007','100008')),
  -- the gateway's sourceId. A token belongs to exactly one merchant, so this
  -- is unique per row and never shared across users.
  source_id   text not null unique,
  msisdn      text not null,
  label       text,
  status      token_status not null default 'active',
  linked_at   timestamptz not null default now(),
  -- a token lives one year
  expires_at  timestamptz not null default (now() + interval '1 year')
);
create index payment_tokens_user_active on payment_tokens (user_id) where status = 'active';

-- In-flight wallet links, keyed by the orderId/userKey we sent.
--   Easypaisa: holds initiate's transactionId until verify redeems it.
--   JazzCash:  holds the hosted-page consent until finalize redeems it —
--              finalize is idempotent per orderId, so retrying is safe.
create table wallet_registrations (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  order_ref              text not null unique,
  operator_id            text not null,
  msisdn                 text not null,
  label                  text,
  gateway_transaction_id text,
  status                 text not null default 'pending'
                           check (status in ('pending','linked','declined','failed')),
  status_code            text,
  message                text,
  created_at             timestamptz not null default now()
);

-- --- orders ----------------------------------------------------------------
create table orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- our own reference; sent as userKey (wallet) or orderId (hosted page).
  order_ref     text not null unique,
  amount        numeric(12,2) not null check (amount > 0),
  status        order_status not null default 'pending',
  operator_id   text,
  msisdn        text,
  -- 'wallet_otp' | 'wallet_non_otp' | 'hosted_page' | 'direct_payment'
  channel       text not null,
  -- latest gateway code seen for this order
  status_code   text,
  message       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index orders_user_created on orders (user_id, created_at desc);

create table order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  name       text not null,          -- snapshot, so history survives edits
  qty        int  not null check (qty > 0),
  unit_price numeric(12,2) not null
);

-- Every gateway exchange, in order. The audit trail for reconciliation.
create table transactions (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid references orders(id) on delete set null,
  user_id                uuid references auth.users(id) on delete set null,
  gateway_transaction_id text,
  operator_id            text,
  kind                   txn_kind not null,
  status_code            text not null,
  message                text,
  -- true for 0007/0018/0037/0094/9999 and anything unrecognised: outcome
  -- unknown, money may have moved. Never surface these as a failure.
  indeterminate          boolean not null default false,
  request                jsonb,
  response               jsonb,
  created_at             timestamptz not null default now()
);
create index transactions_order on transactions (order_id, created_at);
create index transactions_gateway_txn on transactions (gateway_transaction_id);

-- --- subscriptions ---------------------------------------------------------
create table subscriptions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  product_id        uuid not null references products(id),
  payment_token_id  uuid not null references payment_tokens(id),
  status            sub_status not null default 'active',
  interval_days     int not null check (interval_days > 0),
  amount            numeric(12,2) not null check (amount > 0),
  next_charge_at    timestamptz not null default now(),
  last_charge_at    timestamptz,
  failed_attempts   int not null default 0,
  created_at        timestamptz not null default now(),
  unique (user_id, product_id)
);
create index subscriptions_due on subscriptions (next_charge_at) where status = 'active';

create table subscription_charges (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  order_id        uuid not null references orders(id) on delete cascade,
  period_start    timestamptz not null,
  created_at      timestamptz not null default now()
);

-- --- gateway postbacks -----------------------------------------------------
create table postbacks (
  id          uuid primary key default gen_random_uuid(),
  payload     jsonb not null,
  processed   boolean not null default false,
  error       text,
  received_at timestamptz not null default now()
);

-- --- updated_at ------------------------------------------------------------
create function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger orders_touch before update on orders
  for each row execute function touch_updated_at();

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table profiles             enable row level security;
alter table products             enable row level security;
alter table carts                enable row level security;
alter table cart_items           enable row level security;
alter table payment_tokens       enable row level security;
alter table wallet_registrations enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table transactions         enable row level security;
alter table subscriptions        enable row level security;
alter table subscription_charges enable row level security;
alter table postbacks            enable row level security;

-- Catalogue is public read; writes are service-role only (no policy).
create policy products_read_active on products
  for select using (active);

create policy profiles_self on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy carts_self on carts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy cart_items_self on cart_items
  for all using (
    exists (select 1 from carts c where c.id = cart_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from carts c where c.id = cart_id and c.user_id = auth.uid())
  );

-- Tokens: readable and delinkable by their owner, but only the server (service
-- role) may mint one — a sourceId must come from a real gateway response.
create policy payment_tokens_read on payment_tokens
  for select using (auth.uid() = user_id);
create policy payment_tokens_update on payment_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy wallet_registrations_read on wallet_registrations
  for select using (auth.uid() = user_id);

-- Orders and their children are read-only to the owner; they are created and
-- advanced server-side so a client can never mark its own order paid.
create policy orders_read on orders
  for select using (auth.uid() = user_id);

create policy order_items_read on order_items
  for select using (
    exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid())
  );

create policy transactions_read on transactions
  for select using (auth.uid() = user_id);

create policy subscriptions_read on subscriptions
  for select using (auth.uid() = user_id);
-- the owner may pause/cancel; amount and schedule are server-managed
create policy subscriptions_update on subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy subscription_charges_read on subscription_charges
  for select using (
    exists (select 1 from subscriptions s
            where s.id = subscription_id and s.user_id = auth.uid())
  );

-- postbacks: service role only. No policy = no client access.

-- >>> migrations/0002_gateway_settings.sql

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

-- >>> migrations/0003_api_logs.sql

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

-- >>> migrations/0004_base_url_includes_prefix.sql

-- ===========================================================================
-- Rafiq — the base URL now carries the gateway prefix
--
-- `gateway_settings.base_url` used to be the origin alone, with the client
-- appending COLLECTION_GATEWAY_PREFIX ('/mock/collection') to it. The client
-- now appends the endpoint path verbatim instead, starting at the version
-- segment, so the prefix has to live in the stored value.
--
-- Storing the whole thing is what makes the setting honest: what you see on
-- /settings is what a request is addressed to, with nothing spliced in behind
-- your back. The previous split produced
-- '/mock/collection/mock/collection/v2/…' the moment someone pasted the URL
-- they had actually been given.
--
-- Both statements are idempotent, so this is safe to re-run.
-- ===========================================================================

-- 1. Repair a value that already had the prefix doubled by the old client.
update gateway_settings
   set base_url = replace(base_url, '/mock/collection/mock/collection',
                                    '/mock/collection')
 where id and base_url like '%/mock/collection/mock/collection%';

-- 2. Add the prefix to a bare origin — including the one migration 0003
--    seeded. A base URL that already carries a path is left alone: it points
--    at a gateway with a different prefix, which is now expressible.
update gateway_settings
   set base_url = rtrim(base_url, '/') || '/mock/collection'
 where id
   and base_url is not null
   -- no path beyond the origin: 'scheme://host[:port]' and nothing more
   and base_url ~ '^https?://[^/]+/?$';

-- >>> migrations/0005_two_merchants.sql

-- ===========================================================================
-- Rafiq — one merchant per flow, with a switch
--
-- A MID is provisioned on exactly one flow: calling the other one's sequence
-- answers 0015 Invalid-Flow. Testing both therefore meant retyping the merchant
-- id every time the flow changed, and a half-done switch — new flow, old MID —
-- is a configuration that looks fine and fails every call.
--
-- So both merchants are stored side by side and `flow` becomes the switch that
-- says which of them is live. The pair moves together or not at all, and the
-- invalid combination is no longer expressible.
-- ===========================================================================

alter table gateway_settings
  add column merchant_id_otp text
    check (merchant_id_otp is null or merchant_id_otp ~ '^\d{7}$'),
  add column merchant_id_non_otp text
    check (merchant_id_non_otp is null or merchant_id_non_otp ~ '^\d{7}$');

-- Move the existing merchant into the slot its recorded flow names.
update gateway_settings
   set merchant_id_otp = merchant_id
 where id and flow = 'otp' and merchant_id is not null;

update gateway_settings
   set merchant_id_non_otp = merchant_id
 where id and flow = 'non_otp' and merchant_id is not null;

-- A merchant id stored with no flow is deliberately NOT migrated: which
-- sequence it was provisioned on is exactly the thing that is unknown, and
-- guessing would send half of all merchants down the wrong one. That state
-- already blocked payments (`getGatewayConfig` refuses on a missing flow), so
-- nothing that worked stops working — an admin re-enters it under the right
-- heading.

-- `flow` now means "which merchant is live", so a single `merchant_id` would be
-- a second, contradictable answer to the same question.
alter table gateway_settings drop column merchant_id;

-- >>> migrations/0006_tokenization_merchant.sql

-- ===========================================================================
-- Rafiq — a third merchant, for tokenization
--
-- Three MIDs, each provisioned for one job:
--
--   payment      OTP or Non-OTP, whichever `flow` selects
--   tokenization every call that mints, charges or retires a stored token
--
-- Tokenization is not a flow you switch to — it runs alongside whichever
-- payment flow is live, so it is a third slot rather than a third option on the
-- selector. A sourceId belongs to the merchant that minted it, which is why
-- direct-payment and delink follow the token's merchant and not the payment
-- one: charging a token under a different MID answers 0003.
-- ===========================================================================

alter table gateway_settings
  add column merchant_id_tokenization text
    check (merchant_id_tokenization is null or merchant_id_tokenization ~ '^\d{7}$');

-- Seed the MIDs this deployment was given, without disturbing anything an
-- admin has already set — `is null` on each column keeps it re-runnable and
-- keeps /settings the authority.
update gateway_settings
   set merchant_id_non_otp = coalesce(merchant_id_non_otp, '7000111'),
       merchant_id_otp = coalesce(merchant_id_otp, '7000222'),
       merchant_id_tokenization = coalesce(merchant_id_tokenization, '7000333')
 where id;

-- >>> seed.sql

-- Demo catalogue. Prices are PKR with at most 2 decimals — the gateway
-- rejects anything else with 0002 Invalid-Product/Amount.

insert into products (slug, name, description, image_url, price, kind, interval_days) values
  ('wireless-earbuds', 'Wireless Earbuds',
   'Bluetooth 5.3 earbuds with charging case and 24h total playback.',
   'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&q=80',
   4999.00, 'one_time', null),

  ('power-bank-20k', '20,000 mAh Power Bank',
   'Dual USB-C PD output, charges a phone four times over.',
   'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=800&q=80',
   3499.00, 'one_time', null),

  ('smart-watch', 'Smart Watch Series 4',
   'AMOLED display, heart-rate and SpO2 tracking, 7-day battery.',
   'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80',
   12999.00, 'one_time', null),

  ('usb-c-cable-2m', 'USB-C Braided Cable (2m)',
   '60W fast-charge braided cable, tangle free.',
   'https://images.unsplash.com/photo-1601524909162-ae8725290836?w=800&q=80',
   899.00, 'one_time', null),

  ('laptop-sleeve', 'Laptop Sleeve 14"',
   'Water-resistant padded sleeve with an accessory pocket.',
   'https://images.unsplash.com/photo-1547949003-9792a18a2601?w=800&q=80',
   2499.00, 'one_time', null),

  ('rafiq-plus-monthly', 'Rafiq Plus — Monthly',
   'Free delivery, early access to drops and priority support. Charged every 30 days to your saved wallet.',
   'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&q=80',
   499.00, 'subscription', 30),

  ('rafiq-plus-weekly', 'Rafiq Plus — Weekly',
   'All of Rafiq Plus, billed every 7 days. Cancel any time.',
   'https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1?w=800&q=80',
   149.00, 'subscription', 7);
