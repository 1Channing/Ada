/*
  Radar & lectures MI : anti-timeout + pagination stable (02/08 soir).

  Constat en production : « Opportunités à contrôler » passé de 500+ à 95.
  Deux défauts cumulés :

  1. mi_cheap_medians v3 recalculait public.ada_brand_key / ada_model_key
     DEUX fois par ligne (une fois dans les colonnes, une fois dans le
     PARTITION BY) sur 193 609 observations (fenêtre 30 j au 02/08) →
     statement timeout 57014 ; le front assemblait alors les pages déjà
     reçues et affichait un radar à moitié vide.
  2. Aucun ORDER BY final (mi_cheap_medians, mi_dimensions) : PostgREST
     pagine par tranches de 1000 en RÉ-EXÉCUTANT la fonction à chaque
     tranche — sans ordre stable, les tranches se chevauchent et se trouent
     dès que le résultat dépasse 1000 lignes. mi_obs_for_segment triait sur
     scraped_at seul, or toutes les observations d'un même scan partagent le
     MÊME scraped_at (égalités massives, même instabilité).

  v4 : clés d'identité calculées UNE fois (CTE), fenêtre sur colonnes,
  ORDER BY déterministe partout, id en départage, statement_timeout local.
  Additif pur (create or replace), rejouable.
*/

-- ── 1. mi_cheap_medians v4 ──────────────────────────────────────────────────
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
    -- Les clés d'identité sont calculées ICI et une seule fois par ligne.
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
        lower(coalesce(title, '')) ~ '(accident|unfall|schaden|schade[^v]|schadeauto|skadet|incidentat|sinistr|epave|épave|salvage|motorschaden)'
        and lower(coalesce(title, '')) !~ '((non|sans|jamais|no|never)[ -]*accident|accident[ -]*free|unfall[ -]?frei|schaden?[ -]?frei|schadevrij|skades?fri)'
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

-- ── 2. mi_dimensions v2 : ORDER BY stable (mêmes tranches à chaque page) ────
create or replace function mi_dimensions()
returns table (
  site text, country text, brand text, model text, fuel text,
  n bigint, last_seen timestamptz
)
language sql stable
set statement_timeout to '20s'
as $$
  select site, country, brand, model, fuel,
         count(*) as n, max(scraped_at) as last_seen
  from market_listing_observations
  group by site, country, brand, model, fuel
  order by 1, 2, 3, 4, 5
$$;

-- ── 3. mi_obs_for_segment v4 : id en départage des égalités de scraped_at ───
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
      where public.ada_brand_key(brand) = any (p_brand_keys)
        and public.ada_model_key(brand, model) = p_model_key
        and country = p_country
      order by scraped_at desc, id desc limit lim;
  elsif p_model_key is not null then
    return query
      select * from market_listing_observations
      where public.ada_brand_key(brand) = any (p_brand_keys)
        and public.ada_model_key(brand, model) = p_model_key
      order by scraped_at desc, id desc limit lim;
  elsif p_country is not null then
    return query
      select * from market_listing_observations
      where public.ada_brand_key(brand) = any (p_brand_keys)
        and country = p_country
      order by scraped_at desc, id desc limit lim;
  else
    return query
      select * from market_listing_observations
      where public.ada_brand_key(brand) = any (p_brand_keys)
      order by scraped_at desc, id desc limit lim;
  end if;
end $$;

-- ── Droits (create or replace les préserve, redits par sûreté) ──────────────
grant execute on function mi_cheap_medians(timestamptz, numeric) to anon, authenticated;
grant execute on function mi_dimensions() to anon, authenticated;
grant execute on function mi_obs_for_segment(text[], text, text, int) to anon, authenticated;

-- ── Contrôles après application ─────────────────────────────────────────────
-- select count(*) from mi_cheap_medians(now() - interval '30 days');
--   → doit répondre en < 30 s SANS erreur 57014 (avant : timeout).
-- select count(*) from mi_dimensions();
-- select count(*) from mi_obs_for_segment(array['KIA'], 'EV3', 'BE', 1000);
