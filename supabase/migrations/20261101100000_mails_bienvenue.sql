-- ═══════════════════════════════════════════════════════════════════════════
-- MAILS DE BIENVENUE (01/11/2026) — demande Channing : « à la création d'un
-- compte, envoyer un e-mail à la personne depuis la boîte d'Ada avec sa
-- signature : identifiants, lien ; je choisis les onglets et je visualise le
-- mail avant ». L'admin dépose le mail (texte final, celui de l'aperçu) dans
-- welcome_mails ; le worker l'envoie depuis ada@ (délégation Gmail), marque
-- envoyé / échec avec la raison. Lecture et dépôt réservés aux admins.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.welcome_mails (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  to_name text not null default '',
  subject text not null,
  body text not null,
  status text not null default 'queued',
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists idx_welcome_mails_status on public.welcome_mails (status, created_at);
alter table public.welcome_mails enable row level security;

drop policy if exists "welcome_mails_admin" on public.welcome_mails;
create policy "welcome_mails_admin" on public.welcome_mails
  for all to authenticated using (public.ada_is_admin()) with check (public.ada_is_admin());
grant select, insert, update on public.welcome_mails to authenticated;

select exists (select 1 from information_schema.tables where table_name = 'welcome_mails')
   and exists (select 1 from pg_policies where tablename = 'welcome_mails' and policyname = 'welcome_mails_admin') as tout_est_bon;
