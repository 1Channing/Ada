-- ═══════════════════════════════════════════════════════════════════════════
-- ÉQUIPE : activité par compte (31/08/2026) — demande Channing : voir sur la
-- page Équipe les ÉTUDES QUOTIDIENNES et les NÉGOCIATIONS EN COURS de chaque
-- membre, notes comprises. Les tables sont cloisonnées par RLS (chacun ses
-- lignes) : la porte admin est une RPC security definer qui vérifie is_admin,
-- même patron que admin_list_accounts. Idempotent (drop + recréation).
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.admin_list_daily_searches();

create function public.admin_list_daily_searches()
returns table (
  id uuid,
  user_id uuid,
  label text,
  brand text,
  model text,
  source_country text,
  target_country text,
  fuel text,
  vehicle_type text,
  active boolean,
  last_run_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.user_id, s.label, s.brand, s.model,
         s.source_country, s.target_country, s.fuel,
         coalesce(s.vehicle_type, ''), s.active, s.last_run_at, s.created_at
  from public.daily_searches s
  where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
  order by s.created_at desc;
$$;

grant execute on function public.admin_list_daily_searches() to authenticated;

drop function if exists public.admin_list_negotiations();

create function public.admin_list_negotiations()
returns table (
  id uuid,
  user_id uuid,
  title text,
  listing_url text,
  asking_price numeric,
  negotiated_price numeric,
  status text,
  notes text,
  updated_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select n.id, n.user_id, n.title, n.listing_url,
         n.asking_price::numeric, n.negotiated_price::numeric, n.status, n.notes,
         n.updated_at, n.created_at
  from public.negotiations n
  where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
  order by n.updated_at desc;
$$;

grant execute on function public.admin_list_negotiations() to authenticated;

select 'ok' as tout_est_bon;
