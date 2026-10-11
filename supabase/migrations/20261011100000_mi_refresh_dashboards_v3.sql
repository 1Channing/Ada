/*
  # Radar MI v3 : une annonce = une voix, prix d'attaque, titre cohérent
  (11/10, analyse « on tourne au ralenti » — le radar affichait
  « RAV4 PHEV 2022 NL : 14 845 € » (des Mégane / Eclipse Cross écrites sous
  l'étiquette RAV4 par Marktplaats les 12-14/09) et « Tesla Model Y 2023 IT :
  5 000 € » (reprises de leasing Subito à 790-7 900 €).

  La v2 prenait la 3e OBSERVATION la moins chère sur 30 jours, sans
  dédoublonner : une seule annonce fausse revue trois matins fabriquait une
  opportunité. Règles v3 :
    - une observation par annonce (la plus récente, listing_url) ;
    - plancher 2 000 € (même seuil que le premier filtre des scrapes) ;
    - titre cohérent avec la marque : un titre qui COMMENCE par une autre
      marque connue est écarté (« Volkswagen Tiguan » sous TOYOTA) ;
    - « median » = PRIX D'ATTAQUE : médiane des 3 / 5 / 8 annonces les moins
      chères selon la profondeur (règle du MI, des études et des offres) ;
    - cnt = nombre d'ANNONCES distinctes (plus d'observations), seuil 5.
  Même nom de colonne (« median ») : le front ne change pas.
  Additif, idempotent.
*/
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
      select *, case when n >= 100 then 8 when n >= 20 then 5 else 3 end as w
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

select mi_refresh_dashboards();
select (select count(*) from mi_dashboard_medians) > 0 as tout_est_bon;
