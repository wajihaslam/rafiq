-- ===========================================================================
-- Rafiq — catalogue priced for live gateway testing
--
-- The seeded catalogue used realistic retail prices (Rs 149 – Rs 12,999), which
-- is the wrong shape for testing against a real wallet: every run either
-- exceeds a test wallet's balance or its per-transaction threshold, and 0009 /
-- 0016 / 0027 crowd out the codes you actually wanted to exercise.
--
-- Everything is therefore re-priced into the Rs 5 – Rs 200 band, keeping the
-- catalogue's relative order so the cart still reads sensibly: the cable is
-- still the cheapest thing and the watch still the dearest.
--
-- Matched on slug, so this is safe to re-run and does not depend on ids.
-- ===========================================================================

update products set price = 5   where slug = 'usb-c-cable-2m';
update products set price = 10  where slug = 'rafiq-plus-weekly';
update products set price = 30  where slug = 'rafiq-plus-monthly';
update products set price = 50  where slug = 'laptop-sleeve';
update products set price = 100 where slug = 'power-bank-20k';
update products set price = 150 where slug = 'wireless-earbuds';
update products set price = 200 where slug = 'smart-watch';

-- Existing subscriptions carry their own copy of the amount, taken at signup.
-- Left alone on purpose: what a customer agreed to pay is not something a
-- catalogue re-pricing gets to change behind their back. Cancel and re-subscribe
-- to move an existing subscription onto the new amount.
