/*
  # TVA : lignes du 3310-CA3 (03/10 bis, preuve sur la déclaration de janvier 2026)

  Colonnes ajoutées à vat_returns : A1 ventes taxées HT, F2 livraisons
  intracommunautaires B2B (ventes HT), E1 exportations, B2 acquisitions
  intracommunautaires, 22 report du crédit précédent, 25 crédit de TVA.
  Additif, idempotent.
*/
alter table vat_returns add column if not exists sales_taxed numeric;
alter table vat_returns add column if not exists sales_intracom numeric;
alter table vat_returns add column if not exists sales_export numeric;
alter table vat_returns add column if not exists purchases_intracom numeric;
alter table vat_returns add column if not exists credit_in numeric;
alter table vat_returns add column if not exists credit numeric;
select 'ok' as tout_est_bon;
