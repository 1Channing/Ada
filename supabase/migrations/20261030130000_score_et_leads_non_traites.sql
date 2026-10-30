-- ═══════════════════════════════════════════════════════════════════════════
-- SCORE D'ORGANISATION ET LEADS NON TRAITÉS (30/10/2026) — demande Channing :
--   « un onglet Score où les agents voient vite les stats des autres : leads
--   pris, rendez-vous pris, taux de conversion » et, pour les managers,
--   « taux de conversion par commercial (RDV / négociations lancées) et
--   leads non traités ».
-- 1. org_scoreboard(p_org) : pour chaque compte de l'organisation (la mienne ;
--    admin : celle demandée) — leads pris (veilles + études partagées),
--    négociations lancées, rendez-vous pris. Lisible par tout membre.
-- 2. manager_open_leads(p_org) : leads encore « à prendre » de l'organisation
--    (veilles ciblées + études partagées ciblées), périmètre manager.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.org_scoreboard(p_org text default null)
returns table (user_id uuid, display_name text, is_manager boolean, leads_taken bigint, negotiations bigint, rdv bigint)
language sql stable security definer set search_path = public
as $$
  with org as (
    select case when public.ada_is_admin() then coalesce(nullif(trim(p_org), ''), public.my_organisation()) else public.my_organisation() end as name
  ),
  members as (
    select p.id, coalesce(nullif(trim(p.display_name), ''), 'collègue') as display_name, coalesce(p.is_manager, false) as is_manager
      from public.profiles p, org
     where coalesce(nullif(p.organisation, ''), 'MC Export') = org.name and not coalesce(p.blocked, false)
  )
  select m.id,
         m.display_name,
         m.is_manager,
         (coalesce((select count(*) from public.prospect_watch_hits h where h.taken_by = m.id and h.status = 'saved'), 0)
          + coalesce((select count(*) from public.daily_search_hits d where d.taken_by = m.id and d.status = 'saved'), 0))::bigint as leads_taken,
         (select count(*) from public.negotiations n where n.user_id = m.id)::bigint as negotiations,
         (select count(*) from public.negotiations n where n.user_id = m.id and n.status = 'archived' and n.outcome = 'rdv')::bigint as rdv
    from members m
   order by rdv desc, leads_taken desc, m.display_name;
$$;
revoke all on function public.org_scoreboard(text) from public, anon;
grant execute on function public.org_scoreboard(text) to authenticated;

create or replace function public.manager_open_leads(p_org text default null)
returns table (watch_leads bigint, study_leads bigint, oldest timestamptz)
language sql stable security definer set search_path = public
as $$
  with org as (select public.manager_scope_org(p_org) as name),
  w as (
    select h.first_seen_at from public.prospect_watch_hits h join public.prospect_watches pw on pw.id = h.watch_id, org
     where h.status = 'inbox' and coalesce(pw.lead_org, public.organisation_of(pw.user_id)) = org.name
  ),
  s as (
    select d.first_seen_at from public.daily_search_hits d join public.daily_searches ds on ds.id = d.search_id, org
     where d.status = 'inbox' and d.kind <> 'seed' and ds.shared_leads and coalesce(ds.lead_org, public.organisation_of(ds.user_id)) = org.name
  )
  select (select count(*) from w)::bigint, (select count(*) from s)::bigint,
         least((select min(first_seen_at) from w), (select min(first_seen_at) from s));
$$;
revoke all on function public.manager_open_leads(text) from public, anon;
grant execute on function public.manager_open_leads(text) to authenticated;

select exists (select 1 from pg_proc where proname = 'org_scoreboard')
   and exists (select 1 from pg_proc where proname = 'manager_open_leads') as tout_est_bon;
