-- OFFRES FOURNISSEUR — 17/09 : correspondance des colonnes modifiable après
-- réouverture (grille brute conservée) + critères de recherche réglés à la
-- main par lot (« ASTRA L » → « ASTRA », fenêtre d'années, km, énergie, boîte).
-- Additif, idempotent. Reprend la colonne market du 15/09 au cas où.
alter table public.supplier_offers
  add column if not exists market jsonb not null default '{}'::jsonb;
alter table public.supplier_offers
  add column if not exists lot_criteria jsonb not null default '{}'::jsonb;
alter table public.supplier_offers
  add column if not exists source_grid jsonb;
select 'ok' as tout_est_bon;
