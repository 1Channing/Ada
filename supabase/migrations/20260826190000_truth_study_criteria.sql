/*
  TRUTH CENTER — les CRITÈRES RÉELS des études, toutes équipes confondues
  (constat Channing 26/08 soir, dossier Lexus NX) :

  Les études quotidiennes sont cloisonnées par compte (RLS user_id) — le
  Truth Center d'un admin ne voyait que SES études et retombait sur les
  critères DÉCODÉS de l'URL d'ADA pour les autres. Or l'URL est justement
  l'objet à vérifier : elle ne peut pas servir de référence (le décodage
  perdait p.ex. le carburant PHEV du Lexus NX — enum appris, irréversible).

  truth_active_studies() expose les CRITÈRES de toutes les études actives —
  et rien d'autre : ni user_id, ni identité du propriétaire. security definer
  (contourne le cloisonnement en lecture de critères uniquement), lecture
  pour authenticated (l'UI) et anon (le moteur de diagnostic).
*/
create or replace function truth_active_studies()
returns table (
  label text,
  brand text,
  model text,
  fuel text,
  -- « trim » est une fonction SQL réservée — guillemets obligatoires ici.
  "trim" text,
  trim_target text,
  year_min int,
  year_max int,
  mileage_max int,
  gearbox text,
  power_min int,
  source_country text,
  target_country text
)
language sql stable
security definer
set search_path = public
as $$
  select
    d.label, d.brand, d.model, d.fuel, d.trim, d.trim_target,
    d.year_min, d.year_max, d.mileage_max, d.gearbox, d.power_min,
    d.source_country, d.target_country
  from daily_searches d
  where d.active
$$;

revoke all on function truth_active_studies() from public;
grant execute on function truth_active_studies() to authenticated;
grant execute on function truth_active_studies() to anon;

select count(*) >= 0 as tout_est_bon from truth_active_studies();
