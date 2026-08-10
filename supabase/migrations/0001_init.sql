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
