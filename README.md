# Rafiq

One app for multiple products. **Stage 1 is Collection**: a shopping cart that
pays over mobile wallets, and subscription plans that bill a saved wallet with
the customer absent.

Remittance is a later stage — nothing here is remittance-specific, and the
gateway client lives behind its own module so a second product can sit alongside
it.

Built on **Next.js (App Router)** + **Supabase** (Postgres, Auth, RLS), deployed
on **Vercel**. Integration contract:
[docs/COLLECTION-API-CLIENT-GUIDE.md](docs/COLLECTION-API-CLIENT-GUIDE.md).

---

## What's in Stage 1

**Option 1 — Shopping cart.** Browse the catalogue, add to cart, pay with
Easypaisa or JazzCash. Three payment paths are supported and the customer picks
one at checkout:

| Path | Sequence |
|---|---|
| Mobile wallet | `initiate` → OTP → `verify` (OTP flow), or `verify` alone (Non-OTP flow) |
| One-click | `direct-payment` against a saved token — no OTP |
| Hosted page | redirect to `/checkout`, then poll `POST /inquire` |

**Option 2 — Subscriptions (tokenization).** Link a wallet once with an OTP,
then Rafiq charges each period unattended via `direct-payment`. Easypaisa links
over JSON (`initiate`/`verify` with `transactionType: "8"`); JazzCash links
through the gateway's hosted registration page and is redeemed with `finalize`.
Renewals run on a daily Vercel Cron job.

---

## Architecture

```
Browser ──► Next.js Route Handlers ──► Collection gateway
                    │                  (merchant key never leaves the server)
                    └──► Supabase (Postgres + Auth + RLS)
```

Three rules the code holds to, all of them load-bearing:

1. **The gateway is only ever called server-side.** The merchant id, merchant
   key and refund signing secret live in `serverEnv` and the client module
   imports `server-only`, so a stray client import fails the build rather than
   shipping a key to the browser.
2. **Amounts are computed server-side.** The browser never sends a price; the
   cart total is recomputed from the live catalogue at checkout.
3. **Indeterminate is not failure.** `0007`, `0018`, `0037`, `0094`, `9999` and
   *any unrecognised code* leave the order `pending` and are resolved by
   `inquiry` or the postback — never by re-firing the payment. The UI says
   "awaiting confirmation", never "failed".

### Layout

| Path | What it holds |
|---|---|
| [src/lib/collection/](src/lib/collection/) | The gateway client: `client.ts` (endpoints), `codes.ts` (response table + classification), `validate.ts` (§3 field rules), `types.ts` |
| [src/lib/orders.ts](src/lib/orders.ts) | Order lifecycle; `applyOutcome` is the single place pending → paid/failed is decided |
| [src/lib/subscriptions.ts](src/lib/subscriptions.ts) | Renewal charging, retry/backoff, dead-token handling |
| [src/app/api/](src/app/api/) | Route handlers — checkout, wallets, subscriptions, postback, cron |
| [supabase/migrations/](supabase/migrations/) | Schema and RLS policies |

---

## Getting started

### 1. Supabase

Create a project, then run the schema and (optionally) the demo catalogue:

```bash
# via the Supabase SQL editor, or with the CLI:
supabase db push                       # applies supabase/migrations/
psql "$DATABASE_URL" -f supabase/seed.sql
```

Or paste [supabase/setup.sql](supabase/setup.sql) — schema and seed concatenated —
into the SQL editor in one go.

#### One database for local and deployed

By deliberate choice, local development points at the **same** Supabase project
as the deployed app: `.env.local` and the Vercel environment carry identical
`NEXT_PUBLIC_SUPABASE_URL` and key values. There is no local Postgres stack and
no `supabase/config.toml`.

Two consequences worth being awake to, since nothing in the code guards against
them:

- **Local activity is real data.** A test checkout from `localhost:4000` inserts
  live rows into `orders`, `transactions` and `payment_tokens` — the same tables
  the deployed app serves. Sign in as a throwaway user for testing so the rows
  are easy to tell apart from real ones.
- **A migration is immediately production.** Running SQL for local work changes
  the deployed app's schema at the same instant. Additive changes are safe;
  dropping or renaming a column breaks whatever is already deployed.

If those ever start to bite, the split is cheap: create a second Supabase
project, apply the same `setup.sql`, and point `.env.local` at it — nothing in
the code reads a project ref, so no source change is needed.

Under **Authentication → URL Configuration**, add
`http://localhost:4000/auth/callback` and your Vercel URL's equivalent as
redirect URLs, or magic links will bounce.

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in the Supabase keys and the Collection settings. Two values you cannot
guess and must get from whoever provisioned the merchant:

- `COLLECTION_MERCHANT_ID` — a real seeded **7-digit** MID. Every request
  answers `0003 Invalid-Merchant` without one.
- `COLLECTION_FLOW` — `otp` or `non_otp`. Each MID is provisioned on exactly one
  flow; calling the other one's sequence answers `0015 Invalid-Flow`. This is
  not a preference.

Also confirm the MID's `packages` include Wallets, Wallet Tokenization and
Hosted Page, or those calls answer `0106 Merchant-not-allowed`.

Three of these — merchant id, flow and the Payment API base URL — **do not
belong in the environment at all**. They live in the database and are edited from
`/settings`; the env vars are optional bootstrap overrides. See
[Runtime configuration](#runtime-configuration).

### 3. Run

```bash
npm install
npm run dev
```

---

## Deploying to Vercel

1. Push to GitHub and import the repo in Vercel.
2. Add every variable from `.env.example` to the project (Production **and**
   Preview). Set `NEXT_PUBLIC_APP_URL` to the deployment's own URL — it builds
   the `ReturnUrl`/`redirectUrl` the gateway sends the customer back to, so a
   stale value breaks both hosted flows.
3. `vercel.json` registers the daily renewal cron. Vercel calls it with
   `Authorization: Bearer $CRON_SECRET`, so `CRON_SECRET` must be set or every
   run 401s.
4. Register `https://<your-domain>/api/collection/postback` with the gateway for
   async settlement, and give them the `COLLECTION_POSTBACK_SECRET` to send as
   `x-postback-secret`.

**The gateway must be reachable from Vercel's network.** A `localhost:8001`
gateway will not be, and every call will time out into an indeterminate result.

---

## Runtime configuration

`/settings` edits the three values that change most often between environments
and merchants, without a redeploy:

| Field | Overrides | Notes |
| --- | --- | --- |
| Merchant ID | `COLLECTION_MERCHANT_ID` | 7 digits, as provisioned |
| Flow | `COLLECTION_FLOW` | OTP or Non-OTP — must match the MID |
| Base URL for Payment API | `COLLECTION_BASE_URL` | origin only; the gateway prefix and path are appended |

They live in the single-row `gateway_settings` table, which is **sufficient on
its own** — the app needs no `COLLECTION_BASE_URL`, `COLLECTION_MERCHANT_ID` or
`COLLECTION_FLOW` in the environment. Those remain as optional bootstrap
overrides (handy for CI), and the row wins whenever it is set.

Resolution is per column: a blank field clears the override and falls back to the
environment, or to nothing at all if the environment is silent too. Every gateway
call reads the config at call time (memoised per request), so a change takes
effect on the next request — including where live payments go.

When a value is set in neither place, a gateway call raises `ConfigurationError`
and the route answers **503 `NOT_CONFIGURED`** with a message naming the missing
fields. That is deliberately *not* treated as an indeterminate outcome: no
request left the process, so no money can have moved, and the order must not be
left pending. `/settings` itself never throws on a gap — otherwise the one page
that can fix the problem would be the one page you could not open.

`COLLECTION_FLOW` has **no default**. Silently assuming `otp` would send every
Non-OTP merchant down the wrong sequence and answer `0015` on every payment, so
an unset flow is treated as unconfigured instead.

The page and `PUT /api/settings/gateway` are admin-only. Grant access with:

```sql
update profiles set is_admin = true where id = '<auth user id>';
```

Everything else — merchant key, the refund signing secret, region/mode/version
headers, the postback and cron secrets — stays env-only on purpose: secrets do
not belong in a table an app screen can edit.

---

## Testing against the mock

The mock returns any documented code on demand, but *which field selects it
differs per endpoint* (guide §7): `userKey` on initiate/verify, `orderId` on
finalize, the `version` header on direct-payment/delink, `transactionId` on
inquiry.

Rafiq generates order references that **always end in a letter**
(`newOrderRef()` in [src/lib/orders.ts](src/lib/orders.ts)) precisely so normal
traffic can never land on a fixture by accident. To drive a fixture
deliberately, call the client directly with a crafted `userKey` — don't try to
get one through the cart.

Keep `COLLECTION_VERSION` at `3.0`. Any other value turns direct-payment and
delink into canned fixtures that never touch the real token store.

---

## Known gaps

- **Refund signing is a placeholder.** `signRefund()` uses HMAC-SHA256 over the
  sorted fields because the guide doesn't pin the scheme. Confirm the real
  algorithm before relying on refunds — a mismatch answers `0054`.
- **No refund UI yet.** The client method exists; nothing calls it.
- **Cards are not implemented.** They use a different envelope and code table
  (`10000`/`20118`) and are documented separately.
- **Postbacks are authenticated by shared secret**, since the mock doesn't sign
  them. Move to signature verification when the real gateway supports it.
