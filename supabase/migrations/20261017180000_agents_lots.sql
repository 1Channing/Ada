/*
  # Dana — les lots de véhicules identiques (17/10, Channing : « plusieurs
  #   véhicules identiques, c'est intéressant, il y a un sourcing là-bas
  #   peut-être ? » ; « Ada est censée trouver des acheteurs, pas des
  #   vendeurs ! nos Toyota on les vend aux Pays-Bas »)

  - market_dealer_listings : clés d'identité marque / modèle (les mêmes que
    Market Intelligence : ada_brand_key, ada_model_key), tenues par un
    trigger et rattrapées pour les annonces déjà vues.
  - agents_dealer_lots() : chez chaque garage (toutes ses fiches réunies,
    tous pays), les véhicules identiques — même marque, même modèle, même
    année — à partir de 3 ; une voiture publiée sur deux sites ne compte
    qu'une fois. Pour chaque lot : prix, km, depuis quand ADA le voit, et ce
    que ces véhicules valent dans nos pays de vente (annonces des garages de
    l'annuaire et relevés des études, même modèle, année à un an près) —
    écart BRUT, avant taxes d'immatriculation, transport et frais.
  - agents_dealer_directory() : nouveau filtre p_exclude_countries (Ada vend
    à l'export : l'annuaire d'Ada écarte la France, pays d'achat) ; la
    qualification affichée est celle d'Ada.
  Accès : comptes MC Export avec le droit `agents`. Additif, idempotent.
  À coller après agents_tous_sites.
*/

-- 1. Clés d'identité des annonces de l'annuaire --------------------------------------
create or replace function public.agents_set_listing_keys()
returns trigger
language plpgsql
as $$
begin
  new.brand_key := public.ada_brand_key(new.brand);
  new.model_key := public.ada_model_key(new.brand, new.model);
  return new;
end $$;

alter table public.market_dealer_listings
  add column if not exists brand_key text,
  add column if not exists model_key text;
drop trigger if exists trg_mdl_identity_keys on public.market_dealer_listings;
create trigger trg_mdl_identity_keys
  before insert or update of brand, model on public.market_dealer_listings
  for each row execute function public.agents_set_listing_keys();
-- Rattrapage : les annonces déjà vues reçoivent leurs clés (le trigger fait le calcul).
update public.market_dealer_listings set brand = brand where brand_key is null and brand is not null;
create index if not exists idx_market_dealer_listings_keys on public.market_dealer_listings (brand_key, model_key, last_seen_at desc);

-- 2. Les lots ------------------------------------------------------------------------------
create or replace function public.agents_dealer_lots(
  p_country text default null, p_markets text[] default null, p_min integer default 3,
  p_days integer default 45, p_brand text default null, p_limit integer default 200)
returns setof jsonb
language sql stable security definer set search_path = public
as $$
  with params as (
    select greatest(2, least(coalesce(p_min, 3), 50)) as min_n,
           make_interval(days => greatest(1, least(coalesce(p_days, 45), 180))) as win,
           coalesce(nullif(p_markets, '{}'), array['NL', 'DK', 'BE', 'DE']) as markets
  ),
  grp as (
    select d.id, coalesce(d.parent_id, d.id) as root from public.market_dealers d
  ),
  recent as (
    select g.root, l.listing_url, l.brand, l.model, l.brand_key, l.model_key, l.year, l.mileage, l.price_eur, l.fuel,
           l.first_seen_at, l.last_seen_at
    from public.market_dealer_listings l
    join grp g on g.id = l.dealer_id
    cross join params p
    where l.last_seen_at >= now() - p.win
      and coalesce(l.brand_key, '') <> '' and coalesce(l.model_key, '') <> '' and l.year is not null
      and coalesce(l.price_eur, 0) > 2000
      and (p_brand is null or l.brand_key = public.ada_brand_key(p_brand))
  ),
  -- Une voiture publiée sur deux sites du garage ne compte qu'une fois :
  -- même kilométrage à 500 km près, ou même prix quand le km manque.
  cars as (
    select distinct on (r.root, r.brand_key, r.model_key, r.year, coalesce((r.mileage / 500)::text, 'p' || r.price_eur::text)) r.*
    from recent r
    order by r.root, r.brand_key, r.model_key, r.year, coalesce((r.mileage / 500)::text, 'p' || r.price_eur::text), r.last_seen_at desc
  ),
  lots as (
    select c.root, c.brand_key, c.model_key, c.year, count(*) as n,
           mode() within group (order by c.brand) as brand, mode() within group (order by c.model) as model,
           min(c.price_eur) as price_min, max(c.price_eur) as price_max,
           percentile_cont(0.5) within group (order by c.price_eur) as price_median,
           min(c.mileage) as km_min, max(c.mileage) as km_max,
           percentile_cont(0.5) within group (order by c.mileage) as km_median,
           min(c.first_seen_at) as first_seen_at, max(c.last_seen_at) as last_seen_at,
           array_agg(distinct c.fuel) filter (where c.fuel is not null) as fuels,
           (array_agg(c.listing_url order by c.price_eur))[1:10] as urls
    from cars c
    group by c.root, c.brand_key, c.model_key, c.year
    having count(*) >= (select min_n from params)
  ),
  top_lots as (
    select l.*, d.country as dealer_country
    from lots l
    join public.market_dealers d on d.id = l.root
    where (select public.ada_can_drive_agents())
      and (p_country is null or d.country = upper(p_country))
    order by l.n desc, l.last_seen_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ),
  -- Ce que valent ces modèles dans nos pays de vente : annonces des garages
  -- de l'annuaire, et relevés des études (Market Intelligence), 60 jours.
  dest as (
    select d2.country as market, l2.listing_url, l2.brand_key, l2.model_key, l2.year, l2.mileage, l2.price_eur::numeric as price, 0 as src
    from public.market_dealer_listings l2
    join public.market_dealers d2 on d2.id = l2.dealer_id
    cross join params p
    where d2.country = any(p.markets)
      and l2.last_seen_at >= now() - interval '60 days' and coalesce(l2.price_eur, 0) > 2000
      and l2.brand_key in (select brand_key from top_lots)
    union all
    select o.country, o.listing_url, o.brand_key, o.model_key, o.year, o.mileage, o.price::numeric, 1
    from public.market_listing_observations o
    cross join params p
    where o.country = any(p.markets)
      and o.scraped_at >= now() - interval '60 days' and coalesce(o.price, 0) > 2000
      and coalesce(o.currency, 'EUR') = 'EUR' and coalesce(o.price_type, 'one-off') in ('one-off', 'unknown')
      and o.brand_key in (select brand_key from top_lots)
  ),
  -- Une annonce relevée chaque jour par une étude ne compte qu'une fois ; vue
  -- aussi dans l'annuaire, c'est son dernier prix (annuaire) qui compte.
  dest_u as (
    select distinct on (coalesce(x.listing_url, x.market || '|' || x.price::text || '|' || coalesce(x.mileage::text, ''))) x.*
    from dest x
    order by coalesce(x.listing_url, x.market || '|' || x.price::text || '|' || coalesce(x.mileage::text, '')), x.src
  ),
  lot_markets as (
    select t.root, t.brand_key, t.model_key, t.year, x.market, count(*) as n,
           round(percentile_cont(0.5) within group (order by x.price)) as median
    from top_lots t
    join dest_u x on x.brand_key = t.brand_key
     and (x.model_key = t.model_key
          or (length(t.model_key) >= 3 and x.model_key like t.model_key || '%')
          or (length(x.model_key) >= 3 and t.model_key like x.model_key || '%'))
     and x.year between t.year - 1 and t.year + 1
     and x.market <> coalesce(t.dealer_country, '')
     and (t.km_median is null or x.mileage is null or abs(x.mileage - t.km_median) <= greatest(25000, t.km_median * 0.5))
    group by t.root, t.brand_key, t.model_key, t.year, x.market
    having count(*) >= 3
  )
  select jsonb_build_object(
    'dealer', jsonb_build_object('id', d.id, 'name', d.name, 'country', d.country, 'city', d.city, 'zip', d.zip, 'phone', d.phone,
                                 'site', d.site, 'site_url', d.site_url, 'imprint_url', d.imprint_url, 'website', d.website),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'site', m.site, 'site_url', m.site_url) order by m.first_seen_at), '[]'::jsonb)
                from public.market_dealers m where m.id = d.id or m.parent_id = d.id),
    'brand', t.brand, 'model', t.model, 'year', t.year, 'count', t.n,
    'price_min', t.price_min, 'price_max', t.price_max, 'price_median', round(t.price_median),
    'km_min', t.km_min, 'km_max', t.km_max, 'fuels', t.fuels,
    'first_seen_at', t.first_seen_at, 'last_seen_at', t.last_seen_at, 'urls', t.urls,
    'markets', (select coalesce(jsonb_agg(jsonb_build_object('market', lm.market, 'n', lm.n, 'median', lm.median, 'gap', lm.median - round(t.price_median))
                                          order by lm.median - round(t.price_median) desc), '[]'::jsonb)
                from lot_markets lm
                where lm.root = t.root and lm.brand_key = t.brand_key and lm.model_key = t.model_key and lm.year = t.year)
  )
  from top_lots t
  join public.market_dealers d on d.id = t.root
  order by t.n desc, t.last_seen_at desc;
$$;
revoke all on function public.agents_dealer_lots(text, text[], integer, integer, text, integer) from public, anon;
grant execute on function public.agents_dealer_lots(text, text[], integer, integer, text, integer) to authenticated;

-- 3. L'annuaire d'Ada : pays écartés (la France, pays d'achat) -----------------------------
drop function if exists public.agents_dealer_directory(text, text, text, integer, integer);
create or replace function public.agents_dealer_directory(
  p_country text default null, p_brand text default null, p_query text default null,
  p_days integer default 90, p_limit integer default 300, p_exclude_countries text[] default null)
returns setof jsonb
language sql stable security definer set search_path = public
as $$
  with clients as (
    select distinct public.ada_name_key(c.company_name) as nk, public.ada_phone_key(c.phone) as pk
    from public.transactions_admin t
    join public.contacts c on c.id in (t.buyer_contact_id, t.buyer_contact_id_2)
    where coalesce(c.company_name, '') <> '' and c.company_name !~* 'mc[ -]?export'
  ),
  network as (
    select public.ada_name_key(n.name) as nk, public.ada_phone_key(n.phone) as pk from public.network_contacts n
  ),
  grp as (
    select d.*, coalesce(d.parent_id, d.id) as root from public.market_dealers d
  ),
  recent as (
    select g.root, l.* from public.market_dealer_listings l
    join grp g on g.id = l.dealer_id
    where l.last_seen_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)))
  ),
  stats as (
    select r.root,
           count(*) as n,
           count(*) filter (where p_brand is null or r.brand = upper(p_brand)) as n_brand,
           count(distinct r.brand) as nb_brands,
           count(*) filter (where r.vehicle_type ~* '(van|utilit|transport|bestel|kasten|furg|camion)') as n_vans,
           array_agg(distinct r.brand) filter (where r.brand is not null) as brands,
           percentile_cont(0.5) within group (order by r.price_eur) as median_price,
           max(r.last_seen_at) as last_listing_at
    from recent r group by r.root
  ),
  members as (
    select g.root,
           jsonb_agg(jsonb_build_object('id', g.id, 'site', g.site, 'name', g.name, 'site_url', g.site_url, 'imprint_url', g.imprint_url,
                                        'website', g.website, 'phone', g.phone, 'city', g.city)
                     order by (g.id = g.root) desc, g.first_seen_at) as list,
           array_agg(g.id) as ids,
           array_agg(distinct g.site) as sites,
           array_agg(public.ada_name_key(g.name)) as nks,
           array_agg(public.ada_phone_key(g.phone)) as pks,
           (array_agg(g.website order by g.first_seen_at) filter (where g.website is not null))[1] as website,
           (array_agg(g.phone order by g.first_seen_at) filter (where g.phone is not null))[1] as phone,
           (array_agg(g.city order by g.first_seen_at) filter (where g.city is not null))[1] as city,
           (array_agg(g.zip order by g.first_seen_at) filter (where g.zip is not null))[1] as zip,
           (array_agg(g.contact_name order by g.first_seen_at) filter (where g.contact_name is not null))[1] as contact_name,
           (array_agg(g.legal_id order by g.first_seen_at) filter (where g.legal_id is not null))[1] as legal_id,
           max(g.last_seen_at) as last_seen_at,
           bool_or(p_query is null or g.name ilike '%' || p_query || '%' or g.city ilike '%' || p_query || '%') as matches
    from grp g group by g.root
  )
  select jsonb_build_object(
    'id', d.id, 'name', d.name, 'country', d.country, 'city', coalesce(d.city, m.city), 'zip', coalesce(d.zip, m.zip), 'street', d.street,
    'phone', coalesce(d.phone, m.phone), 'contact_name', coalesce(d.contact_name, m.contact_name),
    'site_url', d.site_url, 'imprint_url', d.imprint_url, 'website', coalesce(d.website, m.website),
    'lat', d.lat, 'lng', d.lng, 'legal_id', coalesce(d.legal_id, m.legal_id),
    'site', d.site, 'sites', m.sites, 'members', m.list,
    'first_seen_at', d.first_seen_at, 'last_seen_at', m.last_seen_at,
    'listings', s.n, 'listings_brand', s.n_brand, 'nb_brands', s.nb_brands, 'vans', s.n_vans, 'brands', s.brands,
    'median_price', round(s.median_price), 'last_listing_at', s.last_listing_at,
    'is_client', exists (select 1 from clients c where (c.nk <> '' and c.nk = any(m.nks))
                                                    or (length(c.pk) = 9 and c.pk = any(m.pks))),
    'in_network', exists (select 1 from network n where (n.nk <> '' and n.nk = any(m.nks))
                                                     or (length(n.pk) = 9 and n.pk = any(m.pks))),
    'prospect', (select jsonb_build_object('id', p.id, 'dealer_id', p.dealer_id, 'stage', p.stage, 'score', p.score, 'kind', p.kind,
                                           'qualified_at', p.qualified_at, 'email', p.best_contact->>'email',
                                           'in_map', p.network_contact_id is not null)
                 from public.agent_prospects p where p.dealer_id = any(m.ids) and p.agent = 'ada'
                 order by p.qualified_at desc nulls last limit 1)
  )
  from public.market_dealers d
  join stats s on s.root = d.id
  join members m on m.root = d.id
  where (select public.ada_can_drive_agents())
    and d.parent_id is null
    and (p_country is null or d.country = upper(p_country))
    and (p_exclude_countries is null or coalesce(d.country, '') <> all(p_exclude_countries))
    and (p_brand is null or s.n_brand > 0)
    and m.matches
  order by s.n_brand desc, s.n desc, m.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
$$;
revoke all on function public.agents_dealer_directory(text, text, text, integer, integer, text[]) from public, anon;
grant execute on function public.agents_dealer_directory(text, text, text, integer, integer, text[]) to authenticated;

-- 4. Vérification ------------------------------------------------------------------
select exists (select 1 from information_schema.columns where table_name = 'market_dealer_listings' and column_name = 'model_key')
   and exists (select 1 from pg_trigger where tgname = 'trg_mdl_identity_keys')
   and has_function_privilege('authenticated', 'public.agents_dealer_lots(text, text[], integer, integer, text, integer)', 'execute')
   and not has_function_privilege('anon', 'public.agents_dealer_lots(text, text[], integer, integer, text, integer)', 'execute')
   and has_function_privilege('authenticated', 'public.agents_dealer_directory(text, text, text, integer, integer, text[])', 'execute') as tout_est_bon;
