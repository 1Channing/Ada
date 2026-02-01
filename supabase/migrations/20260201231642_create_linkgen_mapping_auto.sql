/*
  # Create Mapping Auto Tables

  1. Purpose
    - Enable automated crawling of marketplace listings to discover URL patterns
    - Support diversity-driven sampling to avoid repetitive data
    - Extract mapping hints for brand/model identification
    - Isolated from existing study execution pipeline

  2. New Tables
    - `linkgen_mapping_runs`
      - Tracks each crawl job with status and counters
      - Records seed URL, target steps, progress metrics
      - Stores error information for debugging

    - `linkgen_mapping_samples`
      - Stores every visited listing with extracted data
      - Records discovery chain (which page found this URL)
      - Links to parent run via run_id
      - Minimal structured data only (no HTML)

    - `linkgen_mapping_candidates`
      - Aggregates mapping hints from URL patterns
      - Tracks brand_id and model_slug patterns
      - Maintains occurrence counts for confidence scoring

  3. Indexes
    - Fast lookups by run_id, marketplace, date ranges
    - Brand/model queries for diversity algorithm
    - Deduplication via internal_ref

  4. Security
    - Enable RLS on all tables
    - Permissive policies for anon and authenticated (internal tool pattern)
    - Explicit grants for all operations

  5. Constraints
    - No modifications to existing tables
    - Fully isolated from studies_v2 system
    - Read-only imports of existing parsers
*/

-- ============================================================================
-- TABLE: linkgen_mapping_runs
-- ============================================================================
CREATE TABLE IF NOT EXISTS linkgen_mapping_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace text NOT NULL,
  seed_listing_url text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  target_steps int NOT NULL DEFAULT 100,
  steps_done int NOT NULL DEFAULT 0,
  inserted_samples int NOT NULL DEFAULT 0,
  deduped_samples int NOT NULL DEFAULT 0,
  skipped_diversity int NOT NULL DEFAULT 0,
  errors_count int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  last_error text,
  CONSTRAINT valid_status CHECK (status IN ('running', 'completed', 'failed'))
);

-- Indexes for linkgen_mapping_runs
CREATE INDEX IF NOT EXISTS idx_linkgen_mapping_runs_started_at
  ON linkgen_mapping_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkgen_mapping_runs_status_started
  ON linkgen_mapping_runs(status, started_at DESC);

-- ============================================================================
-- TABLE: linkgen_mapping_samples
-- ============================================================================
CREATE TABLE IF NOT EXISTS linkgen_mapping_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES linkgen_mapping_runs(id) ON DELETE CASCADE,
  marketplace text NOT NULL,
  listing_url text NOT NULL,
  internal_ref text NOT NULL,
  brand text,
  model text,
  year int,
  mileage int,
  price_eur int,
  currency text,
  discovered_from_url text,
  step_index int NOT NULL,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb
);

-- Indexes for linkgen_mapping_samples
CREATE UNIQUE INDEX IF NOT EXISTS idx_linkgen_mapping_samples_marketplace_ref
  ON linkgen_mapping_samples(marketplace, internal_ref);

CREATE INDEX IF NOT EXISTS idx_linkgen_mapping_samples_run_step
  ON linkgen_mapping_samples(run_id, step_index);

CREATE INDEX IF NOT EXISTS idx_linkgen_mapping_samples_marketplace_date
  ON linkgen_mapping_samples(marketplace, scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkgen_mapping_samples_brand_model
  ON linkgen_mapping_samples(brand, model);

-- ============================================================================
-- TABLE: linkgen_mapping_candidates
-- ============================================================================
CREATE TABLE IF NOT EXISTS linkgen_mapping_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace text NOT NULL,
  brand text,
  model text,
  brand_id text,
  model_slug text,
  source_url text NOT NULL,
  occurrences int NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- Create unique constraint using coalesced values
-- This ensures we don't have duplicates based on marketplace + brand + model + brand_id + model_slug
CREATE UNIQUE INDEX IF NOT EXISTS idx_linkgen_mapping_candidates_unique
  ON linkgen_mapping_candidates(
    marketplace,
    COALESCE(brand, ''),
    COALESCE(model, ''),
    COALESCE(brand_id, ''),
    COALESCE(model_slug, '')
  );

CREATE INDEX IF NOT EXISTS idx_linkgen_mapping_candidates_marketplace
  ON linkgen_mapping_candidates(marketplace, last_seen_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE linkgen_mapping_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkgen_mapping_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkgen_mapping_candidates ENABLE ROW LEVEL SECURITY;

-- Permissive policies for anon (internal tool pattern)
CREATE POLICY "Allow all operations for anon on mapping_runs"
  ON linkgen_mapping_runs
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for anon on mapping_samples"
  ON linkgen_mapping_samples
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for anon on mapping_candidates"
  ON linkgen_mapping_candidates
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- Permissive policies for authenticated
CREATE POLICY "Allow all operations for authenticated on mapping_runs"
  ON linkgen_mapping_runs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for authenticated on mapping_samples"
  ON linkgen_mapping_samples
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for authenticated on mapping_candidates"
  ON linkgen_mapping_candidates
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- GRANTS
-- ============================================================================

-- Grant permissions to anon
GRANT SELECT, INSERT, UPDATE, DELETE ON linkgen_mapping_runs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON linkgen_mapping_samples TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON linkgen_mapping_candidates TO anon;

-- Grant permissions to authenticated
GRANT SELECT, INSERT, UPDATE, DELETE ON linkgen_mapping_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON linkgen_mapping_samples TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON linkgen_mapping_candidates TO authenticated;
