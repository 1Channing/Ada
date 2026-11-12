/*
  # Carte — seconde vitrine par contact (12/11)

  Channing : « inscrire une seconde vitrine dans le cas où les concessions ont plusieurs vitrines, ici pour des
  utilitaires ». Colonne website2 sur network_contacts : le worker lit les deux vitrines à chaque relevé et cumule
  leurs véhicules dans le même stock. Additif, idempotent.
*/
alter table public.network_contacts add column if not exists website2 text;

select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'network_contacts' and column_name = 'website2') as tout_est_bon;
