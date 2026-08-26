/*
  Clés d'identité PRÉCALCULÉES en colonnes (26/08).

  Constat : 399 067 observations (doublées en 3 semaines) et
  mi_cheap_medians recalculait ada_brand_key/ada_model_key sur CHAQUE ligne
  à CHAQUE page de lecture — 13-16 s par page × 5 pages ; à la moindre
  charge une page dépassait les 30 s et le radar rendait un PARTIEL
  silencieux (« 34 écarts » au lieu de 600+, compteurs d'études qui
  flottent d'un rafraîchissement à l'autre).

  Remède : les clés deviennent des colonnes GÉNÉRÉES STORED — calculées une
  seule fois à l'écriture de la ligne, indexées, lues telles quelles par
  les fonctions. L'ADD COLUMN réécrit la table une fois : laisse tourner
  (1 à 3 minutes), c'est le prix unique de la vitesse ensuite.

  IMPORTANT — MÊME PIÈGE QUE L'ANCIEN INDEX D'EXPRESSION : si un futur
  chantier redéfinit ada_brand_key ou ada_model_key, les valeurs stockées
  deviennent périmées. La migration de ce futur chantier DEVRA régénérer :
    alter table market_listing_observations drop column brand_key, drop column model_key;
  puis re-exécuter le présent fichier (les fonctions v6/v5 comprises).
*/

-- ── 1. Colonnes générées (réécrit la table UNE fois — laisse finir) ─────────
alter table market_listing_observations
  add column if not exists brand_key text generated always as (public.ada_brand_key(brand)) stored,
  add column if not exists model_key text generated always as (public.ada_model_key(brand, model)) stored;

-- ── 2. Index de lecture (remplace l'index d'expression, désormais inutile) ──
create index if not exists idx_mlo_keys_scraped
  on market_listing_observations (brand_key, model_key, scraped_at desc);
drop index if exists idx_mlo_identity_scraped;

-- ── 3. mi_cheap_medians v6 : lit les colonnes (corps v5 par ailleurs) ───────
create or replace function mi_cheap_medians(
  p_since timestamptz,
  p_min_price numeric default 1000
)
returns table (
  brand_label text, model_label text, fuel text, year int, country text,
  site text, median numeric, cnt bigint, last_seen timestamptz
)
language sql stable
set statement_timeout to '30s'
as $$
  with keyed as (
    select
      brand_key as bk,
      model_key as mk,
      brand, model, lower(fuel) as fuel, year, upper(country) as country,
      site, price, scraped_at
    from market_listing_observations
    where scraped_at >= p_since
      and price is not null and price >= p_min_price
      and year is not null
      and coalesce(fuel, '') <> ''
      and coalesce(brand, '') <> '' and coalesce(model, '') <> ''
      and not (
        lower(coalesce(title, '')) ~ '(accident|unfall|schaden|schade[^v]|schadeauto|skadet|totalskade|incidentat|sinistrat|sinistr|siniestr|per ricambi|para piezas|krockskad|krockad|reparationsobjekt|sérült|serult|törött|torott|karambol|motorhibás|motorhibas|daužt|dauzt|po avarijos|dalimis|bastler|defe[ck]t|epave|épave|salvage|motorschaden|non marciante|nevažiuojant|nevaziuojant|endommag)'
        and lower(coalesce(title, '')) !~ '((non|sans|jamais|no|never|senza|mai|sin)[ -]*(accident|incident|siniestr)|accident[ -]*free|unfall[ -]?frei|schaden?[ -]?frei|schadevrij|skades?fri|krockfri|inga[ -]*skador|(inga|utan|keine[nmrs]?|kein|geen|zonder|sans|no|ohne)[ -]*defe[ck]te?|(non|pas|jamais|sans)[ -]*endommag)'
      )
  ),
  ranked as (
    select k.*,
      row_number() over (
        partition by bk, mk, fuel, year, country
        order by price asc
      ) as rn
    from keyed k
  )
  select
    min(brand)  as brand_label,
    min(model)  as model_label,
    fuel, year, country,
    mode() within group (order by site) as site,
    min(price) filter (where rn = 3) as median,
    count(*) as cnt,
    max(scraped_at) as last_seen
  from ranked
  group by bk, mk, fuel, year, country
  having count(*) >= 5
  order by 1, 2, 3, 4, 5
$$;

grant execute on function mi_cheap_medians(timestamptz, numeric) to anon, authenticated;

-- ── 4. mi_obs_for_segment v5 : filtre sur les colonnes indexées ─────────────
create or replace function mi_obs_for_segment(
  p_brand_keys text[],
  p_model_key text default null,
  p_country text default null,
  p_limit int default 30000
)
returns setof market_listing_observations
language plpgsql stable
set statement_timeout to '20s'
as $$
declare lim int := least(coalesce(p_limit, 30000), 50000);
begin
  if p_model_key is not null and p_country is not null then
    return query
      select * from market_listing_observations
      where brand_key = any (p_brand_keys)
        and model_key = p_model_key
        and country = p_country
      order by scraped_at desc, id desc limit lim;
  elsif p_model_key is not null then
    return query
      select * from market_listing_observations
      where brand_key = any (p_brand_keys)
        and model_key = p_model_key
      order by scraped_at desc, id desc limit lim;
  elsif p_country is not null then
    return query
      select * from market_listing_observations
      where brand_key = any (p_brand_keys)
        and country = p_country
      order by scraped_at desc, id desc limit lim;
  else
    return query
      select * from market_listing_observations
      where brand_key = any (p_brand_keys)
      order by scraped_at desc, id desc limit lim;
  end if;
end $$;

grant execute on function mi_obs_for_segment(text[], text, text, int) to anon, authenticated;

-- ── 5. Contrôle (seul résultat affiché) : colonnes ↔ fonctions cohérentes
--       sur les 1 000 lignes les plus récentes, et radar chronométrable ─────
select
  (select count(*) from (
     select 1 from market_listing_observations
     order by scraped_at desc limit 1000
   ) t) = 1000
  and not exists (
    select 1 from (
      select brand, model, brand_key, model_key
      from market_listing_observations
      order by scraped_at desc limit 1000
    ) t
    where t.brand_key is distinct from public.ada_brand_key(t.brand)
       or t.model_key is distinct from public.ada_model_key(t.brand, t.model)
  ) as tout_est_bon;
