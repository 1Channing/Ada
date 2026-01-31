/*
  # Create linkgen_url_samples table

  1. Purpose
    - Store collected sample URLs from marketplaces for link generator analysis
    - Enable diversity and quality analysis of search results across markets
    - Support data-driven link generation improvements

  2. New Tables
    - `linkgen_url_samples`
      - `id` (uuid, primary key) - Unique sample identifier
      - `marketplace` (text, not null) - Marketplace name (e.g., MARKTPLAATS, LEBONCOIN)
      - `listing_url` (text, not null) - Full URL to the listing
      - `internal_ref` (text, not null, unique) - Deterministic reference (marketplace + listing ID)
      - `brand` (text, nullable) - Extracted brand name if available
      - `model` (text, nullable) - Extracted model name if available
      - `year` (integer, nullable) - Extracted year if available
      - `fuel` (text, nullable) - Extracted fuel type if available
      - `mileage` (integer, nullable) - Extracted mileage if available
      - `country` (text, not null, default 'NL') - Country code
      - `source_seed` (text, nullable) - Original seed URL used for collection
      - `raw` (jsonb, nullable) - Small structured JSON metadata (never HTML)
      - `scraped_at` (timestamptz, not null, default now()) - When this sample was collected

  3. Indexes
    - Unique constraint on `internal_ref` to prevent duplicates
    - Composite index on (marketplace, scraped_at desc) for recent samples per market
    - Composite index on (brand, model) for diversity analysis

  4. Security
    - Enable RLS with permissive policies for both anon and authenticated
    - Grant full access to anon and authenticated roles (internal tool pattern)

  5. Notes
    - This is an additive-only feature for internal tooling
    - The raw field stores ONLY small structured JSON (extraction metadata), never HTML
    - Diversity rule enforced at application level: max 3 samples per (brand, model) per run
    - Deduplication handled via upsert on internal_ref with ignoreDuplicates
*/

-- Create table
CREATE TABLE IF NOT EXISTS linkgen_url_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace text NOT NULL,
  listing_url text NOT NULL,
  internal_ref text NOT NULL UNIQUE,
  brand text,
  model text,
  year integer,
  fuel text,
  mileage integer,
  country text NOT NULL DEFAULT 'NL',
  source_seed text,
  raw jsonb,
  scraped_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_linkgen_url_samples_marketplace_date
  ON linkgen_url_samples(marketplace, scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkgen_url_samples_brand_model
  ON linkgen_url_samples(brand, model);

-- Enable RLS
ALTER TABLE linkgen_url_samples ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for internal tool access
CREATE POLICY "Allow all operations for anon"
  ON linkgen_url_samples
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations for authenticated"
  ON linkgen_url_samples
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON linkgen_url_samples TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON linkgen_url_samples TO authenticated;
