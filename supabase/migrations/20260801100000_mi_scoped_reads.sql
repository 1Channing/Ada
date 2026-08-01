-- ════════════════════════════════════════════════════════════════════════════
-- MARKET INTELLIGENCE — LECTURES SCOPÉES CÔTÉ SERVEUR (option A, 01/08/2026)
-- ════════════════════════════════════════════════════════════════════════════
--
-- POURQUOI : le MI chargeait TOUTES les observations dans le navigateur
-- (186 467 lignes au 01/08, +35 000/jour en campagne). Tout plafond client
-- est structurellement condamné — celui de 60 000 a masqué 42 modèles en
-- silence (30/07). Désormais la base trie et le navigateur ne reçoit que :
--   1. les DIMENSIONS agrégées (quelques milliers de lignes) pour les menus,
--   2. les observations du SEGMENT étudié (marque[/modèle][/pays]),
--   3. les médianes basses pré-agrégées pour le radar d'opportunités.
--
-- Clé canonique partagée avec le front (canonKey de marketData.ts) :
-- upper() puis suppression de tout ce qui n'est pas A-Z0-9 — 'RAV 4',
-- 'RAV-4' et 'RAV4' sont la même voiture. Les ALIAS de marque (VW ≡
-- VOLKSWAGEN) restent résolus côté front, qui passe un TABLEAU de clés.
--
-- Tout est ADDITIF : aucune table modifiée, fonctions STABLE en lecture
-- seule, droits d'exécution alignés sur les droits de lecture existants.

-- ── Index fonctionnels (les fonctions ci-dessous filtrent sur ces expressions,
--    à l'IDENTIQUE — c'est ce qui rend le scope instantané à 200k+ lignes) ──
create index if not exists idx_mlo_brand_key
  on market_listing_observations ((regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g')));
create index if not exists idx_mlo_model_key
  on market_listing_observations ((regexp_replace(upper(model), '[^A-Z0-9]', '', 'g')));
create index if not exists idx_mlo_scraped_at
  on market_listing_observations (scraped_at desc);

-- ── 1. Dimensions agrégées : ce qui EXISTE, pour remplir les menus sans
--       charger une seule annonce ─────────────────────────────────────────────
create or replace function mi_dimensions()
returns table (
  site text, country text, brand text, model text, fuel text,
  n bigint, last_seen timestamptz
)
language sql stable as $$
  select site, country, brand, model, fuel,
         count(*) as n, max(scraped_at) as last_seen
  from market_listing_observations
  group by site, country, brand, model, fuel
$$;

-- ── 2. Observations d'un segment : la SEULE lecture de masse restante,
--       bornée par nature (un modèle = quelques centaines/milliers de lignes).
--       Tri DESC : si la borne de sécurité mord, c'est l'ancien qui tombe. ───
create or replace function mi_obs_for_segment(
  p_brand_keys text[],
  p_model_key text default null,
  p_country text default null,
  p_limit int default 30000
)
returns setof market_listing_observations
language sql stable as $$
  select *
  from market_listing_observations
  where regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g') = any (p_brand_keys)
    and (p_model_key is null
         or regexp_replace(upper(model), '[^A-Z0-9]', '', 'g') = p_model_key)
    and (p_country is null or country = p_country)
  order by scraped_at desc
  limit least(p_limit, 50000)
$$;

-- ── 3. Radar d'opportunités : médiane des 5 moins chères par
--       segment (marque·modèle·carburant·année) × pays, calculée EN BASE.
--       « Médiane des 5 moins chères » = la 3e moins chère (rang 3) dès que
--       le pays porte ≥ 5 annonces — la règle exacte du client historique.
--       Le front n'apparie plus que quelques centaines de lignes. ────────────
create or replace function mi_cheap_medians(
  p_since timestamptz,
  p_min_price numeric default 1000
)
returns table (
  brand_label text, model_label text, fuel text, year int, country text,
  site text, median numeric, cnt bigint, last_seen timestamptz
)
language sql stable as $$
  with obs as (
    select
      regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g') as bk,
      regexp_replace(upper(model), '[^A-Z0-9]', '', 'g') as mk,
      brand, model, lower(fuel) as fuel, year, upper(country) as country,
      site, price, scraped_at,
      row_number() over (
        partition by regexp_replace(upper(brand), '[^A-Z0-9]', '', 'g'),
                     regexp_replace(upper(model), '[^A-Z0-9]', '', 'g'),
                     lower(fuel), year, upper(country)
        order by price asc
      ) as rn
    from market_listing_observations
    where scraped_at >= p_since
      and price is not null and price >= p_min_price
      and year is not null
      and coalesce(fuel, '') <> ''
      and coalesce(brand, '') <> '' and coalesce(model, '') <> ''
  )
  select
    min(brand)  as brand_label,
    min(model)  as model_label,
    fuel, year, country,
    mode() within group (order by site) as site,
    min(price) filter (where rn = 3) as median,
    count(*) as cnt,
    max(scraped_at) as last_seen
  from obs
  group by bk, mk, fuel, year, country
  having count(*) >= 5
$$;

-- ── Droits : mêmes lecteurs que les tables sous-jacentes ─────────────────────
grant execute on function mi_dimensions() to anon, authenticated;
grant execute on function mi_obs_for_segment(text[], text, text, int) to anon, authenticated;
grant execute on function mi_cheap_medians(timestamptz, numeric) to anon, authenticated;

-- ── Contrôles après application ──────────────────────────────────────────────
-- select count(*) from mi_dimensions();                          -- quelques milliers
-- select count(*) from mi_obs_for_segment(array['MERCEDES'], 'EQA');  -- ~1700
-- select * from mi_cheap_medians(now() - interval '30 days') limit 5;
