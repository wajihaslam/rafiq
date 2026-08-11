-- ===========================================================================
-- Rafiq — the base URL now carries the gateway prefix
--
-- `gateway_settings.base_url` used to be the origin alone, with the client
-- appending COLLECTION_GATEWAY_PREFIX ('/mock/collection') to it. The client
-- now appends the endpoint path verbatim instead, starting at the version
-- segment, so the prefix has to live in the stored value.
--
-- Storing the whole thing is what makes the setting honest: what you see on
-- /settings is what a request is addressed to, with nothing spliced in behind
-- your back. The previous split produced
-- '/mock/collection/mock/collection/v2/…' the moment someone pasted the URL
-- they had actually been given.
--
-- Both statements are idempotent, so this is safe to re-run.
-- ===========================================================================

-- 1. Repair a value that already had the prefix doubled by the old client.
update gateway_settings
   set base_url = replace(base_url, '/mock/collection/mock/collection',
                                    '/mock/collection')
 where id and base_url like '%/mock/collection/mock/collection%';

-- 2. Add the prefix to a bare origin — including the one migration 0003
--    seeded. A base URL that already carries a path is left alone: it points
--    at a gateway with a different prefix, which is now expressible.
update gateway_settings
   set base_url = rtrim(base_url, '/') || '/mock/collection'
 where id
   and base_url is not null
   -- no path beyond the origin: 'scheme://host[:port]' and nothing more
   and base_url ~ '^https?://[^/]+/?$';
