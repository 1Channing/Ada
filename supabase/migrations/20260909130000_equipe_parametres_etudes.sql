-- ═══════════════════════════════════════════════════════════════════════════
-- ÉQUIPE — paramètres complets des études des autres comptes (09/09/2026,
-- demande Channing : « regarder les paramètres des recherches des autres »).
-- La RPC admin rend désormais TOUS les critères (années, km, finitions,
-- boîte, puissance, écart voulu, heure). Additif ; signature changée →
-- drop + create (même nom, mêmes droits). Réservé aux admins.
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
  created_at timestamptz,
  year_min integer,
  year_max integer,
  mileage_max integer,
  "trim" text,
  trim_target text,
  gearbox text,
  power_min integer,
  price_gap_min integer,
  price_gap_max integer,
  run_hour integer
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.user_id, s.label, s.brand, s.model,
         s.source_country, s.target_country, s.fuel,
         coalesce(s.vehicle_type, ''), s.active, s.last_run_at, s.created_at,
         s.year_min, s.year_max, s.mileage_max,
         coalesce(s.trim, ''), coalesce(s.trim_target, ''),
         coalesce(s.gearbox, ''), s.power_min,
         s.price_gap_min, s.price_gap_max, s.run_hour
  from public.daily_searches s
  where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
  order by s.created_at desc;
$$;

grant execute on function public.admin_list_daily_searches() to authenticated;

select 'ok' as tout_est_bon;
