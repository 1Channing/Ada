/*
  # FYC — fiches PDF publiques (11/11)

  Channing : « transférer les inspections dans Offres avec … en dernier le lien de l'inspection version PDF
  MC Export pour chaque véhicule ». Le client qui reçoit l'offre ouvre la fiche sans compte : bucket PUBLIC
  fyc-fiches (PDF seulement, 20 Mo), écrit par l'équipe MC Export. Additif, idempotent.
*/
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fyc-fiches', 'fyc-fiches', true, 20971520, array['application/pdf'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fyc_fiches_public_read on storage.objects;
create policy fyc_fiches_public_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'fyc-fiches');
drop policy if exists fyc_fiches_write on storage.objects;
create policy fyc_fiches_write on storage.objects
  for all to authenticated
  using (bucket_id = 'fyc-fiches' and (select public.ada_is_mc_export()))
  with check (bucket_id = 'fyc-fiches' and (select public.ada_is_mc_export()));

select exists (select 1 from storage.buckets where id = 'fyc-fiches' and public)
   and exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'fyc_fiches_write') as tout_est_bon;
