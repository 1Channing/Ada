/*
  # Relance groupée depuis la Carte (07/11)

  Channing : « une fois qu'on peut trier par catégorie / pays / marques, il faut ajouter la
  possibilité d'envoyer un mail à plusieurs personnes (sans que eux puissent voir tous les mails
  associés, les cc, afin de faire des relances groupées) ».

  La Carte dépose UNE ligne par destinataire dans la file dossier_emails (un e-mail séparé chacun,
  envoyé par le worker au nom de la personne connectée) : rien ne change côté worker.
  - transaction_id devient facultatif : ces e-mails ne sont rattachés à aucun dossier ;
  - contact_id (fiche de la Carte) et batch_id (identifiant commun à une relance) sont ajoutés ;
  - le verrou d'organisation (verrou_org) sur dossier_emails exigeait l'onglet Ventes : il accepte
    aussi, pour les lignes rattachées à un contact, l'onglet Carte — sans toucher aux e-mails de dossier.

  Additif, idempotent.
*/

alter table public.dossier_emails alter column transaction_id drop not null;
alter table public.dossier_emails add column if not exists contact_id uuid references public.network_contacts(id) on delete set null;
alter table public.dossier_emails add column if not exists batch_id uuid;
create index if not exists idx_dossier_emails_contact on public.dossier_emails (contact_id, created_at);
create index if not exists idx_dossier_emails_batch on public.dossier_emails (batch_id);

-- Les e-mails de dossier gardent leur rattachement ; une ligne doit être soit un e-mail de dossier,
-- soit une relance de contact (jamais ni l'un ni l'autre), sauf les tests du mailer (kind = 'test').
alter table public.dossier_emails drop constraint if exists dossier_emails_rattachement;
alter table public.dossier_emails add constraint dossier_emails_rattachement
  check (transaction_id is not null or contact_id is not null or kind = 'test');

drop policy if exists verrou_org on public.dossier_emails;
create policy verrou_org on public.dossier_emails as restrictive for all to authenticated
  using ((select public.ada_is_mc_export()) and (
    (select public.ada_can_see_any('{wf:ventes}'::text[]))
    or (contact_id is not null and (select public.ada_can_see_any('{carte}'::text[])))))
  with check ((select public.ada_is_mc_export()) and (
    (select public.ada_can_see_any('{wf:ventes}'::text[]))
    or (contact_id is not null and (select public.ada_can_see_any('{carte}'::text[])))));

select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dossier_emails' and column_name = 'transaction_id' and is_nullable = 'YES')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dossier_emails' and column_name = 'contact_id')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dossier_emails' and column_name = 'batch_id')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dossier_emails' and policyname = 'verrou_org' and qual like '%carte%' and qual like '%wf:ventes%')
  as tout_est_bon;
