-- ═══════════════════════════════════════════════════════════════════════════
-- DOSSIERS DE NÉGOCIATION (10/09/2026, demande Channing : « classer mes
-- négociations en cours par dossiers que je nommerai selon mes besoins »).
-- Un dossier est PERSONNEL (comme la négociation) : nom libre, ordre libre.
-- La négociation pointe vers un dossier (ou aucun) ; supprimer un dossier
-- ne supprime JAMAIS ses négociations, elles reviennent « sans dossier ».
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.negotiation_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_negotiation_folders_user on public.negotiation_folders (user_id, position);

alter table public.negotiation_folders enable row level security;
drop policy if exists "negotiation_folders_own" on public.negotiation_folders;
create policy "negotiation_folders_own" on public.negotiation_folders
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.negotiations
  add column if not exists folder_id uuid references public.negotiation_folders(id) on delete set null;
create index if not exists idx_negotiations_folder on public.negotiations (folder_id) where folder_id is not null;

select 'ok' as tout_est_bon;
