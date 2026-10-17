/*
  # Ada — l'annuaire sur tous les sites (17/10, Channing : « fais tous les
  #   sites directement »)

  Jusqu'ici l'annuaire ne gardait que les garages d'AutoScout24. Désormais
  chaque site qu'ADA lit y dépose les siens (Marktplaats, Gaspedaal,
  Leboncoin, La Centrale, mobile.de, coches.net, Subito, Bilbasen, Blocket,
  Jófogás), et un même garage vu sur plusieurs sites n'y figure qu'une fois.

  - market_dealers : parent_id (le même garage, vu d'abord sur un autre
    site), lat / lng (position donnée par l'annonce), legal_id (SIREN…), et
    les clés de rapprochement calculées par la base (nom, téléphone, site
    web, ville, code postal).
  - agents_record_dealers() : le worker enregistre les garages d'une page ;
    une valeur connue n'est jamais effacée par une page qui ne la donne pas ;
    chaque garage est aussitôt rapproché de ses doubles.
  - agents_link_dealers() : le rapprochement — même téléphone, même site
    web, même SIREN, même nom dans la même ville (ou au même code postal), ou
    un nom long et unique dans le pays quand un site ne donne pas la ville.
    La fiche AutoScout24 tient lieu de fiche principale quand il y en a une,
    sinon une fiche qui donne la ville.
  - agents_dealer_directory() et agents_qualify_candidates() : un garage =
    une ligne, avec ses annonces de tous les sites et ses sources.
  - Rapprochement de l'annuaire déjà constitué.
  Accès inchangés (droit `agents`) ; écriture par le worker seul. Additif,
  idempotent. À coller après agents_premiers_mails.
*/

-- 1. Clés de rapprochement ---------------------------------------------------------
/** Nom d'un garage comparable d'un site à l'autre : sans accents, points ni
 *  apostrophes (« B.V. », « Auto's »), sans forme juridique ni mots génériques. */
create or replace function public.ada_dealer_key(p text)
returns text
language sql immutable
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(lower(coalesce(p, '')), 'àáâãäåāăąçćčďèéêëēėęěìíîïīįłñńňòóôõöøōőřśšşùúûüūůűýÿźžżßæœ', 'aaaaaaaaacccdeeeeeeeeiiiiiilnnnoooooooorsssuuuuuuuyyzzzsao'),
        '[''’`.]', '', 'g'),
      '\m(sarl|sas|sasu|sa|eurl|snc|sci|bv|nv|vof|cv|bvba|sprl|srl|srls|spa|sl|slu|gmbh|ag|kg|ohg|ug|ek|ev|ltd|limited|aps|as|ab|oy|kft|bt|zrt|uab|cie|co|and|und|en|et|y|zn|zonen|fils|sohn|sohne|automobiles?|automobielen|autobedrijf|autohaus|autohandel|autos?|garage|cars?|motors?|occasions?)\M',
      ' ', 'g'),
    '[^a-z0-9]+', '', 'g');
$$;

/** Domaine d'un site web (« tesselaarbv.nl ») ; vide pour un site d'annonces ou un réseau social. */
create or replace function public.ada_web_key(p text)
returns text
language sql immutable
as $$
  select case
    when x.h = '' or x.h !~ '\.' then ''
    when x.h ~ '(^|\.)(autoscout24|marktplaats|gaspedaal|leboncoin|lacentrale|mobile|bilbasen|coches|subito|blocket|jofogas|skelbiu|autotrack|autotelegraaf|viabovag|2dehands|2ememain|kleinanzeigen|facebook|instagram|linkedin|youtube|twitter|tiktok|google|goo|bit|admarkt|whatsapp|wa)\.[a-z.]+$' then ''
    else x.h end
  from (select regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '^[a-z][a-z0-9+.-]*://', ''), '^www\d?\.|[/:?#].*$', '', 'g') as h) x;
$$;

/** Ville comparable (lettres seules, sans accents). */
create or replace function public.ada_city_key(p text)
returns text
language sql immutable
as $$
  select regexp_replace(translate(lower(coalesce(p, '')), 'àáâãäåāăąçćčďèéêëēėęěìíîïīįłñńňòóôõöøōőřśšşùúûüūůűýÿźžżßæœ', 'aaaaaaaaacccdeeeeeeeeiiiiiilnnnoooooooorsssuuuuuuuyyzzzsao'), '[^a-z]+', '', 'g');
$$;

/** Code postal comparable (« 1234 AB » = « 1234ab »). */
create or replace function public.ada_zip_key(p text)
returns text
language sql immutable
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]+', '', 'g'));
$$;

-- 2. L'annuaire : position, identifiant légal, rattachement, clés ---------------------
alter table public.market_dealers
  add column if not exists parent_id uuid references public.market_dealers(id) on delete set null,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists legal_id text;
alter table public.market_dealers add column if not exists name_key text generated always as (public.ada_dealer_key(name)) stored;
alter table public.market_dealers add column if not exists phone_key text generated always as (public.ada_phone_key(phone)) stored;
alter table public.market_dealers add column if not exists web_key text generated always as (public.ada_web_key(website)) stored;
alter table public.market_dealers add column if not exists city_key text generated always as (public.ada_city_key(city)) stored;
alter table public.market_dealers add column if not exists zip_key text generated always as (public.ada_zip_key(zip)) stored;
create index if not exists idx_market_dealers_parent on public.market_dealers (parent_id) where parent_id is not null;
create index if not exists idx_market_dealers_phone_key on public.market_dealers (country, phone_key) where length(phone_key) = 9;
create index if not exists idx_market_dealers_name_key on public.market_dealers (country, name_key);
create index if not exists idx_market_dealers_web_key on public.market_dealers (web_key) where web_key <> '';
create index if not exists idx_market_dealers_legal on public.market_dealers (country, legal_id) where legal_id is not null;

-- 3. Le rapprochement -------------------------------------------------------------------
/** Rattache chaque garage (p_ids, ou tout l'annuaire si null) à son double vu
 *  sur un autre site. Rend le nombre de garages rattachés. */
create or replace function public.agents_link_dealers(p_ids uuid[] default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  d public.market_dealers%rowtype;
  cur uuid;
  root uuid;
  root_site text;
  root_noplace boolean;
  n integer := 0;
begin
  for d in
    select * from public.market_dealers x
     where x.parent_id is null and (p_ids is null or x.id = any(p_ids))
     -- AutoScout24 d'abord, puis les fiches qui donnent la ville : un garage
     -- sans ville (Gaspedaal) n'est jugé qu'une fois les autres rapprochés.
     order by (x.site = 'autoscout24') desc, (x.city_key = '' and x.zip_key = ''), x.first_seen_at, x.id
  loop
    -- Rattaché entre-temps (un double traité avant lui) : rien à faire.
    select x.parent_id into cur from public.market_dealers x where x.id = d.id;
    if cur is not null then continue; end if;
    root := null;
    -- a. Même téléphone (9 derniers chiffres), même pays.
    if length(d.phone_key) = 9 then
      select coalesce(y.parent_id, y.id) into root from public.market_dealers y
       where y.country is not distinct from d.country and y.phone_key = d.phone_key
         and y.site <> d.site and coalesce(y.parent_id, y.id) <> d.id
       order by y.first_seen_at, y.id limit 1;
    end if;
    -- b. Même site web.
    if root is null and d.web_key <> '' then
      select coalesce(y.parent_id, y.id) into root from public.market_dealers y
       where y.web_key = d.web_key and y.site <> d.site and coalesce(y.parent_id, y.id) <> d.id
       order by y.first_seen_at, y.id limit 1;
    end if;
    -- c. Même identifiant légal (SIREN…), même pays.
    if root is null and coalesce(d.legal_id, '') <> '' then
      select coalesce(y.parent_id, y.id) into root from public.market_dealers y
       where y.country is not distinct from d.country and y.legal_id = d.legal_id
         and y.site <> d.site and coalesce(y.parent_id, y.id) <> d.id
       order by y.first_seen_at, y.id limit 1;
    end if;
    -- d. Même nom, dans la même ville ou au même code postal.
    if root is null and length(d.name_key) >= 5 then
      select coalesce(y.parent_id, y.id) into root from public.market_dealers y
       where y.country is not distinct from d.country and y.name_key = d.name_key
         and y.site <> d.site and coalesce(y.parent_id, y.id) <> d.id
         and ((d.zip_key <> '' and y.zip_key = d.zip_key) or (d.city_key <> '' and y.city_key = d.city_key))
       order by y.first_seen_at, y.id limit 1;
    end if;
    -- e. Un nom long, porté par un seul garage dans le pays (tous sites
    --    confondus), quand l'un des deux côtés ne donne pas la ville
    --    (Gaspedaal) — jamais deux comptes d'un même site.
    if root is null and length(d.name_key) >= 8 then
      with c as (
        select coalesce(y.parent_id, y.id) as r, y.site, (y.city_key = '' and y.zip_key = '') as noplace
          from public.market_dealers y
         where y.country is not distinct from d.country and y.name_key = d.name_key
           and coalesce(y.parent_id, y.id) <> d.id
      )
      select case when count(distinct c.r) = 1 and not bool_or(c.site = d.site)
                       and ((d.city_key = '' and d.zip_key = '') or bool_and(c.noplace))
                  then (array_agg(c.r))[1] end
        into root from c;
    end if;
    if root is not null then
      select x.site, (x.city_key = '' and x.zip_key = '') into root_site, root_noplace from public.market_dealers x where x.id = root;
      if (d.site = 'autoscout24' and root_site is distinct from 'autoscout24')
         or (root_site is distinct from 'autoscout24' and root_noplace and not (d.city_key = '' and d.zip_key = '')) then
        -- La fiche principale : AutoScout24 (Impressum, téléphone, adresse), sinon une fiche qui donne la ville.
        update public.market_dealers set parent_id = d.id where id = root or parent_id = root;
      else
        update public.market_dealers set parent_id = root where id = d.id or parent_id = d.id;
      end if;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.agents_link_dealers(uuid[]) from public, anon, authenticated;
grant execute on function public.agents_link_dealers(uuid[]) to service_role;

/** Les garages d'une page d'annonces (worker) : enregistrés sans rien effacer, puis rapprochés. */
create or replace function public.agents_record_dealers(p_rows jsonb)
returns table (id uuid, site_dealer_id text)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  ids uuid[];
begin
  with src as (
    select distinct on (r->>'site', r->>'site_dealer_id')
           r->>'site' as site, r->>'site_dealer_id' as sdid, left(btrim(r->>'name'), 200) as name,
           nullif(btrim(r->>'contact_name'), '') as contact_name, nullif(btrim(r->>'site_url'), '') as site_url,
           nullif(btrim(r->>'imprint_url'), '') as imprint_url, nullif(btrim(r->>'website'), '') as website,
           nullif(btrim(r->>'phone'), '') as phone, nullif(upper(btrim(r->>'country')), '') as country,
           nullif(btrim(r->>'zip'), '') as zip, nullif(btrim(r->>'city'), '') as city, nullif(btrim(r->>'street'), '') as street,
           case when jsonb_typeof(r->'lat') = 'number' then (r->>'lat')::double precision end as lat,
           case when jsonb_typeof(r->'lng') = 'number' then (r->>'lng')::double precision end as lng,
           nullif(btrim(r->>'legal_id'), '') as legal_id
      from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) r
     where coalesce(r->>'site', '') <> '' and coalesce(r->>'site_dealer_id', '') <> '' and coalesce(btrim(r->>'name'), '') <> ''
     order by r->>'site', r->>'site_dealer_id'
  ), up as (
    insert into public.market_dealers as m (site, site_dealer_id, name, contact_name, site_url, imprint_url, website, phone, country, zip, city, street, lat, lng, legal_id, last_seen_at)
    select s.site, s.sdid, s.name, s.contact_name, s.site_url, s.imprint_url, s.website, s.phone, s.country, s.zip, s.city, s.street, s.lat, s.lng, s.legal_id, now()
      from src s
    on conflict (site, site_dealer_id) do update set
      name = excluded.name,
      contact_name = coalesce(excluded.contact_name, m.contact_name),
      site_url = coalesce(excluded.site_url, m.site_url),
      imprint_url = coalesce(excluded.imprint_url, m.imprint_url),
      website = coalesce(excluded.website, m.website),
      phone = coalesce(excluded.phone, m.phone),
      country = coalesce(excluded.country, m.country),
      zip = coalesce(excluded.zip, m.zip),
      city = coalesce(excluded.city, m.city),
      street = coalesce(excluded.street, m.street),
      lat = coalesce(excluded.lat, m.lat),
      lng = coalesce(excluded.lng, m.lng),
      legal_id = coalesce(excluded.legal_id, m.legal_id),
      last_seen_at = now()
    returning m.id
  )
  select array_agg(up.id) into ids from up;
  if ids is null then return; end if;
  perform public.agents_link_dealers(ids);
  return query select x.id, x.site_dealer_id from public.market_dealers x where x.id = any(ids);
end $$;
revoke all on function public.agents_record_dealers(jsonb) from public, anon, authenticated;
grant execute on function public.agents_record_dealers(jsonb) to service_role;

-- 4. L'annuaire lisible : un garage = une ligne, tous sites réunis ---------------------------
create or replace function public.agents_dealer_directory(
  p_country text default null, p_brand text default null, p_query text default null,
  p_days integer default 90, p_limit integer default 300)
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
                 from public.agent_prospects p where p.dealer_id = any(m.ids)
                 order by p.qualified_at desc nulls last limit 1)
  )
  from public.market_dealers d
  join stats s on s.root = d.id
  join members m on m.root = d.id
  where (select public.ada_can_drive_agents())
    and d.parent_id is null
    and (p_country is null or d.country = upper(p_country))
    and (p_brand is null or s.n_brand > 0)
    and m.matches
  order by s.n_brand desc, s.n desc, m.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
$$;
revoke all on function public.agents_dealer_directory(text, text, text, integer, integer) from public, anon;
grant execute on function public.agents_dealer_directory(text, text, text, integer, integer) to authenticated;

-- 5. Les prochains garages à qualifier : un garage = toutes ses fiches ----------------------
create or replace function public.agents_qualify_candidates(
  p_countries text[], p_brand_keys text[], p_van_keys text[], p_limit integer default 10)
returns table (dealer_id uuid, hits integer, listings integer)
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
    select d.id, coalesce(d.parent_id, d.id) as root, public.ada_name_key(d.name) as nk, public.ada_phone_key(d.phone) as pk
    from public.market_dealers d
  ),
  recent as (
    select g.root, l.vehicle_type,
           case x.k when 'MERCEDESBENZ' then 'MERCEDES' when 'VW' then 'VOLKSWAGEN' else x.k end as bk
    from public.market_dealer_listings l
    join grp g on g.id = l.dealer_id,
         lateral (select regexp_replace(translate(upper(coalesce(l.brand, '')), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝŠŽ', 'AAAAAACEEEEIIIINOOOOOOUUUUYSZ'), '[^A-Z0-9]', '', 'g') as k) x
    where l.last_seen_at >= now() - interval '60 days'
  ),
  stats as (
    select r.root, count(*) as n,
           count(*) filter (where r.bk = any(coalesce(p_brand_keys, '{}')))
           + count(*) filter (where r.bk = any(coalesce(p_van_keys, '{}')) and r.vehicle_type ~* '(van|utilit|transport|bestel|kasten|furg|camion)') as hits
    from recent r group by r.root
  )
  select d.id, s.hits::integer, s.n::integer
  from public.market_dealers d
  join stats s on s.root = d.id
  where d.parent_id is null
    and (coalesce(cardinality(p_countries), 0) = 0 or d.country = any(p_countries))
    and s.hits > 0
    and not exists (select 1 from public.agent_prospects p join grp g on g.id = p.dealer_id where g.root = d.id)
    and not exists (select 1 from grp g join clients c on (c.nk <> '' and c.nk = g.nk) or (length(c.pk) = 9 and c.pk = g.pk) where g.root = d.id)
    and not exists (select 1 from grp g join network n on (n.nk <> '' and n.nk = g.nk) or (length(n.pk) = 9 and n.pk = g.pk) where g.root = d.id)
  order by s.hits desc, s.n desc, d.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;
revoke all on function public.agents_qualify_candidates(text[], text[], text[], integer) from public, anon, authenticated;
grant execute on function public.agents_qualify_candidates(text[], text[], text[], integer) to service_role;

-- 6. Rapprochement de l'annuaire déjà constitué ------------------------------------------------
select public.agents_link_dealers(null);

-- 7. Vérification ------------------------------------------------------------------
select exists (select 1 from information_schema.columns where table_name = 'market_dealers' and column_name = 'parent_id')
   and exists (select 1 from information_schema.columns where table_name = 'market_dealers' and column_name = 'name_key')
   and public.ada_dealer_key('Van Happen Auto''s B.V.') = public.ada_dealer_key('Van Happen Autos BV')
   and public.ada_dealer_key('Autobedrijf P. Troost & Zonen') = 'ptroost'
   and public.ada_web_key('https://www.tesselaarbv.nl/occasions/toyota') = 'tesselaarbv.nl'
   and public.ada_web_key('https://www.autoscout24.nl/garages/x') = ''
   and public.ada_zip_key('1234 ab') = '1234AB'
   and not has_function_privilege('authenticated', 'public.agents_link_dealers(uuid[])', 'execute')
   and not has_function_privilege('authenticated', 'public.agents_record_dealers(jsonb)', 'execute') as tout_est_bon;
