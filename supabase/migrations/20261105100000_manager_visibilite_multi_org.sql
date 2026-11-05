-- ═══════════════════════════════════════════════════════════════════════════
-- MANAGER DE PLUSIEURS ORGANISATIONS : VISIBILITÉ DES ÉTUDES ET DES VEILLES (05/11/2026)
-- Demande Channing : « le compte segre@… qui est manager aussi de Thouaré ne voit pas les résultats des études
-- de Thouaré, ni ses études quotidiennes ».
-- Preuve : le profil porte bien managed_orgs = {Thouaré} et is_manager = true, mais les règles de lecture posées
-- le 30/10 (ada_shared_search_visible, ada_watch_visible, policies daily_searches / prospect_watches) comparent
-- l'organisation du lead à my_organisation() — UNE organisation — et non au périmètre du manager
-- ada_manager_orgs() (sa propre organisation + celles qu'il gère ; admin : toutes). Seules les Statistiques et
-- l'attribution des leads utilisaient déjà ce périmètre.
-- Corrigé pour la CLASSE : toutes les règles de lecture / modification des études partagées et des veilles
-- s'appuient sur ada_manager_orgs(). Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.ada_shared_search_visible(p_search uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.daily_searches s
    where s.id = p_search and s.shared_leads
      and coalesce(s.lead_org, public.organisation_of(s.user_id)) = any(public.ada_manager_orgs())
  );
$$;

create or replace function public.ada_watch_visible(p_watch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.prospect_watches w
    where w.id = p_watch and coalesce(w.lead_org, public.organisation_of(w.user_id)) = any(public.ada_manager_orgs())
  );
$$;

drop policy if exists "daily_searches_org_shared_select" on public.daily_searches;
create policy "daily_searches_org_shared_select" on public.daily_searches
  for select to authenticated
  using (shared_leads and coalesce(lead_org, public.organisation_of(user_id)) = any(public.ada_manager_orgs()));

drop policy if exists "prospect_watches_org_select" on public.prospect_watches;
create policy "prospect_watches_org_select" on public.prospect_watches
  for select to authenticated
  using (coalesce(lead_org, public.organisation_of(user_id)) = any(public.ada_manager_orgs()));

-- Veilles entre managers (01/11) : un manager corrige / supprime les veilles de TOUT son périmètre.
drop policy if exists "prospect_watches_org_manager_update" on public.prospect_watches;
create policy "prospect_watches_org_manager_update" on public.prospect_watches
  for update to authenticated
  using (public.ada_is_manager() and coalesce(lead_org, public.organisation_of(user_id)) = any(public.ada_manager_orgs()))
  with check (public.ada_is_manager() and coalesce(lead_org, public.organisation_of(user_id)) = any(public.ada_manager_orgs()));

drop policy if exists "prospect_watches_org_manager_delete" on public.prospect_watches;
create policy "prospect_watches_org_manager_delete" on public.prospect_watches
  for delete to authenticated
  using (public.ada_is_manager() and coalesce(lead_org, public.organisation_of(user_id)) = any(public.ada_manager_orgs()));

select (select prosrc like '%ada_manager_orgs%' from pg_proc where proname = 'ada_shared_search_visible' limit 1)
   and (select prosrc like '%ada_manager_orgs%' from pg_proc where proname = 'ada_watch_visible' limit 1)
   and exists (select 1 from pg_policies where policyname = 'prospect_watches_org_select' and qual like '%ada_manager_orgs%')
   and exists (select 1 from pg_policies where policyname = 'daily_searches_org_shared_select' and qual like '%ada_manager_orgs%') as tout_est_bon;
