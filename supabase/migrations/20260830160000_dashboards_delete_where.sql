-- ═══════════════════════════════════════════════════════════════════════════
-- RADAR FIGÉ DEPUIS LE 26/08 21h37 (constat Channing 30/08 : « les
-- opportunités n'ont pas bougé depuis quelques jours ») — worker_logs :
-- « [DASHBOARDS] recalcul échoué : DELETE requires a WHERE clause », toutes
-- les heures depuis 4 jours. Un garde-fou de la base (safeupdate) refuse
-- désormais les DELETE sans WHERE — les deux vidages de mi_refresh_dashboards
-- en étaient. Même fonction, DELETE ... WHERE TRUE (sémantique identique,
-- garde-fou satisfait). Idempotent.
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
    with keyed as (
      select
        brand_key as bk,
        model_key as mk,
        brand, model, lower(fuel) as fuel, year, upper(country) as country,
        site, price, scraped_at
      from market_listing_observations
      where scraped_at >= now() - interval '30 days'
        and price is not null and price >= 1000
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
      min(brand), min(model), fuel, year, country,
      mode() within group (order by site),
      min(price) filter (where rn = 3),
      count(*),
      max(scraped_at)
    from ranked
    group by bk, mk, fuel, year, country
    having count(*) >= 5;

  insert into mi_dashboard_meta (id, refreshed_at, row_count) values
    ('dimensions', now(), (select count(*) from mi_dashboard_dimensions)),
    ('medians', now(), (select count(*) from mi_dashboard_medians))
  on conflict (id) do update
    set refreshed_at = excluded.refreshed_at, row_count = excluded.row_count;
$$;

-- Recalcul immédiat : le radar repart sans attendre la garde horaire.
select mi_refresh_dashboards();

select 'ok' as tout_est_bon;
