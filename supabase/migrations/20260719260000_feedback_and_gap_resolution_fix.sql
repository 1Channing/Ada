/*
  # Feedback équipe + réparation du centre de résolution

  Additive only.

  1. linkgen_campaign_items.resolved_at — la migration précédente
     (20260719230000) supposait la colonne "déjà présente" : elle ne l'a
     jamais été, d'où le centre de résolution en erreur
     ("column linkgen_campaign_items.resolved_at does not exist").
     On l'ajoute réellement ici (avec resolution, idempotent).

  2. ada_feedback — signalements internes (bouton à côté de la cloche) :
     un commercial dépose un problème rencontré ou une suggestion, avec
     capture d'écran compressée (data-URL). C'est le backlog vivant.
*/

ALTER TABLE linkgen_campaign_items
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE linkgen_campaign_items
  ADD COLUMN IF NOT EXISTS resolution text;

CREATE TABLE IF NOT EXISTS ada_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  author text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'probleme',
  message text NOT NULL DEFAULT '',
  page text NOT NULL DEFAULT '',
  screenshot text,
  status text NOT NULL DEFAULT 'open',
  resolved_at timestamptz,
  resolved_by text
);

ALTER TABLE ada_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ada_feedback' AND policyname = 'ada_feedback_select') THEN
    CREATE POLICY ada_feedback_select ON ada_feedback FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ada_feedback' AND policyname = 'ada_feedback_insert') THEN
    CREATE POLICY ada_feedback_insert ON ada_feedback FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ada_feedback' AND policyname = 'ada_feedback_update') THEN
    CREATE POLICY ada_feedback_update ON ada_feedback FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
