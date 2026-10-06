/*
  # Médiane cible de repli : les N annonces les moins chères d'un segment,
  calculées PAR LA BASE (06/10, plafond « etudes.mediane_observations » touché
  8× : Yaris Cross NL = 42 876 observations sur 45 jours, 9 442 sur 14 jours —
  aucune lecture par pages ne tient, la pagination profonde part en timeout).

  Une annonce = sa DERNIÈRE observation (listing_url) ; filtres du segment
  (marque × modèle × pays, clés ADA), fenêtre, carburant (jeton du site),
  finition (clé canonique contenue), années ; tri prix croissant, p_n lignes.

  « trim » est un mot réservé de PostgreSQL (fonction TRIM) : la colonne de
  sortie s'appelle trim_label (erreur 42601 au premier collage, 06/10).

  Additif, idempotent.
*/

create or replace function mi_segment_cheapest(
  p_brand_keys text[],
  p_model_key text,
  p_country text,
  p_since timestamptz,
  p_fuel text default null,
  p_trim_key text default null,
  p_year_min int default null,
  p_year_max int default null,
  p_min_price numeric default 0,
  p_n int default 60
)
returns table (listing_url text, price numeric, brand text, model text, fuel text, year int, trim_label text, scraped_at timestamptz)
language sql stable
set statement_timeout to '20s'
as $$
  with last_obs as (
    select distinct on (o.listing_url)
      o.listing_url, o.price, o.brand, o.model, o.fuel, o.year, o.trim as trim_label, o.scraped_at
    from market_listing_observations o
    where o.brand_key = any (p_brand_keys)
      and o.model_key = p_model_key
      and o.country = p_country
      and o.scraped_at >= p_since
      and o.price is not null and o.price > coalesce(p_min_price, 0)
      and (p_fuel is null or p_fuel = '' or o.fuel = p_fuel)
      and (p_year_min is null or coalesce(o.year, 9999) >= p_year_min)
      and (p_year_max is null or coalesce(o.year, 0) <= p_year_max)
      and (p_trim_key is null or p_trim_key = ''
           or regexp_replace(upper(ada_deburr(coalesce(o.trim, ''))), '[^A-Z0-9]', '', 'g') like '%' || p_trim_key || '%')
    order by o.listing_url, o.scraped_at desc
  )
  select * from last_obs order by price asc limit least(coalesce(p_n, 60), 500);
$$;

grant execute on function mi_segment_cheapest(text[], text, text, timestamptz, text, text, int, int, numeric, int) to anon, authenticated, service_role;

select has_function_privilege('service_role', 'mi_segment_cheapest(text[], text, text, timestamptz, text, text, int, int, numeric, int)', 'execute') as tout_est_bon;
