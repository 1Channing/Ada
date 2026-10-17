/*
  # Ada et Dana — les comptes (17/10, Channing : « Ada & Dana ne sont pas là
  #   pour le day to day business, mais pour le scaler… des fournisseurs et
  #   des acheteurs long terme » ; grands comptes : « elles préparent, vous
  #   envoyez » ; « publiées seulement + LinkedIn »)

  - agent_prospects : une fiche par agente et par garage (le même garage peut
    être un acheteur pour Ada et un fournisseur pour Dana) ; grand compte
    (groupe, loueur, leasing, flotte, gros négociant) et nature du compte ;
    les lots vus chez lui quand Dana l'a qualifié.
  - agent_messages : « pour vous » — ce qu'une agente prépare pour un grand
    compte et que vous envoyez vous-même (votre boîte Gmail, votre LinkedIn) :
    pour_channing → envoye_main (marqué envoyé, par un administrateur) ou
    refuse ; repasser en brouillon pour l'envoyer depuis la boîte de l'agente.
    Marqué envoyé : le fil et le prospect avancent (« contacté »).
  - Dana : réglages de départ, une seule fois (lots de 3, pays de vente
    NL / DK / BE / DE, 20 garages qualifiés et 5 premiers mails par jour au
    plus, 3 $ par jour) — toujours à valider.
  - agents_dealer_lots() : aussi pour un seul garage, lisible par le worker,
    avec la fiche de Dana ; agents_qualify_candidates() : les fiches d'Ada
    seulement.
  Additif, idempotent. À coller après agents_lots.
*/

-- 1. Une fiche par agente et par garage ---------------------------------------------------
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.agent_prospects'::regclass and contype = 'u'
              and pg_get_constraintdef(oid) = 'UNIQUE (dealer_id)'
  loop
    execute format('alter table public.agent_prospects drop constraint %I', c);
  end loop;
end $$;
create unique index if not exists agent_prospects_agent_dealer_key on public.agent_prospects (agent, dealer_id);
alter table public.agent_prospects
  add column if not exists key_account boolean not null default false,
  add column if not exists account_kind text,
  add column if not exists lots jsonb not null default '[]'::jsonb;
create index if not exists idx_agent_prospects_group on public.agent_prospects (agent, lower(group_name)) where group_name is not null;

-- 2. Les messages « pour vous » ----------------------------------------------------------
alter table public.agent_messages drop constraint if exists agent_messages_status_check;
alter table public.agent_messages add constraint agent_messages_status_check
  check (status in ('brouillon', 'a_valider', 'valide', 'envoi', 'envoye', 'echec', 'refuse', 'recu', 'pour_channing', 'envoye_main'));

create or replace function public.agent_messages_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    -- Un message part TOUJOURS de la boîte de son agente, dans un fil de cette boîte :
    -- personne n'écrit au nom d'une autre adresse de mc-export.com.
    if new.mailbox is distinct from (select s.mailbox from public.agent_settings s where s.agent = new.agent)
       or not exists (select 1 from public.agent_threads t where t.id = new.thread_id and t.agent = new.agent and t.mailbox = new.mailbox) then
      raise exception 'Boîte ou fil sans rapport avec l''agente %', new.agent;
    end if;
    if new.direction = 'in' and not v_service then
      raise exception 'Seul le worker enregistre les mails reçus';
    end if;
    if new.direction = 'out' and new.status not in ('brouillon', 'a_valider', 'valide') and not v_service then
      raise exception 'Un nouveau message part en brouillon, à valider ou validé';
    end if;
    if new.direction = 'out' and new.status = 'valide' and not v_service and not public.ada_is_admin() then
      raise exception 'Seul un administrateur valide un envoi';
    end if;
  else
    if new.thread_id is distinct from old.thread_id or new.direction is distinct from old.direction
       or new.agent is distinct from old.agent or new.mailbox is distinct from old.mailbox then
      raise exception 'Fil, sens et boîte d''un message ne changent pas';
    end if;
    if new.direction = 'in' and not v_service
       and (new.body_text is distinct from old.body_text or new.subject is distinct from old.subject
            or new.from_email is distinct from old.from_email or new.status is distinct from old.status) then
      raise exception 'Un mail reçu ne se modifie pas (seul son classement change)';
    end if;
    if new.direction = 'out' and new.status is distinct from old.status then
      if not (
        (old.status = 'brouillon' and new.status in ('a_valider', 'valide'))
        or (old.status = 'a_valider' and new.status in ('brouillon', 'valide', 'refuse'))
        or (old.status = 'valide' and new.status in ('brouillon', 'refuse', 'envoi', 'echec'))
        or (old.status = 'envoi' and new.status in ('envoye', 'echec'))
        or (old.status in ('echec', 'refuse') and new.status = 'brouillon')
        -- Préparé pour vous (grand compte) : vous l'envoyez vous-même, vous l'écartez,
        -- ou vous le repassez en brouillon pour la boîte de l'agente.
        or (old.status = 'pour_channing' and new.status in ('envoye_main', 'refuse', 'brouillon'))
      ) then
        raise exception 'Passage refusé : % → %', old.status, new.status;
      end if;
      if new.status in ('envoi', 'envoye') and not v_service then
        raise exception 'Seul le worker envoie';
      end if;
      -- Copilote : c'est un administrateur MC Export qui valide ce qui part.
      if new.status = 'valide' and not v_service and not public.ada_is_admin() then
        raise exception 'Seul un administrateur valide un envoi';
      end if;
      if new.status = 'envoye_main' and not v_service and not public.ada_is_admin() then
        raise exception 'Seul un administrateur marque un message comme envoyé';
      end if;
    end if;
    -- Validé, en cours d'envoi ou envoyé : le contenu ne bouge plus.
    if old.direction = 'out' and old.status in ('valide', 'envoi', 'envoye', 'envoye_main') and new.status not in ('brouillon', 'refuse')
       and (new.to_emails is distinct from old.to_emails or new.cc_emails is distinct from old.cc_emails
            or new.subject is distinct from old.subject or new.body_text is distinct from old.body_text
            or new.attachments is distinct from old.attachments) then
      raise exception 'Message déjà validé : le repasser en brouillon pour le modifier';
    end if;
  end if;
  if new.direction = 'out' then
    if new.status = 'valide' and (tg_op = 'INSERT' or old.status is distinct from 'valide') then
      new.approved_at := now();
      new.approved_by := coalesce(auth.uid(), new.approved_by);
      new.content_hash := public.agent_message_hash(new.to_emails, new.cc_emails, new.subject, new.body_text, new.attachments);
    elsif new.status = 'envoye_main' and (tg_op = 'INSERT' or old.status is distinct from 'envoye_main') then
      new.approved_at := now();
      new.approved_by := coalesce(auth.uid(), new.approved_by);
      new.sent_at := coalesce(new.sent_at, now());
    elsif new.status in ('brouillon', 'a_valider', 'refuse', 'pour_channing') then
      new.approved_at := null;
      new.approved_by := null;
      new.content_hash := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_agent_messages_guard on public.agent_messages;
create trigger trg_agent_messages_guard before insert or update on public.agent_messages
  for each row execute function public.agent_messages_guard();

/** Journal des gestes sur les messages (humains comme worker). */
create or replace function public.agent_messages_journal()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_who text := case when auth.uid() is not null then 'humain'
                     when new.status in ('envoye', 'echec', 'recu') then 'systeme'
                     else new.author end;
  v_to text := coalesce(nullif(array_to_string(new.to_emails, ', '), ''), case when new.channel = 'linkedin' then 'LinkedIn' else '' end);
  v_kind text;
  v_summary text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  v_kind := case new.status
    when 'recu' then 'mail_recu'
    when 'brouillon' then 'mail_brouillon'
    when 'a_valider' then 'mail_a_valider'
    when 'valide' then 'mail_valide'
    when 'refuse' then 'mail_refuse'
    when 'envoye' then 'mail_envoye'
    when 'echec' then 'mail_echec'
    when 'pour_channing' then 'pour_vous'
    when 'envoye_main' then 'envoye_par_vous'
    else null end;
  if v_kind is null then
    return new;
  end if;
  v_summary := case new.status
    when 'recu' then 'Mail reçu de ' || coalesce(nullif(new.from_name, ''), new.from_email, '?') || ' : « ' || new.subject || ' »'
    when 'brouillon' then 'Brouillon : « ' || new.subject || ' » → ' || v_to
    when 'a_valider' then 'À valider : « ' || new.subject || ' » → ' || v_to
    when 'valide' then 'Validé : « ' || new.subject || ' » → ' || v_to
    when 'refuse' then 'Refusé : « ' || new.subject || ' »' || coalesce(' — ' || nullif(new.refused_reason, ''), '')
    when 'envoye' then 'Envoyé : « ' || new.subject || ' » → ' || v_to
    when 'echec' then 'Échec d''envoi : « ' || new.subject || ' » — ' || coalesce(new.error, '?')
    when 'pour_channing' then 'Préparé pour vous (grand compte, ' || case when new.channel = 'linkedin' then 'LinkedIn' else 'mail' end || ') : « ' || new.subject || ' » → ' || v_to
    when 'envoye_main' then 'Envoyé par vous (' || case when new.channel = 'linkedin' then 'LinkedIn' else 'mail' end || ') : « ' || new.subject || ' » → ' || v_to
  end;
  insert into public.agent_journal (agent, actor, actor_id, kind, summary, thread_id, message_id)
  values (new.agent, v_who, auth.uid(), v_kind, left(v_summary, 500), new.thread_id, new.id);
  return new;
end;
$$;
drop trigger if exists trg_agent_messages_journal on public.agent_messages;
create trigger trg_agent_messages_journal after insert or update on public.agent_messages
  for each row execute function public.agent_messages_journal();

/** Marqué envoyé par vous : le fil et le prospect avancent comme pour un envoi du worker. */
create or replace function public.agent_messages_manual_sent()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'envoye_main' and old.status is distinct from 'envoye_main' then
    update public.agent_threads set last_message_at = now(), last_direction = 'out' where id = new.thread_id;
    update public.agent_prospects p set stage = 'contacte', updated_at = now()
      from public.agent_threads t
     where t.id = new.thread_id and p.id = t.prospect_id and p.stage in ('qualifie', 'a_contacter');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_agent_messages_manual_sent on public.agent_messages;
create trigger trg_agent_messages_manual_sent after update of status on public.agent_messages
  for each row execute function public.agent_messages_manual_sent();

-- 3. Dana : réglages de départ (une seule fois : cibles encore vides) --------------------
update public.agent_settings
   set targets = '{"minLot": 3, "markets": ["NL", "DK", "BE", "DE"]}'::jsonb,
       auto_qualify_per_day = 20, auto_draft_per_day = 5, daily_budget_usd = 3, map_auto_add = true
 where agent = 'dana' and targets = '{}'::jsonb;

-- 4. Les lots : un seul garage, le worker, la fiche de Dana ---------------------------------
drop function if exists public.agents_dealer_lots(text, text[], integer, integer, text, integer);
create or replace function public.agents_dealer_lots(
  p_country text default null, p_markets text[] default null, p_min integer default 3,
  p_days integer default 45, p_brand text default null, p_limit integer default 200, p_dealer uuid default null)
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
    where ((select public.ada_can_drive_agents()) or coalesce(auth.jwt() ->> 'role', '') = 'service_role')
      and (p_country is null or d.country = upper(p_country))
      and (p_dealer is null or l.root = p_dealer)
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
    'prospect', (select jsonb_build_object('id', p.id, 'dealer_id', p.dealer_id, 'stage', p.stage, 'score', p.score, 'key_account', p.key_account,
                                           'email', p.best_contact->>'email', 'qualified_at', p.qualified_at)
                 from public.agent_prospects p
                 where p.agent = 'dana' and p.dealer_id in (select m2.id from public.market_dealers m2 where m2.id = d.id or m2.parent_id = d.id)
                 order by p.qualified_at desc nulls last limit 1),
    'markets', (select coalesce(jsonb_agg(jsonb_build_object('market', lm.market, 'n', lm.n, 'median', lm.median, 'gap', lm.median - round(t.price_median))
                                          order by lm.median - round(t.price_median) desc), '[]'::jsonb)
                from lot_markets lm
                where lm.root = t.root and lm.brand_key = t.brand_key and lm.model_key = t.model_key and lm.year = t.year)
  )
  from top_lots t
  join public.market_dealers d on d.id = t.root
  order by t.n desc, t.last_seen_at desc;
$$;
revoke all on function public.agents_dealer_lots(text, text[], integer, integer, text, integer, uuid) from public, anon;
grant execute on function public.agents_dealer_lots(text, text[], integer, integer, text, integer, uuid) to authenticated, service_role;

-- 5. Les candidats d'Ada : un garage déjà fiché par Dana (fournisseur) reste un acheteur possible --
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
    and not exists (select 1 from public.agent_prospects p join grp g on g.id = p.dealer_id where g.root = d.id and p.agent = 'ada')
    and not exists (select 1 from grp g join clients c on (c.nk <> '' and c.nk = g.nk) or (length(c.pk) = 9 and c.pk = g.pk) where g.root = d.id)
    and not exists (select 1 from grp g join network n on (n.nk <> '' and n.nk = g.nk) or (length(n.pk) = 9 and n.pk = g.pk) where g.root = d.id)
  order by s.hits desc, s.n desc, d.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;
revoke all on function public.agents_qualify_candidates(text[], text[], text[], integer) from public, anon, authenticated;
grant execute on function public.agents_qualify_candidates(text[], text[], text[], integer) to service_role;

-- 6. Vérification ------------------------------------------------------------------
select exists (select 1 from information_schema.columns where table_name = 'agent_prospects' and column_name = 'key_account')
   and exists (select 1 from pg_indexes where indexname = 'agent_prospects_agent_dealer_key')
   and not exists (select 1 from pg_constraint where conrelid = 'public.agent_prospects'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (dealer_id)')
   and exists (select 1 from pg_constraint where conname = 'agent_messages_status_check' and pg_get_constraintdef(oid) like '%pour_channing%')
   and has_function_privilege('service_role', 'public.agents_dealer_lots(text, text[], integer, integer, text, integer, uuid)', 'execute')
   and (select targets ? 'minLot' from public.agent_settings where agent = 'dana') as tout_est_bon;
