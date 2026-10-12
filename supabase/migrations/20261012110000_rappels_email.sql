/*
  # Rappels par e-mail (12/10, Channing : « pour le groupe MC Export, que les
  #   rappels envoient un mail à leur propriétaire à la date, avec la note »)

  Le worker envoie à l'échéance un e-mail de soi à soi (délégation Gmail du
  domaine) et le note ici : notified_at = réservé/envoyé, notify_error = la
  raison si Google a refusé (compte hors domaine, par exemple). Un rappel
  reporté revient à notified_at NULL (le front le remet) et repart.
  Additif, idempotent.
*/
alter table public.user_tasks add column if not exists notified_at timestamptz;
alter table public.user_tasks add column if not exists notify_error text;
create index if not exists idx_user_tasks_to_notify on public.user_tasks (due_at) where status = 'open' and notified_at is null;

select exists (select 1 from information_schema.columns where table_name = 'user_tasks' and column_name = 'notified_at')
   and exists (select 1 from information_schema.columns where table_name = 'user_tasks' and column_name = 'notify_error') as tout_est_bon;
