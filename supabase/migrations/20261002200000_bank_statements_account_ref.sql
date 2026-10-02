/*
  # Relevés : un compte = une banque + un numéro de compte (02/10 soir,
  demande Channing : « ajouter le compte secondaire de Shine » et « si
  j'envoie deux fois le même relevé, pas de doublon »)

  Jusqu'ici un relevé était identifié par (banque, mois) : le compte
  secondaire Shine aurait REMPLACÉ le compte principal du même mois.
  Désormais (banque, numéro de compte, mois) : deux comptes de la même
  banque cohabitent ; le même relevé redéposé (même compte, même mois, quel
  que soit le nom du fichier) remplace le précédent au lieu de le doubler.

  Additif, idempotent.
*/

alter table bank_statements add column if not exists account_ref text not null default '';
alter table bank_statements add column if not exists account_name text;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'bank_statements_account_period_month_key') then
    alter table bank_statements drop constraint bank_statements_account_period_month_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bank_statements_account_ref_period_key') then
    alter table bank_statements add constraint bank_statements_account_ref_period_key unique (account, account_ref, period_month);
  end if;
end $$;

select 'ok' as tout_est_bon;
