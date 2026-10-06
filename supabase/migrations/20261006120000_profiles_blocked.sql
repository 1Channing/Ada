/*
  # Bloquer un compte, pour de vrai (06/10, Channing : « me donner le droit
  de bloquer les accès à quelqu'un, et que ça le bloque vraiment »)

  profiles.blocked : true = le compte est fermé — l'application le
  déconnecte à chaque chargement et ne lui montre que l'écran « accès
  suspendu ». Seul un admin peut poser ou lever le blocage (RPC
  admin_set_blocked ; la colonne est protégée par le verrou
  protect_profile_privileges, comme is_admin et allowed_tabs : un compte ne
  peut pas se débloquer lui-même).

  Additif, idempotent.
*/

alter table public.profiles add column if not exists blocked boolean not null default false;

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_admin is distinct from old.is_admin)
     or (new.allowed_tabs is distinct from old.allowed_tabs)
     or (new.blocked is distinct from old.blocked) then
    if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
      raise exception 'Seul un admin peut modifier les droits d''un compte.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_blocked(p_user uuid, p_blocked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Réservé aux admins.';
  end if;
  if p_user = auth.uid() then
    raise exception 'Un admin ne peut pas se bloquer lui-même.';
  end if;
  select u.email, coalesce(nullif(u.raw_user_meta_data->>'first_name', ''), split_part(u.email, '@', 1))
    into v_email, v_name from auth.users u where u.id = p_user;
  if v_email is null then
    raise exception 'Compte inconnu.';
  end if;
  insert into public.profiles (id, display_name, blocked)
  values (p_user, v_name, p_blocked)
  on conflict (id) do update set blocked = excluded.blocked;
end;
$$;
revoke all on function public.admin_set_blocked(uuid, boolean) from public, anon;
grant execute on function public.admin_set_blocked(uuid, boolean) to authenticated;

select exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'blocked')
   and has_function_privilege('authenticated', 'public.admin_set_blocked(uuid, boolean)', 'execute') as tout_est_bon;
