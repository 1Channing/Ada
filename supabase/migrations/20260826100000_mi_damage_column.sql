/*
  Verdict accidentées PRÉCALCULÉ en colonne (26/08, suite immédiate de
  20260826090000).

  Mesure après les colonnes de clés : mi_cheap_medians restait à 21-22 s
  par page (un essai a expiré) — le coût restant est le DOUBLE balayage
  regex du lexique accidentées sur ~400 000 titres à chaque page. Même
  remède : le verdict devient une colonne générée stored, calculée une
  fois à l'écriture ; la fonction filtre un booléen indexable.

  IMPORTANT — MÊME PIÈGE DOCUMENTÉ : toute évolution FUTURE du lexique
  accidentées (TS isDamagedVehicleText + SQL) devra régénérer la colonne :
    alter table market_listing_observations drop column title_damaged;
  puis ré-exécuter le présent fichier.
*/

-- ── 1. Colonne verdict (réécrit la table UNE fois — laisse finir) ───────────
alter table market_listing_observations
  add column if not exists title_damaged boolean generated always as (
    lower(coalesce(title, '')) ~ '(accident|unfall|schaden|schade[^v]|schadeauto|skadet|totalskade|incidentat|sinistrat|sinistr|siniestr|per ricambi|para piezas|krockskad|krockad|reparationsobjekt|sérült|serult|törött|torott|karambol|motorhibás|motorhibas|daužt|dauzt|po avarijos|dalimis|bastler|defe[ck]t|epave|épave|salvage|motorschaden|non marciante|nevažiuojant|nevaziuojant|endommag)'
    and lower(coalesce(title, '')) !~ '((non|sans|jamais|no|never|senza|mai|sin)[ -]*(accident|incident|siniestr)|accident[ -]*free|unfall[ -]?frei|schaden?[ -]?frei|schadevrij|skades?fri|krockfri|inga[ -]*skador|(inga|utan|keine[nmrs]?|kein|geen|zonder|sans|no|ohne)[ -]*defe[ck]te?|(non|pas|jamais|sans)[ -]*endommag)'
  ) stored;

-- ── 2. mi_cheap_medians v7 : filtre le booléen précalculé ───────────────────
create or replace function mi_cheap_medians(
  p_since timestamptz,
  p_min_price numeric default 1000
)
returns table (
  brand_label text, model_label text, fuel text, year int, country text,
  site text, median numeric, cnt bigint, last_seen timestamptz
)
language sql stable
set statement_timeout to '30s'
as $$
  with keyed as (
    select
      brand_key as bk,
      model_key as mk,
      brand, model, lower(fuel) as fuel, year, upper(country) as country,
      site, price, scraped_at
    from market_listing_observations
    where scraped_at >= p_since
      and price is not null and price >= p_min_price
      and year is not null
      and coalesce(fuel, '') <> ''
      and coalesce(brand, '') <> '' and coalesce(model, '') <> ''
      and not title_damaged
  ),
  ranked as (
    select k.*,
      row_number() over (
        partition by bk, mk, fuel, year, country
        order by price asc
      ) as rn
    from keyed k
  )
  select
    min(brand)  as brand_label,
    min(model)  as model_label,
    fuel, year, country,
    mode() within group (order by site) as site,
    min(price) filter (where rn = 3) as median,
    count(*) as cnt,
    max(scraped_at) as last_seen
  from ranked
  group by bk, mk, fuel, year, country
  having count(*) >= 5
  order by 1, 2, 3, 4, 5
$$;

grant execute on function mi_cheap_medians(timestamptz, numeric) to anon, authenticated;

-- ── 3. Contrôle (seul résultat affiché) ─────────────────────────────────────
select
  (select count(*) from mi_cheap_medians(now() - interval '30 days')) > 0
  and not exists (
    select 1 from (
      select title, title_damaged
      from market_listing_observations
      order by scraped_at desc limit 1000
    ) t
    where t.title_damaged is distinct from (
      lower(coalesce(t.title, '')) ~ '(accident|unfall|schaden|schade[^v]|schadeauto|skadet|totalskade|incidentat|sinistrat|sinistr|siniestr|per ricambi|para piezas|krockskad|krockad|reparationsobjekt|sérült|serult|törött|torott|karambol|motorhibás|motorhibas|daužt|dauzt|po avarijos|dalimis|bastler|defe[ck]t|epave|épave|salvage|motorschaden|non marciante|nevažiuojant|nevaziuojant|endommag)'
      and lower(coalesce(t.title, '')) !~ '((non|sans|jamais|no|never|senza|mai|sin)[ -]*(accident|incident|siniestr)|accident[ -]*free|unfall[ -]?frei|schaden?[ -]?frei|schadevrij|skades?fri|krockfri|inga[ -]*skador|(inga|utan|keine[nmrs]?|kein|geen|zonder|sans|no|ohne)[ -]*defe[ck]te?|(non|pas|jamais|sans)[ -]*endommag)'
    )
  ) as tout_est_bon;
