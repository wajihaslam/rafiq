-- Demo catalogue. Prices are PKR with at most 2 decimals — the gateway
-- rejects anything else with 0002 Invalid-Product/Amount.

insert into products (slug, name, description, image_url, price, kind, interval_days) values
  ('wireless-earbuds', 'Wireless Earbuds',
   'Bluetooth 5.3 earbuds with charging case and 24h total playback.',
   'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&q=80',
   4999.00, 'one_time', null),

  ('power-bank-20k', '20,000 mAh Power Bank',
   'Dual USB-C PD output, charges a phone four times over.',
   'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=800&q=80',
   3499.00, 'one_time', null),

  ('smart-watch', 'Smart Watch Series 4',
   'AMOLED display, heart-rate and SpO2 tracking, 7-day battery.',
   'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80',
   12999.00, 'one_time', null),

  ('usb-c-cable-2m', 'USB-C Braided Cable (2m)',
   '60W fast-charge braided cable, tangle free.',
   'https://images.unsplash.com/photo-1601524909162-ae8725290836?w=800&q=80',
   899.00, 'one_time', null),

  ('laptop-sleeve', 'Laptop Sleeve 14"',
   'Water-resistant padded sleeve with an accessory pocket.',
   'https://images.unsplash.com/photo-1547949003-9792a18a2601?w=800&q=80',
   2499.00, 'one_time', null),

  ('rafiq-plus-monthly', 'Rafiq Plus — Monthly',
   'Free delivery, early access to drops and priority support. Charged every 30 days to your saved wallet.',
   'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&q=80',
   499.00, 'subscription', 30),

  ('rafiq-plus-weekly', 'Rafiq Plus — Weekly',
   'All of Rafiq Plus, billed every 7 days. Cancel any time.',
   'https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1?w=800&q=80',
   149.00, 'subscription', 7);
