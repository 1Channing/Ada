/*
  # Enable Realtime for linkgen_ingestion_events

  Additive only. Lets the Ingestion History page receive new ingestion rows
  live (as the 5 contributors add links), same pattern as study_runs /
  study_run_results.
*/

ALTER TABLE linkgen_ingestion_events REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE linkgen_ingestion_events;
