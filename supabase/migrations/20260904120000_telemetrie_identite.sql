-- ═══════════════════════════════════════════════════════════════════════════
-- TÉLÉMÉTRIE : identité par COMPTE, plus par libellé (04/09/2026) — constat
-- Channing : « channing » et « Channing » (idem Antoine) comptés comme deux
-- utilisateurs. Le journal ne portait qu'un texte (prénom du profil, ou à
-- défaut l'ancien nom saisi dans l'Ingestion, ou un identifiant d'appareil),
-- et le premier événement d'une session partait avant le chargement du
-- profil. Désormais chaque événement porte user_id ; l'historique est
-- rattaché par prénom insensible à la casse quand il est sans ambiguïté.
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.app_usage_events
  add column if not exists user_id uuid;
create index if not exists idx_app_usage_events_user on public.app_usage_events (user_id, at desc);

-- Rattrapage : un libellé qui correspond (sans casse) au prénom d'UN SEUL
-- profil est rattaché à ce compte. Un prénom porté par deux profils reste
-- tel quel (on ne devine pas).
update public.app_usage_events e
   set user_id = m.id
  from (
    select lower(trim(p.display_name)) as k, min(p.id::text)::uuid as id
      from public.profiles p
     where coalesce(trim(p.display_name), '') <> ''
     group by lower(trim(p.display_name))
    having count(*) = 1
  ) m
 where e.user_id is null
   and lower(trim(coalesce(e.visitor, ''))) = m.k;

-- Équipe : « dernière activité » par compte (repli sur le prénom sans casse
-- pour les événements antérieurs non rattachés).
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
         (select max(e.at) from public.app_usage_events e
           where e.user_id = u.id
              or (e.user_id is null and lower(trim(coalesce(e.visitor, ''))) = lower(trim(coalesce(p.display_name, '§'))))
         )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
  order by u.created_at;
$$;

grant execute on function public.admin_list_accounts() to authenticated;

select 'ok' as tout_est_bon;
