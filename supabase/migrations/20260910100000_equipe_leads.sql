-- ═══════════════════════════════════════════════════════════════════════════
-- ÉQUIPE — LEADS du Workflow par compte (10/09/2026, demande Channing :
-- « afficher et actualiser tous les jours les nouveaux leads apparus dans
-- les résultats du workflow par utilisateur »).
-- Un LEAD = une annonce entrée dans la boîte d'une étude (nouvelle ou baisse
-- dans l'écart) : à traiter, poussée en négociation, ou traitée avec motif.
-- Les « vues hors écart » (écartées sans motif) n'ont jamais été montrées :
-- pas des leads. Lecture admin, security definer (les résultats des autres
-- sont sous RLS). Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

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
  last_seen_at timestamptz
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
         h.site, h.kind, h.status, h.resolution, h.first_seen_at, h.last_seen_at
  from public.daily_search_hits h
  join public.daily_searches s on s.id = h.search_id
  left join public.profiles pr on pr.id = h.user_id
  left join auth.users u on u.id = h.user_id
  where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
    and h.kind <> 'seed'
    and (h.status in ('inbox', 'saved', 'cleared') or (h.status = 'dismissed' and h.resolution is not null))
    and greatest(h.first_seen_at, case when h.kind = 'price_drop' then h.last_seen_at else h.first_seen_at end)
        >= now() - make_interval(days => greatest(1, least(90, p_days)))
  order by greatest(h.first_seen_at, case when h.kind = 'price_drop' then h.last_seen_at else h.first_seen_at end) desc
  limit 5000;
$$;
revoke all on function public.admin_list_daily_leads(integer) from public, anon;
grant execute on function public.admin_list_daily_leads(integer) to authenticated;

select 'ok' as tout_est_bon;
