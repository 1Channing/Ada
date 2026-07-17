/*
  # Market intelligence: time-series market snapshots + per-listing observations

  Additive only. Every confirmed ingestion records the state of a market
  segment at that instant, so ADA builds a macro view of the European used-car
  market (depth, prices over time, price distribution, velocity) on top of the
  arbitrage work — the "mirador".

  1. market_snapshots — one aggregate row per scrape of a segment at a time.
     Segment = site + brand + model + fuel + trim (+ country). Cheap, indexed
     by (segment, scraped_at); powers depth / median-over-time / country charts.

  2. market_listing_observations — one row per listing per snapshot. Heavier,
     but enables the price distribution and velocity (a listing's lifetime =
     first_seen → last_seen across snapshots of its segment).
*/

CREATE TABLE IF NOT EXISTS market_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site text NOT NULL,
  country text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  fuel text NOT NULL DEFAULT '',
  trim text NOT NULL DEFAULT '',
  scraped_at timestamptz NOT NULL DEFAULT now(),
  listing_count integer,          -- real total the site reports, when readable
  sample_size integer NOT NULL DEFAULT 0,
  price_min numeric,
  price_p25 numeric,
  price_median numeric,
  price_p75 numeric,
  price_max numeric,
  price_avg numeric,
  currency text NOT NULL DEFAULT 'EUR',
  source_url text,
  submitted_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_segment
  ON market_snapshots (site, brand, model, fuel, trim, scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_scraped_at
  ON market_snapshots (scraped_at DESC);

CREATE TABLE IF NOT EXISTS market_listing_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES market_snapshots(id) ON DELETE CASCADE,
  site text NOT NULL,
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  fuel text NOT NULL DEFAULT '',
  trim text NOT NULL DEFAULT '',
  internal_ref text NOT NULL,
  price numeric,
  year integer,
  mileage integer,
  currency text NOT NULL DEFAULT 'EUR',
  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_obs_segment_ref
  ON market_listing_observations (site, brand, model, fuel, trim, internal_ref);
CREATE INDEX IF NOT EXISTS idx_market_obs_snapshot
  ON market_listing_observations (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_market_obs_scraped_at
  ON market_listing_observations (scraped_at DESC);

ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_listing_observations ENABLE ROW LEVEL SECURITY;

-- Read for everyone, insert for everyone (same anon+auth pattern as the rest);
-- append-only, no client UPDATE/DELETE.
CREATE POLICY "anon_select_market_snapshots" ON market_snapshots FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_market_snapshots" ON market_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_insert_market_snapshots" ON market_snapshots FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "auth_insert_market_snapshots" ON market_snapshots FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "anon_select_market_obs" ON market_listing_observations FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_market_obs" ON market_listing_observations FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_insert_market_obs" ON market_listing_observations FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "auth_insert_market_obs" ON market_listing_observations FOR INSERT TO authenticated WITH CHECK (true);
