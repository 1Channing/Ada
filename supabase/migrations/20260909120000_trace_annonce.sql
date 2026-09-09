-- ═══════════════════════════════════════════════════════════════════════════
-- « VÉRIFIER UNE ANNONCE » (09/09/2026, question Channing : « Antoine n'a pas
-- eu cette caisse dans son étude, moi oui »). Une URL d'annonce → une ligne
-- par étude quotidienne : l'étude l'a-t-elle VUE (statut, motif, prix, écart,
-- première/dernière vue) et sous quels critères (années, km, écart voulu).
-- Admin : toutes les études de l'équipe ; sinon les siennes seulement.
-- Lecture seule, security definer (les annonces des autres sont sous RLS).
-- Additif, idempotent. (« trim » est un mot réservé : colonne quotée.)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.trace_listing_url(p_url text)
returns table (
  search_id uuid,
  search_label text,
  owner_id uuid,
  owner_name text,
  brand text,
  model text,
  "trim" text,
  source_country text,
  target_country text,
  year_min integer,
  year_max integer,
  mileage_max integer,
  price_gap_min integer,
  price_gap_max integer,
  active boolean,
  last_run_at timestamptz,
  seen boolean,
  status text,
  resolution text,
  kind text,
  price integer,
  previous_price integer,
  target_median integer,
  price_gap integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id, coalesce(p.is_admin, false) as is_admin from public.profiles p where p.id = auth.uid()
  ),
  url as (select trim(p_url) as u)
  select
    s.id, s.label, s.user_id,
    coalesce(nullif(trim(pr.display_name), ''), split_part(u.email, '@', 1)) as owner_name,
    s.brand, s.model, s.trim, s.source_country, s.target_country,
    s.year_min, s.year_max, s.mileage_max, s.price_gap_min, s.price_gap_max,
    s.active, s.last_run_at,
    (h.id is not null) as seen,
    h.status, h.resolution, h.kind, h.price, h.previous_price, h.target_median, h.price_gap,
    h.first_seen_at, h.last_seen_at
  from public.daily_searches s
  cross join me
  cross join url
  left join public.daily_search_hits h on h.search_id = s.id and h.listing_url = url.u
  left join public.profiles pr on pr.id = s.user_id
  left join auth.users u on u.id = s.user_id
  where me.id is not null and (me.is_admin or s.user_id = me.id)
  order by (h.id is not null) desc, s.label;
$$;
revoke all on function public.trace_listing_url(text) from public, anon;
grant execute on function public.trace_listing_url(text) to authenticated;

select 'ok' as tout_est_bon;
