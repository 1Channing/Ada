/*
  # Add cancel_requested column to study_runs table
  
  ## What This Does
  Adds a `cancel_requested` boolean column to the `study_runs` table to persist
  the cancel state across page navigation and browser refreshes.
  
  ## Why This Is Needed
  - Currently, cancel state is stored in React component state only
  - When user navigates away from "Run Searches" page, cancel button disappears
  - This column allows the UI to restore cancel state on page load
  - Enables "Cancel Run" button to persist across navigation
  
  ## Changes
  - Adds `cancel_requested` boolean column with default FALSE
  - Allows tracking if user requested to cancel a batch run
  - UI can check this column to show/hide cancel button
  
  ## Impact
  - Better UX: Cancel button persists across page navigation
  - Cleaner state management: Database is source of truth
  - No breaking changes: Existing runs default to FALSE
*/

-- Add cancel_requested column to study_runs table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study_runs' AND column_name = 'cancel_requested'
  ) THEN
    ALTER TABLE study_runs ADD COLUMN cancel_requested BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add index for faster queries on active runs with cancel requests
CREATE INDEX IF NOT EXISTS idx_study_runs_cancel_requested 
ON study_runs(status, cancel_requested) 
WHERE status = 'running';
