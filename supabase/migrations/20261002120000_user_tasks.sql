/*
  # Tâches par utilisateur (02/10, demande Channing)

  L'admin confie une tâche à un compte depuis la boîte à apprendre (note +
  lien) ; la personne la voit sur son accueil avec une pastille, et la
  coche pour la valider. Une liste par compte.

  Lecture : chacun voit ses tâches, l'admin voit tout. Création : admin.
  Validation (fait / à refaire) : la personne ou l'admin.

  Additif, idempotent. Insère aussi les 6 lacunes réelles de campagne dans
  la liste de Channing (clé stable, jamais en double).
*/

create table if not exists user_tasks (
  id uuid primary key default gen_random_uuid(),
  assignee_id uuid not null references profiles(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  key text unique,
  title text not null,
  note text,
  link text,
  status text not null default 'open',          -- open | done
  created_at timestamptz not null default now(),
  done_at timestamptz,
  seen_at timestamptz
);
create index if not exists idx_user_tasks_assignee on user_tasks (assignee_id, status, created_at desc);

alter table user_tasks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'user_tasks' and policyname = 'user_tasks_select') then
    create policy "user_tasks_select" on user_tasks for select to authenticated
      using (assignee_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_tasks' and policyname = 'user_tasks_insert') then
    create policy "user_tasks_insert" on user_tasks for insert to authenticated
      with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_tasks' and policyname = 'user_tasks_delete') then
    create policy "user_tasks_delete" on user_tasks for delete to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_tasks' and policyname = 'user_tasks_update') then
    create policy "user_tasks_update" on user_tasks for update to authenticated
      using (assignee_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
      with check (assignee_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
  end if;
end $$;

-- Les 6 lacunes réelles de campagne (02/10) → liste de Channing.
insert into user_tasks (assignee_id, created_by, key, title, note, link) values
  ('4537e9c9-fb62-424d-8a5c-228e9dbfbf58', '4537e9c9-fb62-424d-8a5c-228e9dbfbf58', 'gap:BILBASEN:BMW:2-SERIES GRAN COUPE',
   'Bilbasen · BMW 2-Series Gran Coupé (électrique, 2024)',
   'Le site ne reconnaît pas notre nom de modèle. Sur bilbasen.dk, choisir BMW puis le modèle 2-serie Gran Coupé dans leur menu, et me coller l''URL de la page de résultats.',
   'https://www.bilbasen.dk/brugt/bil/bmw/2-series_gran_coupe?includeengroscvr=true&includeleasing=false&sortby=price&sortorder=asc&regfrom=2024-01&regto=2024-12&fuel=3'),
  ('4537e9c9-fb62-424d-8a5c-228e9dbfbf58', '4537e9c9-fb62-424d-8a5c-228e9dbfbf58', 'gap:BILBASEN:VOLKSWAGEN:T7 MULTIVAN',
   'Bilbasen · Volkswagen T7 Multivan (électrique, 2022)',
   'Même cas : choisir VW puis Multivan dans le menu du site, et me coller l''URL de la page de résultats.',
   'https://www.bilbasen.dk/brugt/bil/vw/t7_multivan?includeengroscvr=true&includeleasing=false&sortby=price&sortorder=asc&regfrom=2022-01&regto=2022-12&fuel=3'),
  ('4537e9c9-fb62-424d-8a5c-228e9dbfbf58', '4537e9c9-fb62-424d-8a5c-228e9dbfbf58', 'gap:AUTOSCOUT_FR:OPEL:CORSA F',
   'AutoScout FR · Opel Corsa F (électrique, 2020)',
   'Page introuvable avec notre nom. Sur autoscout24.fr, chercher Opel Corsa électrique 2020 et me coller l''URL de la page de résultats (le site nomme peut-être le modèle « Corsa » ou « Corsa-e »).',
   'https://www.autoscout24.fr/lst/opel/corsa-f?atype=C&cy=F&sort=price&desc=0&ustate=N%2CU&fregfrom=2020&fregto=2020&fuel=E'),
  ('4537e9c9-fb62-424d-8a5c-228e9dbfbf58', '4537e9c9-fb62-424d-8a5c-228e9dbfbf58', 'gap:AUTOSCOUT_FR:XPENG:G7',
   'AutoScout FR · Xpeng G7 (électrique, 2025)',
   'Page introuvable. Sur autoscout24.fr, chercher Xpeng G7 et me coller l''URL de la page de résultats, ou me dire si la marque n''existe pas sur le site.',
   'https://www.autoscout24.fr/lst/xpeng/g7?atype=C&cy=F&sort=price&desc=0&ustate=N%2CU&fregfrom=2025&fregto=2025&fuel=E'),
  ('4537e9c9-fb62-424d-8a5c-228e9dbfbf58', '4537e9c9-fb62-424d-8a5c-228e9dbfbf58', 'gap:BLOCKET:BMW:X3:PHEV',
   'Blocket · BMW X3 hybride rechargeable (2024)',
   'Le site ne donne pas le carburant dans la liste (9 annonces illisibles). Ouvrir 2 annonces de cette page et me dire où le carburant apparaît (titre, fiche, étiquette), avec une capture.',
   'https://www.blocket.se/mobility/search/car?sort=PRICE_ASC&variant=2.749.2466.7798&fuel=1352&year_from=2024&year_to=2024'),
  ('4537e9c9-fb62-424d-8a5c-228e9dbfbf58', '4537e9c9-fb62-424d-8a5c-228e9dbfbf58', 'gap:JOFOGAS:TESLA:YEAR',
   'Jofogas · page marque Tesla (2026)',
   'Le site ne structure pas l''année dans la liste (0 sur 61). Ouvrir 2 annonces et me dire où l''année apparaît (titre, fiche), avec une capture.',
   'https://auto.jofogas.hu/magyarorszag/auto/tesla?sp=1&rs=2026&re=2026')
on conflict (key) do nothing;

select 'ok' as tout_est_bon;
