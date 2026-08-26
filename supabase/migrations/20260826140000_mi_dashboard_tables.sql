/*
  ÉTAGE 1 du plan anti-mille-feuille (validé Channing 26/08) : le serveur
  PRÉCALCULE les tableaux de bord du MI, la page ne fait plus que LIRE.

  Les deux agrégats globaux (menus Marque/Modèle et radar des médianes
  basses) deviennent des TABLES, régénérées par le worker après chaque
  vague d'écriture (études du matin, campagnes, + garde horaire) via
  mi_refresh_dashboards() — réservée à service_role. La page MI lit ces
  tables en dessous de la seconde, quel que soit le volume de la base.
  mi_dashboard_meta date chaque calcul (« calculé il y a X min » à l'écran).

  Les fonctions à la volée (mi_dimensions*, mi_cheap_medians*) restent en
  place comme repli de transition.
*/

-- ── 1. Tables de lecture ────────────────────────────────────────────────────
create table if not exists mi_dashboard_dimensions (
  site text not null default '',
  country text not null default '',
  brand text not null default '',
  model text not null default '',
  fuel text not null default '',
  n bigint not null default 0,
  last_seen timestamptz
);

create table if not exists mi_dashboard_medians (
  brand_label text not null default '',
  model_label text not null default '',
  fuel text not null default '',
  year int,
  country text not null default '',
  site text not null default '',
  median numeric,
  cnt bigint not null default 0,
  last_seen timestamptz
);

create table if not exists mi_dashboard_meta (
  id text primary key,
  refreshed_at timestamptz not null default now(),
  row_count int not null default 0
);

grant select on mi_dashboard_dimensions, mi_dashboard_medians, mi_dashboard_meta to anon, authenticated;

-- ── 2. Le recalcul — worker uniquement (service_role) ───────────────────────
create or replace function mi_refresh_dashboards()
returns void
language sql
set statement_timeout to '180s'
as $$
  delete from mi_dashboard_dimensions;
  insert into mi_dashboard_dimensions (site, country, brand, model, fuel, n, last_seen)
    select site, country, brand, model, fuel, count(*), max(scraped_at)
    from market_listing_observations
    group by site, country, brand, model, fuel;

  delete from mi_dashboard_medians;
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

revoke all on function mi_refresh_dashboards() from public;
revoke all on function mi_refresh_dashboards() from anon;
revoke all on function mi_refresh_dashboards() from authenticated;
grant execute on function mi_refresh_dashboards() to service_role;

-- ── 3. Premier remplissage (laisse tourner ~30-60 s) ────────────────────────
select mi_refresh_dashboards();

-- ── 4. Contrôle (seul résultat affiché) ─────────────────────────────────────
select
      (select count(*) from mi_dashboard_dimensions) > 0
  and (select count(*) from mi_dashboard_medians) > 0
  and (select count(*) from mi_dashboard_meta) = 2
  as tout_est_bon;
