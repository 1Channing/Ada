/*
  # Learned enum dictionary (opaque code → human label)

  Additive only. Stores, per site + field, the mapping from a marketplace's
  opaque URL code to the human label the discovery scrape confirmed. Example:
  Leboncoin gearbox code '2' → 'Automatique'. Used to auto-fill the Ingestion
  form when a pasted URL contains a code we've already learned — so operators
  don't re-declare what ADA already knows.

  Written only when the ingestion's core taxonomy (brand + model) is confirmed,
  so we never learn an enum from an off-target sample.
*/

CREATE TABLE IF NOT EXISTS linkgen_enum_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site text NOT NULL,
  field text NOT NULL,          -- 'gearbox' | 'color' | 'vehicleType' | ...
  code text NOT NULL,            -- the URL raw value, e.g. '2'
  label text NOT NULL,            -- confirmed human value, e.g. 'Automatique'
  confirmations integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkgen_enum_mappings_unique UNIQUE (site, field, code)
);

CREATE INDEX IF NOT EXISTS idx_linkgen_enum_mappings_lookup
  ON linkgen_enum_mappings (site, field, code);

ALTER TABLE linkgen_enum_mappings ENABLE ROW LEVEL SECURITY;

-- Same anon+authenticated pattern as linkgen_mapping_memory: select/insert/update
-- (update needed to reinforce confirmations); no client-side delete.
CREATE POLICY "anon_select_enum_mappings"
  ON linkgen_enum_mappings FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_enum_mappings"
  ON linkgen_enum_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_insert_enum_mappings"
  ON linkgen_enum_mappings FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "auth_insert_enum_mappings"
  ON linkgen_enum_mappings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "anon_update_enum_mappings"
  ON linkgen_enum_mappings FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_update_enum_mappings"
  ON linkgen_enum_mappings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
