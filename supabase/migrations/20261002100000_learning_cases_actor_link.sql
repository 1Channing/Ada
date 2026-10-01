/*
  # Boîte à apprendre : qui agit, où aller, écriture depuis ADA (02/10,
  décision Channing : « tout ce qui peut nécessiter une action de
  correction va dans la boîte, y compris les signalements »)

  actor : equipe | dev — qui doit agir
  link  : chemin dans ADA vers la page ou le dossier concerné
  Les comptes connectés peuvent aussi ENREGISTRER un cas (fichier
  fournisseur mal lu depuis la page Offres, par exemple) ; le worker
  continue d'écrire avec la clé service.

  Additif, idempotent.
*/

alter table learning_cases add column if not exists actor text;
alter table learning_cases add column if not exists link text;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'learning_cases' and policyname = 'equipe_learning_cases_insert') then
    create policy "equipe_learning_cases_insert" on learning_cases for insert to authenticated with check (true);
  end if;
end $$;

select 'ok' as tout_est_bon;
