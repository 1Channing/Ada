/*
  ÉTAGE 2 du plan anti-mille-feuille (validé Channing 26/08) : ARCHIVE
  REQUÊTABLE — JAMAIS de suppression.

  La table chaude market_listing_observations garde les 60 derniers jours
  (les fenêtres vivantes : radar 30 j, médiane cible worker 45 j) et reste de
  taille ~constante pour toujours ; tout le reste est DÉPLACÉ (jamais effacé)
  vers market_listing_observations_archive, même schéma. La vue
  market_listing_observations_all recolle les deux : l'historique par étude
  lit la vue — accès à TOUT, comme exigé.

  PIÈGE documenté (même famille que 20260826090000) : brand_key/model_key/
  title_damaged sont GÉNÉRÉES sur la table chaude mais COPIÉES EN DUR ici
  (« like … » sans « including generated » = colonnes ordinaires, remplies au
  moment du déplacement). Toute redéfinition future des fonctions d'identité
  ou du lexique accidentées doit donc AUSSI mettre à jour l'archive :
    update market_listing_observations_archive set brand_key = ada_brand_key(brand), …
  sous peine d'identités divergentes entre chaud et archive.
  Même famille : toute FUTURE colonne ajoutée à la table chaude doit être
  ajoutée à l'archive ET la vue recréée (create or replace view … union all),
  sinon la vue fige l'ancien jeu de colonnes.

  Le déplacement est fait par mi_archive_observations() — service_role
  uniquement, par lots, atomique (delete + insert dans le même ordre SQL) —
  appelée par le worker après la vague quotidienne.
*/

-- ── 1. La table d'archive (même schéma, colonnes générées devenues en dur) ──
create table if not exists market_listing_observations_archive
  (like market_listing_observations including defaults including indexes);

alter table market_listing_observations_archive enable row level security;
do $$ begin
  create policy "anon_select_market_obs_archive"
    on market_listing_observations_archive for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth_select_market_obs_archive"
    on market_listing_observations_archive for select to authenticated using (true);
exception when duplicate_object then null; end $$;
grant select on market_listing_observations_archive to anon, authenticated;

-- ── 2. La vue « TOUT » (chaud + archive) ────────────────────────────────────
-- security_invoker : les politiques RLS des deux tables s'appliquent au
-- lecteur (anon/authenticated lisent, comme aujourd'hui). Les prédicats
-- (snapshot_id, scraped_at…) sont poussés dans chaque branche par Postgres —
-- les index copiés servent des deux côtés.
create or replace view market_listing_observations_all
  with (security_invoker = true) as
    select * from market_listing_observations
    union all
    select * from market_listing_observations_archive;

grant select on market_listing_observations_all to anon, authenticated;

-- ── 3. Le déplacement par lots — worker uniquement (service_role) ───────────
-- Atomique : le delete…returning alimente l'insert dans LA MÊME instruction ;
-- un échec n'en laisse aucune moitié. Rend le nombre de lignes déplacées —
-- le worker rappelle tant que > 0 (et s'arrête à un plafond de tours).
create or replace function mi_archive_observations(
  p_keep_days int default 60,
  p_batch int default 20000
) returns int
language plpgsql
set statement_timeout to '120s'
as $$
declare
  moved int;
begin
  with old as (
    select id from market_listing_observations
    where scraped_at < now() - make_interval(days => p_keep_days)
    order by scraped_at
    limit p_batch
  ),
  del as (
    delete from market_listing_observations o
    using old
    where o.id = old.id
    returning o.*
  )
  insert into market_listing_observations_archive
    select * from del;
  get diagnostics moved = row_count;
  return moved;
end;
$$;

revoke all on function mi_archive_observations(int, int) from public;
revoke all on function mi_archive_observations(int, int) from anon;
revoke all on function mi_archive_observations(int, int) from authenticated;
grant execute on function mi_archive_observations(int, int) to service_role;

-- ── 4. Les MENUS du MI voient toujours TOUT ─────────────────────────────────
-- mi_refresh_dashboards (étage 1) : la partie DIMENSIONS agrégeait la table
-- chaude sans fenêtre — avec l'archive elle n'aurait plus vu que 60 jours.
-- Elle lit désormais la VUE (chaud + archive) : les menus Marque/Modèle
-- gardent l'inventaire complet de tout ce qu'ADA a observé un jour. La
-- partie MÉDIANES (fenêtre 30 j) reste sur la table chaude — plus rapide,
-- strictement équivalente sous 60 j de rétention.
create or replace function mi_refresh_dashboards()
returns void
language sql
set statement_timeout to '180s'
as $$
  delete from mi_dashboard_dimensions;
  insert into mi_dashboard_dimensions (site, country, brand, model, fuel, n, last_seen)
    select site, country, brand, model, fuel, count(*), max(scraped_at)
    from market_listing_observations_all
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

-- ── 4bis. mi_obs_for_segment v6 : l'historique par étude voit TOUT ──────────
-- Même corps que la v5 (20260826090000), mais sur la VUE chaud + archive :
-- la courbe « médiane dans le temps » d'une étude garde tout son passé.
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
      select * from market_listing_observations_all
      where brand_key = any (p_brand_keys)
        and model_key = p_model_key
        and country = p_country
      order by scraped_at desc, id desc limit lim;
  elsif p_model_key is not null then
    return query
      select * from market_listing_observations_all
      where brand_key = any (p_brand_keys)
        and model_key = p_model_key
      order by scraped_at desc, id desc limit lim;
  elsif p_country is not null then
    return query
      select * from market_listing_observations_all
      where brand_key = any (p_brand_keys)
        and country = p_country
      order by scraped_at desc, id desc limit lim;
  else
    return query
      select * from market_listing_observations_all
      where brand_key = any (p_brand_keys)
      order by scraped_at desc, id desc limit lim;
  end if;
end $$;

grant execute on function mi_obs_for_segment(text[], text, text, int) to anon, authenticated;

-- ── 5. Contrôle (seul résultat affiché) ─────────────────────────────────────
-- La vue rend exactement chaud + archive, la fonction de bascule existe et
-- est bien fermée aux clés publiques.
select
      (select count(*) from market_listing_observations_all)
        = (select count(*) from market_listing_observations)
        + (select count(*) from market_listing_observations_archive)
  and not has_function_privilege('anon', 'mi_archive_observations(int,int)', 'execute')
  and has_function_privilege('service_role', 'mi_archive_observations(int,int)', 'execute')
  as tout_est_bon;
