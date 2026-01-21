/*
  # Enable Realtime for Scheduled Study Runs

  ## Critical Fix
  The `scheduled_study_runs` table was missing from the Realtime publication,
  causing the UI to never receive completion events. This resulted in:
  - 5-minute timeouts on every study
  - Widget showing "1 running" forever
  - No progression to next study in batch

  ## What This Does
  Adds `scheduled_study_runs` to the Realtime publication so the UI can
  receive instant push notifications when:
  - status changes from 'pending' → 'running' → 'completed'
  - Worker updates the job status

  ## Impact
  - Studies complete in 30-60s instead of timing out at 5 minutes
  - Batch processing flows smoothly
  - Widget updates in real-time
*/

-- Enable FULL replica identity for complete Realtime data
ALTER TABLE scheduled_study_runs REPLICA IDENTITY FULL;

-- Add table to the supabase_realtime publication
DO $$
BEGIN
  -- Check if the table is already in the publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'scheduled_study_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE scheduled_study_runs;
  END IF;
END $$;
