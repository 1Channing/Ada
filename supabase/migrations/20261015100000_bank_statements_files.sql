/*
  # Relevés de compte téléchargeables (15/10, demande Channing : « rend les
  relevés de compte cliquables pour téléchargement si besoin »)

  Jusqu'ici le PDF déposé était lu puis perdu : seul son nom restait
  (bank_statements.file_name). Désormais le fichier est conservé dans un
  bucket PRIVÉ `bank-statements`, un objet par relevé (<id>.pdf), et la
  grille de la trésorerie l'ouvre par une URL signée (5 minutes).

  - bank_statements.file_path : chemin dans le bucket (null = relevé déposé
    avant cette migration, pas de fichier ; l'application le dit).
  - bucket privé, PDF seulement, 25 Mo max.
  - storage.objects : lecture / écriture / suppression réservées aux admins
    (même règle que la table bank_statements : ada_is_admin()).

  Additif, idempotent. Bloc unique à coller dans l'éditeur SQL.
*/

alter table public.bank_statements add column if not exists file_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bank-statements', 'bank-statements', false, 26214400, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists bank_statements_files_admin on storage.objects;
create policy bank_statements_files_admin on storage.objects
  for all to authenticated
  using (bucket_id = 'bank-statements' and (select public.ada_is_admin()))
  with check (bucket_id = 'bank-statements' and (select public.ada_is_admin()));

select (
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bank_statements' and column_name = 'file_path')
  and exists (select 1 from storage.buckets where id = 'bank-statements' and not public)
  and exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'bank_statements_files_admin')
) as tout_est_bon;
