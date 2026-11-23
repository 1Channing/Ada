/*
  23/11 — N° de TVA intracommunautaire des contacts professionnels (Channing : « il faut pouvoir ajouter les numéros
  de TVA pour les pro », Kamux Oyj). Une colonne texte, normalisée par l'app (majuscules, sans espaces : « FI12345678 »).
  Additif, idempotent. Sans elle, l'app écrit la fiche sans la TVA et le dit.
*/
alter table public.contacts add column if not exists vat_number text;
select exists (select 1 from information_schema.columns where table_name = 'contacts' and column_name = 'vat_number') as tout_est_bon;
