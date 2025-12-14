/*
  # Add TARGET_BLOCKED status for provider restrictions

  1. Changes
    - Add `target_error_reason` column to `study_run_results` to store error messages
    - Update status CHECK constraint to include 'TARGET_BLOCKED' status
    - This allows the system to explicitly mark when a target marketplace is blocked by the scraping provider

  2. Use Cases
    - When Bilbasen.dk (or other sites) are blocked by Bright Data due to robots.txt restrictions
    - Provides clear indication to users that the target market cannot be scraped with current provider configuration
    - Stores the specific error message from the provider for troubleshooting

  3. Notes
    - Backward compatible: existing 'NULL' and 'OPPORTUNITIES' statuses remain valid
    - `target_error_reason` is nullable so existing rows are not affected
*/

-- Add target_error_reason column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study_run_results' AND column_name = 'target_error_reason'
  ) THEN
    ALTER TABLE study_run_results ADD COLUMN target_error_reason text;
  END IF;
END $$;

-- Update the status CHECK constraint to include TARGET_BLOCKED
ALTER TABLE study_run_results DROP CONSTRAINT IF EXISTS study_run_results_status_check;
ALTER TABLE study_run_results ADD CONSTRAINT study_run_results_status_check
  CHECK (status IN ('NULL', 'OPPORTUNITIES', 'TARGET_BLOCKED'));
