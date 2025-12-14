/*
  # Create Study Run Logs Table

  1. New Table
    - `study_run_logs` - Stores persisted logs and metadata for each study run
      - `id` (uuid, primary key)
      - `study_run_id` (text, indexed) - Matches the in-memory run ID
      - `created_at` (timestamptz) - When the log was created
      - `status` (text) - Final status of the run (SUCCESS, NO_SOURCE_RESULTS, etc.)
      - `last_stage` (text) - Last stage before completion/error
      - `error_message` (text) - Error message if any
      - `logs_json` (jsonb) - Full array of progress events

  2. Purpose
    - Persist study run logs for debugging and analysis
    - Survives page reloads and session loss
    - Enable historical review of run outcomes
*/

create table if not exists study_run_logs (
  id uuid primary key default gen_random_uuid(),
  study_run_id text not null,
  created_at timestamptz not null default now(),
  status text not null,
  last_stage text,
  error_message text,
  logs_json jsonb not null
);

create index if not exists idx_study_run_logs_study_run_id
  on study_run_logs (study_run_id);

create index if not exists idx_study_run_logs_created_at
  on study_run_logs (created_at desc);