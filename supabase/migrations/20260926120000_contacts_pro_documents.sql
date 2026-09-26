/*
  # Contacts : pro / particulier + documents des professionnels (26/09, demande Channing)

  1. `contacts.category` : 'pro' | 'particulier'. NULL = déduit (société ou
     SIREN renseigné → pro, sinon particulier) — les 64 fiches existantes
     n'ont rien à ressaisir.
  2. `contact_documents` : les pièces d'un professionnel (Kbis, pièce
     d'identité du gérant, RIB, mandat…), fichiers dans le bucket
     admin-documents sous contacts/{contact_id}/, imprimables à côté des
     certificats de cession et déclarations d'achat d'un dossier.

  Additif, idempotent. Mêmes droits que `contacts` (anon + authenticated).
*/

alter table contacts add column if not exists category text;

create table if not exists contact_documents (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  label text not null,
  path text not null,                -- chemin dans le bucket admin-documents
  content_type text,
  size_bytes integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_contact_documents_contact on contact_documents (contact_id, created_at);

alter table contact_documents enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'contact_documents' and policyname = 'anon_all_contact_documents') then
    create policy "anon_all_contact_documents" on contact_documents for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'contact_documents' and policyname = 'auth_all_contact_documents') then
    create policy "auth_all_contact_documents" on contact_documents for all to authenticated using (true) with check (true);
  end if;
end $$;

select 'ok' as tout_est_bon;
