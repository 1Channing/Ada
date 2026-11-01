-- ═══════════════════════════════════════════════════════════════════════════
-- OPPORTUNITÉS AIGUISÉES (01/11/2026) — demande Channing : « certaines
-- opportunités se calculent sans kilométrage max, cela fausse les résultats :
-- maximum 100 000 km, et au minimum 5 véhicules qui confirment ».
-- Preuve en base (30 derniers jours, prix ≥ 2 000 €) : 268 819 observations,
-- dont 16 054 au-delà de 100 000 km et ~1 000 sans kilométrage — elles
-- entraient toutes dans les prix d'attaque du radar.
-- Règles v4 (sur la v3 du 11/10, qui reste sinon identique) :
--   - kilométrage CONNU et ≤ 100 000 km (une annonce sans km ne peut pas
--     confirmer une opportunité) ;
--   - le prix d'attaque est la médiane d'AU MOINS 5 annonces (8 au-delà de
--     100 annonces), plus jamais 3 ;
--   - toujours ≥ 5 annonces distinctes par pays et par millésime.
-- La fonction à la volée (repli du front) reçoit les mêmes règles. Tableaux
-- recalculés tout de suite. Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function mi_refresh_dashboards()
returns void
language sql
set statement_timeout to '180s'
as $$
  delete from mi_dashboard_dimensions where true;
  insert into mi_dashboard_dimensions (site, country, brand, model, fuel, n, last_seen)
    select site, country, brand, model, fuel, count(*), max(scraped_at)
    from market_listing_observations_all
    group by site, country, brand, model, fuel;

  delete from mi_dashboard_medians where true;
  insert into mi_dashboard_medians (brand_label, model_label, fuel, year, country, site, median, cnt, last_seen)
    with known_brands as (
      select distinct brand_key from market_listing_observations where brand_key is not null and brand_key <> ''
    ),
    last_obs as (
      select distinct on (coalesce(nullif(listing_url, ''), id::text))
        brand_key as bk, model_key as mk, brand, model, lower(fuel) as fuel, year, upper(country) as country,
        site, price, scraped_at, title
      from market_listing_observations
      where scraped_at >= now() - interval '30 days'
        and price is not null and price >= 2000
        and mileage is not null and mileage <= 100000
        and year is not null
        and coalesce(fuel, '') <> ''
        and coalesce(brand, '') <> '' and coalesce(model, '') <> ''
        and not title_damaged
      order by coalesce(nullif(listing_url, ''), id::text), scraped_at desc
    ),
    coherent as (
      select o.* from last_obs o
      where not exists (
        select 1 from known_brands kb
        where kb.brand_key = ada_brand_key(split_part(coalesce(o.title, ''), ' ', 1))
          and kb.brand_key <> o.bk
      )
    ),
    ranked as (
      select c.*,
        row_number() over (partition by bk, mk, fuel, year, country order by price asc) as rn,
        count(*) over (partition by bk, mk, fuel, year, country) as n
      from coherent c
    ),
    windowed as (
      select *, case when n >= 100 then 8 else 5 end as w
      from ranked
    )
    select
      min(brand), min(model), fuel, year, country,
      mode() within group (order by site),
      (percentile_cont(0.5) within group (order by price) filter (where rn <= w))::numeric,
      max(n),
      max(scraped_at)
    from windowed
    group by bk, mk, fuel, year, country
    having max(n) >= 5;

  insert into mi_dashboard_meta (id, refreshed_at, row_count) values
    ('dimensions', now(), (select count(*) from mi_dashboard_dimensions)),
    ('medians', now(), (select count(*) from mi_dashboard_medians))
  on conflict (id) do update
    set refreshed_at = excluded.refreshed_at, row_count = excluded.row_count;
$$;

create or replace function mi_cheap_medians_json(
  p_since timestamptz,
  p_min_price numeric default 1000
)
returns jsonb
language sql stable
set statement_timeout to '30s'
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    with keyed as (
      select distinct on (coalesce(nullif(listing_url, ''), id::text))
        brand_key as bk,
        model_key as mk,
        brand, model, lower(fuel) as fuel, year, upper(country) as country,
        site, price, scraped_at
      from market_listing_observations
      where scraped_at >= p_since
        and price is not null and price >= greatest(p_min_price, 2000)
        and mileage is not null and mileage <= 100000
        and year is not null
        and coalesce(fuel, '') <> ''
        and coalesce(brand, '') <> '' and coalesce(model, '') <> ''
        and not title_damaged
      order by coalesce(nullif(listing_url, ''), id::text), scraped_at desc
    ),
    ranked as (
      select k.*,
        row_number() over (partition by bk, mk, fuel, year, country order by price asc) as rn,
        count(*) over (partition by bk, mk, fuel, year, country) as n
      from keyed k
    )
    select
      min(brand)  as brand_label,
      min(model)  as model_label,
      fuel, year, country,
      mode() within group (order by site) as site,
      (percentile_cont(0.5) within group (order by price) filter (where rn <= case when n >= 100 then 8 else 5 end))::numeric as median,
      max(n) as cnt,
      max(scraped_at) as last_seen
    from ranked
    group by bk, mk, fuel, year, country
    having max(n) >= 5
  ) t
$$;

grant execute on function mi_cheap_medians_json(timestamptz, numeric) to anon, authenticated;

select mi_refresh_dashboards();

select (select count(*) from mi_dashboard_medians) > 0
   and (select prosrc like '%mileage <= 100000%' from pg_proc where proname = 'mi_refresh_dashboards' limit 1) as tout_est_bon;
