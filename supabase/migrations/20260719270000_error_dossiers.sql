/*
  # Boîte noire — dossiers d'erreur complets

  Additive only.

  Chaque échec de campagne (URL non générable, scrape bloqué, page introuvable,
  échantillon insuffisant, lacune taxo/enum) enregistre désormais le DOSSIER
  COMPLET de l'action — critères, URL et sa provenance (mémoire ou template),
  diagnostic du scrape (tentatives, modes, tailles, raison de blocage),
  échantillon d'annonces, analyse champ par champ — pas seulement la ligne
  d'erreur. C'est la matière de la revue quotidienne : on dépile, on corrige,
  et par récurrence le mapping converge vers le parfait.
*/

CREATE TABLE IF NOT EXISTS linkgen_error_dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  campaign_id uuid,
  seq integer NOT NULL DEFAULT 0,
  site text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  url text,
  url_source text NOT NULL DEFAULT '',
  dossier jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_error_dossiers_unreviewed
  ON linkgen_error_dossiers (created_at DESC) WHERE reviewed = false;

ALTER TABLE linkgen_error_dossiers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'linkgen_error_dossiers' AND policyname = 'error_dossiers_select') THEN
    CREATE POLICY error_dossiers_select ON linkgen_error_dossiers FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'linkgen_error_dossiers' AND policyname = 'error_dossiers_insert') THEN
    CREATE POLICY error_dossiers_insert ON linkgen_error_dossiers FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'linkgen_error_dossiers' AND policyname = 'error_dossiers_update') THEN
    CREATE POLICY error_dossiers_update ON linkgen_error_dossiers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
