-- Études quotidiennes : kilométrage maximum (critère de recherche + filtre
-- dur sur les annonces remontées). Additif.
alter table public.daily_searches
  add column if not exists mileage_max integer;
