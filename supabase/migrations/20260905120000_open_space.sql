-- ═══════════════════════════════════════════════════════════════════════════
-- OPEN SPACE (05/09/2026, demande Channing) : un espace PARTAGÉ dans les
-- négociations. Une négociation reste personnelle (RLS negotiations_own
-- intacte) ; son propriétaire peut la POUSSER dans l'Open space — elle
-- devient alors visible par toute l'équipe (titre, annonce, prix, photos)
-- et chacun peut y laisser des notes datées et signées.
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.open_space_items (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null unique references public.negotiations(id) on delete cascade,
  pushed_by uuid not null references auth.users(id) on delete cascade,
  pushed_at timestamptz not null default now(),
  message text not null default ''
);
create index if not exists idx_open_space_items_pushed on public.open_space_items (pushed_at desc);

create table if not exists public.open_space_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.open_space_items(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_open_space_notes_item on public.open_space_notes (item_id, created_at);

-- Dernière visite de l'Open space par compte → badge « nouveautés ».
create table if not exists public.open_space_seen (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.open_space_items enable row level security;
alter table public.open_space_notes enable row level security;
alter table public.open_space_seen  enable row level security;

do $$ begin
  -- Items : lisibles par toute l'équipe ; poussés par le propriétaire de la
  -- négociation ; retirés par lui ou par un admin.
  if not exists (select 1 from pg_policies where tablename = 'open_space_items' and policyname = 'open_space_items_select') then
    create policy "open_space_items_select" on public.open_space_items for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'open_space_items' and policyname = 'open_space_items_insert') then
    create policy "open_space_items_insert" on public.open_space_items for insert to authenticated
      with check (pushed_by = auth.uid() and exists (select 1 from public.negotiations n where n.id = negotiation_id and n.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'open_space_items' and policyname = 'open_space_items_delete') then
    create policy "open_space_items_delete" on public.open_space_items for delete to authenticated
      using (pushed_by = auth.uid() or exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin));
  end if;
  -- Notes : lisibles par tous, signées par leur auteur, supprimables par lui ou un admin.
  if not exists (select 1 from pg_policies where tablename = 'open_space_notes' and policyname = 'open_space_notes_select') then
    create policy "open_space_notes_select" on public.open_space_notes for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'open_space_notes' and policyname = 'open_space_notes_insert') then
    create policy "open_space_notes_insert" on public.open_space_notes for insert to authenticated with check (author_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'open_space_notes' and policyname = 'open_space_notes_delete') then
    create policy "open_space_notes_delete" on public.open_space_notes for delete to authenticated
      using (author_id = auth.uid() or exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin));
  end if;
  -- Vu : chacun sa ligne.
  if not exists (select 1 from pg_policies where tablename = 'open_space_seen' and policyname = 'open_space_seen_own') then
    create policy "open_space_seen_own" on public.open_space_seen for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  -- Une négociation POUSSÉE devient lisible par l'équipe (titre, annonce,
  -- prix, photos) — c'est le choix explicite de son propriétaire.
  if not exists (select 1 from pg_policies where tablename = 'negotiations' and policyname = 'negotiations_open_space_read') then
    create policy "negotiations_open_space_read" on public.negotiations for select to authenticated
      using (exists (select 1 from public.open_space_items o where o.negotiation_id = negotiations.id));
  end if;
end $$;

grant select, insert, delete on public.open_space_items to authenticated;
grant select, insert, delete on public.open_space_notes to authenticated;
grant select, insert, update, delete on public.open_space_seen to authenticated;

select 'ok' as tout_est_bon;
