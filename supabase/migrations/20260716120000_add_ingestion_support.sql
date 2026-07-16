/*
  # Ingestion support: human-verified mappings + audit trail

  Additive only — no existing column, constraint or row is modified.

  1. linkgen_mapping_memory
     - `source`: 'csv_import' (all existing rows backfilled via DEFAULT) or
       'human_verified' (written by the Ingestion page after discovery-scrape
       confirmation).
     - `human_confirmations`: reinforcement counter, incremented when a second
       ingestion confirms the exact same mapping. Deliberately separate from
       `success_count`/`failure_count`, which belong to the Scout Check.
     - `last_confirmed_at`: timestamp of the latest human confirmation.

  2. linkgen_ingestion_events (new)
     Append-only audit of every ingestion attempt: what was submitted, what
     the discovery scrape returned, which fields were retained vs discarded
     (with reasons), and what happened in memory (insert / reinforce /
     conflict). This table is NEVER read by URL generation — audit only.
*/

ALTER TABLE linkgen_mapping_memory
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'csv_import',
  ADD COLUMN IF NOT EXISTS human_confirmations integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz;

CREATE TABLE IF NOT EXISTS linkgen_ingestion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_url text NOT NULL,
  site text NOT NULL,
  declared_criteria jsonb,
  detected_params jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  scrape_error text,
  retained jsonb,
  discarded jsonb,
  conflicts jsonb,
  memory_record_id uuid,
  memory_action text,
  submitted_by text
);

CREATE INDEX IF NOT EXISTS idx_linkgen_ingestion_events_created_at
  ON linkgen_ingestion_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkgen_ingestion_events_site
  ON linkgen_ingestion_events (site);

ALTER TABLE linkgen_ingestion_events ENABLE ROW LEVEL SECURITY;

-- Same anon+authenticated pattern as linkgen_mapping_memory, but SELECT/INSERT
-- only: the audit trail is append-only, no client-side UPDATE or DELETE.
CREATE POLICY "anon_select_ingestion_events"
  ON linkgen_ingestion_events FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_ingestion_events"
  ON linkgen_ingestion_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_insert_ingestion_events"
  ON linkgen_ingestion_events FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "auth_insert_ingestion_events"
  ON linkgen_ingestion_events FOR INSERT TO authenticated WITH CHECK (true);
