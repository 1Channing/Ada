-- ============================================================================
-- REFONTE COMPTES + WORKFLOW + VENTES + VEILLE (27/07/2026) — 100 % ADDITIF.
-- Prérequis côté dashboard Supabase : Authentication → Providers → Email activé
-- (activé par défaut). Chaque membre crée son compte depuis l'écran de
-- connexion d'ADA (email + mot de passe + prénom d'affichage).
-- ============================================================================

-- ── Profils : lien compte → prénom d'équipe (Antoine, Channing, …) ──────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- ── Études quotidiennes (PERSONNELLES) ──────────────────────────────────────
-- Une recherche = pays source (tous ses sites), critères véhicule, pays cible
-- et écart de prix recherché. Scrape quotidien à run_hour (heure de Paris),
-- TRI PRIX CROISSANT, plafond 3 pages — voir worker/dailySearches.
create table if not exists public.daily_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default '',
  source_country text not null,
  target_country text not null,
  brand text not null,
  model text not null default '',
  year_min integer,
  year_max integer,
  fuel text not null default '',
  trim text not null default '',
  price_gap_min integer not null default 3000,
  price_gap_max integer not null default 10000,
  run_hour integer not null default 7,
  active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_daily_searches_user on public.daily_searches (user_id);
create index if not exists idx_daily_searches_due on public.daily_searches (active, run_hour);
alter table public.daily_searches enable row level security;
drop policy if exists "daily_searches_own" on public.daily_searches;
create policy "daily_searches_own" on public.daily_searches
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Annonces vues / nouveautés / baisses (mémoire du diff quotidien) ────────
-- kind: 'seed' = amorçage 1er passage (jamais montré), 'new' = nouvelle
-- annonce, 'price_drop' = baisse vs dernier prix vu.
-- status: 'inbox' (à trier sur l'accueil), 'saved' (→ négociations),
-- 'dismissed' (supprimée de l'accueil, reste en mémoire anti-doublon).
create table if not exists public.daily_search_hits (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.daily_searches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_url text not null,
  title text not null default '',
  price integer,
  previous_price integer,
  year integer,
  mileage integer,
  fuel text not null default '',
  site text not null default '',
  source_country text not null default '',
  target_median integer,
  price_gap integer,
  kind text not null default 'new',
  status text not null default 'inbox',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (search_id, listing_url)
);
create index if not exists idx_daily_search_hits_user_inbox
  on public.daily_search_hits (user_id, status, last_seen_at desc);
alter table public.daily_search_hits enable row level security;
drop policy if exists "daily_search_hits_own" on public.daily_search_hits;
create policy "daily_search_hits_own" on public.daily_search_hits
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Négociations (PERSONNELLES) — pipeline vers les ventes ──────────────────
create table if not exists public.negotiations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  listing_url text not null default '',
  asking_price integer,
  negotiated_price integer,
  notes text not null default '',
  status text not null default 'open',
  transaction_id uuid references public.transactions_admin(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_negotiations_user on public.negotiations (user_id, status);
alter table public.negotiations enable row level security;
drop policy if exists "negotiations_own" on public.negotiations;
create policy "negotiations_own" on public.negotiations
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Veille juridique automobile européenne (PARTAGÉE) ───────────────────────
-- Collecte automatique (worker + IA) : les entrées arrivent en 'draft' puis
-- passent 'published' après validation ; l'historique = la table elle-même.
create table if not exists public.legal_watch_entries (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  kind text not null default 'loi',
  title text not null,
  summary text not null default '',
  effective_date date,
  source_url text not null default '',
  status text not null default 'published',
  created_by text not null default 'ADA',
  created_at timestamptz not null default now()
);
create index if not exists idx_legal_watch_country on public.legal_watch_entries (country, created_at desc);
alter table public.legal_watch_entries enable row level security;
drop policy if exists "legal_watch_select" on public.legal_watch_entries;
create policy "legal_watch_select" on public.legal_watch_entries
  for select to authenticated using (true);
drop policy if exists "legal_watch_write" on public.legal_watch_entries;
create policy "legal_watch_write" on public.legal_watch_entries
  for all to authenticated using (true) with check (true);

-- ── Configuration applicative NON SECRÈTE (id du Google Sheet, sources de
--    veille…) — les secrets (clés API) restent dans les variables Railway. ──
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists "app_config_rw" on public.app_config;
create policy "app_config_rw" on public.app_config
  for all to authenticated using (true) with check (true);

-- ── Ventes : responsable (compte) — partagées, mais on sait qui gère ────────
alter table public.transactions_admin
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;
