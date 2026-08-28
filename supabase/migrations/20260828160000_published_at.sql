-- VÉLOCITÉ RÉELLE (28/08) : date de MISE EN LIGNE déclarée par le site,
-- par annonce. Sondes du jour : exposée en liste chez Subito (ISO seconde),
-- Gaspedaal (data-published-date), Marktplaats (jour), Jófogás (jour),
-- Skelbiu (relatif), Leboncoin (first_publication_date). NULL quand le site
-- la cache (mobile.de, Blocket) ou avant ce déploiement. Additif, idempotent.
alter table public.market_listing_observations
  add column if not exists published_at timestamptz;
-- L'archive (étage 2) est LIKE la table vive : même colonne, même position.
alter table public.market_listing_observations_archive
  add column if not exists published_at timestamptz;

-- PIÈGE DOCUMENTÉ : la vue _all fige ses colonnes à sa création — sans la
-- recréer, published_at resterait invisible de toutes les lectures.
drop view if exists public.market_listing_observations_all;
create view public.market_listing_observations_all
  with (security_invoker = true) as
    select * from public.market_listing_observations
    union all
    select * from public.market_listing_observations_archive;
grant select on public.market_listing_observations_all to anon, authenticated;

select 'ok' as tout_est_bon;
