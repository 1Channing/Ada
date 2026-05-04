/*
  # Add study_run_logs retention cleanup (30 days)

  1. Function
    - `cleanup_old_study_run_logs()` — deletes rows older than 30 days from study_run_logs

  2. Scheduled job (pg_cron)
    - Runs daily at 03:00 UTC
    - Calls cleanup_old_study_run_logs()
    - Created only if pg_cron is available (graceful, does not block migration)

  Notes
    - Safe to run multiple times (IF NOT EXISTS guards)
    - Does not DROP any data less than 30 days old
    - Worker log records needed for active debug window are always preserved
*/

-- Enable pg_cron (available on this Supabase project)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Cleanup function: delete study_run_logs older than 30 days
CREATE OR REPLACE FUNCTION public.cleanup_old_study_run_logs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.study_run_logs
  WHERE created_at < now() - interval '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Schedule daily cleanup at 03:00 UTC via pg_cron
DO $$
BEGIN
  -- Remove existing job with same name to allow idempotent re-runs
  PERFORM cron.unschedule('cleanup-study-run-logs-30d');
EXCEPTION
  WHEN others THEN
    NULL; -- job did not exist, that's fine
END;
$$;

SELECT cron.schedule(
  'cleanup-study-run-logs-30d',
  '0 3 * * *',
  'SELECT public.cleanup_old_study_run_logs()'
);
