/*
  # Ada et Dana — l'annuaire et les lots précalculés (17/10, constat de
  #   Channing : « canceling statement due to statement timeout » dans
  #   l'onglet Agents)

  L'annuaire des garages, les lots de Dana et leurs écarts se calculaient à
  chaque ouverture de page, sur toutes les annonces des garages (les études
  en ajoutent chaque jour) et tous les relevés du Market Intelligence : au-delà
  de 8 secondes, la base coupe. Même règle que le Market Intelligence (plan
  anti-mille-feuille, 26/08) : le serveur PRÉCALCULE, la page ne fait que LIRE.

  - agent_dealer_index : une ligne par garage (toutes ses fiches réunies) —
    annonces des 90 derniers jours, marques (par clé d'identité),
    utilitaires, prix médian, client ou déjà sur la carte.
  - agent_lots : les véhicules identiques (même marque, modèle, année) chez
    un même garage, vus ces 45 derniers jours, dès 2 ; une voiture publiée
    sur deux sites ne compte qu'une fois.
  - agent_market_refs : ce que vaut chaque modèle, par pays et par année —
    médiane des annonces des 60 derniers jours (garages de l'annuaire et
    relevés des études), une annonce = une voix, 3 annonces au moins.
  - agents_refresh_index() : recalcule les trois (worker seul : toutes les
    3 heures et quelques minutes après chaque découverte) ; agent_index_meta
    en garde l'heure (« recalculé il y a … » à l'écran).
  - agents_dealer_directory(), agents_dealer_lots() et
    agents_qualify_candidates() lisent ces tables : mêmes réponses qu'avant,
    en moins d'une seconde, quel que soit le volume.
  Additif, idempotent. À coller après agents_recherche : le premier calcul
  est fait tout de suite (une à deux minutes).
*/

-- 1. Les tables précalculées ---------------------------------------------------------
create table if not exists public.agent_dealer_index (
  root uuid primary key references public.market_dealers(id) on delete cascade,
  country text,
  listings integer not null default 0,
  nb_brands integer not null default 0,
  vans integer not null default 0,
  brands text[] not null default '{}',
  -- {clé de marque : annonces}, et la même chose pour les utilitaires.
  brand_counts jsonb not null default '{}'::jsonb,
  van_counts jsonb not null default '{}'::jsonb,
  median_price numeric,
  last_listing_at timestamptz,
  last_seen_at timestamptz,
  sites text[] not null default '{}',
  members jsonb not null default '[]'::jsonb,
  member_ids uuid[] not null default '{}',
  city text, zip text, phone text, contact_name text, website text, legal_id text,
  is_client boolean not null default false,
  in_network boolean not null default false,
  -- Noms et villes de toutes ses fiches, en minuscules (la recherche de l'annuaire).
  search text not null default ''
);
create index if not exists idx_agent_dealer_index_country on public.agent_dealer_index (country, listings desc);

create table if not exists public.agent_lots (
  root uuid not null references public.market_dealers(id) on delete cascade,
  brand_key text not null,
  model_key text not null,
  year integer not null,
  brand text, model text,
  n integer not null,
  price_min numeric, price_max numeric, price_median numeric,
  km_min integer, km_max integer, km_median numeric,
  fuels text[], urls text[],
  first_seen_at timestamptz, last_seen_at timestamptz,
  country text,
  primary key (root, brand_key, model_key, year)
);
create index if not exists idx_agent_lots_size on public.agent_lots (n desc, last_seen_at desc);

create table if not exists public.agent_market_refs (
  country text not null,
  brand_key text not null,
  model_key text not null,
  year integer not null,
  median numeric not null,
  n integer not null,
  km_median numeric,
  primary key (brand_key, model_key, year, country)
);

create table if not exists public.agent_index_meta (
  id boolean primary key default true check (id),
  computed_at timestamptz,
  duration_ms integer,
  dealers integer, lots integer, refs integer
);

-- Lues par les fonctions ci-dessous (security definer) ; l'heure du calcul, par l'équipe des agentes.
alter table public.agent_dealer_index enable row level security;
alter table public.agent_lots enable row level security;
alter table public.agent_market_refs enable row level security;
alter table public.agent_index_meta enable row level security;
drop policy if exists "agent_index_meta_select" on public.agent_index_meta;
create policy "agent_index_meta_select" on public.agent_index_meta for select to authenticated using ((select public.ada_can_drive_agents()));
revoke all on public.agent_dealer_index, public.agent_lots, public.agent_market_refs, public.agent_index_meta from anon, authenticated;
grant select on public.agent_index_meta to authenticated;
grant all on public.agent_dealer_index, public.agent_lots, public.agent_market_refs, public.agent_index_meta to service_role;

-- 2. Le calcul (worker seul) ------------------------------------------------------------
create or replace function public.agents_refresh_index()
returns jsonb
language plpgsql security definer set search_path = public
set statement_timeout to '300s'
as $$
declare
  t0 timestamptz := clock_timestamp();
  n_dir integer;
  n_lots integer;
  n_refs integer;
begin
  -- a. L'annuaire : une ligne par garage, annonces des 90 derniers jours.
  delete from public.agent_dealer_index where true;
  insert into public.agent_dealer_index (root, country, listings, nb_brands, vans, brands, brand_counts, van_counts, median_price, last_listing_at,
                                         last_seen_at, sites, members, member_ids, city, zip, phone, contact_name, website, legal_id,
                                         is_client, in_network, search)
  with grp as materialized (
    select d.id, coalesce(d.parent_id, d.id) as root, d.site, d.name, d.site_url, d.imprint_url, d.website, d.phone, d.city, d.zip,
           d.contact_name, d.legal_id, d.first_seen_at, d.last_seen_at,
           public.ada_name_key(d.name) as nk, public.ada_phone_key(d.phone) as pk
    from public.market_dealers d
  ),
  recent as materialized (
    select g.root, l.brand, l.brand_key, l.price_eur, l.last_seen_at,
           coalesce(l.vehicle_type, '') ~* '(van|utilit|transport|bestel|kasten|furg|camion)' as is_van
    from public.market_dealer_listings l
    join grp g on g.id = l.dealer_id
    where l.last_seen_at >= now() - interval '90 days'
  ),
  stats as (
    select r.root, count(*)::int as n, count(distinct r.brand)::int as nb, (count(*) filter (where r.is_van))::int as vans,
           coalesce(array_agg(distinct r.brand) filter (where r.brand is not null), '{}') as brands,
           percentile_cont(0.5) within group (order by r.price_eur) as med, max(r.last_seen_at) as last_listing_at
    from recent r group by r.root
  ),
  by_brand as (
    select x.root, jsonb_object_agg(x.bk, x.c) as counts,
           coalesce(jsonb_object_agg(x.bk, x.v) filter (where x.v > 0), '{}'::jsonb) as vans
    from (select r.root, r.brand_key as bk, count(*)::int as c, (count(*) filter (where r.is_van))::int as v
          from recent r where coalesce(r.brand_key, '') <> '' group by r.root, r.brand_key) x
    group by x.root
  ),
  members as (
    select g.root,
           jsonb_agg(jsonb_build_object('id', g.id, 'site', g.site, 'name', g.name, 'site_url', g.site_url, 'imprint_url', g.imprint_url,
                                        'website', g.website, 'phone', g.phone, 'city', g.city)
                     order by (g.id = g.root) desc, g.first_seen_at) as list,
           array_agg(g.id) as ids,
           array_agg(distinct g.site) as sites,
           (array_agg(g.website order by g.first_seen_at) filter (where g.website is not null))[1] as website,
           (array_agg(g.phone order by g.first_seen_at) filter (where g.phone is not null))[1] as phone,
           (array_agg(g.city order by g.first_seen_at) filter (where g.city is not null))[1] as city,
           (array_agg(g.zip order by g.first_seen_at) filter (where g.zip is not null))[1] as zip,
           (array_agg(g.contact_name order by g.first_seen_at) filter (where g.contact_name is not null))[1] as contact_name,
           (array_agg(g.legal_id order by g.first_seen_at) filter (where g.legal_id is not null))[1] as legal_id,
           max(g.last_seen_at) as last_seen_at,
           lower(string_agg(coalesce(g.name, '') || ' ' || coalesce(g.city, ''), ' ')) as search
    from grp g group by g.root
  ),
  clients as materialized (
    select distinct public.ada_name_key(c.company_name) as nk, public.ada_phone_key(c.phone) as pk
    from public.transactions_admin t
    join public.contacts c on c.id in (t.buyer_contact_id, t.buyer_contact_id_2)
    where coalesce(c.company_name, '') <> '' and c.company_name !~* 'mc[ -]?export'
  ),
  network as materialized (
    select public.ada_name_key(n.name) as nk, public.ada_phone_key(n.phone) as pk from public.network_contacts n
  ),
  -- Deux jointures simples (nom, téléphone) plutôt qu'une condition « ou » : la base les fait d'un coup.
  client_roots as materialized (
    select g.root from grp g join clients c on c.nk = g.nk where c.nk <> ''
    union
    select g.root from grp g join clients c on c.pk = g.pk where length(c.pk) = 9
  ),
  network_roots as materialized (
    select g.root from grp g join network n on n.nk = g.nk where n.nk <> ''
    union
    select g.root from grp g join network n on n.pk = g.pk where length(n.pk) = 9
  )
  select d.id, d.country, s.n, s.nb, s.vans, s.brands, coalesce(b.counts, '{}'::jsonb), coalesce(b.vans, '{}'::jsonb), s.med, s.last_listing_at,
         m.last_seen_at, m.sites, m.list, m.ids, m.city, m.zip, m.phone, m.contact_name, m.website, m.legal_id,
         cr.root is not null, nr.root is not null, m.search
  from public.market_dealers d
  join stats s on s.root = d.id
  join members m on m.root = d.id
  left join by_brand b on b.root = d.id
  left join client_roots cr on cr.root = d.id
  left join network_roots nr on nr.root = d.id
  where d.parent_id is null;
  get diagnostics n_dir = row_count;

  -- b. Les lots : 45 jours, dès 2 véhicules identiques ; une voiture publiée sur
  --    deux sites ne compte qu'une fois (même km à 500 km près, ou même prix sans km).
  delete from public.agent_lots where true;
  insert into public.agent_lots (root, brand_key, model_key, year, brand, model, n, price_min, price_max, price_median,
                                 km_min, km_max, km_median, fuels, urls, first_seen_at, last_seen_at, country)
  with recent as (
    select coalesce(d.parent_id, d.id) as root, l.listing_url, l.brand, l.model, l.brand_key, l.model_key, l.year, l.mileage,
           l.price_eur, l.fuel, l.first_seen_at, l.last_seen_at
    from public.market_dealer_listings l
    join public.market_dealers d on d.id = l.dealer_id
    where l.last_seen_at >= now() - interval '45 days'
      and coalesce(l.brand_key, '') <> '' and coalesce(l.model_key, '') <> '' and l.year is not null
      and coalesce(l.price_eur, 0) > 2000
  ),
  cars as (
    select distinct on (r.root, r.brand_key, r.model_key, r.year, coalesce((r.mileage / 500)::text, 'p' || r.price_eur::text)) r.*
    from recent r
    order by r.root, r.brand_key, r.model_key, r.year, coalesce((r.mileage / 500)::text, 'p' || r.price_eur::text), r.last_seen_at desc
  ),
  lots as (
    select c.root, c.brand_key, c.model_key, c.year,
           mode() within group (order by c.brand) as brand, mode() within group (order by c.model) as model, count(*)::int as n,
           min(c.price_eur) as price_min, max(c.price_eur) as price_max, percentile_cont(0.5) within group (order by c.price_eur) as price_median,
           min(c.mileage) as km_min, max(c.mileage) as km_max, percentile_cont(0.5) within group (order by c.mileage) as km_median,
           array_agg(distinct c.fuel) filter (where c.fuel is not null) as fuels,
           (array_agg(c.listing_url order by c.price_eur))[1:10] as urls,
           min(c.first_seen_at) as first_seen_at, max(c.last_seen_at) as last_seen_at
    from cars c
    group by c.root, c.brand_key, c.model_key, c.year
    having count(*) >= 2
  )
  select l.root, l.brand_key, l.model_key, l.year, l.brand, l.model, l.n, l.price_min, l.price_max, l.price_median,
         l.km_min, l.km_max, l.km_median, l.fuels, l.urls, l.first_seen_at, l.last_seen_at, d.country
  from lots l
  join public.market_dealers d on d.id = l.root;
  get diagnostics n_lots = row_count;

  -- c. Ce que vaut chaque modèle, par pays et par année : 60 jours, une annonce = une
  --    voix (son dernier prix ; vue aussi dans l'annuaire, c'est l'annuaire qui compte).
  delete from public.agent_market_refs where true;
  insert into public.agent_market_refs (country, brand_key, model_key, year, median, n, km_median)
  with dir as (
    select upper(d.country) as country, l.listing_url, l.brand_key, l.model_key, l.year, l.mileage, l.price_eur::numeric as price, 0 as src, l.last_seen_at as seen
    from public.market_dealer_listings l
    join public.market_dealers d on d.id = l.dealer_id
    where l.last_seen_at >= now() - interval '60 days' and coalesce(l.price_eur, 0) > 2000
      and coalesce(l.brand_key, '') <> '' and coalesce(l.model_key, '') <> '' and l.year is not null and coalesce(d.country, '') <> ''
  ),
  obs as (
    select upper(o.country) as country, o.listing_url, o.brand_key, o.model_key, o.year, o.mileage, o.price::numeric as price, 1 as src, o.scraped_at as seen
    from public.market_listing_observations o
    where o.scraped_at >= now() - interval '60 days' and coalesce(o.price, 0) > 2000
      and coalesce(o.currency, 'EUR') = 'EUR' and coalesce(o.price_type, 'one-off') in ('one-off', 'unknown')
      and coalesce(o.brand_key, '') <> '' and coalesce(o.model_key, '') <> '' and o.year is not null and coalesce(o.country, '') <> ''
  ),
  u as (
    select distinct on (coalesce(x.listing_url, x.country || '|' || x.price::text || '|' || coalesce(x.mileage::text, ''))) x.*
    from (select * from dir union all select * from obs) x
    order by coalesce(x.listing_url, x.country || '|' || x.price::text || '|' || coalesce(x.mileage::text, '')), x.src, x.seen desc
  )
  select u.country, u.brand_key, u.model_key, u.year, round(percentile_cont(0.5) within group (order by u.price)), count(*)::int,
         percentile_cont(0.5) within group (order by u.mileage)
  from u
  group by u.country, u.brand_key, u.model_key, u.year
  having count(*) >= 3;
  get diagnostics n_refs = row_count;

  insert into public.agent_index_meta (id, computed_at, duration_ms, dealers, lots, refs)
  values (true, now(), (extract(epoch from clock_timestamp() - t0) * 1000)::int, n_dir, n_lots, n_refs)
  on conflict (id) do update set computed_at = excluded.computed_at, duration_ms = excluded.duration_ms,
    dealers = excluded.dealers, lots = excluded.lots, refs = excluded.refs;
  return jsonb_build_object('dealers', n_dir, 'lots', n_lots, 'refs', n_refs, 'ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
end $$;
revoke all on function public.agents_refresh_index() from public, anon, authenticated;
grant execute on function public.agents_refresh_index() to service_role;

-- 3. Les lectures ------------------------------------------------------------------------
/** L'annuaire d'Ada (filtres pays, marque, recherche, pays écartés) ; p_days : 90 jours, fixé par le calcul. */
create or replace function public.agents_dealer_directory(
  p_country text default null, p_brand text default null, p_query text default null,
  p_days integer default 90, p_limit integer default 300, p_exclude_countries text[] default null)
returns setof jsonb
language sql stable security definer set search_path = public
set statement_timeout to '20s'
as $$
  with x as (
    select i.*, case when p_brand is null then i.listings else coalesce((i.brand_counts ->> public.ada_brand_key(p_brand))::int, 0) end as n_brand
    from public.agent_dealer_index i
    where (select public.ada_can_drive_agents())
      and (p_country is null or i.country = upper(p_country))
      and (p_exclude_countries is null or coalesce(i.country, '') <> all(p_exclude_countries))
      and (p_query is null or i.search like '%' || lower(btrim(p_query)) || '%')
  )
  select jsonb_build_object(
    'id', d.id, 'name', d.name, 'country', d.country, 'city', coalesce(d.city, x.city), 'zip', coalesce(d.zip, x.zip), 'street', d.street,
    'phone', coalesce(d.phone, x.phone), 'contact_name', coalesce(d.contact_name, x.contact_name),
    'site_url', d.site_url, 'imprint_url', d.imprint_url, 'website', coalesce(d.website, x.website),
    'lat', d.lat, 'lng', d.lng, 'legal_id', coalesce(d.legal_id, x.legal_id),
    'site', d.site, 'sites', x.sites, 'members', x.members,
    'first_seen_at', d.first_seen_at, 'last_seen_at', x.last_seen_at,
    'listings', x.listings, 'listings_brand', x.n_brand, 'nb_brands', x.nb_brands, 'vans', x.vans, 'brands', x.brands,
    'median_price', round(x.median_price), 'last_listing_at', x.last_listing_at,
    'is_client', x.is_client, 'in_network', x.in_network,
    'prospect', (select jsonb_build_object('id', p.id, 'dealer_id', p.dealer_id, 'stage', p.stage, 'score', p.score, 'kind', p.kind,
                                           'qualified_at', p.qualified_at, 'email', p.best_contact->>'email',
                                           'in_map', p.network_contact_id is not null)
                 from public.agent_prospects p where p.agent = 'ada' and p.dealer_id = any(x.member_ids)
                 order by p.qualified_at desc nulls last limit 1)
  )
  from x
  join public.market_dealers d on d.id = x.root
  where (p_brand is null or x.n_brand > 0)
  order by x.n_brand desc, x.listings desc, x.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
$$;
revoke all on function public.agents_dealer_directory(text, text, text, integer, integer, text[]) from public, anon;
grant execute on function public.agents_dealer_directory(text, text, text, integer, integer, text[]) to authenticated;

/** Les lots de Dana (tous garages ou un seul) et leurs écarts face à nos pays de vente ; p_days ≤ 45, fixé par le calcul. */
create or replace function public.agents_dealer_lots(
  p_country text default null, p_markets text[] default null, p_min integer default 3,
  p_days integer default 45, p_brand text default null, p_limit integer default 200, p_dealer uuid default null)
returns setof jsonb
language sql stable security definer set search_path = public
set statement_timeout to '20s'
as $$
  with params as (
    select greatest(2, least(coalesce(p_min, 3), 50)) as min_n,
           make_interval(days => greatest(1, least(coalesce(p_days, 45), 180))) as win,
           coalesce(nullif(p_markets, '{}'), array['NL', 'DK', 'BE', 'DE']) as markets
  ),
  top_lots as (
    select l.*
    from public.agent_lots l
    cross join params p
    where ((select public.ada_can_drive_agents()) or coalesce(auth.jwt() ->> 'role', '') = 'service_role')
      and l.n >= p.min_n
      and l.last_seen_at >= now() - p.win
      and (p_country is null or l.country = upper(p_country))
      and (p_dealer is null or l.root = p_dealer)
      and (p_brand is null or l.brand_key = public.ada_brand_key(p_brand))
    order by l.n desc, l.last_seen_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  )
  select jsonb_build_object(
    'dealer', jsonb_build_object('id', d.id, 'name', d.name, 'country', d.country, 'city', d.city, 'zip', d.zip, 'phone', d.phone,
                                 'site', d.site, 'site_url', d.site_url, 'imprint_url', d.imprint_url, 'website', d.website),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', e->>'id', 'site', e->>'site', 'site_url', e->>'site_url'))
                         from public.agent_dealer_index i, jsonb_array_elements(i.members) e where i.root = t.root), '[]'::jsonb),
    'brand', t.brand, 'model', t.model, 'year', t.year, 'count', t.n,
    'price_min', t.price_min, 'price_max', t.price_max, 'price_median', round(t.price_median),
    'km_min', t.km_min, 'km_max', t.km_max, 'fuels', t.fuels,
    'first_seen_at', t.first_seen_at, 'last_seen_at', t.last_seen_at, 'urls', t.urls,
    'prospect', (select jsonb_build_object('id', p.id, 'dealer_id', p.dealer_id, 'stage', p.stage, 'score', p.score, 'key_account', p.key_account,
                                           'email', p.best_contact->>'email', 'qualified_at', p.qualified_at)
                 from public.agent_prospects p
                 where p.agent = 'dana'
                   and p.dealer_id = any(coalesce((select i.member_ids from public.agent_dealer_index i where i.root = t.root), array[t.root]))
                 order by p.qualified_at desc nulls last limit 1),
    'markets', (select coalesce(jsonb_agg(jsonb_build_object('market', r.country, 'n', r.n, 'median', r.median, 'gap', r.median - round(t.price_median))
                                          order by r.median - round(t.price_median) desc), '[]'::jsonb)
                from public.agent_market_refs r cross join params p
                where r.brand_key = t.brand_key and r.model_key = t.model_key and r.year = t.year
                  and r.country = any(p.markets) and r.country <> coalesce(t.country, ''))
  )
  from top_lots t
  join public.market_dealers d on d.id = t.root
  order by t.n desc, t.last_seen_at desc;
$$;
revoke all on function public.agents_dealer_lots(text, text[], integer, integer, text, integer, uuid) from public, anon;
grant execute on function public.agents_dealer_lots(text, text[], integer, integer, text, integer, uuid) to authenticated, service_role;

/** Les candidats d'Ada : ses pays, ses marques (et utilitaires), ni clients ni déjà sur la carte, pas encore fichés par elle. */
create or replace function public.agents_qualify_candidates(
  p_countries text[], p_brand_keys text[], p_van_keys text[], p_limit integer default 10)
returns table (dealer_id uuid, hits integer, listings integer)
language sql stable security definer set search_path = public
set statement_timeout to '20s'
as $$
  select i.root, h.hits, i.listings
  from public.agent_dealer_index i
  cross join lateral (
    select (coalesce((select sum((i.brand_counts ->> k)::int) from unnest(coalesce(p_brand_keys, '{}')) k), 0)
          + coalesce((select sum((i.van_counts ->> k)::int) from unnest(coalesce(p_van_keys, '{}')) k), 0))::int as hits
  ) h
  where (coalesce(cardinality(p_countries), 0) = 0 or i.country = any(p_countries))
    and h.hits > 0
    and not i.is_client and not i.in_network
    and not exists (select 1 from public.agent_prospects p where p.agent = 'ada' and p.dealer_id = any(i.member_ids))
  order by h.hits desc, i.listings desc, i.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;
revoke all on function public.agents_qualify_candidates(text[], text[], text[], integer) from public, anon, authenticated;
grant execute on function public.agents_qualify_candidates(text[], text[], text[], integer) to service_role;

-- 4. Le premier calcul, tout de suite ------------------------------------------------------
select public.agents_refresh_index();

-- 5. Vérification ------------------------------------------------------------------
select exists (select 1 from public.agent_index_meta where computed_at is not null)
   and has_function_privilege('service_role', 'public.agents_refresh_index()', 'execute')
   and not has_function_privilege('authenticated', 'public.agents_refresh_index()', 'execute')
   and has_function_privilege('authenticated', 'public.agents_dealer_lots(text, text[], integer, integer, text, integer, uuid)', 'execute')
   and has_function_privilege('authenticated', 'public.agents_dealer_directory(text, text, text, integer, integer, text[])', 'execute') as tout_est_bon;
