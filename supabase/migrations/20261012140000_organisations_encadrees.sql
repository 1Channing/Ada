/*
  # Organisations ENCADRÉES (12/10 soir, Channing : « je n'ai pas les
  #   organisations d'enregistrées pour les comptes, et à la création d'un
  #   compte je ne peux pas l'ajouter à une organisation — il faut que tout
  #   soit bien encadré »)

  - Table organisations : la liste de référence (MC Export, Weecars Angers,
    Mon agence automobile…), lue par tous, gérée par les admins ; alimentée
    par les organisations déjà posées sur les profils.
  - À la CRÉATION d'un compte : l'organisation se choisit dans le formulaire
    (RPC admin_set_organisation, qui crée la ligne de profil si elle manque,
    comme admin_set_allowed_tabs) ; une adresse autorisée à s'inscrire porte
    aussi son organisation (auth_allowlist.organisation) et le profil la
    reçoit à l'inscription (trigger).
  - Personne ne change sa propre organisation : seul un admin (trigger de
    protection, comme is_admin / allowed_tabs).
  - open_space_set_photos : limité à l'organisation, comme la lecture.
  Additif, idempotent ; suppose la migration 20261012130000 passée.
*/
create table if not exists public.organisations (
  name text primary key,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.organisations enable row level security;
drop policy if exists organisations_select on public.organisations;
create policy organisations_select on public.organisations for select to authenticated using (true);
drop policy if exists organisations_admin_write on public.organisations;
create policy organisations_admin_write on public.organisations for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
grant select, insert, update, delete on public.organisations to authenticated;
insert into public.organisations (name) values ('MC Export') on conflict do nothing;
insert into public.organisations (name)
  select distinct organisation from public.profiles where coalesce(organisation, '') <> ''
  on conflict do nothing;

alter table public.auth_allowlist add column if not exists organisation text;

-- Organisation à la naissance d'un profil : celle de l'adresse autorisée,
-- sinon MC Export ; et toute organisation posée entre dans la liste.
create or replace function public.profile_default_organisation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_org text;
begin
  if coalesce(new.organisation, '') = '' then
    select u.email into v_email from auth.users u where u.id = new.id;
    select a.organisation into v_org
      from public.auth_allowlist a
     where lower(a.email) = lower(coalesce(v_email, '')) and coalesce(a.organisation, '') <> ''
     limit 1;
    new.organisation := coalesce(v_org, 'MC Export');
  end if;
  insert into public.organisations (name) values (new.organisation) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists trg_profile_default_organisation on public.profiles;
create trigger trg_profile_default_organisation
  before insert or update of organisation on public.profiles
  for each row execute function public.profile_default_organisation();

-- Seul un admin change l'organisation d'un compte (comme les droits).
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_admin is distinct from old.is_admin
      or new.allowed_tabs is distinct from old.allowed_tabs
      or new.organisation is distinct from old.organisation) then
    if auth.uid() is null then return new; end if;
    if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
      raise exception 'Seul un admin peut modifier les droits ou l''organisation d''un compte.';
    end if;
  end if;
  return new;
end;
$$;

-- RPC admin : crée la ligne de profil si elle manque (compte tout juste créé).
create or replace function public.admin_set_organisation(p_user uuid, p_org text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name text;
  v_org text := coalesce(nullif(trim(p_org), ''), 'MC Export');
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Réservé aux admins.';
  end if;
  select u.email,
         coalesce(nullif(u.raw_user_meta_data->>'first_name', ''), split_part(u.email, '@', 1))
    into v_email, v_name
    from auth.users u where u.id = p_user;
  if v_email is null then
    raise exception 'Compte inconnu.';
  end if;
  insert into public.organisations (name) values (v_org) on conflict do nothing;
  insert into public.profiles (id, display_name, organisation)
  values (p_user, v_name, v_org)
  on conflict (id) do update set organisation = excluded.organisation;
end;
$$;
revoke all on function public.admin_set_organisation(uuid, text) from public, anon;
grant execute on function public.admin_set_organisation(uuid, text) to authenticated;

-- Photos d'une négociation partagée : même organisation seulement.
create or replace function public.open_space_set_photos(p_negotiation_id uuid, p_photos jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if auth.uid() is null then return false; end if;
  if jsonb_typeof(p_photos) <> 'array' then return false; end if;
  update public.negotiations n
     set photos = p_photos, updated_at = now()
   where n.id = p_negotiation_id
     and exists (select 1 from public.open_space_items o
                  where o.negotiation_id = n.id
                    and public.organisation_of(o.pushed_by) = public.my_organisation());
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

select exists (select 1 from information_schema.tables where table_name = 'organisations')
   and exists (select 1 from public.organisations where name = 'MC Export')
   and exists (select 1 from information_schema.columns where table_name = 'auth_allowlist' and column_name = 'organisation')
   and exists (select 1 from pg_trigger where tgname = 'trg_profile_default_organisation')
   and exists (select 1 from pg_proc where proname = 'admin_set_organisation') as tout_est_bon;
