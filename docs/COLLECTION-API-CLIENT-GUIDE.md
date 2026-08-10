# Collection Gateway — Client Integration Guide

> For merchant-side developers building a client app (e.g. an online shopping app)
> against the Minception Collection (Pay-In PK) mock gateway.
>
> Source of truth: the seeded Collection gateway (`migrations/seeds/*`) and
> `product_reference/collection.py`. Codes are the Pay-In PK response-code table.

---

## 1. Basics

| | |
|---|---|
| Base URL (direct) | `http://localhost:8001` |
| Base URL (via nginx) | `http://localhost` |
| Gateway prefix | `/mock/collection` |
| Full endpoint URL | `{baseUrl}/mock/collection/{path}` |
| Content type | `application/json` |
| HTTP status | **Always `200`** on wallet endpoints — the outcome is in the body's `status` field, not the HTTP code. `/checkout` is the exception (`302`). |

### Supported channels

Only two operators exist on this gateway. Anything else answers `0001 Invalid-Operator`.

| `operatorId` | Wallet | One-time payment | Tokenization |
|---|---|---|---|
| `100007` | Easypaisa | ✅ | ✅ |
| `100008` | JazzCash | ✅ | ✅ |

Retired (do **not** use): `100011` 1Bill, `100012` Alfa, `100014` HBL Konnect.
The `cnic` and `accountNumber` fields went with them — do not send them.

### Standard headers (wallet endpoints)

```http
Content-Type: application/json
region: PK
mode: payin
version: 3.0
operatorId: 100007          # must equal the body's operatorId
Request-Id: <uuid>          # optional, echoed back
```

`version: 3.0` and the `operatorId` header are **required** on `initiate` and
`verify`. On `direct-payment` and `delink` the `version` header is required but
is *also* the QA fixture selector (see §7) — send `3.0` for normal traffic.

### Response envelope

Every wallet response looks like this:

```json
{
  "status": "0000",
  "message": "Success",
  "msisdn": "03001234567",
  "operatorId": "100007",
  "merchantId": "2000010",
  "transactionId": "95190001"
}
```

**Integrate on `status` (the numeric code), never on `message`.** Message strings
have been corrected in place without the code moving.

---

## 2. Which flow is your merchant on?

Every Collection merchant is provisioned on exactly **one** flow. Calling the
other one's sequence answers `0015 Invalid-Flow`.

| Flow | Sequence | Notes |
|---|---|---|
| **OTP Flow** | `initiate` → *(customer receives OTP)* → `verify` (with `otp`) | Both calls are **one** transaction — pass `initiate`'s `transactionId` back on `verify`. |
| **Non-OTP Flow** | `verify` only, no `otp` | `verify` *is* the first call and the one that creates the transaction. `initiate` is not available. |

**Tokenization is exempt.** Linking a wallet (`transactionType: "8"`) always runs
`initiate` → `verify` with an OTP, on *both* flows. That is the point of Non-OTP:
you link once with an OTP, then charge the token with the customer absent.

A missing `otp` when one is required answers `0011 Invalid-OTP`, never `0015` —
a forgotten field is a payload mistake, not a provisioning one.

---

## 3. Field rules

These are enforced before anything else runs; a failure answers the param's own
error code and records **no** transaction.

| Field | Rule (regex) | Failure code |
|---|---|---|
| `merchantId` | `\d{7}` **and** must be a provisioned MID | `0003` Invalid-Merchant |
| `operatorId` | `100007` or `100008` | `0001` Invalid-Operator |
| `amount` | `(?!0+(\.0{1,2})?$)\d+(\.\d{1,2})?` — non-zero, ≤2 decimals | `0002` Invalid-Product/Amount |
| `msisdn` | `0?3\d{9}` — `3001234567` or `03001234567` | `0025` Invalid-Mobile-No |
| `userKey` | required, your own order reference | `0019` Invalid-UserKey |
| `transactionType` | `^(0\|8)$` — `0` = payment, `8` = tokenization | `0088` Invalid-Transaction-Type |
| `sourceId` | required on `direct-payment` / `delink` | `0034` Invalid-Token |
| `transactionId` | required on refund / inquiry | `0097` Invalid-Transaction-Id |
| `signature` | required on refund | `0054` Invalid-Signature |

`msisdn` values are compared by national significant digits: `03001234567` and
`923001234567` are the same subscriber.

---

## 4. Endpoints

### 4.1 `POST /v2/wallets/transaction/initiate`

Starts a one-time payment or a tokenization. Sends the OTP to the customer.
Creates the transaction (status `Pending`).

**Request**
```json
{
  "merchantId": "2000010",
  "operatorId": "100007",
  "amount": "100",
  "userKey": "ORDER-10432",
  "msisdn": "03001234567",
  "transactionType": "0"
}
```

**Response**
```json
{
  "status": "0000",
  "message": "Success",
  "msisdn": "03001234567",
  "operatorId": "100007",
  "merchantId": "2000010",
  "transactionId": "95190001"
}
```

Keep `transactionId` — you must pass it to `verify` (OTP Flow) and you need it
for inquiry and refund.

---

### 4.2 `POST /v2/wallets/transaction/verify`

Completes the payment with the OTP (OTP Flow), or *is* the payment (Non-OTP
Flow). For `transactionType: "8"` it also mints the token on Easypaisa.

**Request** (OTP Flow — continues initiate's transaction)
```json
{
  "merchantId": "2000010",
  "operatorId": "100007",
  "amount": "100",
  "userKey": "ORDER-10432",
  "msisdn": "03001234567",
  "transactionType": "0",
  "transactionId": "95190001",
  "otp": "1234"
}
```

Omit `transactionId` and a **new** transaction is started — which is exactly what
a Non-OTP merchant wants, and exactly what an OTP merchant does *not*.

**Response** (tokenization, `transactionType: "8"`)
```json
{
  "status": "0000",
  "message": "Success",
  "msisdn": "03001234567",
  "operatorId": "100007",
  "merchantId": "2000010",
  "transactionId": "95185887",
  "sourceId": "sp_a1b2c3d4e5f6"
}
```

`sourceId` is only returned when `transactionType` is `8` **and** the response is
a success code. A one-time payment never walks away with a reusable token.

---

### 4.3 `GET /jc/registrationfull` — JazzCash wallet linking (hosted page)

JazzCash tokenizes through a **real hosted page**, not a JSON call. Redirect the
customer's browser to:

```
{baseUrl}/mock/collection/jc/registrationfull
    ?MerchantId=2000010
    &OrderId=ORDER-10432
    &Amount=100
    &ReturnUrl=https%3A%2F%2Fyourshop.com%2Freturn
    &MobileNo=03001234567
    &transactionType=8
```

`MerchantId`, `OrderId`, `Amount`, `ReturnUrl` and `transactionType=8` are all
**required**. An illegal launch renders a 400 error page and deliberately does
**not** redirect.

The customer enters their MSISDN and a **6-digit OTP** (any six digits
authenticate — there is no SMS behind a mock). The page then 303s back to your
`ReturnUrl`:

```
https://yourshop.com/return?orderId=ORDER-10432&transactionId=95190099&status=0000&message=Success
```

| Customer action | Redirect `status` | `finalize` then reports |
|---|---|---|
| Enters a 6-digit OTP | `0000` | mints the `sourceId` |
| Abandons at launch | `0037` | `0037` Transaction-Pending |
| Malformed OTP ×3 | `0012` | `0012` Transaction-Failed |
| Clicks "Not now" | `0091` | `0091` customer declined |

Two rejections come back over the redirect without a `transactionId`:
`0003` (unknown `MerchantId`) and `0005` Invalid-Call (this merchant has already
linked this wallet — an active, unexpired token exists).

`/jc/registration` is a legacy alias of the same page.

---

### 4.4 `POST /v2/wallets/transaction/finalize`

Redeems a JazzCash registration for a `sourceId`. Call it after the redirect
returns.

**Request**
```json
{
  "merchantId": "2000010",
  "operatorId": "100008",
  "orderId": "ORDER-10432",
  "msisdn": "03001234567"
}
```

**Response**
```json
{
  "status": "0000",
  "message": "Success",
  "msisdn": "03001234567",
  "operatorId": "100008",
  "merchantId": "2000010",
  "sourceId": "sp_9f8e7d6c5b4a",
  "transactionId": "95190099"
}
```

**Re-finalizing the same `orderId` returns the same token** — safe to retry a
missed redirect. One consent never yields two tokens.

Failures: `0042` no registration · `0037` consent still pending ·
`0091` customer declined · `0012` registration failed · `0025` msisdn ≠ the one
that consented.

---

### 4.5 `POST /v2/wallets/transaction/direct-payment`

Charges a stored token with the customer absent. This is your "1-click checkout".

**Request**
```json
{
  "merchantId": "2000010",
  "operatorId": "100007",
  "transactionType": "8",
  "amount": "250",
  "userKey": "ORDER-10555",
  "sourceId": "sp_a1b2c3d4e5f6",
  "platform": "android"
}
```
Header `version: 3.0` required.

**Response**
```json
{
  "status": "0000",
  "message": "Success",
  "operatorId": "100007",
  "merchantId": "2000010",
  "sourceId": "sp_a1b2c3d4e5f6",
  "transactionId": "95190101",
  "amount": "250"
}
```

Token failures — all three are distinct, don't collapse them:

| Code | Meaning |
|---|---|
| `0034` Invalid-Token | `sourceId` blank or absent (rejected before the store) |
| `0036` Token-Not-Found | well-formed token the store never held |
| `0028` Token-Expired | token was held but is no longer chargeable — **delinked or elapsed** |
| `0003` Invalid-Merchant | the token belongs to a different merchant |

**A token belongs to exactly one merchant.** Two merchants tokenizing the same
wallet get two independent tokens; neither can charge the other's. A token lives
one year.

---

### 4.6 `POST /v2/wallets/transaction/delink`

Retires a token. After this, charging it answers `0028`.

```json
{ "merchantId": "2000010", "operatorId": "100007", "sourceId": "sp_a1b2c3d4e5f6" }
```
```json
{ "status": "0000", "message": "Success", "operatorId": "100007",
  "merchantId": "2000010", "sourceId": "sp_a1b2c3d4e5f6" }
```

---

### 4.7 `POST /v2/inquire/wallet/transaction/inquiry`

Reads a transaction's **live** status. This is how you resolve an indeterminate
response (§6). Send `transactionId`, or `userKey` as the fallback — at least one
is required.

```json
{ "merchantId": "2000010", "transactionId": "95190001", "userKey": "ORDER-10432" }
```
```json
{
  "merchantId": "2000010",
  "transactionId": "95190001",
  "userKey": "ORDER-10432",
  "transaction": {
    "amount": "100",
    "operatorId": "100007",
    "transactionId": "95190001",
    "status": "0000",
    "message": "Success",
    "updatedTimestamp": "2026-08-10T09:14:22Z"
  }
}
```

Reported codes: `0000` Success · `0012` Failed · `0037` still in flight ·
**`0090` Transaction-Not-Found** when no such transaction was ever created.

---

### 4.8 `POST /v3/transaction/refund`

Refunds a settled transaction. Validated live against the stored original.

```json
{
  "transactionId": "95190001",
  "merchantId": "2000010",
  "transactionDate": "2026-08-10",
  "type": "WALLETS",
  "amount": "100",
  "signature": "<your signature>"
}
```

`transactionDate` must be `YYYY-MM-DD`; `type` must be `WALLETS`. Omit `amount`
for a full refund.

```json
{ "status": "0135", "message": "Refund-Submitted", "merchantId": "2000010",
  "transactionId": "95190001", "referenceNumber": "..." }
```

**`0135` is the success answer, not `0000`.** The transaction moves to
`RefundSubmitted`, and to `Refunded` once the postback confirms it.

| Code | Meaning |
|---|---|
| `0135` | Refund submitted (success) |
| `0090` | Original transaction not found |
| `0134` | A refund already exists for it |
| `0137` | Amount greater than the transaction amount |
| `0138` | Amount exceeds the total in process |
| `0140` | Invalid transaction date |
| `0054` | Invalid signature |

⚠️ Known conflict: refund answers `0094` as *Invalid-Type* while the pay-in table
assigns `0094` to *Transaction-In-Progress*.

---

### 4.9 Hosted Page — `GET /checkout` + `POST /inquire`

Redirect-based checkout with no wallet UI of your own.

```
{baseUrl}/mock/collection/checkout
    ?merchantId=2000010&key=<merchant key>&orderId=ORDER-10432
    &amount=100&redirectUrl=https%3A%2F%2Fyourshop.com%2Freturn&operator=100007
```

`merchantId`, `key`, `orderId` and `redirectUrl` are required; you must send at
least one of `amount` / `productId`. Answers **`302`** with a `Location` of:

```
https://yourshop.com/return?orderId=ORDER-10432&transactionId=…&status=0037&message=Transaction-Pending
```

Then poll for the real outcome:

```json
POST /mock/collection/inquire
{ "merchantId": "2000010", "orderId": "ORDER-10432" }
```
```json
{ "status": "0037", "message": "Transaction-Pending", "amount": "100",
  "operatorId": "100007", "transactionId": "...", "merchantId": "2000010",
  "orderId": "ORDER-10432", "createdDate": "..." }
```

Codes: `0000` / `0012` / `0037` / `0042`. This flow is keyed by **`orderId`**,
not `transactionId`.

---

### 4.10 Cards

Card endpoints use a different envelope (`response` + `signature`, Checkout-style
codes like `10000`/`20118`) and are documented separately. Paths:
`POST /cards/payments`, `/cards/inquiry`, `/cards/capture`, `/cards/tokens`,
`/cards-refund/reverse`.

---

## 5. Recommended client sequences

**One-time payment (OTP Flow)**
```
initiate  →  collect OTP from customer  →  verify (with transactionId + otp)
          →  if indeterminate: inquiry until resolved
```

**One-time payment (Non-OTP Flow)**
```
verify (no otp, no transactionId)  →  if indeterminate: inquiry
```

**Save-a-wallet, then 1-click (Easypaisa)**
```
initiate (transactionType 8)  →  verify (transactionType 8 + otp)  →  store sourceId
later: direct-payment (sourceId)   … settings: delink (sourceId)
```

**Save-a-wallet, then 1-click (JazzCash)**
```
redirect browser → /jc/registrationfull  →  customer consents  →  back on ReturnUrl
finalize (orderId)  →  store sourceId
later: direct-payment (sourceId)   … settings: delink (sourceId)
```

**Hosted Page**
```
redirect → /checkout  →  back on redirectUrl  →  POST /inquire until settled
```

---

## 6. ⚠️ Handling indeterminate codes

`0007` · `0018` · `0037` · `0094` · `9999` mean **the outcome is not yet known
and money may have moved.**

- Do **not** show the customer a failure.
- Do **not** re-fire the request.
- Resolve via `inquiry` (or your postback), and only then settle the order.
- `0037` is the *expected* first response of an async flow, not an error.

Treat any code you don't recognise as indeterminate too — the safe reading of an
unclassifiable code is that you don't know what happened.

Otherwise: `0000` = success, everything else in the table = failed.

---

## 7. Driving specific error codes in test

The mock lets you request any documented code deterministically. Which field
selects it differs by endpoint:

| Endpoint | Selector |
|---|---|
| `initiate`, `verify` | last 4 digits of **`userKey`** — `ORDER-000000000009` → `0009` |
| `finalize` | last 4 digits of **`orderId`** |
| `direct-payment`, `delink` | the **`version` header** — `3.009` → `0009` |
| `inquiry` | **`transactionId`** (falls back to `userKey`) — must *be* the code |
| refund | last 4 digits of **`transactionId`** |
| `/checkout` | `orderId` suffix — `0000` → Success, `0012` → Failed, else Pending |

`msisdn` selects nothing — a real subscriber number can never land on an error
fixture by accident. Keep your happy-path requests free of these suffixes and of
`version` values other than `3.0`, or you'll hit a canned fixture instead of the
real token store.

---

## 8. Response-code reference

| Code | Message | | Code | Message |
|---|---|---|---|---|
| `0000` | Success | | `0042` | Record-Not-Found |
| `0001` | Invalid-Operator | | `0043` | Invalid-Account-Number |
| `0002` | Invalid-Product/Amount | | `0054` | Invalid-Signature |
| `0003` | Invalid-Merchant | | `0073` | No-Threshold-Found |
| `0004` | Invalid-Value | | `0087` | No-Active-Subscription-Found |
| `0005` | Invalid-Call | | `0088` | Invalid-Transaction-Type |
| `0006` | Channel-Rejected-Transaction | | `0089` | Transaction-Cancelled |
| `0007` | No-Response-From-Operator ⚠️ | | `0090` | Transaction-Not-Found |
| `0008` | Invalid-Account | | `0091` | User-didn't-approve-or-rejected |
| `0009` | Not-Enough-Balance | | `0093` | Transaction-Initiation-Failed |
| `0010` | OTP-Expired | | `0094` | Transaction-In-Progress ⚠️ |
| `0011` | Invalid-OTP | | `0095` | Otp-Not-Entered |
| `0012` | Transaction-Failed | | `0097` | Invalid-Transaction-Id |
| `0015` | Invalid-Flow | | `0098` | Otp-Threshold-Exceeded |
| `0016` | Threshold-Exceeded | | `0106` | Merchant-not-allowed |
| `0018` | Request-In-Progress ⚠️ | | `0134` | Refund-Request-Already-Exists |
| `0019` | Invalid-UserKey | | `0135` | Refund-Request-Submitted |
| `0020` | Channel-Auth-Failed | | `0137` | Amount-Greater-Than-Transaction-Amount |
| `0021` | Channel-Failed-Transaction | | `0138` | Amount-Exceeds-Total-Amount-In-Process |
| `0023` | Method-Not-Allowed | | `0140` | Invalid-Transaction-Date |
| `0025` | Invalid-Mobile-No | | `9999` | System-Failure ⚠️ |
| `0026` | Operator-Disabled | | | |
| `0027` | Amount-Beyond-Limit | | | |
| `0028` | Token-Expired | | | |
| `0033` | Channel-Invalid-Call | | | |
| `0034` | Invalid-Token | | | |
| `0036` | Token-Not-Found | | | |
| `0037` | Transaction-Pending ⚠️ | | | |

⚠️ = indeterminate (see §6). `0039` Invalid-CNIC and `0041` Invalid-Account-Number
were retired with the wallets that produced them.

---

## 9. Before you start

1. The gateway must be seeded and mock-service reloaded.
2. Get a **real seeded 7-digit MID** — every request fails `0003` without one.
3. Know which flow that MID is provisioned on (OTP or Non-OTP) — see §2.
4. Ensure your MID's `packages` include the features you're calling (Wallets,
   Wallet Tokenization, Hosted Page, Cards); otherwise `0106 Merchant-not-allowed`.
5. Register your postback URL if you want async settlement pushed to you.

---

*Generated from the seeded Collection gateway (`GATEWAY_ID 6a1fec0f1411146b056bb7b6`)
and `product_reference/collection.py`.*
