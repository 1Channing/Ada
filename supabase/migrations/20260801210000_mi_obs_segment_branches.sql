-- mi_obs_for_segment timeoutait encore À FROID malgré l'index composite
-- idx_mlo_brand_model_scraped (57014 reproduit le 01/08 APRÈS application de
-- l'index : échec au 1er appel, 2,4 s au 2e). Cause : les gardes
-- « (p_model_key is null OR expr = p_model_key) » interdisent au planificateur
-- d'utiliser la colonne modèle de l'index — il balaye toute la marque puis
-- trie. Ici, version plpgsql à BRANCHES : chaque combinaison de paramètres
-- exécute une requête SANS or-null, dont les égalités épousent le préfixe de
-- l'index (clé marque, clé modèle, scraped_at desc) — chemin indexé de bout
-- en bout, cache chaud ou froid.
--
-- Additif : même signature, mêmes droits — seul le corps change.
create or replace function mi_obs_for_segment(
  p_brand_keys text[],
  p_model_key text default null,
  p_country text default null,
  p_limit int default 30000
)
returns setof market_listing_observations
language plpgsql stable as $$
declare lim int := least(coalesce(p_limit, 30000), 50000);
begin
  if p_model_key is not null and p_country is not null then
    return query
      select * from market_listing_observations
      where regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g') = any (p_brand_keys)
        and regexp_replace(upper(model), '[^A-Z0-9]', '', 'g') = p_model_key
        and country = p_country
      order by scraped_at desc limit lim;
  elsif p_model_key is not null then
    return query
      select * from market_listing_observations
      where regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g') = any (p_brand_keys)
        and regexp_replace(upper(model), '[^A-Z0-9]', '', 'g') = p_model_key
      order by scraped_at desc limit lim;
  elsif p_country is not null then
    return query
      select * from market_listing_observations
      where regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g') = any (p_brand_keys)
        and country = p_country
      order by scraped_at desc limit lim;
  else
    return query
      select * from market_listing_observations
      where regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g') = any (p_brand_keys)
      order by scraped_at desc limit lim;
  end if;
end $$;

grant execute on function mi_obs_for_segment(text[], text, text, int) to anon, authenticated;

-- Contrôle après application — les DEUX doivent répondre vite dès le 1er appel :
-- select count(*) from mi_obs_for_segment(array['AUDI'], 'Q6ETRON', 'DE');
-- select count(*) from mi_obs_for_segment(array['AUDI'], 'Q5', 'FR');
