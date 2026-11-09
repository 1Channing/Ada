/*
  # Score visible par tous, scores de tous (09/11)

  Channing : « certains comptes n'ont pas accès au Score dans le Workflow, je veux que tout le monde y ait
  accès, que tout le monde voie les scores de tout le monde ».

  org_scoreboard(p_org) rendait seulement MON organisation (un admin choisissait). Désormais, pour tout
  compte connecté : p_org vide = TOUTES les organisations (chaque compte non bloqué, avec son organisation) ;
  p_org donné = celle-là. Le type de retour change (colonne organisation) : la fonction est recréée.

  Et (même jour, Channing : « dans Équipe, pour chaque compte, sélectionner ceux dont les scores s'affichent ») :
  profiles.score_visible (vrai par défaut), posé depuis la page Admin ; un compte à faux n'apparaît pas.

  Et (09/11 soir, Channing : « une option monthly, remise à jour tous les mois, et une option All time ») :
  p_since = début de période ; vide = depuis toujours. Leads pris par date de prise, négociations par date
  d'ouverture, rendez-vous par date de validation.
  Additif, idempotent.
*/

alter table public.profiles add column if not exists score_visible boolean not null default true;

drop function if exists public.org_scoreboard(text);
drop function if exists public.org_scoreboard(text, timestamptz);
create function public.org_scoreboard(p_org text default null, p_since timestamptz default null)
returns table (user_id uuid, display_name text, organisation text, is_manager boolean, leads_taken bigint, negotiations bigint, rdv bigint)
language sql stable security definer set search_path = public
as $$
  with members as (
    select p.id, coalesce(nullif(trim(p.display_name), ''), 'collègue') as display_name,
           coalesce(nullif(p.organisation, ''), 'MC Export') as organisation,
           coalesce(p.is_manager, false) as is_manager
      from public.profiles p
     where not coalesce(p.blocked, false)
       and coalesce(p.score_visible, true)
       and (nullif(trim(p_org), '') is null or coalesce(nullif(p.organisation, ''), 'MC Export') = trim(p_org))
  )
  select m.id,
         m.display_name,
         m.organisation,
         m.is_manager,
         (coalesce((select count(*) from public.prospect_watch_hits h where h.taken_by = m.id and h.status = 'saved' and (p_since is null or coalesce(h.taken_at, h.first_seen_at) >= p_since)), 0)
          + coalesce((select count(*) from public.daily_search_hits d where d.taken_by = m.id and d.status = 'saved' and (p_since is null or coalesce(d.taken_at, d.first_seen_at) >= p_since)), 0))::bigint as leads_taken,
         (select count(*) from public.negotiations n where n.user_id = m.id and (p_since is null or n.created_at >= p_since))::bigint as negotiations,
         (select count(*) from public.negotiations n where n.user_id = m.id and n.status = 'archived' and n.outcome = 'rdv' and (p_since is null or coalesce(n.archived_at, n.updated_at) >= p_since))::bigint as rdv
    from members m
   order by rdv desc, leads_taken desc, m.display_name;
$$;
revoke all on function public.org_scoreboard(text, timestamptz) from public, anon;
grant execute on function public.org_scoreboard(text, timestamptz) to authenticated;

select exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'org_scoreboard'
     and pg_get_function_result(p.oid) like '%organisation text%'
     and pg_get_function_arguments(p.oid) like '%p_since%'
) and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'score_visible') as tout_est_bon;
