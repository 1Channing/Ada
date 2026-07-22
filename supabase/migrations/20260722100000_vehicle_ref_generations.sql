/*
  # Référentiel constructeur — fenêtres de commercialisation par génération

  Additive only.

  Source of truth (~98 %, décision Channing 22/07) pour « ce modèle
  existait-il cette année-là ? » : base Teoalida « Car Models List — Cars sold
  in Europe » (211 marques, ~3 500 modèles, générations avec codes châssis,
  achetée le 22/07/2026, un an de mises à jour). Usage :
  - le planificateur de campagnes écarte les années hors fenêtre (fini les
    études « VW Tayron 2023 » alors qu'il sort en 2024) — en FAIL-OPEN :
    un modèle absent du référentiel n'est JAMAIS filtré ;
  - les études « marché vide » hors fenêtre s'expliquent d'elles-mêmes ;
  - le MI affiche la fenêtre du modèle sélectionné.

  `manual_lock = true` marque les lignes ajoutées/corrigées à la main (les ~2 %
  que la base n'a pas : Yaris Cross, Ignis actuelle…) : les réimports les
  préservent (le fichier de données ne purge que source='teoalida').
*/

CREATE TABLE IF NOT EXISTS vehicle_ref_generations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_key text NOT NULL,
  model_key text NOT NULL,
  brand_label text NOT NULL DEFAULT '',
  model_label text NOT NULL DEFAULT '',
  generation_label text NOT NULL DEFAULT '',
  generation_code text NOT NULL DEFAULT '',
  year_from integer NOT NULL,
  year_to integer,                -- NULL = encore en production
  classification text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'teoalida',
  manual_lock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_ref_brand_model
  ON vehicle_ref_generations (brand_key, model_key);

ALTER TABLE vehicle_ref_generations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_ref_generations' AND policyname = 'vehicle_ref_select') THEN
    CREATE POLICY vehicle_ref_select ON vehicle_ref_generations FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;
