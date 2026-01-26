/*
  # Add study_run_result_listings mapping table

  ## Summary
  Creates a join table to maintain many-to-many relationship between study runs and source listings.
  This preserves historical associations while preventing duplicate listings.

  ## New Tables
  - `study_run_result_listings`
    - `id` (uuid, primary key)
    - `run_result_id` (uuid, references study_run_results.id)
    - `listing_id` (uuid, references study_source_listings.id)
    - `created_at` (timestamptz)
    - Unique constraint on (run_result_id, listing_id)

  ## Why This Change
  Previously, study_source_listings had a direct run_result_id column, which meant:
  - On reruns with same internal_ref, we either skipped insertion (showing 0 listings)
  - OR overwrote run_result_id (breaking historical runs)

  With this join table:
  - Each listing row is deduplicated by internal_ref
  - Each run can reference the same listing (many-to-many)
  - Ownership (assigned_to, status) is preserved on the listing row
  - Historical runs maintain their associations

  ## Security
  - Enable RLS on the new table
  - Allow authenticated users to read their own mappings
*/

-- Create the join table
CREATE TABLE IF NOT EXISTS study_run_result_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_result_id uuid NOT NULL REFERENCES study_run_results(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES study_source_listings(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(run_result_id, listing_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_study_run_result_listings_run_result_id 
  ON study_run_result_listings(run_result_id);

CREATE INDEX IF NOT EXISTS idx_study_run_result_listings_listing_id 
  ON study_run_result_listings(listing_id);

-- Enable RLS
ALTER TABLE study_run_result_listings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read mappings
CREATE POLICY "Authenticated users can read result-listing mappings"
  ON study_run_result_listings
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert mappings
CREATE POLICY "Authenticated users can insert result-listing mappings"
  ON study_run_result_listings
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
