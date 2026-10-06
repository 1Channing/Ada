/*
  # Index marque × modèle sur l'ARCHIVE des observations (06/10, plafond
  « finitions.observations » rallumé : mi_segment_trims TOYOTA RAV4 = 13 à
  19 s, au bord du délai de 20 s — un dépassement rend l'erreur, le front
  retombe sur l'ancienne lecture et son plafond).

  Le chaud porte idx_mlo_keys_scraped (brand_key, model_key, scraped_at) ;
  l'archive (265 000 lignes au 06/10) n'avait AUCUN index sur ces clés : toute
  fonction qui lit la vue chaud + archive (mi_obs_for_segment, mi_segment_trims)
  parcourait l'archive entière. Même index, même forme.

  Additif, idempotent.
*/

create index if not exists idx_mloa_keys_scraped
  on market_listing_observations_archive (brand_key, model_key, scraped_at desc);

select exists (
  select 1 from pg_indexes where tablename = 'market_listing_observations_archive' and indexname = 'idx_mloa_keys_scraped'
) as tout_est_bon;
