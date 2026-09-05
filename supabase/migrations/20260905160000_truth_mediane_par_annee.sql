-- ═══════════════════════════════════════════════════════════════════════════
-- TRUTH CENTER : « médiane aberrante » comparée À ANNÉE ÉGALE (05/09/2026,
-- audit). Le signal F comparait la médiane 7 j à celle des 8-30 j par
-- (marque, modèle, carburant, pays) TOUTES ANNÉES CONFONDUES : une étude
-- récente « Golf 2024 » contre une ingestion MI « Golf toutes années » (des
-- 1.9 TDI de 1999 à 1 600 €) ouvrait 21 dossiers à 80/100 sur des marchés
-- parfaitement sains. Désormais : même année de mise en circulation des
-- deux côtés ; les dossiers nés du mélange sont refermés (R5 rouvre si le
-- signal persiste à année égale). Le reste du balayage est inchangé.
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

update public.truth_dossiers
   set status = 'accepted_variance',
       resolved_at = now(),
       details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
         'diagnosis', 'Écart compris : médianes comparées toutes années confondues (études récentes ciblées vs ingestions toutes générations) avant le 05/09 — comparaison recalculée à année égale désormais ; se rouvrira seul si le signal persiste.',
         'diagnosed_by', 'ADA (règles)', 'diagnosed_at', now())
 where signal = 'mediane_aberrante'
   and resolved_at is null;

create or replace function truth_sweep()
returns int
language plpgsql
set statement_timeout to '120s'
as $$
declare
  v_var_pct numeric := coalesce((select value from truth_config where key = 'depth_variation_pct'), 50);
  v_min_hist numeric := coalesce((select value from truth_config where key = 'depth_min_history'), 20);
  v_poll_pct numeric := coalesce((select value from truth_config where key = 'pollution_pct'), 25);
  v_ratio numeric := coalesce((select value from truth_config where key = 'median_ratio'), 2);
  v_drop_pts numeric := coalesce((select value from truth_config where key = 'completeness_drop_pts'), 30);
  v_min_n numeric := coalesce((select value from truth_config where key = 'min_sample'), 20);
  v_rows int; v_total int := 0;
begin
  -- A/B/C — profondeur : dernier listing_count vs médiane historique (2-30 j)
  -- DU MÊME SEGMENT (site, pays, marque, modèle, carburant, segment_key).
  with latest as (
    select distinct on (site, country, upper(brand), upper(model), lower(fuel), segment_key)
      site, country, upper(brand) as brand, upper(model) as model, lower(fuel) as fuel, segment_key,
      listing_count, scraped_at
    from market_snapshots
    where listing_count is not null and brand <> '' and model <> ''
    order by site, country, upper(brand), upper(model), lower(fuel), segment_key, scraped_at desc
  ),
  hist as (
    select site, country, upper(brand) as brand, upper(model) as model, lower(fuel) as fuel, segment_key,
      percentile_cont(0.5) within group (order by listing_count) as med,
      count(*) as n
    from market_snapshots
    where listing_count is not null and brand <> '' and model <> ''
      and scraped_at >= now() - interval '30 days'
      and scraped_at <  now() - interval '2 days'
    group by 1, 2, 3, 4, 5, 6
    having count(*) >= 3
  ),
  flagged as (
    select l.*, h.med,
      case when l.listing_count = 0 then 'profondeur_zero' else 'profondeur_variation' end as signal,
      round(abs(l.listing_count - h.med) / greatest(h.med, 1) * 100) as dev_pct
    from latest l
    join hist h using (site, country, brand, model, fuel, segment_key)
    where h.med >= v_min_hist
      and l.scraped_at >= now() - interval '2 days'
      and (l.listing_count = 0
           or abs(l.listing_count - h.med) / greatest(h.med, 1) * 100 >= v_var_pct)
  ),
  one as (
    select distinct on (site, country, brand, model, fuel, signal) *
    from flagged
    order by site, country, brand, model, fuel, signal, dev_pct desc
  )
  insert into truth_dossiers (site, country, brand, model, fuel, signal, layer, doubt_score, priority, summary, details)
  select site, country, brand, model, fuel, signal,
    case when signal = 'profondeur_zero' then 'url' else 'profondeur' end,
    least(100, case when signal = 'profondeur_zero' then 90 else dev_pct end),
    truth_priority(brand, model),
    format('Profondeur %s vs médiane historique %s (%s%%) — segment %s', listing_count, round(med), dev_pct, coalesce(nullif(segment_key, ''), 'ingestion')),
    jsonb_build_object('listing_count', listing_count, 'median_hist', round(med), 'dev_pct', dev_pct, 'snapshot_at', scraped_at, 'segment_key', segment_key)
  from one
  on conflict (site, country, brand, model, fuel, signal) do update set
    doubt_score = excluded.doubt_score, priority = excluded.priority,
    summary = excluded.summary, details = excluded.details, last_seen_at = now();
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;

  -- E — pollution du sample (inchangé).
  with poll as (
    select s.site, s.country, upper(s.brand) as brand, upper(s.model) as model, lower(s.fuel) as fuel,
      count(*) as n,
      count(*) filter (
        where o.model_key <> '' and k.smk <> ''
          and not (o.model_key like k.smk || '%' or k.smk like o.model_key || '%')
      ) as bad
    from market_listing_observations o
    join market_snapshots s on s.id = o.snapshot_id
    cross join lateral (select ada_model_key(s.brand, s.model) as smk) k
    where o.scraped_at >= now() - interval '7 days' and s.model <> ''
    group by 1, 2, 3, 4, 5
    having count(*) >= v_min_n
  )
  insert into truth_dossiers (site, country, brand, model, fuel, signal, layer, doubt_score, priority, summary, details)
  select site, country, brand, model, fuel, 'pollution_sample', 'canonicalisation',
    least(100, round(bad::numeric / n * 200)),
    truth_priority(brand, model),
    format('%s/%s annonces hors segment (%s%%)', bad, n, round(bad::numeric / n * 100)),
    jsonb_build_object('sample', n, 'polluted', bad, 'pct', round(bad::numeric / n * 100))
  from poll
  where bad::numeric / n * 100 >= v_poll_pct
  on conflict (site, country, brand, model, fuel, signal) do update set
    doubt_score = excluded.doubt_score, priority = excluded.priority,
    summary = excluded.summary, details = excluded.details, last_seen_at = now();
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;

  -- F — médiane aberrante : médiane 7 j vs 8-30 j, À ANNÉE ÉGALE (05/09).
  with recent as (
    select brand_key as bk, model_key as mk, lower(fuel) as fuel, upper(country) as country, year,
      min(brand) as brand, min(model) as model,
      percentile_cont(0.5) within group (order by price) as med, count(*) as n
    from market_listing_observations
    where scraped_at >= now() - interval '7 days'
      and price >= 1000 and not title_damaged and coalesce(model, '') <> '' and year is not null
    group by 1, 2, 3, 4, 5
    having count(*) >= v_min_n
  ),
  base as (
    select brand_key as bk, model_key as mk, lower(fuel) as fuel, upper(country) as country, year,
      percentile_cont(0.5) within group (order by price) as med, count(*) as n
    from market_listing_observations
    where scraped_at >= now() - interval '30 days'
      and scraped_at <  now() - interval '7 days'
      and price >= 1000 and not title_damaged and coalesce(model, '') <> '' and year is not null
    group by 1, 2, 3, 4, 5
    having count(*) >= v_min_n
  )
  insert into truth_dossiers (site, country, brand, model, fuel, signal, layer, doubt_score, priority, summary, details)
  select '', r.country, upper(r.brand), upper(r.model), r.fuel, 'mediane_aberrante', 'parsing',
    80, truth_priority(r.brand, r.model),
    format('Médiane 7 j %s € vs %s € sur 8-30 j (année %s)', round(r.med), round(b.med), r.year),
    jsonb_build_object('median_recent', round(r.med), 'median_base', round(b.med), 'n_recent', r.n, 'n_base', b.n, 'year', r.year)
  from recent r
  join base b using (bk, mk, fuel, country, year)
  where r.med > b.med * v_ratio or r.med < b.med / v_ratio
  on conflict (site, country, brand, model, fuel, signal) do update set
    doubt_score = excluded.doubt_score, priority = excluded.priority,
    summary = excluded.summary, details = excluded.details, last_seen_at = now();
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;

  -- H — chute de complétude par SITE (inchangé).
  with recent as (
    select site,
      avg((fuel <> '')::int) * 100 as fuel_pct,
      avg((year is not null)::int) * 100 as year_pct,
      avg((mileage is not null)::int) * 100 as km_pct,
      count(*) as n
    from market_listing_observations
    where scraped_at >= now() - interval '7 days'
    group by site having count(*) >= v_min_n
  ),
  base as (
    select site,
      avg((fuel <> '')::int) * 100 as fuel_pct,
      avg((year is not null)::int) * 100 as year_pct,
      avg((mileage is not null)::int) * 100 as km_pct,
      count(*) as n
    from market_listing_observations
    where scraped_at >= now() - interval '30 days'
      and scraped_at <  now() - interval '7 days'
    group by site having count(*) >= v_min_n
  )
  insert into truth_dossiers (site, country, brand, model, fuel, signal, layer, doubt_score, priority, summary, details)
  select r.site, '', '', '', '', 'completude_chute', 'parsing',
    70, 2,
    format('Complétude en chute sur %s : fuel %s→%s%%, année %s→%s%%, km %s→%s%%',
      r.site, round(b.fuel_pct), round(r.fuel_pct), round(b.year_pct), round(r.year_pct), round(b.km_pct), round(r.km_pct)),
    jsonb_build_object('fuel', jsonb_build_array(round(b.fuel_pct), round(r.fuel_pct)),
                       'year', jsonb_build_array(round(b.year_pct), round(r.year_pct)),
                       'mileage', jsonb_build_array(round(b.km_pct), round(r.km_pct)),
                       'n_recent', r.n, 'n_base', b.n)
  from recent r
  join base b using (site)
  where (b.fuel_pct - r.fuel_pct) >= v_drop_pts
     or (b.year_pct - r.year_pct) >= v_drop_pts
     or (b.km_pct - r.km_pct) >= v_drop_pts
  on conflict (site, country, brand, model, fuel, signal) do update set
    doubt_score = excluded.doubt_score, summary = excluded.summary,
    details = excluded.details, last_seen_at = now();
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;

  return v_total;
end;
$$;

revoke all on function truth_sweep() from public;
revoke all on function truth_sweep() from anon;
revoke all on function truth_sweep() from authenticated;

select 'ok' as tout_est_bon;
