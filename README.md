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
| [src/lib/api-logs.ts](src/lib/api-logs.ts) | The API call log — redaction, writing, querying |
| [src/app/api/](src/app/api/) | Route handlers — checkout, wallets, subscriptions, postback, cron, webhook catcher |
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

`/settings` edits the values that change most often between environments and
merchants, without a redeploy:

| Field | Overrides | Notes |
| --- | --- | --- |
| OTP merchant | `COLLECTION_MERCHANT_ID_OTP` | 7 digits, as provisioned |
| Non-OTP merchant | `COLLECTION_MERCHANT_ID_NON_OTP` | 7 digits, as provisioned |
| Tokenization merchant | `COLLECTION_MERCHANT_ID_TOKENIZATION` | not selectable — used by every token call |
| Active flow | `COLLECTION_FLOW` | selects which *payment* merchant is live, and which sequence checkout runs |
| Base URL for Payment API | `COLLECTION_BASE_URL` | includes the gateway prefix; endpoint paths are appended verbatim |

### Three merchants, one switch

A MID is provisioned for exactly one job. Which of the three a call uses is
decided by **what the call does**, not by a global setting:

| Role | Merchant | Calls |
| --- | --- | --- |
| `payment` | OTP or Non-OTP, whichever `flow` selects | `initiate`, `verify`, hosted `/checkout` and its `/inquire` |
| `tokenization` | the tokenization merchant, always | `initiate`/`verify` with `transactionType: "8"`, `finalize`, `direct-payment`, `delink`, JazzCash registration |

The two payment merchants are the switch: selecting OTP runs
`initiate → OTP → verify` under the OTP MID, Non-OTP runs `verify` alone under
the Non-OTP MID. They move together, so the pair can never be left mismatched
(new flow, old MID). Calling a MID on the other flow's sequence answers
`0015 Invalid-Flow`.

Tokenization is **not** a third option on that switch — it runs alongside
whichever payment flow is live. `direct-payment` and `delink` use it even though
one of them moves money: a `sourceId` belongs to the merchant that minted it, so
charging a token under the payment MID answers `0003`. For `initiate`/`verify`
the role is derived from `transactionType` — `"8"` *is* tokenization — so those
two cannot be called with a merchant that contradicts their payload.

**Inquiry and refund follow the original call.** A transaction is only visible
to the MID that created it, so asking under a different one answers
`0090 No-Transaction-Found` — indistinguishable from a payment that never
happened. `/api/orders/[id]/inquire` therefore reads the merchant id back out of
`transactions.request` (the oldest row for the order — what we actually sent)
and passes it explicitly, rather than re-reading a configuration that may have
been switched since.

Each role demands only what it uses: an unset tokenization merchant does not
block ordinary payments, and an unset flow does not block a subscription
renewal. The merchant belonging to the *inactive* flow is never a silent
fallback.

`COLLECTION_MERCHANT_ID` still works as a legacy fallback for the two payment
slots. It deliberately does **not** cover tokenization.

The base URL is **everything up to the version segment, gateway prefix
included** — endpoint paths are appended to it exactly as written and nothing is
spliced in between. A fresh install starts at
`http://3.127.43.66:8001/mock/collection`, so a payment goes to:

```
http://3.127.43.66:8001/mock/collection/v2/wallets/transaction/verify
```

Every path in `client.ts` therefore begins at `/v2` or `/v3`, or at a hosted
route (`/checkout`, `/inquire`, `/jc/registrationfull`). `/settings` shows one
resolved endpoint in full, since a doubled or missing prefix is otherwise
invisible until a call 404s.

There is no separate prefix setting: it was one, and splitting the URL in two
meant pasting the address the gateway team gave you produced
`/mock/collection/mock/collection/v2/…`. A base URL whose path is an exact
doubling is now collapsed on save as a guard.

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

## API call log and the webhook catcher

`/logs` (admin-only) shows every HTTP conversation the app takes part in, newest
first, with headers, bodies, status, gateway code and duration:

- **outbound** — every call to the Collection gateway, including the ones that
  failed to connect or came back non-JSON. Hosted hand-offs (`/checkout`,
  JazzCash registration) are logged as the request only; their outcome arrives
  later as its own row from the return-URL inquiry or the postback.
- **inbound** — gateway postbacks and anything sent to the webhook catcher.

Filter by direction, operation or free text; expand a row for the full payload.
Auto-refresh polls every five seconds while it is ticked.

Keys that look like secrets — `key`, `secret`, `token`, `signature`, `otp`,
`authorization`, `cookie` — are redacted **before** the row is written, so the
table never holds them. `merchantId` is deliberately kept: it is not a secret,
and it is the first thing you need when a call answers `0003`.

Logging is best-effort by design. A failed log write is a `console.warn` and
nothing more — a payment must never fail because a diagnostic row could not be
saved. The `transactions` table, not this one, remains the record of what
happened to money.

### Webhook catcher

```
POST https://<your-app>/api/webhooks/catch
```

The absolute URL is shown on `/settings`, resolved from the request itself so it
is correct on localhost, behind a tunnel and on a preview deployment. It accepts
any method, any content type and any sub-path
(`/api/webhooks/catch/easypaisa` is logged under `webhook.easypaisa`), records
the query string, headers and body in the log, and answers `200` with
`{"ok": true, "message": "Webhook received."}`.

It is unauthenticated on purpose — the point is to catch calls you have not
configured yet — and it has **no side effects**: it never touches an order, a
token or a subscription. Real settlement still goes to
`/api/collection/postback`, which checks the shared secret and is also logged.

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
