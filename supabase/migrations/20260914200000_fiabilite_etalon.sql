-- ═══════════════════════════════════════════════════════════════════════════
-- FIABILISER AVANT DE DÉVELOPPER AUTOUR (décision Channing 14/09/2026).
-- 1) ÉTALON HUMAIN HEBDOMADAIRE : chaque semaine, 5 études tirées au sort ;
--    pour chacune et chaque site, l'humain fait la recherche à la main et
--    note le nombre d'annonces vu (et l'URL) ; ADA note le sien (dernier
--    relevé de la vague). Le rappel par site, semaine après semaine, est le
--    seul juge de paix de « l'étude trouve-t-elle tout ? ».
--    Table d'équipe : lisible et modifiable par tout compte connecté.
-- 2) truth_active_studies() rend désormais l'id de l'étude : le Truth Center
--    rattache un dossier à l'étude EXACTE de son segment (constat 14/09 :
--    critères d'une autre Yaris Cross affichés). Toujours sans propriétaire.
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.truth_benchmarks (
  id uuid primary key default gen_random_uuid(),
  week text not null,                                  -- ISO « 2026-W38 »
  search_id uuid not null references public.daily_searches(id) on delete cascade,
  search_label text not null default '',
  site text not null,
  side text not null default 'source',                 -- 'source' | 'cible'
  country text not null default '',
  ada_count integer,
  ada_url text,
  ada_at timestamptz,
  human_count integer,
  human_url text,
  note text not null default '',
  filled_by uuid,
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (week, search_id, site)
);
create index if not exists idx_truth_benchmarks_week on public.truth_benchmarks (week);

alter table public.truth_benchmarks enable row level security;
drop policy if exists "truth_benchmarks_team" on public.truth_benchmarks;
create policy "truth_benchmarks_team" on public.truth_benchmarks
  for all to authenticated using (true) with check (true);

drop function if exists public.truth_active_studies();
create function public.truth_active_studies()
returns table (
  id uuid,
  label text,
  brand text,
  model text,
  fuel text,
  "trim" text,
  trim_target text,
  year_min int,
  year_max int,
  mileage_max int,
  gearbox text,
  power_min int,
  source_country text,
  target_country text
)
language sql stable
security definer
set search_path = public
as $$
  select
    d.id, d.label, d.brand, d.model, d.fuel, d.trim, d.trim_target,
    d.year_min, d.year_max, d.mileage_max, d.gearbox, d.power_min,
    d.source_country, d.target_country
  from daily_searches d
  where d.active
$$;
revoke all on function public.truth_active_studies() from public;
grant execute on function public.truth_active_studies() to authenticated;
grant execute on function public.truth_active_studies() to anon;

select 'ok' as tout_est_bon;
