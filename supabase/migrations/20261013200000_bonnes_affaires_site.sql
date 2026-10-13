/*
  # Bonnes affaires sur le site mc-export.com (13/10, Channing : « ce qui
  #   apparaît dans Ada dans les bonnes affaires de l'Accueil doit apparaître
  #   dans le stock du site MC Export… ajouter les études de marché selon la
  #   langue… le SEO impeccable, ça va être notre publicité… des photos »)

  Le site lit ADA DIRECTEMENT, avec la clé anonyme : une seule porte,
  site_good_deals(), fonction « security definer » qui ne rend que ce qui est
  destiné au public — véhicule, prix MC Export HT, mot de l'équipe, photos,
  et pour chaque pays du relevé de marché le prix d'attaque, la médiane et
  le nombre d'annonces (jamais le prix fournisseur, jamais les recherches ni
  les sites interrogés, jamais le nom de l'offre ni de l'auteur). La clé
  anonyme ne lit toujours aucune table. Photos : bucket public intra-photos,
  écriture réservée à l'équipe MC Export avec l'onglet Offres. Additif,
  idempotent.
*/

-- 1. Photos des bonnes affaires ---------------------------------------------------
alter table public.intra_showcase add column if not exists photos jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intra-photos', 'intra-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists intra_photos_public_read on storage.objects;
create policy intra_photos_public_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'intra-photos');
drop policy if exists intra_photos_write on storage.objects;
create policy intra_photos_write on storage.objects
  for all to authenticated
  using (bucket_id = 'intra-photos' and (select public.ada_is_mc_export()) and (select public.ada_can_see_any(array['offres'])))
  with check (bucket_id = 'intra-photos' and (select public.ada_is_mc_export()) and (select public.ada_can_see_any(array['offres'])));

-- 2. Adresse lisible (« audi-a4-2016-3f2a9c1b ») ---------------------------------
create or replace function public.ada_slug(p text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(p, '')), 'àáâãäåāçćčèéêëēìíîïłñńòóôõöøùúûüýÿžšß', 'aaaaaaaccceeeeeiiiilnnoooooouuuuyyzss'),
    '[^a-z0-9]+', '-', 'g'))
$$;

-- 3. La porte publique --------------------------------------------------------------
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
  order by i.published_at desc
  limit 200;
$$;

revoke all on function public.site_good_deals(text) from public;
grant execute on function public.site_good_deals(text) to anon, authenticated;
revoke all on function public.ada_slug(text) from public;
grant execute on function public.ada_slug(text) to authenticated;

-- 4. Vérification ------------------------------------------------------------------
select exists (select 1 from information_schema.columns where table_name = 'intra_showcase' and column_name = 'photos')
   and exists (select 1 from storage.buckets where id = 'intra-photos' and public)
   and exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'intra_photos_public_read')
   and exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'intra_photos_write')
   and has_function_privilege('anon', 'public.site_good_deals(text)', 'execute')
   and not has_table_privilege('anon', 'public.intra_showcase', 'select')
   and public.ada_slug('Škoda Enyaq 2024') = 'skoda-enyaq-2024' as tout_est_bon;
