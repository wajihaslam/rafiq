-- ===========================================================================
-- Rafiq — name the operation on every gateway exchange, and make the API log
--         searchable by the two references a tester actually has
--
-- Two additions, both in service of "what step is this payment on?".
--
--  1. `transactions.kind` says what a call was *about* (a payment, a
--     tokenization) but not what it *did*. Initiate and verify are both
--     `kind = 'payment'`, so a breadcrumb could only guess at the step by
--     counting rows and reading tea leaves out of the request payload. The
--     operation is known at the call site, so it is recorded there instead.
--
--  2. The API log could be searched by URL, operation and gateway code — none
--     of which narrow anything down when every call is `collection.verify`
--     against the same host. The two references that *do* identify one
--     conversation are the gateway's `transactionId` and our own `userKey`,
--     and both were buried inside jsonb. They are lifted into their own
--     columns on the way in, so the search is an indexed equality rather than
--     a scan through every stored body.
-- ===========================================================================

-- Every table below is unqualified, as everywhere else in this directory. Said
-- explicitly so a client with a different default cannot turn "wrong schema"
-- into "relation does not exist" — which reads exactly like a missing table.
set search_path = public;

-- --- transactions.operation -------------------------------------------------
alter table transactions add column if not exists operation text;

comment on column transactions.operation is
  'The gateway call this row records: initiate | verify | finalize | direct_payment | inquiry | refund | delink | postback. Set at the call site; null on rows written before migration 0009.';

create index if not exists transactions_operation_idx
  on transactions (operation, created_at desc);

-- Best-effort backfill. `kind` settles three of them outright; the rest are
-- inferred from the payload we actually sent, which is the only evidence left.
-- Initiate and a Non-OTP verify are genuinely indistinguishable by payload —
-- both carry msisdn and transactionType and nothing else — so the order's
-- channel breaks that tie, and rows with no order stay null rather than guess.
update transactions t
   set operation = case
     when t.kind = 'delink'         then 'delink'
     when t.kind = 'refund'         then 'refund'
     when t.kind = 'direct_payment' then 'direct_payment'
     when t.request ->> 'sourceId'      is not null then 'direct_payment'
     when t.request ->> 'otp'           is not null then 'verify'
     when t.request ->> 'orderId'       is not null
      and t.request ->> 'msisdn'        is not null then 'finalize'
     when t.request ->> 'transactionId' is not null
      and t.request ->> 'msisdn'        is null     then 'inquiry'
     when t.request ->> 'transactionId' is not null then 'verify'
     when t.request is null                         then 'postback'
     -- A correlated read rather than a join: a row with no order must not be
     -- paired with an arbitrary one, which is what `or order_id is null` in a
     -- FROM clause would silently do.
     when (select o.channel from orders o where o.id = t.order_id)
            = 'wallet_non_otp'                      then 'verify'
     when t.request ->> 'transactionType' is not null then 'initiate'
     else null
   end
 where t.operation is null;

-- --- api_logs: the two references worth searching by ------------------------
alter table api_logs add column if not exists transaction_id text;
alter table api_logs add column if not exists user_key text;

comment on column api_logs.transaction_id is
  'The gateway transactionId seen anywhere in this exchange. Lifted out of the bodies at write time so it can be indexed.';
comment on column api_logs.user_key is
  'Our own reference for the exchange — userKey on wallet calls, orderId on hosted and finalize calls.';

create index if not exists api_logs_transaction_id_idx
  on api_logs (transaction_id, created_at desc);
create index if not exists api_logs_user_key_idx
  on api_logs (user_key, created_at desc);

-- Backfill from the stored bodies. Inquiry nests its answer one level down,
-- hence the third branch on each.
update api_logs
   set transaction_id = coalesce(
         request_body  ->> 'transactionId',
         response_body ->> 'transactionId',
         response_body -> 'transaction' ->> 'transactionId'
       ),
       user_key = coalesce(
         request_body  ->> 'userKey',
         request_body  ->> 'orderId',
         request_body  ->> 'OrderId',
         response_body ->> 'userKey',
         response_body ->> 'orderId'
       )
 where transaction_id is null
   and user_key is null;
