/*
  # Point de départ : disponibilités au 31/12/2025 par compte (03/10 ter)

  Preuve lue sur les relevés : Shine compte principal 25 063,72 € (ouverture
  de janvier), Shine ESSENCE 800,00 € (ouverture de janvier), Banque
  Populaire 73 676,60 € (« SOLDE CREDITEUR AU 31/12/2025 » du relevé n°9),
  CIC 0 (ouvert le 29/01). Total 99 540,32 € = 99 540 € de disponibilités au
  bilan. Additif, idempotent.
*/
update app_config
set value = value || '{"cash_by_account": {"Shine principal": 25063.72, "Shine ESSENCE": 800, "Banque Populaire": 73676.60, "CIC": 0}}'::jsonb
where key = 'treasury_opening';
select (select value->'cash_by_account' is not null from app_config where key = 'treasury_opening') as tout_est_bon;
