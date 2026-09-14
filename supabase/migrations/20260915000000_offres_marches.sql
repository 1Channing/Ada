-- Offres fournisseur — résultats de relevé « où vendre » par lot et par pays
-- (médianes, concurrentes, URLs, dates), gardés avec l'offre. Additif, idempotent.
alter table public.supplier_offers
  add column if not exists market jsonb not null default '{}'::jsonb;

select 'ok' as tout_est_bon;
