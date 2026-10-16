/*
  # Ada, phase 2.2 — qualifier les garages (17/10)

  - agent_settings : cibles (pays, marques, marques d'utilitaires,
    multimarques), budget IA par jour, travail automatique (découvertes,
    qualifications par jour), ajout automatique à la carte au-delà d'un score.
  - agent_prospects : un garage qualifié par Ada — site, e-mails publiés
    (vérifiés : domaine qui reçoit du courrier), personnes, type, score et
    raison, preuves, coût. Écrit par le worker ; l'équipe change l'étape.
  - agent_runs : chaque appel à Claude (modèle, jetons, coût) ; le plafond
    par jour se lit ici.
  - agent_tasks : nouvelle sorte « qualification ».
  - agents_dealer_directory() : chaque garage porte sa qualification.
  - agents_ai_spend() : dépense du jour et du mois, par agente.
  Accès : comptes MC Export avec le droit `agents`. Additif, idempotent.
*/

-- 1. Réglages ------------------------------------------------------------------
alter table public.agent_settings
  add column if not exists targets jsonb not null default '{}'::jsonb,
  add column if not exists daily_budget_usd numeric(8,2) not null default 3,
  add column if not exists auto_discovery boolean not null default false,
  add column if not exists auto_qualify_per_day integer not null default 0,
  add column if not exists map_auto_add boolean not null default true,
  add column if not exists map_min_score integer not null default 70;
alter table public.agent_settings drop constraint if exists agent_settings_ai_limits;
alter table public.agent_settings add constraint agent_settings_ai_limits check (
  daily_budget_usd between 0 and 100 and auto_qualify_per_day between 0 and 500 and map_min_score between 0 and 100);
-- Ada travaille dès ce soir : cibles de Channing (17/10), 30 garages par jour, 3 $ par jour au plus.
-- Une seule fois (cibles encore vides) : un réglage déjà fait n'est jamais écrasé.
update public.agent_settings
   set targets = '{"countries": [], "brands": ["Toyota", "Suzuki", "Peugeot", "Opel"], "vanBrands": ["Ford", "Mercedes-Benz", "Renault", "Volkswagen", "Peugeot", "Citroën", "Fiat", "Opel", "Toyota"], "multibrand": true}'::jsonb,
       auto_discovery = true, auto_qualify_per_day = 30
 where agent = 'ada' and targets = '{}'::jsonb;
grant update (targets, daily_budget_usd, auto_discovery, auto_qualify_per_day, map_auto_add, map_min_score)
  on public.agent_settings to authenticated;

-- 2. Les garages qualifiés --------------------------------------------------------
create table if not exists public.agent_prospects (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agent_settings(agent),
  dealer_id uuid unique references public.market_dealers(id) on delete set null,
  name text not null,
  country text,
  city text,
  zip text,
  street text,
  phone text,
  website text,
  legal_name text,
  group_name text,
  sites integer,
  kind text,
  brands_official text[] not null default '{}',
  -- [{email, nature, source, mx}] : seulement des adresses écrites dans une page.
  emails jsonb not null default '[]'::jsonb,
  -- [{nom, fonction, email, source}]
  people jsonb not null default '[]'::jsonb,
  -- {nom, fonction, email, pourquoi}
  best_contact jsonb,
  language text,
  fit_score integer,
  fit_parts jsonb not null default '[]'::jsonb,
  score integer,
  summary text,
  exclusion_reason text,
  -- [{url, note}] : les pages lues.
  evidence jsonb not null default '[]'::jsonb,
  stage text not null default 'qualifie'
    check (stage in ('qualifie', 'ecarte', 'a_contacter', 'contacte', 'repondu', 'interesse', 'client', 'perdu')),
  qualified_at timestamptz,
  qualify_cost_usd numeric(10,4) not null default 0,
  network_contact_id uuid references public.network_contacts(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_agent_prospects_score on public.agent_prospects (agent, stage, score desc);

alter table public.agent_prospects enable row level security;
drop policy if exists "agent_prospects_select" on public.agent_prospects;
create policy "agent_prospects_select" on public.agent_prospects
  for select to authenticated using ((select public.ada_can_drive_agents()));
drop policy if exists "agent_prospects_update" on public.agent_prospects;
create policy "agent_prospects_update" on public.agent_prospects
  for update to authenticated
  using ((select public.ada_can_drive_agents()))
  with check ((select public.ada_can_drive_agents()));
revoke all on public.agent_prospects from anon, authenticated;
grant select on public.agent_prospects to authenticated;
-- L'équipe change l'étape et note ; le reste est écrit par le worker.
grant update (stage, notes, updated_at) on public.agent_prospects to authenticated;

-- 3. Les appels à Claude --------------------------------------------------------------
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agent_settings(agent),
  purpose text not null,
  model text not null,
  prospect_id uuid references public.agent_prospects(id) on delete set null,
  task_id uuid references public.agent_tasks(id) on delete set null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  web_searches integer not null default 0,
  web_fetches integer not null default 0,
  cost_usd numeric(10,4) not null default 0,
  stop_reason text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_runs_day on public.agent_runs (agent, created_at desc);

alter table public.agent_runs enable row level security;
drop policy if exists "agent_runs_select" on public.agent_runs;
create policy "agent_runs_select" on public.agent_runs
  for select to authenticated using ((select public.ada_can_drive_agents()));
revoke all on public.agent_runs from anon, authenticated;
grant select on public.agent_runs to authenticated;

-- 4. Nouvelle sorte de tâche ------------------------------------------------------------
alter table public.agent_tasks drop constraint if exists agent_tasks_kind_check;
alter table public.agent_tasks add constraint agent_tasks_kind_check check (kind in ('decouverte_concessions', 'qualification'));

-- 5. L'annuaire porte la qualification -----------------------------------------------------
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
                                                     or (length(n.pk) = 9 and n.pk = public.ada_phone_key(d.phone))),
    'prospect', (select jsonb_build_object('id', p.id, 'stage', p.stage, 'score', p.score, 'kind', p.kind,
                                           'qualified_at', p.qualified_at, 'email', p.best_contact->>'email',
                                           'in_map', p.network_contact_id is not null)
                 from public.agent_prospects p where p.dealer_id = d.id)
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

-- 6. Dépense IA du jour et du mois (heure de Paris) ----------------------------------------
create or replace function public.agents_ai_spend()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with b as (
    select (date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris') as day_start,
           (date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris') as month_start
  )
  select case when (select public.ada_can_drive_agents()) then coalesce((
    select jsonb_object_agg(x.agent, jsonb_build_object('today', x.today, 'month', x.month, 'runs_today', x.runs_today))
    from (
      select r.agent,
             round(coalesce(sum(r.cost_usd) filter (where r.created_at >= b.day_start), 0), 4) as today,
             round(coalesce(sum(r.cost_usd), 0), 4) as month,
             count(*) filter (where r.created_at >= b.day_start) as runs_today
      from public.agent_runs r, b
      where r.created_at >= b.month_start
      group by r.agent
    ) x), '{}'::jsonb) else null end;
$$;
revoke all on function public.agents_ai_spend() from public, anon;
grant execute on function public.agents_ai_spend() to authenticated;

-- 7. Les prochains garages à qualifier (worker seul) -----------------------------------------
-- Dans les pays cibles, vus en 60 jours, avec des annonces de nos marques (ou des
-- utilitaires de nos marques d'utilitaires) ; jamais un client actuel, un contact
-- déjà sur la carte ni un garage déjà qualifié. Les clés de marque viennent du
-- worker (brandKey : « MERCEDES-BENZ » → MERCEDES, « VW » → VOLKSWAGEN).
create or replace function public.agents_qualify_candidates(
  p_countries text[], p_brand_keys text[], p_van_keys text[], p_limit integer default 10)
returns table (dealer_id uuid, hits integer, listings integer)
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
    select l.dealer_id, l.vehicle_type,
           case x.k when 'MERCEDESBENZ' then 'MERCEDES' when 'VW' then 'VOLKSWAGEN' else x.k end as bk
    from public.market_dealer_listings l,
         lateral (select regexp_replace(translate(upper(coalesce(l.brand, '')), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝŠŽ', 'AAAAAACEEEEIIIINOOOOOOUUUUYSZ'), '[^A-Z0-9]', '', 'g') as k) x
    where l.last_seen_at >= now() - interval '60 days'
  ),
  stats as (
    select r.dealer_id, count(*) as n,
           count(*) filter (where r.bk = any(coalesce(p_brand_keys, '{}')))
           + count(*) filter (where r.bk = any(coalesce(p_van_keys, '{}')) and r.vehicle_type ~* '(van|utilit|transport|bestel|kasten|furg|camion)') as hits
    from recent r group by r.dealer_id
  )
  select d.id, s.hits::integer, s.n::integer
  from public.market_dealers d
  join stats s on s.dealer_id = d.id
  where (coalesce(cardinality(p_countries), 0) = 0 or d.country = any(p_countries))
    and s.hits > 0
    and not exists (select 1 from public.agent_prospects p where p.dealer_id = d.id)
    and not exists (select 1 from clients c where (c.nk <> '' and c.nk = public.ada_name_key(d.name))
                                               or (length(c.pk) = 9 and c.pk = public.ada_phone_key(d.phone)))
    and not exists (select 1 from network n where (n.nk <> '' and n.nk = public.ada_name_key(d.name))
                                               or (length(n.pk) = 9 and n.pk = public.ada_phone_key(d.phone)))
  order by s.hits desc, s.n desc, d.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;
revoke all on function public.agents_qualify_candidates(text[], text[], text[], integer) from public, anon, authenticated;
grant execute on function public.agents_qualify_candidates(text[], text[], text[], integer) to service_role;

-- 8. Vérification ------------------------------------------------------------------
select exists (select 1 from pg_tables where tablename = 'agent_prospects')
   and exists (select 1 from pg_tables where tablename = 'agent_runs')
   and exists (select 1 from information_schema.columns where table_name = 'agent_settings' and column_name = 'daily_budget_usd')
   and (select targets ? 'brands' from public.agent_settings where agent = 'ada')
   and not has_table_privilege('anon', 'public.agent_runs', 'select') as tout_est_bon;
