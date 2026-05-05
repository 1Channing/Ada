/*
  # Create linkgen_mapping_memory table

  ## Purpose
  Stores learned URL parameter mappings extracted from CSV study data.
  A mapping starts as 'pending' (learned from CSV structure analysis) and
  becomes 'valid' only after Scout Check validation.

  ## New Table: linkgen_mapping_memory

  ### Columns
  - id: uuid primary key
  - site: site key (LEBONCOIN, MARKTPLAATS, BILBASEN)
  - country: source country string
  - brand / model / fuel / trim: car attributes for lookup key
  - source_url: original URL from which the mapping was learned
  - detected_params: jsonb — raw URL decomposition (queryParams, hashParams, pathSegments)
  - inferred_mapping: jsonb — deterministic inference result (brandParam, modelParam, etc.)
  - validated_mapping: jsonb — confirmed mapping after Scout validation (null until validated)
  - confidence: 0.0–1.0 numeric score
  - validation_status: 'pending' | 'valid' | 'invalid'
  - issues: jsonb array of detected issues
  - success_count / failure_count: Scout validation counters
  - created_at / updated_at / last_checked_at: timestamps

  ### Unique Constraint
  (site, country, brand, model, fuel, trim) — prevents duplicate mappings for same vehicle/site combo.

  ### Security
  - RLS enabled
  - Permissive policies for anon and authenticated (same pattern as other linkgen tables in this project)
*/

CREATE TABLE IF NOT EXISTS linkgen_mapping_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site text NOT NULL,
  country text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  fuel text NOT NULL DEFAULT '',
  trim text NOT NULL DEFAULT '',
  source_url text,
  detected_params jsonb,
  inferred_mapping jsonb,
  validated_mapping jsonb,
  confidence numeric DEFAULT 0,
  validation_status text DEFAULT 'pending',
  issues jsonb,
  success_count integer DEFAULT 0,
  failure_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_checked_at timestamptz,
  CONSTRAINT linkgen_mapping_memory_unique_key UNIQUE (site, country, brand, model, fuel, trim)
);

ALTER TABLE linkgen_mapping_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read linkgen_mapping_memory"
  ON linkgen_mapping_memory FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "anon can insert linkgen_mapping_memory"
  ON linkgen_mapping_memory FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "anon can update linkgen_mapping_memory"
  ON linkgen_mapping_memory FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated can read linkgen_mapping_memory"
  ON linkgen_mapping_memory FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated can insert linkgen_mapping_memory"
  ON linkgen_mapping_memory FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated can update linkgen_mapping_memory"
  ON linkgen_mapping_memory FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
