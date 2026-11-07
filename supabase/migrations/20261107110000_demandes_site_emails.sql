/*
  # Répondre aux demandes du site depuis Ada (07/11)

  Channing : « traiter les demandes du site directement sur Ada… un onglet dispo uniquement pour les
  administrateurs… avec la possibilité d'envoyer des mails pour les personnes connectées ».

  Les réponses partent par la file dossier_emails (worker, au nom du compte connecté), rattachées à la demande
  (lead_id). Ce bloc REPREND aussi le SQL du 07/11 « relance_contacts » (Carte) : un seul collage suffit.
  - transaction_id facultatif ; contact_id / batch_id (relance groupée Carte) ; lead_id (réponse à une demande) ;
  - une ligne est un e-mail de dossier, une relance de contact ou une réponse à une demande ;
  - verrou d'organisation : Ventes pour les e-mails de dossier, Carte pour les relances, administrateur pour
    les réponses aux demandes du site.
  Additif, idempotent.
*/

alter table public.dossier_emails alter column transaction_id drop not null;
alter table public.dossier_emails add column if not exists contact_id uuid references public.network_contacts(id) on delete set null;
alter table public.dossier_emails add column if not exists batch_id uuid;
alter table public.dossier_emails add column if not exists lead_id uuid references public.site_leads(id) on delete set null;
create index if not exists idx_dossier_emails_contact on public.dossier_emails (contact_id, created_at);
create index if not exists idx_dossier_emails_batch on public.dossier_emails (batch_id);
create index if not exists idx_dossier_emails_lead on public.dossier_emails (lead_id, created_at);

alter table public.dossier_emails drop constraint if exists dossier_emails_rattachement;
alter table public.dossier_emails add constraint dossier_emails_rattachement
  check (transaction_id is not null or contact_id is not null or lead_id is not null or kind = 'test');

drop policy if exists verrou_org on public.dossier_emails;
create policy verrou_org on public.dossier_emails as restrictive for all to authenticated
  using ((select public.ada_is_mc_export()) and (
    (select public.ada_can_see_any('{wf:ventes}'::text[]))
    or (contact_id is not null and (select public.ada_can_see_any('{carte}'::text[])))
    or (lead_id is not null and (select public.ada_is_admin()))))
  with check ((select public.ada_is_mc_export()) and (
    (select public.ada_can_see_any('{wf:ventes}'::text[]))
    or (contact_id is not null and (select public.ada_can_see_any('{carte}'::text[])))
    or (lead_id is not null and (select public.ada_is_admin()))));

select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dossier_emails' and column_name = 'transaction_id' and is_nullable = 'YES')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dossier_emails' and column_name = 'contact_id')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dossier_emails' and column_name = 'lead_id')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dossier_emails' and policyname = 'verrou_org' and qual like '%lead_id%' and qual like '%carte%' and qual like '%wf:ventes%')
  as tout_est_bon;
