/*
  # Managers d'organisation et onglet Statistiques (12/10 soir, Channing :
  #   « un compte manager pour les managers des organisations : un compte
  #   de prospection normal sur lequel j'ajoute la position de manager, qui
  #   donne accès à un onglet Statistiques — négociations en cours avec
  #   notes et URL, nombre d'URL lancées, rendez-vous pris, Open space… »)

  - profiles.is_manager : posé par un admin (page Équipe), protégé par le
    trigger comme is_admin / allowed_tabs / organisation / blocked.
  - Trois RPC security definer, bornées à l'ORGANISATION : un manager ne
    voit que la sienne ; un admin voit celle qu'il demande (p_org), sinon
    la sienne. Sans rôle, aucune ligne.
      manager_team_members(p_org)      — les comptes de l'organisation
      manager_team_negotiations(p_org) — toutes leurs négociations (notes,
                                         URL, numéro, suite d'appel,
                                         Open space, photos)
      manager_team_analyses(p_org)     — analyses lancées par compte
  - « Rendez-vous pris ! » = outcome 'rdv' (colonne texte, rien à ajouter).
  Additif, idempotent.
*/
alter table public.profiles add column if not exists is_manager boolean not null default false;

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
      or new.is_manager is distinct from old.is_manager) then
    if auth.uid() is null then return new; end if;
    if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
      raise exception 'Seul un admin peut modifier les droits, le rôle ou l''organisation d''un compte.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.ada_is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and coalesce((
    select p.is_manager and not coalesce(p.blocked, false) from public.profiles p where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.ada_is_manager() from public, anon;
grant execute on function public.ada_is_manager() to authenticated;

/** L'organisation que l'appelant a le droit de voir : la sienne (manager), celle demandée ou la sienne (admin), sinon rien. */
create or replace function public.manager_scope_org(p_org text)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when public.ada_is_admin() then coalesce(nullif(trim(p_org), ''), public.my_organisation())
    when public.ada_is_manager() then public.my_organisation()
    else null
  end;
$$;
revoke all on function public.manager_scope_org(text) from public, anon, authenticated;

create or replace function public.manager_team_members(p_org text default null)
returns table (id uuid, display_name text, email text, organisation text, is_manager boolean, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select p.id,
         coalesce(nullif(trim(p.display_name), ''), split_part(coalesce(u.email, ''), '@', 1)) as display_name,
         u.email,
         coalesce(nullif(p.organisation, ''), 'MC Export') as organisation,
         coalesce(p.is_manager, false),
         u.created_at
    from public.profiles p
    left join auth.users u on u.id = p.id
   where coalesce(nullif(p.organisation, ''), 'MC Export') = public.manager_scope_org(p_org)
   order by display_name;
$$;
revoke all on function public.manager_team_members(text) from public, anon;
grant execute on function public.manager_team_members(text) to authenticated;

create or replace function public.manager_team_negotiations(p_org text default null)
returns table (
  id uuid, user_id uuid, owner_name text, title text, listing_url text, phone text, notes text,
  asking_price numeric, negotiated_price numeric,
  status text, outcome text, archived_at timestamptz, created_at timestamptz, updated_at timestamptz,
  in_open_space boolean, photos_count integer
)
language sql stable security definer set search_path = public
as $$
  select n.id, n.user_id,
         coalesce(nullif(trim(p.display_name), ''), 'collègue') as owner_name,
         n.title, n.listing_url, n.phone, n.notes,
         n.asking_price::numeric, n.negotiated_price::numeric,
         n.status, n.outcome, n.archived_at, n.created_at, n.updated_at,
         exists (select 1 from public.open_space_items i where i.negotiation_id = n.id) as in_open_space,
         (case when jsonb_typeof(n.photos) = 'array' then jsonb_array_length(n.photos) else 0 end)::integer as photos_count
    from public.negotiations n
    join public.profiles p on p.id = n.user_id
   where coalesce(nullif(p.organisation, ''), 'MC Export') = public.manager_scope_org(p_org)
   order by n.updated_at desc;
$$;
revoke all on function public.manager_team_negotiations(text) from public, anon;
grant execute on function public.manager_team_negotiations(text) to authenticated;

create or replace function public.manager_team_analyses(p_org text default null)
returns table (user_id uuid, total bigint, today bigint, week bigint, first_at timestamptz, last_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select a.user_id,
         count(*)::bigint,
         count(*) filter (where (a.created_at at time zone 'Europe/Paris')::date = (now() at time zone 'Europe/Paris')::date)::bigint,
         count(*) filter (where a.created_at >= now() - interval '7 days')::bigint,
         min(a.created_at), max(a.created_at)
    from public.negotiation_analyses a
    join public.profiles p on p.id = a.user_id
   where coalesce(nullif(p.organisation, ''), 'MC Export') = public.manager_scope_org(p_org)
   group by a.user_id;
$$;
revoke all on function public.manager_team_analyses(text) from public, anon;
grant execute on function public.manager_team_analyses(text) to authenticated;

select exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'is_manager')
   and exists (select 1 from pg_proc where proname = 'manager_team_negotiations')
   and exists (select 1 from pg_proc where proname = 'manager_team_members')
   and exists (select 1 from pg_proc where proname = 'manager_team_analyses')
   and not has_function_privilege('anon', 'public.manager_team_negotiations(text)', 'execute') as tout_est_bon;
