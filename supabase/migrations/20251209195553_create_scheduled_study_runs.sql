/*
  # Create scheduled study runs system

  1. New Table
    - `scheduled_study_runs`
      - `id` (uuid, primary key) - Unique job identifier
      - `created_at` (timestamptz) - When the job was created
      - `scheduled_at` (timestamptz) - When the job should run
      - `status` (text) - Job status: pending, running, completed, failed, cancelled
      - `payload` (jsonb) - Job configuration (study IDs, threshold, type)
      - `last_run_at` (timestamptz) - When the job last attempted to run
      - `last_error` (text) - Error message from last failed run
      - `run_id` (uuid) - Reference to study_runs table when executed

  2. Indexes
    - Index on (status, scheduled_at) for efficient "due jobs" queries

  3. Security
    - Enable RLS on table
    - Only service role can manage scheduled jobs (backend-only table)
*/

CREATE TABLE IF NOT EXISTS public.scheduled_study_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  payload jsonb NOT NULL,
  last_run_at timestamptz,
  last_error text,
  run_id uuid REFERENCES public.study_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_study_runs_due
  ON public.scheduled_study_runs (status, scheduled_at);

ALTER TABLE public.scheduled_study_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scheduled_study_runs'
      AND policyname = 'scheduled_study_runs_service_only'
  ) THEN
    CREATE POLICY "scheduled_study_runs_service_only"
      ON public.scheduled_study_runs
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END$$;
