/*
  # MC Export Intelligence - Core Database Schema

  ## Overview
  This migration creates the complete database schema for the MC Export Intelligence platform,
  a mission-critical tool for a 6M€ car export company.

  ## New Tables Created

  ### 1. market_studies
  Tracks model/pattern combinations being monitored across source and target countries.
  - Primary fields: name, brand, model_pattern, year range
  - Source market: country, marketplace, search URL
  - Target market: country, marketplace, search URL
  - Pricing: strategy, last computed target price with timestamp
  - Audit: created_at, updated_at with automatic trigger

  ### 2. search_queries
  Records ad-hoc and daily searches on source markets.
  - Fields: date, source/target countries, marketplace, search URL
  - Classification: modele, type_recherche (etude/manuel/test/veille)
  - Optional commentary field
  
  ### 3. listings
  Individual car listings from source markets, tracked over time.
  - Relations: market_study_id, search_query_id (nullable FKs)
  - Source data: site, country, URL, brand, model, year, km, price
  - Target data: export price, estimated margin, MC score
  - Status tracking: new/seen/disappeared/price changes/contacted/bought/rejected
  - Price history: original, current, variation
  - Lifecycle: first_seen_at, last_seen_at, days_online
  - Details: scraped flag, running status, accident suspected
  - Risk analysis: level, flags
  - AI insights: comment, detail comment
  - Media: photos_urls (JSON array)
  - Raw: raw_data (JSON payload from scraper)

  ### 4. job_runs
  Tracks cron job executions and failures.
  - Fields: run_type, started_at, finished_at
  - Status: success/error with message and details (JSON)

  ## Indexes
  - listings: url_annonce (unique), market_study_id, search_query_id
  - listings: composite index on (score_mc DESC, last_seen_at DESC) for dashboard queries
  - listings: status, deal_status for filtering

  ## Security
  - RLS enabled on all tables
  - Policies allow authenticated users full access (internal tool)
  - Future: can be restricted to specific roles

  ## Important Notes
  1. No mock data - schema ready for real production data
  2. All timestamps use timestamptz for correct timezone handling
  3. Updated_at trigger for market_studies ensures audit trail
  4. Flexible status enums allow evolution without schema changes
*/

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- TABLE: market_studies
-- =============================================================================
CREATE TABLE IF NOT EXISTS market_studies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  brand text NOT NULL,
  model_pattern text NOT NULL,
  year_min int,
  year_max int,
  source_country text NOT NULL,
  source_marketplace text NOT NULL,
  source_search_url text NOT NULL,
  target_country text NOT NULL,
  target_marketplace text NOT NULL,
  target_search_url text,
  pricing_strategy text NOT NULL DEFAULT 'mean_5_lowest',
  last_computed_target_export_price_eur numeric(10, 2),
  last_computed_target_export_price_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_market_studies_updated_at
  BEFORE UPDATE ON market_studies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- TABLE: search_queries
-- =============================================================================
CREATE TABLE IF NOT EXISTS search_queries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  date_recherche date NOT NULL,
  source_country text NOT NULL,
  target_country text NOT NULL,
  source_marketplace text NOT NULL,
  source_search_url text NOT NULL,
  modele text NOT NULL,
  type_recherche text NOT NULL CHECK (type_recherche IN ('etude', 'manuel', 'test', 'veille')),
  commentaire text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- =============================================================================
-- TABLE: listings
-- =============================================================================
CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_study_id uuid REFERENCES market_studies(id) ON DELETE SET NULL,
  search_query_id uuid REFERENCES search_queries(id) ON DELETE SET NULL,
  source_site text NOT NULL,
  source_country text NOT NULL,
  target_country text NOT NULL,
  url_annonce text UNIQUE NOT NULL,
  brand text NOT NULL,
  model text NOT NULL,
  year int,
  km int,
  price_eur numeric(10, 2) NOT NULL,
  target_export_price_eur numeric(10, 2),
  estimated_margin_eur numeric(10, 2),
  score_mc numeric(5, 2),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'disappeared', 'price_up', 'price_down', 'contacted', 'bought', 'rejected')),
  deal_status text,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  price_original numeric(10, 2) NOT NULL,
  price_current numeric(10, 2) NOT NULL,
  price_variation_eur numeric(10, 2),
  days_online int,
  details_scraped boolean DEFAULT false NOT NULL,
  is_running boolean,
  is_accident_suspected boolean,
  risk_level text CHECK (risk_level IN ('low', 'medium', 'high')),
  risk_flags text,
  ai_comment text,
  ai_detail_comment text,
  photos_urls jsonb,
  raw_data jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_listings_url ON listings(url_annonce);
CREATE INDEX IF NOT EXISTS idx_listings_market_study ON listings(market_study_id);
CREATE INDEX IF NOT EXISTS idx_listings_search_query ON listings(search_query_id);
CREATE INDEX IF NOT EXISTS idx_listings_score_date ON listings(score_mc DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_deal_status ON listings(deal_status);
CREATE INDEX IF NOT EXISTS idx_listings_source_country ON listings(source_country);
CREATE INDEX IF NOT EXISTS idx_listings_target_country ON listings(target_country);
CREATE INDEX IF NOT EXISTS idx_listings_brand ON listings(brand);

-- =============================================================================
-- TABLE: job_runs
-- =============================================================================
CREATE TABLE IF NOT EXISTS job_runs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_type text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'success', 'error')),
  message text,
  details jsonb
);

-- Index for monitoring
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE market_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;

-- Policies: Allow authenticated users full access (internal tool)
-- Future: can add role-based restrictions

CREATE POLICY "Authenticated users can view market studies"
  ON market_studies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert market studies"
  ON market_studies FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update market studies"
  ON market_studies FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete market studies"
  ON market_studies FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view search queries"
  ON search_queries FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert search queries"
  ON search_queries FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update search queries"
  ON search_queries FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete search queries"
  ON search_queries FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view listings"
  ON listings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert listings"
  ON listings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update listings"
  ON listings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete listings"
  ON listings FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view job runs"
  ON job_runs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert job runs"
  ON job_runs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update job runs"
  ON job_runs FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete job runs"
  ON job_runs FOR DELETE
  TO authenticated
  USING (true);