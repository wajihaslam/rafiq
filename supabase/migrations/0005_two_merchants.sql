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
