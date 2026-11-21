/*
  # L'inspection sur le site mc-export.com (21/11, Channing : « notre vitrine va être scrappée par JP Cars… il
  #   faudrait que sur le site il y ait l'inspection de jointe »)

  site_good_deals() rend un champ de plus, `inspection_url` : la fiche d'inspection PDF MC Export de la bonne affaire
  (bucket public fyc-fiches), quand le lien de rapport du véhicule publié en est une. Un rapport FOURNISSEUR (DEKRA,
  VTI…) n'est jamais exposé : il nommerait le fournisseur et son dossier ; « Fiches MC Export » dans l'onglet Export
  d'une offre en fait une fiche à nous, qui devient le lien du véhicule. Additif, idempotent ; le reste de la fonction
  est repris tel quel (SQL du 29/10).
*/
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
    -- 21/11 : la fiche d'inspection MC Export (PDF public), jamais un rapport fournisseur.
    'inspection_url', case when i.vehicle->>'report_url' like '%/storage/v1/object/public/fyc-fiches/%' then i.vehicle->>'report_url' end,
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
  order by i.position asc nulls last, i.published_at desc
  limit 200;
$$;

select (select pg_get_functiondef('public.site_good_deals(text)'::regprocedure) like '%inspection_url%')
   and has_function_privilege('anon', 'public.site_good_deals(text)', 'execute') as tout_est_bon;
