-- ═══════════════════════════════════════════════════════════════════════════
-- CRITÈRE CARROSSERIE (30/08/2026) — canon ADA acté par Channing : la
-- nomenclature Leboncoin (URLs-preuves du jour : vehicle_type=4x4 + liste
-- complète 4x4,berline,cabriolet,break,citadine,coupe,monospace,
-- voituresociete).
--
-- 1. daily_searches.vehicle_type : le critère d'étude (token canon 'suv',
--    'berline', … — '' = toutes carrosseries, comportement inchangé).
-- 2. market_listing_observations.vehicle_type : la carrosserie STRUCTURÉE
--    déclarée par le site sur chaque annonce (LBC vehicle_type, La Centrale
--    category, Skelbiu sk:body…) — capture fidèle dès maintenant, les
--    lectures (filtre MI) viendront dessus.
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.daily_searches
  add column if not exists vehicle_type text not null default '';

alter table public.market_listing_observations
  add column if not exists vehicle_type text;
-- L'archive (étage 2) est LIKE la table vive : même colonne, même position.
alter table public.market_listing_observations_archive
  add column if not exists vehicle_type text;

-- PIÈGE DOCUMENTÉ : la vue _all fige ses colonnes à sa création — sans la
-- recréer, vehicle_type resterait invisible de toutes les lectures.
drop view if exists public.market_listing_observations_all;
create view public.market_listing_observations_all
  with (security_invoker = true) as
    select * from public.market_listing_observations
    union all
    select * from public.market_listing_observations_archive;
grant select on public.market_listing_observations_all to anon, authenticated;

select 'ok' as tout_est_bon;
