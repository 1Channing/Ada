-- Journal d'usage de l'interface : un événement par page visitée, pour savoir
-- ce qui sert vraiment au quotidien (et ce qui peut être simplifié).
-- Additif — aucune table existante modifiée.
create table if not exists public.app_usage_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  path text not null,
  visitor text
);

create index if not exists idx_app_usage_events_at on public.app_usage_events (at desc);
create index if not exists idx_app_usage_events_path on public.app_usage_events (path);

alter table public.app_usage_events enable row level security;

drop policy if exists "app_usage_insert_anon" on public.app_usage_events;
create policy "app_usage_insert_anon" on public.app_usage_events
  for insert to anon, authenticated with check (true);

drop policy if exists "app_usage_select_anon" on public.app_usage_events;
create policy "app_usage_select_anon" on public.app_usage_events
  for select to anon, authenticated using (true);
