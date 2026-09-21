/*
  # Preuve de marché « modèle × carburant » (21/09, décision Channing)

  Les campagnes forcées « électrique » étudiaient des modèles qui n'existent
  pas en électrique (BMW 2-Series Gran Coupé, Gran Tourer, SL…) : le
  référentiel constructeur ne connaît pas les carburants. Les sites, eux,
  savent : coches.net et Marktplaats exposent, pour un carburant et une
  marque, la liste des modèles avec leur nombre d'annonces (agrégations /
  facettes). On l'enregistre ici, sans jamais rien supprimer : une ligne par
  site × carburant × modèle du site, comptes rafraîchis à chaque moisson.

  Additive, idempotente. Écrite par le worker (moisson) ; lecture partout.
*/

CREATE TABLE IF NOT EXISTS vehicle_fuel_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site text NOT NULL,                 -- 'COCHES', 'MARKTPLAATS'…
  country text NOT NULL,              -- 'ES', 'NL'…
  fuel text NOT NULL,                 -- carburant ADA : 'ELECTRIQUE'…
  brand text NOT NULL,                -- libellé MARQUE du site ('OPEL')
  model text NOT NULL,                -- libellé MODÈLE du site ('Mokka-e', 'Corsa Electric')
  brand_key text NOT NULL,            -- clé marque ADA (brandKey)
  model_key text NOT NULL,            -- clé de FAMILLE ADA (modelFamilyKey : Mokka-e → mokka)
  site_model_id text NOT NULL,        -- id du modèle chez le site ('1333')
  listing_count integer NOT NULL DEFAULT 0,
  year_min integer,                   -- borne d'année de la moisson (2023 = « existe aujourd'hui »)
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_fuel_evidence_unique UNIQUE (site, fuel, brand_key, site_model_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_fuel_evidence_lookup
  ON vehicle_fuel_evidence (fuel, brand_key, model_key);

ALTER TABLE vehicle_fuel_evidence ENABLE ROW LEVEL SECURITY;

-- Même patron que linkgen_enum_mappings : lecture et écriture (upsert de
-- moisson) pour anon + authenticated, jamais de suppression côté client.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_fuel_evidence' AND policyname = 'anon_select_fuel_evidence') THEN
    CREATE POLICY "anon_select_fuel_evidence" ON vehicle_fuel_evidence FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_fuel_evidence' AND policyname = 'auth_select_fuel_evidence') THEN
    CREATE POLICY "auth_select_fuel_evidence" ON vehicle_fuel_evidence FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_fuel_evidence' AND policyname = 'anon_insert_fuel_evidence') THEN
    CREATE POLICY "anon_insert_fuel_evidence" ON vehicle_fuel_evidence FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_fuel_evidence' AND policyname = 'auth_insert_fuel_evidence') THEN
    CREATE POLICY "auth_insert_fuel_evidence" ON vehicle_fuel_evidence FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_fuel_evidence' AND policyname = 'anon_update_fuel_evidence') THEN
    CREATE POLICY "anon_update_fuel_evidence" ON vehicle_fuel_evidence FOR UPDATE TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_fuel_evidence' AND policyname = 'auth_update_fuel_evidence') THEN
    CREATE POLICY "auth_update_fuel_evidence" ON vehicle_fuel_evidence FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

select 'ok' as tout_est_bon;
