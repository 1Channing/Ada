/*
  # Create market study definitions table

  1. New Tables
    - `market_study_definitions`
      - `id` (uuid, primary key) - Unique identifier for each definition
      - `brand` (text) - Car brand name
      - `models` (text[]) - Array of model names
      - `year_min` (integer) - Minimum year filter
      - `year_max` (integer) - Maximum year filter
      - `km_max` (integer) - Maximum kilometers filter
      - `generated_links` (jsonb) - Generated marketplace URLs
      - `created_at` (timestamptz) - Creation timestamp

  2. Security
    - Enable RLS on `market_study_definitions` table
    - Add policy for anonymous users to perform all operations
    - Add policy for authenticated users to perform all operations

  3. Performance
    - Add index on created_at for efficient retrieval of recent definitions
*/

CREATE TABLE IF NOT EXISTS market_study_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  models text[] NOT NULL,
  year_min integer NOT NULL,
  year_max integer NOT NULL,
  km_max integer NOT NULL,
  generated_links jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE market_study_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for anon"
  ON market_study_definitions
  FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations for authenticated"
  ON market_study_definitions
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_market_study_definitions_created_at
  ON market_study_definitions(created_at DESC);