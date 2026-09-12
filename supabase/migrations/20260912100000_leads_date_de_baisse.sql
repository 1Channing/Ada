-- ═══════════════════════════════════════════════════════════════════════════
-- LEADS — DATE RÉELLE DE LA BAISSE (12/09/2026, constat Channing : « je
-- n'avais pas 19 leads à traiter ce matin »). Le compteur Équipe datait une
-- baisse par `last_seen_at`, or le worker retouche last_seen_at À CHAQUE
-- vague où l'annonce est revue : une baisse d'il y a huit jours, déjà
-- traitée, ressortait comme lead « du jour » tant que l'annonce restait en
-- ligne. Nouvelle colonne `dropped_at` : posée par le worker au moment où
-- la baisse FAIT RENTRER l'annonce dans la boîte, jamais retouchée ensuite.
-- Un lead compte UNE fois, à la date du dernier événement qui l'a mis dans
-- la boîte : dropped_at, sinon first_seen_at. (Anciennes baisses sans
-- dropped_at : datées de leur première vue — transitoire, plus jamais
-- « du jour ».) Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.daily_search_hits
  add column if not exists dropped_at timestamptz;

drop function if exists public.admin_list_daily_leads(integer);
create or replace function public.admin_list_daily_leads(p_days integer default 14)
returns table (
  id uuid,
  user_id uuid,
  owner_name text,
  search_id uuid,
  search_label text,
  listing_url text,
  title text,
  price integer,
  previous_price integer,
  target_median integer,
  price_gap integer,
  site text,
  kind text,
  status text,
  resolution text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  dropped_at timestamptz,
  lead_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.user_id,
         coalesce(nullif(trim(pr.display_name), ''), split_part(u.email, '@', 1)) as owner_name,
         h.search_id, s.label,
         h.listing_url, h.title, h.price, h.previous_price, h.target_median, h.price_gap,
         h.site, h.kind, h.status, h.resolution, h.first_seen_at, h.last_seen_at,
         h.dropped_at,
         coalesce(h.dropped_at, h.first_seen_at) as lead_at
  from public.daily_search_hits h
  join public.daily_searches s on s.id = h.search_id
  left join public.profiles pr on pr.id = h.user_id
  left join auth.users u on u.id = h.user_id
  where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
    and h.kind <> 'seed'
    and (h.status in ('inbox', 'saved', 'cleared') or (h.status = 'dismissed' and h.resolution is not null))
    and coalesce(h.dropped_at, h.first_seen_at) >= now() - make_interval(days => greatest(1, least(90, p_days)))
  order by coalesce(h.dropped_at, h.first_seen_at) desc
  limit 5000;
$$;
revoke all on function public.admin_list_daily_leads(integer) from public, anon;
grant execute on function public.admin_list_daily_leads(integer) to authenticated;

select 'ok' as tout_est_bon;
