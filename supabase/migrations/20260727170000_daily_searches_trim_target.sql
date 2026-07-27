-- Études quotidiennes : la finition n'a pas le même nom d'un pays à l'autre
-- (« GR Sport » FR vs « GR-S » DE…). trim = finition côté PAYS SOURCE (filtre
-- de recherche), trim_target = son ÉQUIVALENT côté PAYS CIBLE (filtre de la
-- médiane de comparaison). Additif.
alter table public.daily_searches
  add column if not exists trim_target text not null default '';
