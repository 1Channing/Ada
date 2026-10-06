/*
  # Finitions connues d'un segment, calculées PAR LA BASE (06/10, plafond
  « finitions.observations » touché 2× : TOYOTA RAV4 = plus de 10 000
  observations — lire les lignes une à une pour en extraire les finitions
  distinctes ne tient pas, et chaque plafond cache des finitions).

  Une ligne par graphie de finition (chaud + archive), avec son nombre
  d'observations ; filtres du segment (marque × modèle, pays optionnel),
  clés ADA comme mi_obs_for_segment. Tri par fréquence, 500 graphies au plus
  (le front en garde 60 après canonisation).

  « trim » est un mot réservé de PostgreSQL : la colonne de sortie s'appelle
  trim_label.

  Additif, idempotent.
*/

create or replace function mi_segment_trims(
  p_brand_keys text[],
  p_model_key text default null,
  p_country text default null
)
returns table (trim_label text, brand text, model text, n bigint)
language sql stable
set statement_timeout to '20s'
as $$
  select o.trim as trim_label, min(o.brand) as brand, min(o.model) as model, count(*) as n
  from market_listing_observations_all o
  where o.brand_key = any (p_brand_keys)
    and (p_model_key is null or o.model_key = p_model_key)
    and (p_country is null or p_country = '' or o.country = p_country)
    and o.trim is not null and o.trim <> ''
  group by o.trim
  order by n desc
  limit 500;
$$;

grant execute on function mi_segment_trims(text[], text, text) to anon, authenticated, service_role;

select has_function_privilege('authenticated', 'mi_segment_trims(text[], text, text)', 'execute') as tout_est_bon;
