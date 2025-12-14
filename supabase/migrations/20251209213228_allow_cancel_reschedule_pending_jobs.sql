/*
  # Allow users to cancel and reschedule pending scheduled jobs

  1. Changes
    - Allow UPDATE on scheduled_study_runs for pending jobs only
    - Users can update:
      - status (to cancel: pending → cancelled)
      - scheduled_at (to reschedule)
    - Service role retains full UPDATE access for worker operations

  2. Security
    - Users can ONLY update jobs that are currently 'pending'
    - Users can ONLY set status to 'pending' or 'cancelled' (not 'running', 'completed', 'failed')
    - Service role (worker) retains unrestricted UPDATE access
*/

-- Drop the existing restrictive update policy
DROP POLICY IF EXISTS "scheduled_study_runs_update" ON public.scheduled_study_runs;

-- Allow service role full UPDATE access (for worker)
CREATE POLICY "scheduled_study_runs_update_service"
  ON public.scheduled_study_runs
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Allow users to update pending jobs (cancel or reschedule)
CREATE POLICY "scheduled_study_runs_update_pending"
  ON public.scheduled_study_runs
  FOR UPDATE
  USING (status = 'pending')
  WITH CHECK (status IN ('pending', 'cancelled'));
