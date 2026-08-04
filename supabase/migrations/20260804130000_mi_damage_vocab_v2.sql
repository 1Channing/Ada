/*
  Anti-accidentées v2 : vocabulaire des 10 langues du réseau (04/08).

  Constat : « TESLA MODELLO Y AUT.SINISTRATA » (8 700 €) entrait dans les
  médianes IT — l'italien sinistrata, l'espagnol siniestrado (graphie
  « ie »), le suédois krockskadad, le hongrois sérült/törött/karambolos et
  le lituanien daužtas/po avarijos manquaient au lexique. Négation d'abord,
  comme depuis le 01/08 : les tournures « sain » (unfallfrei, krockfri,
  senza incidenti, sin siniestros, inga defekter…) sont neutralisées avant
  la recherche des marqueurs. Même vocabulaire répliqué côté TypeScript
  (isDamagedVehicleText) — affichage MI, études, écritures.

  Corps identique à la v4 (20260802235000 : clés calculées une fois,
  ORDER BY déterministe, timeout 30 s) — seuls les deux lexiques changent.
*/

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
      public.ada_brand_key(brand) as bk,
      public.ada_model_key(brand, model) as mk,
      brand, model, lower(fuel) as fuel, year, upper(country) as country,
      site, price, scraped_at
    from market_listing_observations
    where scraped_at >= p_since
      and price is not null and price >= p_min_price
      and year is not null
      and coalesce(fuel, '') <> ''
      and coalesce(brand, '') <> '' and coalesce(model, '') <> ''
      and not (
        lower(coalesce(title, '')) ~ '(accident|unfall|schaden|schade[^v]|schadeauto|skadet|totalskade|incidentat|sinistrat|sinistr|siniestr|per ricambi|para piezas|krockskad|krockad|reparationsobjekt|sérült|serult|törött|torott|karambol|motorhibás|motorhibas|daužt|dauzt|po avarijos|dalimis|bastler|defe[ck]t|epave|épave|salvage|motorschaden|non marciante|nevažiuojant|nevaziuojant)'
        and lower(coalesce(title, '')) !~ '((non|sans|jamais|no|never|senza|mai|sin)[ -]*(accident|incident|siniestr)|accident[ -]*free|unfall[ -]?frei|schaden?[ -]?frei|schadevrij|skades?fri|krockfri|inga[ -]*skador|(inga|utan|keine[nmrs]?|kein|geen|zonder|sans|no|ohne)[ -]*defe[ck]te?)'
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

-- ── Contrôle après application (exécuter SÉPARÉMENT, une seule ligne) ───────
-- select count(*) from mi_cheap_medians(now() - interval '30 days');
