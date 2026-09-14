-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTALON HUMAIN — RESCRAPE AUTOMATIQUE (demande Channing 14/09 : « chaque
-- étude tirée au hasard doit être re-scrapée automatiquement pour que les
-- données soient fraîches — trois véhicules vendus feraient penser à des
-- erreurs alors que non »).
-- Le drapeau force_requested_at (« Lancer maintenant ») n'est posable que
-- sur SES études (RLS). L'étalon compare les études de toute l'équipe : cette
-- fonction pose le drapeau pour n'importe quel compte connecté, mais SEULEMENT
-- sur une étude tirée dans l'étalon de la semaine en cours — rien d'autre
-- n'est écrit. Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.truth_benchmark_force_run(p_search uuid, p_week text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with allowed as (
    select 1 from public.truth_benchmarks b
    where b.search_id = p_search and b.week = p_week and auth.uid() is not null
    limit 1
  ), upd as (
    update public.daily_searches d
       set force_requested_at = now()
     where d.id = p_search and exists (select 1 from allowed)
    returning 1
  )
  select exists (select 1 from upd);
$$;
revoke all on function public.truth_benchmark_force_run(uuid, text) from public, anon;
grant execute on function public.truth_benchmark_force_run(uuid, text) to authenticated;

select 'ok' as tout_est_bon;
