-- ═══════════════════════════════════════════════════════════════════════════
-- LEADS DE PROSPECTION : PÉRIMÈTRE SANS PRIVILÈGE ADMIN (06/11/2026)
-- Demande Channing : « avec mon compte je vois les recherches des agences de Thouaré et de Segré alors que je ne
-- suis pas le manager — je ne veux pas polluer l'affichage ».
-- Preuve : son profil est admin (MC Export), non manager. Le SQL du 05/11 a mis la lecture des études partagées
-- et des veilles sur ada_manager_orgs(), qui rend TOUTES les organisations à un admin (règle voulue pour les
-- Statistiques). Pour les leads, un admin doit voir ce que verrait son compte sans le badge admin : sa propre
-- organisation, plus celles qu'il gère s'il est manager.
-- → ada_lead_orgs() : ce périmètre-là, sans cas admin ; les règles de lecture / modification des études partagées
--   et des veilles passent dessus. ada_manager_orgs() reste pour les Statistiques et l'attribution des leads.
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.ada_lead_orgs()
returns text[]
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null then array[]::text[]
    else (
      select array(select distinct x from unnest(
        array[public.my_organisation()] || case when p.is_manager then coalesce(p.managed_orgs, array[]::text[]) else array[]::text[] end
      ) as x)
      from public.profiles p where p.id = auth.uid()
    )
  end;
$$;
revoke all on function public.ada_lead_orgs() from public, anon;
grant execute on function public.ada_lead_orgs() to authenticated;

create or replace function public.ada_shared_search_visible(p_search uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.daily_searches s
    where s.id = p_search and s.shared_leads
      and coalesce(s.lead_org, public.organisation_of(s.user_id)) = any(public.ada_lead_orgs())
  );
$$;

create or replace function public.ada_watch_visible(p_watch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.prospect_watches w
    where w.id = p_watch and coalesce(w.lead_org, public.organisation_of(w.user_id)) = any(public.ada_lead_orgs())
  );
$$;

drop policy if exists "daily_searches_org_shared_select" on public.daily_searches;
create policy "daily_searches_org_shared_select" on public.daily_searches
  for select to authenticated
  using (shared_leads and coalesce(lead_org, public.organisation_of(user_id)) = any(public.ada_lead_orgs()));

drop policy if exists "prospect_watches_org_select" on public.prospect_watches;
create policy "prospect_watches_org_select" on public.prospect_watches
  for select to authenticated
  using (coalesce(lead_org, public.organisation_of(user_id)) = any(public.ada_lead_orgs()));

drop policy if exists "prospect_watches_org_manager_update" on public.prospect_watches;
create policy "prospect_watches_org_manager_update" on public.prospect_watches
  for update to authenticated
  using (public.ada_is_manager() and coalesce(lead_org, public.organisation_of(user_id)) = any(public.ada_lead_orgs()))
  with check (public.ada_is_manager() and coalesce(lead_org, public.organisation_of(user_id)) = any(public.ada_lead_orgs()));

drop policy if exists "prospect_watches_org_manager_delete" on public.prospect_watches;
create policy "prospect_watches_org_manager_delete" on public.prospect_watches
  for delete to authenticated
  using (public.ada_is_manager() and coalesce(lead_org, public.organisation_of(user_id)) = any(public.ada_lead_orgs()));

select exists (select 1 from pg_proc where proname = 'ada_lead_orgs')
   and (select prosrc like '%ada_lead_orgs%' from pg_proc where proname = 'ada_shared_search_visible' limit 1)
   and (select prosrc like '%ada_lead_orgs%' from pg_proc where proname = 'ada_watch_visible' limit 1)
   and exists (select 1 from pg_policies where policyname = 'prospect_watches_org_select' and qual like '%ada_lead_orgs%')
   and exists (select 1 from pg_policies where policyname = 'daily_searches_org_shared_select' and qual like '%ada_lead_orgs%') as tout_est_bon;
