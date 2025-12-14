/*
  # Fix RLS policies for scheduled_study_runs

  The initial policy was too restrictive - it only allowed service role access.
  This update allows:
  - Anyone can INSERT new scheduled jobs (from frontend)
  - Anyone can SELECT their jobs (to show next scheduled run)
  - Only service role can UPDATE/DELETE (backend worker only)
*/

-- Drop the overly restrictive policy
DROP POLICY IF EXISTS "scheduled_study_runs_service_only" ON public.scheduled_study_runs;

-- Allow anyone to insert scheduled jobs
CREATE POLICY "scheduled_study_runs_insert"
  ON public.scheduled_study_runs
  FOR INSERT
  WITH CHECK (true);

-- Allow anyone to view scheduled jobs
CREATE POLICY "scheduled_study_runs_select"
  ON public.scheduled_study_runs
  FOR SELECT
  USING (true);

-- Only service role can update jobs (backend worker)
CREATE POLICY "scheduled_study_runs_update"
  ON public.scheduled_study_runs
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Only service role can delete jobs (cleanup)
CREATE POLICY "scheduled_study_runs_delete"
  ON public.scheduled_study_runs
  FOR DELETE
  USING (auth.role() = 'service_role');
