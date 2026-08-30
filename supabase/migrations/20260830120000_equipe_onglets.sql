-- ═══════════════════════════════════════════════════════════════════════════
-- ÉQUIPE & ONGLETS PAR COMPTE (30/08/2026) — demande Channing : page admin
-- où un clic sur un compte active/désactive chaque onglet de l'app pour cet
-- utilisateur (l'onglet apparaît/disparaît chez lui).
--
-- 1. profiles.allowed_tabs text[] : NULL = tous les onglets (défaut, rien ne
--    change pour les comptes existants) ; sinon liste des clés autorisées
--    ('workflow','ventes','atelier','historique','market','veille').
--    Les admins ne sont JAMAIS restreints (gardé côté app ET sans effet ici).
-- 2. Verrou anti-auto-élévation : seul un admin peut changer is_admin ou
--    allowed_tabs (trigger, indépendant des policies existantes).
-- 3. Policy : un admin peut mettre à jour tous les profils (l'UI Équipe).
-- 4. RPC admin_list_accounts() : la liste des comptes AVEC email (auth.users
--    n'est pas exposé à PostgREST) — servie aux seuls admins.
-- Additif uniquement. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists allowed_tabs text[];

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_admin is distinct from old.is_admin
      or new.allowed_tabs is distinct from old.allowed_tabs) then
    -- Appels serveur (service_role, triggers internes) : auth.uid() est nul.
    if auth.uid() is null then return new; end if;
    if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
      raise exception 'Seul un admin peut modifier les droits d''un compte.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

create or replace function public.admin_list_accounts()
returns table (
  id uuid,
  email text,
  display_name text,
  first_name text,
  last_name text,
  phone text,
  is_admin boolean,
  allowed_tabs text[],
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.display_name, p.first_name, p.last_name, p.phone,
         coalesce(p.is_admin, false), p.allowed_tabs, u.created_at, u.last_sign_in_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
  order by u.created_at;
$$;

grant execute on function public.admin_list_accounts() to authenticated;

select 'ok' as tout_est_bon;
