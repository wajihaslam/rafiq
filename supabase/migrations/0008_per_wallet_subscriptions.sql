-- ===========================================================================
-- Rafiq — one subscription per wallet, and one charge per period
--
-- Two corrections to 0001, both exposed by subscribing from the per-operator
-- panels on /subscriptions:
--
--  1. `unique (user_id, product_id)` allowed a customer only one subscription
--     to a plan across *all* their wallets, so subscribing the same plan on
--     Easypaisa and on JazzCash was impossible — the second attempt came back
--     0005. The wallet is part of what makes a subscription distinct, so it
--     belongs in the key.
--
--  2. `subscription_charges` had no key on the period, so a manual "Pay now"
--     racing the scheduler could bill the same period twice. Making the period
--     unique per subscription turns that into a database error we can catch
--     *before* any money moves, rather than a duplicate charge we discover
--     afterwards.
-- ===========================================================================

alter table subscriptions
  drop constraint if exists subscriptions_user_id_product_id_key;

-- A customer may hold the same plan on two wallets, but not twice on one.
alter table subscriptions
  add constraint subscriptions_user_product_token_key
  unique (user_id, product_id, payment_token_id);

-- Existing duplicate periods, if any, are collapsed first — keeping the oldest
-- row, which is the charge that actually ran.
delete from subscription_charges c
using subscription_charges keep
where c.subscription_id = keep.subscription_id
  and c.period_start    = keep.period_start
  -- id breaks the tie when two rows share a timestamp, so exactly one survives
  and (c.created_at, c.id) > (keep.created_at, keep.id);

alter table subscription_charges
  add constraint subscription_charges_period_key
  unique (subscription_id, period_start);
