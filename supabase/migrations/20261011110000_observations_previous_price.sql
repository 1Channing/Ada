/*
  # Ancien prix déclaré par le site (11/10, trajectoire de prix en bêta —
  décision Channing : « en vélocité ce qu'on est sûr uniquement, pas de
  supposition »)

  previous_price = l'ancien prix AFFICHÉ par le site sur l'annonce (Leboncoin
  « old_price », AutoScout24 « oldSuperDealPrice »), quand il existe. C'est un
  fait déclaré par le site, pas une déduction d'ADA. Colonne ajoutée au chaud
  ET à l'archive (la vue chaud + archive est un UNION ALL : mêmes colonnes,
  même ordre), vue recréée.
  Additif, idempotent.
*/
alter table public.market_listing_observations add column if not exists previous_price numeric;
alter table public.market_listing_observations_archive add column if not exists previous_price numeric;

create or replace view public.market_listing_observations_all
  with (security_invoker = true) as
    select * from public.market_listing_observations
    union all
    select * from public.market_listing_observations_archive;
grant select on public.market_listing_observations_all to anon, authenticated;

select exists (select 1 from information_schema.columns where table_name = 'market_listing_observations' and column_name = 'previous_price')
   and exists (select 1 from information_schema.columns where table_name = 'market_listing_observations_archive' and column_name = 'previous_price')
   and exists (select 1 from information_schema.columns where table_name = 'market_listing_observations_all' and column_name = 'previous_price') as tout_est_bon;
