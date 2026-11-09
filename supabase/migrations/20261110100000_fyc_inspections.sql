/*
  # FYC — Find Your Customer (10/11)

  Channing : « un outil d'analyse dans le Market Intelligence : on colle un lien d'inspection (ou une liste),
  Ada lit le rapport, on compare notre prix d'attaque au marché (recherche MI dans le pays cible) et au stock
  d'un client (vitrine lue) ; prix d'achat et prix d'attaque saisis ; export PDF à la charte ».

  Une ligne par inspection : le lien, le PDF rangé dans le storage par le worker (statut queued → fetched), puis
  les champs lus par le navigateur (statut read), nos prix, les filtres MI retenus et le client cible.
  Équipe MC Export seulement. Additif, idempotent.
*/
create table if not exists public.fyc_inspections (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  status text not null default 'queued' check (status in ('queued', 'fetched', 'read', 'failed')),
  error text,
  pdf_path text,
  report_number text,
  report_date date,
  vin text,
  brand text,
  model text,
  version text,
  body text,
  first_registration date,
  year int,
  km int,
  fuel text,
  gearbox text,
  power_ch int,
  color text,
  doors int,
  seats int,
  repainted boolean,
  damages jsonb not null default '{}'::jsonb,
  equipment jsonb not null default '[]'::jsonb,
  tyres jsonb not null default '[]'::jsonb,
  raw_fields jsonb not null default '{}'::jsonb,
  purchase_price numeric,
  attack_price numeric,
  notes text not null default '',
  market_filters jsonb not null default '{}'::jsonb,
  client_contact_id uuid references public.network_contacts(id) on delete set null,
  created_by uuid,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
-- Si la table existait déjà (premier collage du 10/11) : colonnes ajoutées.
alter table public.fyc_inspections add column if not exists equipment jsonb not null default '[]'::jsonb;
alter table public.fyc_inspections add column if not exists tyres jsonb not null default '[]'::jsonb;
alter table public.fyc_inspections add column if not exists archived_at timestamptz;
create index if not exists fyc_inspections_status_idx on public.fyc_inspections (status, created_at);
alter table public.fyc_inspections enable row level security;
drop policy if exists fyc_inspections_team on public.fyc_inspections;
create policy fyc_inspections_team on public.fyc_inspections for all to authenticated
  using ((select public.ada_is_mc_export())) with check ((select public.ada_is_mc_export()));
grant select, insert, update, delete on public.fyc_inspections to authenticated;

select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'fyc_inspections')
   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fyc_inspections' and column_name = 'archived_at')
   and exists (select 1 from pg_policies where tablename = 'fyc_inspections' and policyname = 'fyc_inspections_team') as tout_est_bon;
