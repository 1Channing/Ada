-- ═══════════════════════════════════════════════════════════════════════════
-- VEILLES DE PROSPECTION PAR ADRESSE (29/10/2026) — demande Channing : « les
-- managers des organisations de prospection (Mon agence automobile, Weecars)
-- lancent des études quotidiennes à partir d'une URL, pour trouver les
-- dernières voitures mises en vente par des particuliers sur leur secteur ;
-- premier passage = les véhicules des dernières 24 h, puis chaque jour les
-- nouveaux, sans reprendre ceux déjà ajoutés ; dans les leads de tous les
-- commerciaux ; ce mode ne doit pas interférer avec les études quotidiennes
-- des comptes MC Export ».
--
-- Tables À PART (rien de commun avec daily_searches / daily_search_hits) :
--   prospect_watches      : la veille (adresse, nom, heure, active, auteur)
--   prospect_watch_hits   : les annonces vues ; status 'seed' (mémoire du
--                           premier passage, jamais montrée), 'inbox' (lead à
--                           prendre), 'saved' (pris, taken_by)
-- Lecture : l'auteur, et tout compte de la même organisation (les leads).
-- Écriture : l'auteur gère sa veille ; un membre de l'organisation ne peut
-- que PRENDRE un lead (inbox → saved à son nom). Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.prospect_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default '',
  url text not null,
  run_hour integer not null default 7,
  active boolean not null default true,
  last_run_at timestamptz,
  last_summary text,
  force_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_prospect_watches_user on public.prospect_watches (user_id);
create index if not exists idx_prospect_watches_due on public.prospect_watches (active, run_hour);

create table if not exists public.prospect_watch_hits (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references public.prospect_watches(id) on delete cascade,
  listing_url text not null,
  title text not null default '',
  price integer,
  year integer,
  mileage integer,
  fuel text not null default '',
  site text not null default '',
  published_at timestamptz,
  status text not null default 'inbox',
  taken_by uuid references auth.users(id) on delete set null,
  taken_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (watch_id, listing_url)
);
create index if not exists idx_prospect_watch_hits_watch on public.prospect_watch_hits (watch_id, status, first_seen_at desc);

alter table public.prospect_watches enable row level security;
alter table public.prospect_watch_hits enable row level security;

-- La veille d'un collègue de MON organisation.
create or replace function public.ada_watch_visible(p_watch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.prospect_watches w
    where w.id = p_watch and public.organisation_of(w.user_id) = public.my_organisation()
  );
$$;
revoke all on function public.ada_watch_visible(uuid) from public, anon;
grant execute on function public.ada_watch_visible(uuid) to authenticated;

drop policy if exists "prospect_watches_own" on public.prospect_watches;
create policy "prospect_watches_own" on public.prospect_watches
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "prospect_watches_org_select" on public.prospect_watches;
create policy "prospect_watches_org_select" on public.prospect_watches
  for select to authenticated using (public.organisation_of(user_id) = public.my_organisation());

drop policy if exists "prospect_watch_hits_org_select" on public.prospect_watch_hits;
create policy "prospect_watch_hits_org_select" on public.prospect_watch_hits
  for select to authenticated using (public.ada_watch_visible(watch_id));
drop policy if exists "prospect_watch_hits_take" on public.prospect_watch_hits;
create policy "prospect_watch_hits_take" on public.prospect_watch_hits
  for update to authenticated
  using (status = 'inbox' and public.ada_watch_visible(watch_id))
  with check (status = 'saved' and taken_by = auth.uid() and public.ada_watch_visible(watch_id));

grant select, insert, update, delete on public.prospect_watches to authenticated;
grant select, update on public.prospect_watch_hits to authenticated;

select (
  exists (select 1 from information_schema.tables where table_name = 'prospect_watches')
  and exists (select 1 from pg_policies where tablename = 'prospect_watch_hits' and policyname = 'prospect_watch_hits_take')
) as tout_est_bon;
