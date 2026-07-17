/*
  # Enrich per-listing market observations

  Additive only. Each observation now carries its OWN attributes (listing_url,
  title, canonical fuel, trim, power, country), so the Market Intelligence
  dashboard can filter/segment at the listing grain (a search without a fuel/
  trim filter returns mixed listings) and link straight to each ad — instead of
  fragmenting into one segment per trim.

  `fuel` here holds the per-listing canonical token ('electric', 'hybrid', …);
  `trim` holds the listing's own version. Existing rows keep their (segment-
  level) values — no backfill needed.
*/

ALTER TABLE market_listing_observations
  ADD COLUMN IF NOT EXISTS listing_url text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS power_din integer,
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_market_obs_filter
  ON market_listing_observations (site, brand, model, fuel, trim, scraped_at DESC);
