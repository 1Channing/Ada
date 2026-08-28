-- Photos d'une négociation : tableau ORDONNÉ d'URLs (bucket admin-documents,
-- miroir des photos de l'annonce + ajouts manuels). L'ordre du tableau EST
-- l'ordre des pages du PDF photos. Additif, idempotent.
alter table public.negotiations
  add column if not exists photos jsonb not null default '[]'::jsonb;

select 'ok' as tout_est_bon;
