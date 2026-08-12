-- ===========================================================================
-- Rafiq — which sequence tokenization runs
--
-- Guide §2 says tokenization is *exempt* from the flow split: linking a wallet
-- always runs `initiate` → `verify` with an OTP, on both flows. The app was
-- built to that, and hard-coded it.
--
-- The gateway at 3.127.43.66:8001 disagrees. Probed directly:
--
--   initiate  transactionType 8, MID 7000333  ->  0015 Invalid-Flow
--   initiate  transactionType 8, MID 7000222  ->  0015 Invalid-Flow
--   initiate  transactionType 0, MID 7000333  ->  0000 Success + transactionId
--   verify    transactionType 8, no otp       ->  0011 Invalid-OTP
--   verify    transactionType 8, with otp     ->  sourceId minted
--
-- So `initiate` is refused whenever transactionType is 8, on every merchant,
-- whatever flow it is on — while `verify` alone mints the token. Note the third
-- line: the same MID accepts `initiate` for an ordinary payment, so this is not
-- a merchant provisioned on Non-OTP. It is tokenization specifically.
--
-- Which of the two is true of *your* gateway is a fact about the deployment, not
-- a preference, so it becomes a setting rather than a guess or a retry. The
-- default is `initiate_verify` — the documented behaviour — so a gateway that
-- follows the guide is unaffected by this migration.
-- ===========================================================================

set search_path = public;

alter table gateway_settings
  add column if not exists tokenization_sequence text
    check (tokenization_sequence is null
           or tokenization_sequence in ('initiate_verify', 'verify_only'));

comment on column gateway_settings.tokenization_sequence is
  'How an Easypaisa wallet link runs: initiate_verify (guide §2 — initiate sends the OTP, verify redeems it) or verify_only (initiate answers 0015 for transactionType 8; verify with an OTP mints the token on its own). Null falls back to COLLECTION_TOKENIZATION_SEQUENCE, then to initiate_verify.';

-- This deployment's gateway is the verify_only kind, as probed above. Set only
-- where nothing has been chosen, so /settings stays the authority.
update gateway_settings
   set tokenization_sequence = coalesce(tokenization_sequence, 'verify_only')
 where id;
