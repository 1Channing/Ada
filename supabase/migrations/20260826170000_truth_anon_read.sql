/*
  TRUTH CENTER — lecture seule pour la clé anon (26/08 soir).

  Le moteur de diagnostic (session Claude via ADA_SUPABASE_ANON_KEY) lit les
  dossiers et les preuves par la même fenêtre que l'environnement ADA ; les
  politiques v1 (authenticated seul) le laissaient aveugle. Même posture que
  market_snapshots / market_listing_observations, déjà lisibles par anon —
  AUCUNE écriture ouverte : les verdicts restent authenticated, la création
  de dossiers reste service_role.
*/
do $$ begin
  create policy "anon_select_truth_dossiers" on truth_dossiers for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon_select_truth_evidence" on truth_evidence for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon_select_truth_config" on truth_config for select to anon using (true);
exception when duplicate_object then null; end $$;
grant select on truth_dossiers, truth_evidence, truth_config to anon;

-- Contrôle : lecture ouverte, et le RLS reste actif (les écritures anon
-- restent bloquées par l'absence de politique insert/update, pas par le
-- privilège — Supabase accorde les privilèges par défaut à tous les rôles).
select
      has_table_privilege('anon', 'truth_dossiers', 'select')
  and has_table_privilege('anon', 'truth_evidence', 'select')
  and (select relrowsecurity from pg_class where relname = 'truth_dossiers')
  and (select relrowsecurity from pg_class where relname = 'truth_evidence')
  as tout_est_bon;
