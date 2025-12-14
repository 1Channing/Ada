/*
  # Add configurable price difference threshold to study runs

  1. Changes to `study_runs` table
    - Add `price_diff_threshold_eur` column (numeric, default 5000)
      - Stores the minimum price difference threshold used for this run
      - All comparisons are done in EUR after currency conversion

  2. Purpose
    - Allows users to configure the threshold at runtime
    - Historical runs preserve the threshold that was used
    - Enables better analysis of opportunity detection sensitivity
*/

-- Add price_diff_threshold_eur column to study_runs
ALTER TABLE study_runs 
ADD COLUMN IF NOT EXISTS price_diff_threshold_eur NUMERIC NOT NULL DEFAULT 5000;

-- Add index for common query patterns
CREATE INDEX IF NOT EXISTS idx_study_runs_threshold 
ON study_runs(price_diff_threshold_eur);
