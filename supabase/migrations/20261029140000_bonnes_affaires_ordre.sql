-- ═══════════════════════════════════════════════════════════════════════════
-- ORDRE DES BONNES AFFAIRES (29/10/2026) — demande Channing : « modifier
-- l'ordre des véhicules présents sur la liste ». intra_showcase.position :
-- rang choisi à la main (1 = en tête) ; null = non rangé, après les rangés,
-- par date de publication décroissante comme avant. Même ordre sur
-- l'Accueil d'ADA (listShowcase) et sur mc-export.com (site_good_deals).
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.intra_showcase add column if not exists position integer;
create index if not exists idx_intra_showcase_position on public.intra_showcase (position);

create or replace function public.site_good_deals(p_slug text default null) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', i.id,
    'slug', public.ada_slug(concat_ws(' ', i.vehicle->>'brand', i.vehicle->>'model', (nullif(i.vehicle->>'year', '')::numeric::int)::text)) || '-' || left(replace(i.id::text, '-', ''), 8),
    'published_at', i.published_at,
    'brand', i.vehicle->>'brand',
    'model', i.vehicle->>'model',
    'version', i.vehicle->>'version',
    'engine', i.vehicle->>'engine',
    'year', nullif(i.vehicle->>'year', '')::numeric::int,
    'reg_month', left(i.vehicle->>'reg_date', 7),
    'km', nullif(i.vehicle->>'km', '')::numeric::int,
    'fuel', i.vehicle->>'fuel',
    'gearbox', i.vehicle->>'gearbox',
    'power_ch', nullif(i.vehicle->>'power_ch', '')::numeric::int,
    'color', i.vehicle->>'color',
    'quantity', coalesce(nullif(i.vehicle->>'quantity', '')::numeric::int, 1),
    'damages', nullif(i.vehicle->>'damages', '')::numeric::int,
    'price_ht', i.price_ht,
    'note', i.note,
    'title', nullif(trim(coalesce(i.title, '')), ''),
    'photos', coalesce(i.photos, '[]'::jsonb),
    -- Par pays : prix d'attaque, médiane, nombre d'annonces, et les recherches
    -- du relevé (site, adresse, annonces lues) — les mêmes liens que sur
    -- l'Accueil d'ADA, pour que le visiteur vérifie le marché lui-même.
    'market', (
      select coalesce(jsonb_object_agg(e.key, jsonb_build_object(
        'median', e.value->'medianTtc', 'attack', e.value->'attackTtc', 'competitors', e.value->'competitors', 'at', e.value->'at',
        'sites', (
          select coalesce(jsonb_agg(jsonb_build_object('site', s.key, 'url', s.value->'url', 'count', s.value->'count', 'attack', s.value->'attack', 'median', s.value->'median')), '[]'::jsonb)
          from jsonb_each(coalesce(e.value->'sites', '{}'::jsonb)) s
          where jsonb_typeof(s.value) = 'object' and (s.value->>'url') like 'http%' and (s.value->>'error') is null
        ))), '{}'::jsonb)
      from jsonb_each(coalesce(i.market, '{}'::jsonb)) e
      where jsonb_typeof(e.value) = 'object'
    )
  )
  from public.intra_showcase i
  where p_slug is null or left(replace(i.id::text, '-', ''), 8) = right(p_slug, 8)
  -- Ordre choisi à la main (29/10) : position croissante, puis les plus récentes.
  order by i.position asc nulls last, i.published_at desc
  limit 200;
$$;

select exists (select 1 from information_schema.columns where table_name = 'intra_showcase' and column_name = 'position')
   and has_function_privilege('anon', 'public.site_good_deals(text)', 'execute') as tout_est_bon;
