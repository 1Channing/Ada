/*
  # Add stop_reason column to linkgen_mapping_runs

  1. Purpose
    - Track why the crawler stopped (queue exhausted vs max steps reached)
    - Helps understand crawler behavior and effectiveness

  2. Changes
    - Add `stop_reason` column to `linkgen_mapping_runs` table
    - Optional text field with two possible values: 'queue_exhausted' or 'max_steps_reached'

  3. Notes
    - Existing records will have NULL stop_reason (no backfill needed)
    - New crawls will always set this value
*/

-- Add stop_reason column
ALTER TABLE linkgen_mapping_runs
ADD COLUMN IF NOT EXISTS stop_reason text;

-- Add comment for documentation
COMMENT ON COLUMN linkgen_mapping_runs.stop_reason IS 
  'Reason the crawler stopped: queue_exhausted or max_steps_reached';
