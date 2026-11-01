-- ═══════════════════════════════════════════════════════════════════════════
-- RAPPELS PERSONNELS (01/11/2026) — demande Channing : « attention que MC
-- Export ne reçoive pas les rappels des autres organisations ; les rappels
-- sont tous personnels ». Preuve en base : les policies du 02/10 laissaient un
-- admin LIRE et MODIFIER toutes les lignes de user_tasks, donc aussi les
-- rappels que chacun se pose à lui-même (dans la liste « Tâches confiées »).
-- Règle corrigée : un rappel que l'on se pose soi-même (created_by =
-- assignee_id) n'est visible et modifiable que par soi ; un admin ne voit et
-- ne gère que les tâches CONFIÉES (créées pour quelqu'un d'autre). Les
-- e-mails, eux, partent déjà de la personne à elle-même (worker). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "user_tasks_select" on public.user_tasks;
create policy "user_tasks_select" on public.user_tasks for select to authenticated
  using (assignee_id = auth.uid()
     or (public.ada_is_admin() and created_by is distinct from assignee_id));

drop policy if exists "user_tasks_update" on public.user_tasks;
create policy "user_tasks_update" on public.user_tasks for update to authenticated
  using (assignee_id = auth.uid()
     or (public.ada_is_admin() and created_by is distinct from assignee_id))
  with check (assignee_id = auth.uid()
     or (public.ada_is_admin() and created_by is distinct from assignee_id));

drop policy if exists "user_tasks_delete" on public.user_tasks;
create policy "user_tasks_delete" on public.user_tasks for delete to authenticated
  using (public.ada_is_admin() and created_by is distinct from assignee_id);

select (select count(*) from pg_policies where tablename = 'user_tasks' and policyname in ('user_tasks_select', 'user_tasks_update', 'user_tasks_delete')) = 3 as tout_est_bon;
