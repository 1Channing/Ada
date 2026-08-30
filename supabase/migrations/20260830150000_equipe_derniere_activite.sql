-- ═══════════════════════════════════════════════════════════════════════════
-- ÉQUIPE : vraie « dernière activité » (30/08/2026) — constat Channing :
-- « vu le » affichait last_sign_in_at, qui ne bouge qu'à une SAISIE du mot
-- de passe (la session ADA reste ouverte des semaines) → date périmée pour
-- un utilisateur pourtant actif. La télémétrie (app_usage_events, un
-- événement par page visitée, visitor = prénom du profil) porte la vérité :
-- on l'ajoute à la liste des comptes.
-- (Type de retour étendu → drop + recréation obligatoire, même définition
-- sinon.) Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.admin_list_accounts();

create function public.admin_list_accounts()
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
  last_sign_in_at timestamptz,
  last_activity_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.display_name, p.first_name, p.last_name, p.phone,
         coalesce(p.is_admin, false), p.allowed_tabs, u.created_at, u.last_sign_in_at,
         (select max(e.at) from public.app_usage_events e where e.visitor = p.display_name)
  from auth.users u
  left join public.profiles p on p.id = u.id
  where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
  order by u.created_at;
$$;

grant execute on function public.admin_list_accounts() to authenticated;

select 'ok' as tout_est_bon;
