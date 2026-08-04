/*
  Études quotidiennes : critère puissance minimum (ch DIN).

  Additif pur. Le front et le worker dégradent proprement tant que cette
  migration n'est pas appliquée (étude enregistrée sans le critère, avec
  message explicite — même mécanique que gearbox).
*/

alter table daily_searches add column if not exists power_min integer;

-- Contrôle après application :
-- select column_name from information_schema.columns
--   where table_name = 'daily_searches' and column_name = 'power_min';
