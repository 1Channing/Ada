/*
  # Enable Realtime for Study Tables

  ## What This Does
  Adds `study_runs` and `study_run_results` tables to the Realtime publication
  so the UI can receive instant push notifications when results are written.

  ## Why This Is Critical
  - Worker writes results to `study_run_results`
  - UI subscribes via Realtime to receive instant updates
  - WITHOUT this migration, Realtime will NOT broadcast changes
  - Result: UI never sees the results until manual refresh

  ## Tables Enabled
  - `study_runs` - for status updates (pending → running → completed)
  - `study_run_results` - for result INSERTs (the actual opportunities!)

  ## Replica Identity
  Setting FULL replica identity ensures Realtime has complete row data
  for both old and new values in UPDATE events.
*/

-- Enable FULL replica identity for better Realtime performance
ALTER TABLE study_runs REPLICA IDENTITY FULL;
ALTER TABLE study_run_results REPLICA IDENTITY FULL;

-- Add tables to the supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE study_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE study_run_results;
