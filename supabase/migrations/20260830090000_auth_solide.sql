-- ═══════════════════════════════════════════════════════════════════════════
-- AUTH SOLIDE (30/08/2026) — demande Channing : « connexion et inscription
-- vraiment solides, un compte unique par adresse mail ».
--
-- 1. Profils enrichis : prénom / nom / téléphone (l'inscription les demande
--    désormais ; display_name reste le prénom d'affichage historique — rien
--    ne casse : contributeurs, négociations, conflits).
-- 2. Liste d'emails AUTORISÉS à s'inscrire (auth_allowlist) + verrou à la
--    création de compte. FAIL-OPEN : tant que la liste est VIDE, l'inscription
--    reste libre (comportement actuel) — le verrou ne s'arme qu'au premier
--    email inséré. Un compte par email est déjà garanti par Supabase Auth ;
--    ce verrou empêche les comptes fantômes (adresses hors équipe).
-- Additif uniquement. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name  text;
alter table public.profiles add column if not exists phone      text;

create table if not exists public.auth_allowlist (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.auth_allowlist enable row level security;

-- Lecture/écriture réservées aux admins connectés (gestion future depuis
-- l'UI) ; le trigger lui-même est security definer et ignore la RLS.
drop policy if exists auth_allowlist_admin_all on public.auth_allowlist;
create policy auth_allowlist_admin_all on public.auth_allowlist
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

create or replace function public.enforce_auth_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- FAIL-OPEN : liste vide = aucun verrou (l'équipe n'est pas encore saisie).
  if not exists (select 1 from public.auth_allowlist) then
    return new;
  end if;
  if exists (
    select 1 from public.auth_allowlist a
    where lower(a.email) = lower(new.email)
  ) then
    return new;
  end if;
  raise exception 'Inscription réservée à l''équipe MC Export — demande à un admin d''ajouter ton adresse.';
end;
$$;

drop trigger if exists trg_enforce_auth_allowlist on auth.users;
create trigger trg_enforce_auth_allowlist
  before insert on auth.users
  for each row execute function public.enforce_auth_allowlist();

select 'ok' as tout_est_bon;
