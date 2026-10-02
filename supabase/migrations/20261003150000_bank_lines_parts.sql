/*
  # Un virement pour plusieurs véhicules (03/10 quater, demande Channing :
  « on a des paiements client sur virement unique qui paient plusieurs
  véhicules, il faut lier les dossiers grâce aux numéros de factures
  présents dans le sheet »)

  bank_lines.parts : la part de chaque dossier quand une ligne en paie
  plusieurs — [{ id (transactions_admin.id), how, amount }]. null = lien
  simple (transaction_id). Sans cette colonne, l'application ne garde que le
  premier dossier et le dit.

  Additif, idempotent.
*/

alter table bank_lines add column if not exists parts jsonb;

select 'ok' as tout_est_bon;
