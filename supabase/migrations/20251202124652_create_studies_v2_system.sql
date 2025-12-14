/*
  # Create Studies V2 System

  ## Overview
  This migration creates a parallel system for the new "3-tab" workflow for car sourcing studies.
  This system runs side-by-side with the existing market_studies system without modifying it.

  ## New Tables

  ### 1. `studies_v2`
  Stores studies imported from the 9-column CSV format:
  - `id` (text, primary key) - Unique study identifier (e.g., MS_TOYOTA_RAV4_2022_FR_NL)
  - `brand` (text) - Car brand (e.g., TOYOTA)
  - `model` (text) - Model name (e.g., RAV4)
  - `year` (integer) - Main model year for the study
  - `max_mileage` (integer) - Maximum mileage allowed (0 = no limit)
  - `country_target` (text) - Target market country code (e.g., NL, DK)
  - `market_target_url` (text) - URL to scrape target market
  - `country_source` (text) - Source market country code (e.g., FR)
  - `market_source_url` (text) - URL to scrape source market
  - `created_at` (timestamptz) - When the study was imported
  - `updated_at` (timestamptz) - Last update timestamp

  ### 2. `study_runs`
  Stores execution history of instant and scheduled searches:
  - `id` (uuid, primary key) - Unique run identifier
  - `run_type` (text) - 'instant' or 'scheduled'
  - `scheduled_for` (timestamptz, nullable) - When the run was scheduled for
  - `executed_at` (timestamptz, nullable) - When the run actually executed
  - `status` (text) - 'pending', 'running', 'completed', 'error'
  - `total_studies` (integer) - Number of studies in this run
  - `null_count` (integer) - Number of studies with status NULL (diff < 5000€)
  - `opportunities_count` (integer) - Number of studies with opportunities (diff >= 5000€)
  - `error_message` (text, nullable) - Error details if status = 'error'
  - `created_at` (timestamptz) - When the run was created

  ### 3. `study_run_results`
  Stores per-study results for each run:
  - `id` (uuid, primary key) - Unique result identifier
  - `run_id` (uuid, foreign key → study_runs) - Which run this result belongs to
  - `study_id` (text, foreign key → studies_v2) - Which study this result is for
  - `status` (text) - 'NULL' or 'OPPORTUNITIES'
  - `target_market_price` (numeric, nullable) - Computed median/avg price in target market
  - `best_source_price` (numeric, nullable) - Best price found in source market
  - `price_difference` (numeric, nullable) - target_market_price - best_source_price
  - `target_stats` (jsonb, nullable) - Aggregated target market statistics
  - `created_at` (timestamptz) - When this result was created

  ### 4. `study_source_listings`
  Stores detailed "interesting" source listings (only when status = 'OPPORTUNITIES'):
  - `id` (uuid, primary key) - Unique listing identifier
  - `run_result_id` (uuid, foreign key → study_run_results) - Which result this listing belongs to
  - `listing_url` (text) - Original marketplace listing URL
  - `title` (text) - Listing title
  - `price` (numeric) - Price in euros
  - `mileage` (integer, nullable) - Mileage in km
  - `year` (integer, nullable) - Vehicle year
  - `trim` (text, nullable) - Trim/version
  - `is_damaged` (boolean) - Whether vehicle is damaged (from AI analysis)
  - `defects_summary` (text, nullable) - AI-extracted defects summary
  - `maintenance_summary` (text, nullable) - AI-extracted maintenance history
  - `options_summary` (text, nullable) - AI-extracted valuable options/equipment
  - `full_description` (text, nullable) - Original full description
  - `created_at` (timestamptz) - When this listing was stored

  ## Security
  - All tables have RLS enabled
  - Policies allow full CRUD access to authenticated users
  - This is an internal tool, so permissive policies are appropriate

  ## Notes
  - This system is completely independent from the existing market_studies table
  - CSV uploads to studies_v2 will DELETE all existing rows and replace them
  - Target market listings are never stored individually (only aggregated stats)
  - Source listings are only stored when price difference >= 5000€
*/

-- Create studies_v2 table
CREATE TABLE IF NOT EXISTS studies_v2 (
  id text PRIMARY KEY,
  brand text NOT NULL,
  model text NOT NULL,
  year integer NOT NULL,
  max_mileage integer NOT NULL DEFAULT 0,
  country_target text NOT NULL,
  market_target_url text NOT NULL,
  country_source text NOT NULL,
  market_source_url text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE studies_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on studies_v2"
  ON studies_v2
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create study_runs table
CREATE TABLE IF NOT EXISTS study_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL CHECK (run_type IN ('instant', 'scheduled')),
  scheduled_for timestamptz,
  executed_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'error')),
  total_studies integer NOT NULL DEFAULT 0,
  null_count integer NOT NULL DEFAULT 0,
  opportunities_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE study_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on study_runs"
  ON study_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create study_run_results table
CREATE TABLE IF NOT EXISTS study_run_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES study_runs(id) ON DELETE CASCADE,
  study_id text NOT NULL REFERENCES studies_v2(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('NULL', 'OPPORTUNITIES')),
  target_market_price numeric,
  best_source_price numeric,
  price_difference numeric,
  target_stats jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE study_run_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on study_run_results"
  ON study_run_results
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create study_source_listings table
CREATE TABLE IF NOT EXISTS study_source_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_result_id uuid NOT NULL REFERENCES study_run_results(id) ON DELETE CASCADE,
  listing_url text NOT NULL,
  title text NOT NULL,
  price numeric NOT NULL,
  mileage integer,
  year integer,
  trim text,
  is_damaged boolean DEFAULT false,
  defects_summary text,
  maintenance_summary text,
  options_summary text,
  full_description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE study_source_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on study_source_listings"
  ON study_source_listings
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_study_runs_status ON study_runs(status);
CREATE INDEX IF NOT EXISTS idx_study_runs_executed_at ON study_runs(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_run_results_run_id ON study_run_results(run_id);
CREATE INDEX IF NOT EXISTS idx_study_run_results_study_id ON study_run_results(study_id);
CREATE INDEX IF NOT EXISTS idx_study_source_listings_run_result_id ON study_source_listings(run_result_id);
