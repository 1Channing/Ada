/*
  # Add execution fields to market_study_definitions

  1. Changes
    - Add `target_count` (integer) - Target number of listings to scrape
    - Add `results` (jsonb) - Array of scraped listing snapshots (structured data only, no full HTML)
    - Add `status` (text) - Execution status: 'pending', 'running', 'completed', 'failed'
    - Add `error_message` (text, nullable) - Error details if execution failed
    - Add `executed_at` (timestamptz, nullable) - When the study was last executed
    - Add `execution_duration_ms` (integer, nullable) - How long execution took

  2. Notes
    - target_count: stops pagination immediately once this many listings are inserted
    - results: stores only small JSON snapshots with extracted fields, NOT full HTML
    - status tracking enables UI to show execution progress
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_study_definitions' AND column_name = 'target_count'
  ) THEN
    ALTER TABLE market_study_definitions ADD COLUMN target_count integer NOT NULL DEFAULT 50;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_study_definitions' AND column_name = 'results'
  ) THEN
    ALTER TABLE market_study_definitions ADD COLUMN results jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_study_definitions' AND column_name = 'status'
  ) THEN
    ALTER TABLE market_study_definitions ADD COLUMN status text NOT NULL DEFAULT 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_study_definitions' AND column_name = 'error_message'
  ) THEN
    ALTER TABLE market_study_definitions ADD COLUMN error_message text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_study_definitions' AND column_name = 'executed_at'
  ) THEN
    ALTER TABLE market_study_definitions ADD COLUMN executed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_study_definitions' AND column_name = 'execution_duration_ms'
  ) THEN
    ALTER TABLE market_study_definitions ADD COLUMN execution_duration_ms integer;
  END IF;
END $$;