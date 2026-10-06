/*
  # mi_segment_trims v2 : plan par branche (06/10, après l'index de l'archive :
  TOYOTA RAV4 toujours 15 à 21 s alors que les lignes filtrées se comptent en
  1 s — 35 030 au chaud, 8 039 en archive).

  Cause : la v1 écrivait « (p_model_key is null or model_key = p_model_key) »
  et « (p_country is null or country = p_country) ». Avec un paramètre, le
  planificateur ne peut pas s'engager sur l'index (brand_key, model_key) : il
  lit toute la marque (TOYOTA = des centaines de milliers de lignes) puis
  filtre. Même piège que mi_obs_for_segment a évité dès sa v1 (20260801) :
  une requête PAR CAS, chaque filtre écrit en égalité simple.

  Même signature, même sortie ; additif, idempotent.
*/

create or replace function mi_segment_trims(
  p_brand_keys text[],
  p_model_key text default null,
  p_country text default null
)
returns table (trim_label text, brand text, model text, n bigint)
language plpgsql stable
set statement_timeout to '20s'
as $$
declare
  v_country text := nullif(p_country, '');
begin
  if p_model_key is not null and v_country is not null then
    return query
      select o.trim, min(o.brand), min(o.model), count(*)
      from market_listing_observations_all o
      where o.brand_key = any (p_brand_keys) and o.model_key = p_model_key and o.country = v_country
        and o.trim is not null and o.trim <> ''
      group by o.trim order by count(*) desc limit 500;
  elsif p_model_key is not null then
    return query
      select o.trim, min(o.brand), min(o.model), count(*)
      from market_listing_observations_all o
      where o.brand_key = any (p_brand_keys) and o.model_key = p_model_key
        and o.trim is not null and o.trim <> ''
      group by o.trim order by count(*) desc limit 500;
  elsif v_country is not null then
    return query
      select o.trim, min(o.brand), min(o.model), count(*)
      from market_listing_observations_all o
      where o.brand_key = any (p_brand_keys) and o.country = v_country
        and o.trim is not null and o.trim <> ''
      group by o.trim order by count(*) desc limit 500;
  else
    return query
      select o.trim, min(o.brand), min(o.model), count(*)
      from market_listing_observations_all o
      where o.brand_key = any (p_brand_keys)
        and o.trim is not null and o.trim <> ''
      group by o.trim order by count(*) desc limit 500;
  end if;
end $$;

grant execute on function mi_segment_trims(text[], text, text) to anon, authenticated, service_role;

select has_function_privilege('authenticated', 'mi_segment_trims(text[], text, text)', 'execute') as tout_est_bon;
