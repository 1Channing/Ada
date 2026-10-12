/*
  # Rappels personnels (12/10, demande Channing pour l'équipe Weecars :
  #   « qu'ils puissent ajouter un rappel qui apparaît dans les notifs »)

  Un rappel = une tâche de la liste user_tasks créée PAR SOI-MÊME, avec une
  échéance (due_at) et, s'il vient d'une annonce, la négociation d'origine.
  La cloche « Rappels » (tout le monde) montre les rappels échus et à venir,
  et les tâches confiées par l'admin ; l'accueil (Mes tâches) les reprend.

  Droits : chacun crée et supprime SES rappels (assignee = créateur = soi) ;
  les règles existantes (admin crée pour les autres, chacun coche ses tâches)
  restent telles quelles. Additif, idempotent.
*/
alter table public.user_tasks add column if not exists due_at timestamptz;
alter table public.user_tasks add column if not exists negotiation_id uuid;
create index if not exists idx_user_tasks_due on public.user_tasks (assignee_id, status, due_at);

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'user_tasks' and policyname = 'user_tasks_insert_self') then
    create policy "user_tasks_insert_self" on public.user_tasks for insert to authenticated
      with check (assignee_id = auth.uid() and created_by = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_tasks' and policyname = 'user_tasks_delete_self') then
    create policy "user_tasks_delete_self" on public.user_tasks for delete to authenticated
      using (assignee_id = auth.uid() and created_by = auth.uid());
  end if;
end $$;

select exists (select 1 from information_schema.columns where table_name = 'user_tasks' and column_name = 'due_at')
   and exists (select 1 from information_schema.columns where table_name = 'user_tasks' and column_name = 'negotiation_id')
   and exists (select 1 from pg_policies where tablename = 'user_tasks' and policyname = 'user_tasks_insert_self')
   and exists (select 1 from pg_policies where tablename = 'user_tasks' and policyname = 'user_tasks_delete_self') as tout_est_bon;
