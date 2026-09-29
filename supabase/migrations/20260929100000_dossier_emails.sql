/*
  # E-mails envoyés depuis un dossier (29/09, chantier e-mails — étape 3)

  Journal de chaque envoi : qui, à qui, quand, objet, pièces jointes,
  résultat. Le front dépose une ligne « queued » ; le worker (Railway)
  l'envoie par l'API Gmail au nom de la personne connectée (Google
  Workspace, délégation à l'échelle du domaine sur le compte de service
  déjà utilisé pour le tableur) puis note « sent » avec l'identifiant Gmail,
  ou « failed » avec la raison.

  Additif, idempotent. Accès équipe (comptes connectés) comme le reste.
*/

create table if not exists dossier_emails (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions_admin(id) on delete cascade,
  kind text not null default 'cessions_acheteur',     -- cessions_acheteur | pack_prestataire | test
  to_email text not null,
  subject text not null,
  body text not null,
  attachments jsonb not null default '[]'::jsonb,     -- [{ "path": "transactions/…/x.pdf", "name": "Cession YC632.pdf" }]
  status text not null default 'queued',              -- queued | sent | failed
  error text,
  sent_by uuid,                                       -- auth.users.id de l'expéditeur
  sender_email text not null,                         -- adresse Google de l'expéditeur (From)
  sender_name text,
  gmail_message_id text,
  gmail_thread_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists idx_dossier_emails_tx on dossier_emails (transaction_id, created_at);
create index if not exists idx_dossier_emails_status on dossier_emails (status, created_at);

alter table dossier_emails enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'dossier_emails' and policyname = 'equipe_dossier_emails') then
    create policy "equipe_dossier_emails" on dossier_emails for all to authenticated using (true) with check (true);
  end if;
end $$;

select 'ok' as tout_est_bon;
