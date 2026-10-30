-- ═══════════════════════════════════════════════════════════════════════════
-- MANAGER DE PLUSIEURS ORGANISATIONS (30/10/2026) — demande Channing :
-- « segre@monagenceautomobile… gère les études quotidiennes de Mon agence
-- automobile Segré ET de Mon agence automobile Thouaré ; un compte de
-- prospection doit pouvoir être manager de deux agences : dans Admin je
-- choisis de quelles organisations il est manager ; dans Statistiques il
-- voit tous ses commerciaux ; dans ses études il attribue les leads à telle
-- ou telle organisation ».
--
-- 1. profiles.managed_orgs text[] : organisations gérées EN PLUS de la sienne
--    (posé par un admin seulement — trigger de protection).
-- 2. ada_manager_orgs() : le périmètre d'un manager = sa propre organisation
--    + managed_orgs (admin : toutes).
-- 3. daily_searches.lead_org / prospect_watches.lead_org : l'organisation qui
--    REÇOIT les leads (null = celle de l'auteur). Un trigger refuse une
--    organisation hors périmètre. La visibilité des leads (fonctions
--    ada_shared_search_visible / ada_watch_visible et policies de lecture)
--    suit lead_org au lieu de l'organisation de l'auteur.
-- 4. manager_scope_org(p_org) : un manager peut demander n'importe quelle
--    organisation de son périmètre (Statistiques).
-- 5. RPC admin_set_managed_orgs(p_user, p_orgs) : réservée aux admins.
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists managed_orgs text[];

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_admin is distinct from old.is_admin
      or new.allowed_tabs is distinct from old.allowed_tabs
      or new.organisation is distinct from old.organisation
      or new.blocked is distinct from old.blocked
      or new.is_manager is distinct from old.is_manager
      or new.managed_orgs is distinct from old.managed_orgs) then
    if auth.uid() is null then return new; end if;
    if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
      raise exception 'Seul un admin peut modifier les droits, le rôle ou l''organisation d''un compte.';
    end if;
  end if;
  return new;
end;
$$;

-- Le trigger de protection existe depuis le 30/08 ; recréé ici pour que la garde tienne même sur une base où il manquerait.
drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges before update on public.profiles for each row execute function public.protect_profile_privileges();

/** Le périmètre d'organisations d'un compte : la sienne + celles qu'il gère (manager) ; admin : toutes. */
create or replace function public.ada_manager_orgs()
returns text[]
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null then array[]::text[]
    when public.ada_is_admin() then (select coalesce(array_agg(name), array[]::text[]) from public.organisations)
    else (
      select array(select distinct x from unnest(
        array[public.my_organisation()] || case when p.is_manager then coalesce(p.managed_orgs, array[]::text[]) else array[]::text[] end
      ) as x)
      from public.profiles p where p.id = auth.uid()
    )
  end;
$$;
revoke all on function public.ada_manager_orgs() from public, anon;
grant execute on function public.ada_manager_orgs() to authenticated;

create or replace function public.admin_set_managed_orgs(p_user uuid, p_orgs text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Réservé aux admins.';
  end if;
  update public.profiles
     set managed_orgs = (select nullif(array(select distinct o from unnest(coalesce(p_orgs, array[]::text[])) o where o <> '' and exists (select 1 from public.organisations g where g.name = o)), array[]::text[]))
   where id = p_user;
  if not found then raise exception 'Profil introuvable.'; end if;
end $$;
revoke all on function public.admin_set_managed_orgs(uuid, text[]) from public, anon;
grant execute on function public.admin_set_managed_orgs(uuid, text[]) to authenticated;

-- Statistiques : un manager voit n'importe quelle organisation de son périmètre.
create or replace function public.manager_scope_org(p_org text)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when public.ada_is_admin() then coalesce(nullif(trim(p_org), ''), public.my_organisation())
    when public.ada_is_manager() then
      case when nullif(trim(p_org), '') is not null and nullif(trim(p_org), '') = any(public.ada_manager_orgs()) then trim(p_org) else public.my_organisation() end
    else null
  end;
$$;
revoke all on function public.manager_scope_org(text) from public, anon, authenticated;

-- Cible des leads.
alter table public.daily_searches add column if not exists lead_org text;
alter table public.prospect_watches add column if not exists lead_org text;

create or replace function public.protect_lead_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_org is not null and nullif(trim(new.lead_org), '') is null then new.lead_org := null; end if;
  if new.lead_org is not null and auth.uid() is not null and not (new.lead_org = any(public.ada_manager_orgs())) then
    raise exception 'Organisation « % » hors de ton périmètre de manager.', new.lead_org;
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_lead_org_searches on public.daily_searches;
create trigger trg_protect_lead_org_searches before insert or update on public.daily_searches for each row execute function public.protect_lead_org();
drop trigger if exists trg_protect_lead_org_watches on public.prospect_watches;
create trigger trg_protect_lead_org_watches before insert or update on public.prospect_watches for each row execute function public.protect_lead_org();

-- Visibilité des leads : l'organisation CIBLE (lead_org, sinon celle de l'auteur).
create or replace function public.ada_shared_search_visible(p_search uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.daily_searches s
    where s.id = p_search and s.shared_leads
      and coalesce(s.lead_org, public.organisation_of(s.user_id)) = public.my_organisation()
  );
$$;
create or replace function public.ada_watch_visible(p_watch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.prospect_watches w
    where w.id = p_watch and coalesce(w.lead_org, public.organisation_of(w.user_id)) = public.my_organisation()
  );
$$;

drop policy if exists "daily_searches_org_shared_select" on public.daily_searches;
create policy "daily_searches_org_shared_select" on public.daily_searches
  for select to authenticated
  using (shared_leads and coalesce(lead_org, public.organisation_of(user_id)) = public.my_organisation());
drop policy if exists "prospect_watches_org_select" on public.prospect_watches;
create policy "prospect_watches_org_select" on public.prospect_watches
  for select to authenticated using (coalesce(lead_org, public.organisation_of(user_id)) = public.my_organisation());

select exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'managed_orgs')
   and exists (select 1 from information_schema.columns where table_name = 'daily_searches' and column_name = 'lead_org')
   and exists (select 1 from information_schema.columns where table_name = 'prospect_watches' and column_name = 'lead_org')
   and exists (select 1 from pg_proc where proname = 'admin_set_managed_orgs')
   and exists (select 1 from pg_proc where proname = 'ada_manager_orgs') as tout_est_bon;
