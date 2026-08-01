-- Radar d'opportunités : écarter les ACCIDENTÉES du calcul des médianes
-- basses. Elles s'agglutinent par construction au bas du classement prix —
-- exactement la fenêtre « médiane des 5 moins chères » — et fabriquaient de
-- faux écarts inter-pays (mesure du 01/08 : 129 titres de dégât confirmés en
-- base : « Accidenté » LBC, « Unfall » mobile.de, « Motorschaden » AutoScout).
--
-- Détection NÉGATION D'ABORD, comme côté front (isDamagedVehicleText) : les
-- annonces SAINES portent le mot du dégât — 1 422 « NON accidenté » et 88
-- « Unfallfrei » mesurés — elles doivent RESTER dans le calcul. Une annonce
-- n'est écartée que si son titre matche un marqueur de dégât ET ne matche
-- PAS une tournure « sain ».
create or replace function mi_cheap_medians(
  p_since timestamptz,
  p_min_price numeric default 1000
)
returns table (
  brand_label text, model_label text, fuel text, year int, country text,
  site text, median numeric, cnt bigint, last_seen timestamptz
)
language sql stable as $$
  with obs as (
    select
      regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g') as bk,
      regexp_replace(upper(model), '[^A-Z0-9]', '', 'g') as mk,
      brand, model, lower(fuel) as fuel, year, upper(country) as country,
      site, price, scraped_at,
      row_number() over (
        partition by regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g'),
                     regexp_replace(upper(model), '[^A-Z0-9]', '', 'g'),
                     lower(fuel), year, upper(country)
        order by price asc
      ) as rn
    from market_listing_observations
    where scraped_at >= p_since
      and price is not null and price >= p_min_price
      and year is not null
      and coalesce(fuel, '') <> ''
      and coalesce(brand, '') <> '' and coalesce(model, '') <> ''
      and not (
        lower(coalesce(title, '')) ~ '(accident|unfall|schaden|schade[^v]|schadeauto|skadet|incidentat|sinistr|epave|épave|salvage|motorschaden)'
        and lower(coalesce(title, '')) !~ '((non|sans|jamais|no|never)[ -]*accident|accident[ -]*free|unfall[ -]?frei|schaden?[ -]?frei|schadevrij|skades?fri)'
      )
  )
  select
    min(brand)  as brand_label,
    min(model)  as model_label,
    fuel, year, country,
    mode() within group (order by site) as site,
    min(price) filter (where rn = 3) as median,
    count(*) as cnt,
    max(scraped_at) as last_seen
  from obs
  group by bk, mk, fuel, year, country
  having count(*) >= 5
$$;

grant execute on function mi_cheap_medians(timestamptz, numeric) to anon, authenticated;

-- Contrôle après application :
-- select count(*) from mi_cheap_medians(now() - interval '30 days');
