-- ════════════════════════════════════════════════════════════════════════════
-- CHANTIER NOMMAGE UNIFIÉ (02/08/2026) — identité modèle jusque dans le SQL
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONSTAT FONDATEUR : les snapshots portent « CLA » ET « CLASSE CLA » comme
-- deux modèles distincts — la clé canonique ORDONNÉE (CLA ≠ CLASSECLA) les
-- sépare dans le MI (deux entrées de menu, deux segments) et rend le radar
-- inter-pays aveugle à leurs paires. Même famille de problème à venir :
-- « SÉRIE 3 » (études FR) vs « 3-SERIES » (référentiel/campagnes) vs
-- « 3-serie » (Gaspedaal).
--
-- REMÈDE : ada_model_key(brand, model) — réplique SQL EXACTE de refModelKey
-- (services/marketData.ts, elle-même répliquée par l'importeur Python) :
--   1. numéral romain de génération en fin de nom retiré (Golf IV → GOLF) ;
--   2. Mercedes : X-Class / Classe X / X-Klasse → code nu (CLA) ;
--   3. Séries : « SERIE 3 » / « 3-Series » / « 3er(-Reihe) » / « 3-serie »
--      → code nu (3) ;
--   4. puis clé canonique (MAJ, alphanumérique seulement).
-- Les fonctions de LECTURE du MI (segment + radar) basculent dessus ; un
-- index fonctionnel assorti garde le chemin indexé de bout en bout.
-- mi_dimensions reste inchangée : la fusion des libellés se fait côté front.
--
-- Tout est ADDITIF : aucune table modifiée, aucune donnée réécrite —
-- « corriger la LECTURE, pas l'écriture ». Les anciens index restent.

-- ── 1. Clés d'identité (IMMUTABLE → indexables) ─────────────────────────────
create or replace function ada_brand_key(p text)
returns text language sql immutable parallel safe as $$
  select case regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g')
    when 'MERCEDESBENZ' then 'MERCEDES'
    when 'VW' then 'VOLKSWAGEN'
    else regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g')
  end
$$;

create or replace function ada_model_key(p_brand text, p_model text)
returns text language plpgsql immutable parallel safe as $$
declare
  v text := trim(coalesce(p_model, ''));
  m text[];
begin
  -- 1. Numéral romain de génération en fin de nom (Golf IV, C4 III, Ignis II).
  v := regexp_replace(v, '\s+(I{1,3}|IV|V|VI{0,3}|IX|X{1,2})$', '', 'i');
  -- 2. Mercedes : X-Class / Classe X / X-Klasse → code nu.
  if ada_brand_key(p_brand) = 'MERCEDES' then
    m := regexp_match(v, '^([A-Za-z]{1,3})[- ]?(?:CLASS|KLASSE)$', 'i');
    if m is null then
      m := regexp_match(v, '^(?:CLASSE|CLASE|CLASS)\s+([A-Za-z]{1,3})$', 'i');
    end if;
    if m is not null then v := m[1]; end if;
  end if;
  -- 3. Séries : SERIE 3 / SÉRIE 3 / 3-Series / 3-serie / 3er(-Reihe) → 3.
  m := regexp_match(v, '^(?:SERIE|SÉRIE|SERIES)\s+(\w{1,3})$', 'i');
  if m is null then m := regexp_match(v, '^(\w{1,3})[- ]?SERIES?$', 'i'); end if;
  if m is null then m := regexp_match(v, '^(\d)[- ]?ER(?:[- ]?REIHE)?$', 'i'); end if;
  if m is not null then v := m[1]; end if;
  -- 4. Clé canonique.
  return regexp_replace(upper(v), '[^A-Z0-9]', '', 'g');
end $$;

-- ── 2. Index d'identité — même préfixe que les requêtes de mi_obs_for_segment
--       v3 (clé marque, clé modèle, scraped_at desc) ────────────────────────
create index if not exists idx_mlo_identity_scraped
  on market_listing_observations (
    (ada_brand_key(brand)), (ada_model_key(brand, model)), scraped_at desc
  );

-- ── 3. mi_obs_for_segment v3 : mêmes branches anti-timeout (01/08), clés
--       d'IDENTITÉ — « CLA » charge aussi les « CLASSE CLA » ────────────────
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
      where ada_brand_key(brand) = any (p_brand_keys)
        and ada_model_key(brand, model) = p_model_key
        and country = p_country
      order by scraped_at desc limit lim;
  elsif p_model_key is not null then
    return query
      select * from market_listing_observations
      where ada_brand_key(brand) = any (p_brand_keys)
        and ada_model_key(brand, model) = p_model_key
      order by scraped_at desc limit lim;
  elsif p_country is not null then
    return query
      select * from market_listing_observations
      where ada_brand_key(brand) = any (p_brand_keys)
        and country = p_country
      order by scraped_at desc limit lim;
  else
    return query
      select * from market_listing_observations
      where ada_brand_key(brand) = any (p_brand_keys)
      order by scraped_at desc limit lim;
  end if;
end $$;

-- ── 4. mi_cheap_medians v3 : radar groupé par IDENTITÉ (le filtre
--       anti-accidentées négation-d'abord du 01/08 est conservé tel quel) ───
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
      ada_brand_key(brand) as bk,
      ada_model_key(brand, model) as mk,
      brand, model, lower(fuel) as fuel, year, upper(country) as country,
      site, price, scraped_at,
      row_number() over (
        partition by ada_brand_key(brand), ada_model_key(brand, model),
                     lower(fuel), year, upper(country)
        order by price asc
      ) as rn
    from market_listing_observations
    where scraped_at >= p_since
      and price is not null and price >= p_min_price
      and year is not null
      and coalesce(fuel, '') <> ''
      and coalesce(brand, '') <> '' and coalesce(model, '') <> ''
      and not (
        lower(coalesce(title, '')) ~ '(accident|unfall|schaden|schade[^v]|schadeauto|skadet|incidentat|sinistr|epave|épave|salvage|motorschaden)'
        and lower(coalesce(title, '')) !~ '((non|sans|jamais|no|never)[ -]*accident|accident[ -]*free|unfall[ -]?frei|schaden?[ -]?frei|schadevrij|skades?fri)'
      )
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

-- ── Droits (create or replace les préserve, redits par sûreté) ──────────────
grant execute on function ada_brand_key(text) to anon, authenticated;
grant execute on function ada_model_key(text, text) to anon, authenticated;
grant execute on function mi_obs_for_segment(text[], text, text, int) to anon, authenticated;
grant execute on function mi_cheap_medians(timestamptz, numeric) to anon, authenticated;

-- ── Contrôles après application — les VECTEURS font foi (identiques au smoke
--    TS refModelKey et à l'importeur Python) ────────────────────────────────
-- select ada_model_key('MERCEDES', 'CLASSE CLA')   = 'CLA';         -- true
-- select ada_model_key('MERCEDES-BENZ', 'GLC-Class') = 'GLC';       -- true
-- select ada_model_key('BMW', 'SÉRIE 3')           = '3';           -- true
-- select ada_model_key('BMW', '3-SERIES')          = '3';           -- true
-- select ada_model_key('BMW', '5-serie')           = '5';           -- true
-- select ada_model_key('BMW', '3er')               = '3';           -- true
-- select ada_model_key('VOLKSWAGEN', 'Golf IV')    = 'GOLF';        -- true
-- select ada_model_key('TOYOTA', 'RAV-4')          = 'RAV4';        -- true
-- select ada_model_key('TOYOTA', 'YARIS CROSS')    = 'YARISCROSS';  -- true
-- select ada_model_key('AUDI', 'Q8 E-TRON')        = 'Q8ETRON';     -- true
-- select count(*) from mi_obs_for_segment(array['MERCEDES'], 'CLA', null, 1000); -- CLA + CLASSE CLA réunis
-- select count(*) from mi_cheap_medians(now() - interval '30 days');
