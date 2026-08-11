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
