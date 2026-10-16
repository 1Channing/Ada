/*
  # Ada, phase 2 — l'annuaire des concessions (17/10, Channing : « nos
  #   acheteurs idéaux sont ceux qui vendent les voitures que nous vendons,
  #   plus chères ! … les pays de nos ventes actuelles, Toyota, Suzuki,
  #   Peugeot, Opel… multimarques, et des vendeurs de van, Ford, Mercedes »)

  - market_dealers / market_dealer_listings : les garages vus sur les pages
    d'annonces qu'ADA lit déjà (AutoScout24 : nom, adresse, téléphone, page
    du garage, mentions légales) et leurs annonces (marque, modèle, année,
    km, prix). Écrits par le worker seul.
  - agent_tasks : le travail demandé aux agentes, d'abord « découvrir des
    concessions » (un pays, une marque, quelques pages d'AutoScout24).
  - agents_dealer_directory() : l'annuaire lisible, avec les drapeaux
    « client actuel » (acheteurs des ventes du Workflow) et « déjà dans le
    réseau » (carte) — rapprochés par nom ou téléphone, sans exposer les
    fiches clients.
  - agents_sales_profile() : pays et marques de nos ventes.
  Accès : comptes MC Export avec le droit `agents`. Additif, idempotent.
*/

-- 1. L'annuaire ---------------------------------------------------------------
create table if not exists public.market_dealers (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  site_dealer_id text not null,
  name text not null,
  contact_name text,
  site_url text,
  imprint_url text,
  website text,
  phone text,
  country text,
  zip text,
  city text,
  street text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (site, site_dealer_id)
);
create index if not exists idx_market_dealers_country on public.market_dealers (country, last_seen_at desc);

create table if not exists public.market_dealer_listings (
  dealer_id uuid not null references public.market_dealers(id) on delete cascade,
  listing_url text not null,
  brand text,
  model text,
  title text,
  year integer,
  mileage integer,
  fuel text,
  vehicle_type text,
  price_eur integer,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (dealer_id, listing_url)
);
create index if not exists idx_market_dealer_listings_brand on public.market_dealer_listings (brand, model);
create index if not exists idx_market_dealer_listings_seen on public.market_dealer_listings (last_seen_at desc);

alter table public.market_dealers enable row level security;
alter table public.market_dealer_listings enable row level security;
drop policy if exists "market_dealers_select" on public.market_dealers;
create policy "market_dealers_select" on public.market_dealers
  for select to authenticated using ((select public.ada_can_drive_agents()));
drop policy if exists "market_dealer_listings_select" on public.market_dealer_listings;
create policy "market_dealer_listings_select" on public.market_dealer_listings
  for select to authenticated using ((select public.ada_can_drive_agents()));
revoke all on public.market_dealers, public.market_dealer_listings from anon, authenticated;
grant select on public.market_dealers, public.market_dealer_listings to authenticated;

-- 2. Le travail demandé aux agentes -------------------------------------------
create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agent_settings(agent),
  kind text not null check (kind in ('decouverte_concessions')),
  params jsonb not null default '{}'::jsonb,
  status text not null default 'en_attente' check (status in ('en_attente', 'en_cours', 'terminee', 'echec', 'annulee')),
  result jsonb,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists idx_agent_tasks_queue on public.agent_tasks (status, created_at);

alter table public.agent_tasks enable row level security;
drop policy if exists "agent_tasks_select" on public.agent_tasks;
create policy "agent_tasks_select" on public.agent_tasks
  for select to authenticated using ((select public.ada_can_drive_agents()));
drop policy if exists "agent_tasks_insert" on public.agent_tasks;
create policy "agent_tasks_insert" on public.agent_tasks
  for insert to authenticated
  with check ((select public.ada_can_drive_agents()) and status = 'en_attente' and created_by = auth.uid());
-- Annuler une tâche pas encore commencée (seul geste permis à l'écran).
drop policy if exists "agent_tasks_cancel" on public.agent_tasks;
create policy "agent_tasks_cancel" on public.agent_tasks
  for update to authenticated
  using ((select public.ada_can_drive_agents()) and status = 'en_attente')
  with check ((select public.ada_can_drive_agents()) and status = 'annulee');
revoke all on public.agent_tasks from anon, authenticated;
grant select, insert on public.agent_tasks to authenticated;
grant update (status) on public.agent_tasks to authenticated;

-- 3. Rapprochements : clé de nom et clé de téléphone --------------------------
/** Nom d'entreprise comparable : minuscules, sans accents, sans forme juridique ni mots génériques. */
create or replace function public.ada_name_key(p text)
returns text
language sql immutable
as $$
  select regexp_replace(
    regexp_replace(
      translate(lower(coalesce(p, '')), 'àáâãäåāçćčèéêëēìíîïłñńòóôõöøùúûüýÿžšß', 'aaaaaaaccceeeeeiiiilnnoooooouuuuyyzss'),
      '\m(sarl|sas|sasu|sa|eurl|snc|bv|nv|vof|bvba|sprl|srl|spa|sl|gmbh|ag|kg|ltd|aps|ab|oy|automobiles?|autos?|garage|cars?)\M', ' ', 'g'),
    '[^a-z0-9]+', '', 'g');
$$;

/** Téléphone comparable : les 9 derniers chiffres (indicatif et zéro initial ignorés). */
create or replace function public.ada_phone_key(p text)
returns text
language sql immutable
as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9);
$$;

-- 4. L'annuaire lisible --------------------------------------------------------
create or replace function public.agents_dealer_directory(
  p_country text default null, p_brand text default null, p_query text default null,
  p_days integer default 90, p_limit integer default 300)
returns setof jsonb
language sql stable security definer set search_path = public
as $$
  with clients as (
    select distinct public.ada_name_key(c.company_name) as nk, public.ada_phone_key(c.phone) as pk
    from public.transactions_admin t
    join public.contacts c on c.id in (t.buyer_contact_id, t.buyer_contact_id_2)
    where coalesce(c.company_name, '') <> '' and c.company_name !~* 'mc[ -]?export'
  ),
  network as (
    select public.ada_name_key(n.name) as nk, public.ada_phone_key(n.phone) as pk from public.network_contacts n
  ),
  recent as (
    select l.* from public.market_dealer_listings l
    where l.last_seen_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)))
  ),
  stats as (
    select r.dealer_id,
           count(*) as n,
           count(*) filter (where p_brand is null or r.brand = upper(p_brand)) as n_brand,
           count(distinct r.brand) as nb_brands,
           count(*) filter (where r.vehicle_type ~* '(van|utilit|transport|bestel|kasten|furg|camion)') as n_vans,
           array_agg(distinct r.brand) filter (where r.brand is not null) as brands,
           percentile_cont(0.5) within group (order by r.price_eur) as median_price,
           max(r.last_seen_at) as last_listing_at
    from recent r group by r.dealer_id
  )
  select jsonb_build_object(
    'id', d.id, 'name', d.name, 'country', d.country, 'city', d.city, 'zip', d.zip, 'street', d.street,
    'phone', d.phone, 'contact_name', d.contact_name, 'site_url', d.site_url, 'imprint_url', d.imprint_url, 'website', d.website,
    'first_seen_at', d.first_seen_at, 'last_seen_at', d.last_seen_at,
    'listings', s.n, 'listings_brand', s.n_brand, 'nb_brands', s.nb_brands, 'vans', s.n_vans, 'brands', s.brands,
    'median_price', round(s.median_price), 'last_listing_at', s.last_listing_at,
    'is_client', exists (select 1 from clients c where (c.nk <> '' and c.nk = public.ada_name_key(d.name))
                                                    or (length(c.pk) = 9 and c.pk = public.ada_phone_key(d.phone))),
    'in_network', exists (select 1 from network n where (n.nk <> '' and n.nk = public.ada_name_key(d.name))
                                                     or (length(n.pk) = 9 and n.pk = public.ada_phone_key(d.phone)))
  )
  from public.market_dealers d
  join stats s on s.dealer_id = d.id
  where (select public.ada_can_drive_agents())
    and (p_country is null or d.country = upper(p_country))
    and (p_brand is null or s.n_brand > 0)
    and (p_query is null or d.name ilike '%' || p_query || '%' or d.city ilike '%' || p_query || '%')
  order by s.n_brand desc, s.n desc, d.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
$$;
revoke all on function public.agents_dealer_directory(text, text, text, integer, integer) from public, anon;
grant execute on function public.agents_dealer_directory(text, text, text, integer, integer) to authenticated;

/** Pays et marques de nos ventes (Workflow → Ventes), pour viser les bons marchés. */
create or replace function public.agents_sales_profile()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when (select public.ada_can_drive_agents()) then jsonb_build_object(
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('country', x.country, 'n', x.n) order by x.n desc), '[]'::jsonb)
                  from (select trim(c.country) as country, count(*) as n
                        from public.transactions_admin t join public.contacts c on c.id = t.buyer_contact_id
                        where coalesce(trim(c.country), '') <> '' and coalesce(c.company_name, '') !~* 'mc[ -]?export'
                        group by 1) x),
    'brands', (select coalesce(jsonb_agg(jsonb_build_object('brand', y.brand, 'n', y.n) order by y.n desc), '[]'::jsonb)
               from (select upper(trim(v.brand)) as brand, count(*) as n
                     from public.transactions_admin t join public.vehicles_admin v on v.id = t.vehicle_id
                     where coalesce(trim(v.brand), '') <> ''
                     group by 1) y)
  ) else null end;
$$;
revoke all on function public.agents_sales_profile() from public, anon;
grant execute on function public.agents_sales_profile() to authenticated;

-- 5. Vérification ------------------------------------------------------------------
select exists (select 1 from pg_tables where tablename = 'market_dealers')
   and exists (select 1 from pg_tables where tablename = 'market_dealer_listings')
   and exists (select 1 from pg_tables where tablename = 'agent_tasks')
   and not has_table_privilege('anon', 'public.market_dealers', 'select')
   and public.ada_name_key('Garage Martin SARL') = 'martin'
   and public.ada_name_key('Martin Automobiles') = 'martin'
   and public.ada_phone_key('+33 (0)1 72 39 63 87') = '172396387'
   and public.ada_phone_key('01 72 39 63 87') = '172396387' as tout_est_bon;
