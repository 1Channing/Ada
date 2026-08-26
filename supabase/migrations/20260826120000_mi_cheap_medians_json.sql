/*
  Radar en UN appel (26/08, dernier étage de la série vitesse).

  Après les colonnes précalculées, chaque PAGE PostgREST ré-exécutait
  encore la fonction entière (~8 s × 5 pages, en série comme en parallèle :
  la base fait 5 fois le même travail). Variante qui renvoie TOUTES les
  lignes en un seul jsonb — une exécution, pas de pagination. L'ancienne
  mi_cheap_medians reste en place (compat, repli du front).
*/

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
        and not title_damaged
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
  ) t
$$;

grant execute on function mi_cheap_medians_json(timestamptz, numeric) to anon, authenticated;

-- ── Contrôle (seul résultat affiché) ────────────────────────────────────────
select jsonb_array_length(mi_cheap_medians_json(now() - interval '30 days')) > 0 as tout_est_bon;
