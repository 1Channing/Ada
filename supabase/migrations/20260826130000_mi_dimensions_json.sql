/*
  Menus du MI en UN appel + index couvrant (26/08, même série que le radar).

  Constat : mi_dimensions (les menus Marque/Modèle du MI) EXPIRE
  systématiquement à 400 k observations (57014 à ~20 s mesuré) ; le front
  retombait alors sur la lecture intégrale paginée — 400 requêtes, la page
  « charge » 2 minutes et paraît instable. Index couvrant pour un parcours
  sans table + variante jsonb en une exécution. L'ancienne mi_dimensions
  reste (compat/repli).
*/

-- ── 1. Index couvrant du GROUP BY (INCLUDE pour le max(scraped_at)) ─────────
create index if not exists idx_mlo_dimensions
  on market_listing_observations (site, country, brand, model, fuel)
  include (scraped_at);

-- ── 2. Variante un-appel ────────────────────────────────────────────────────
create or replace function mi_dimensions_json()
returns jsonb
language sql stable
set statement_timeout to '30s'
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select site, country, brand, model, fuel,
           count(*) as n, max(scraped_at) as last_seen
    from market_listing_observations
    group by site, country, brand, model, fuel
  ) t
$$;

grant execute on function mi_dimensions_json() to anon, authenticated;

-- ── Contrôle (seul résultat affiché) ────────────────────────────────────────
select jsonb_array_length(mi_dimensions_json()) > 0 as tout_est_bon;
