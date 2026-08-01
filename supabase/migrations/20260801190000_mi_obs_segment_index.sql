-- Le chargement d'un segment MI (mi_obs_for_segment) partait en statement
-- timeout à FROID — 57014 constaté le 01/08 sur AUDI/Q5/FR : échec, puis
-- 4,1 s / 1,3 s / 0,8 s sur les essais suivants (le cache de la base faisait
-- tout le travail). Résultat côté page : segment à 0 annonce alors que la
-- base en portait 445.
--
-- Cause : la fonction filtre sur (clé marque, clé modèle) puis trie par
-- scraped_at desc — trois index SÉPARÉS obligent le planificateur à combiner
-- puis trier. Cet index composite porte le filtre ET le tri : la lecture
-- devient indexée de bout en bout, cache chaud ou froid.
--
-- Additif : aucun index existant supprimé, aucune table modifiée.
create index if not exists idx_mlo_brand_model_scraped
  on market_listing_observations (
    (regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g')),
    (regexp_replace(upper(model), '[^A-Z0-9]', '', 'g')),
    scraped_at desc
  );

-- Contrôle après application (doit répondre vite même à froid) :
-- select count(*) from mi_obs_for_segment(array['AUDI'], 'Q5', 'FR');
