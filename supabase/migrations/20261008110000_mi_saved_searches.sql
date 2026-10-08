/*
  # Market Intelligence : recherches sauvegardées (08/10, Channing : « enregistrer
  des études pour les retrouver, avec les pays et tous les filtres ; un onglet
  « Recherches sauvegardées » ; favoris par un cœur ; suppression »)

  Une recherche = le jeu complet d'études (jusqu'à 3 onglets : pays, marque,
  modèle, finition, carburant, boîte, carrosserie, années, km, puissance),
  partagée par l'équipe, avec son auteur et un drapeau favori.
  Additif, idempotent.
*/
create table if not exists public.mi_saved_searches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  studies jsonb not null default '[]'::jsonb,
  favorite boolean not null default false,
  created_by uuid,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mi_saved_searches enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'mi_saved_searches' and policyname = 'mi_saved_searches_select') then
    create policy mi_saved_searches_select on public.mi_saved_searches for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'mi_saved_searches' and policyname = 'mi_saved_searches_insert') then
    create policy mi_saved_searches_insert on public.mi_saved_searches for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'mi_saved_searches' and policyname = 'mi_saved_searches_update') then
    create policy mi_saved_searches_update on public.mi_saved_searches for update to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'mi_saved_searches' and policyname = 'mi_saved_searches_delete') then
    create policy mi_saved_searches_delete on public.mi_saved_searches for delete to authenticated using (true);
  end if;
end $$;
grant select, insert, update, delete on public.mi_saved_searches to authenticated;

select exists (select 1 from information_schema.tables where table_name = 'mi_saved_searches')
   and (select count(*) from pg_policies where tablename = 'mi_saved_searches') = 4 as tout_est_bon;
