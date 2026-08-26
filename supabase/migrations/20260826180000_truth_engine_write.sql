/*
  TRUTH CENTER — écriture du MOTEUR DE DIAGNOSTIC (26/08 soir).

  Le moteur (session Claude via la clé anon de l'environnement) doit pouvoir
  déposer son diagnostic dans le dossier (details.diagnosis/diagnosed_by,
  couche corrigée, changement de statut) et signer une preuve de type
  'diagnostic' — sinon les dossiers corrigés restent coincés en « preuve
  reçue » jusqu'à un clic humain, l'inverse de l'autonomie voulue.

  Posture : même ouverture que le reste du schéma (les snapshots et
  observations sont déjà insérables par anon depuis la v1). La création de
  dossiers reste au balayage (service_role) — anon ne peut que METTRE À JOUR
  un dossier existant et AJOUTER des preuves, jamais en créer ou supprimer.
*/
do $$ begin
  create policy "anon_update_truth_dossiers" on truth_dossiers for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
grant update (status, layer, summary, details, resolved_at) on truth_dossiers to anon;

do $$ begin
  create policy "anon_insert_truth_evidence" on truth_evidence for insert to anon with check (true);
exception when duplicate_object then null; end $$;
grant insert on truth_evidence to anon;

select
      has_table_privilege('anon', 'truth_evidence', 'insert')
  and (select relrowsecurity from pg_class where relname = 'truth_dossiers')
  as tout_est_bon;
