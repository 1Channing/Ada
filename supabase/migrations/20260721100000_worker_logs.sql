/*
  # Journal technique du worker (warn + error)

  Additive only.

  Les avertissements et erreurs de la console du worker Railway sont capturés
  à la source et écrits ici par lots. Complète la boîte noire
  (linkgen_error_dossiers, contexte métier des échecs d'étude) avec ce qui lui
  échappe : crashs au boot, erreurs réseau hors étude, patterns de blocage
  dans le temps. Rétention 14 jours, purgée par le worker lui-même.

  Lecture ouverte à l'anon (front + sessions d'analyse) ; écriture réservée au
  worker (service role, bypasse la RLS) — aucune policy INSERT volontairement.
*/

CREATE TABLE IF NOT EXISTS worker_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'error',
  message text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_worker_logs_created_at
  ON worker_logs (created_at DESC);

ALTER TABLE worker_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'worker_logs' AND policyname = 'worker_logs_select') THEN
    CREATE POLICY worker_logs_select ON worker_logs FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;
