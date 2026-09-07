-- ═══════════════════════════════════════════════════════════════════════════
-- ALERTES DE CAPACITÉ (07/09/2026, règle Channing : « pose des alertes
-- visibles si ce genre de limites sont atteintes, je ne serai pas toujours
-- là pour m'en rendre compte »). Chaque lecture plafonnée d'ADA (front et
-- worker) signale ici quand elle touche son plafond : une ligne par clé,
-- compteur de touches, dernière touche, acquittement. Bandeau rouge sur
-- toutes les pages tant que non acquittée, reprise dans « Ce matin ».
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.capacity_alerts (
  key text primary key,
  message text not null,
  limit_value integer,
  hits integer not null default 1,
  first_hit_at timestamptz not null default now(),
  hit_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid
);

alter table public.capacity_alerts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'capacity_alerts' and policyname = 'capacity_alerts_select') then
    create policy "capacity_alerts_select" on public.capacity_alerts for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'capacity_alerts' and policyname = 'capacity_alerts_ack') then
    create policy "capacity_alerts_ack" on public.capacity_alerts for update to authenticated using (true) with check (true);
  end if;
end $$;
grant select, update on public.capacity_alerts to authenticated;

-- Une touche : création ou incrément, et l'alerte se RÉ-OUVRE si elle avait
-- été acquittée (le plafond est de nouveau atteint = nouveau fait).
create or replace function public.capacity_hit(p_key text, p_message text, p_limit integer)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.capacity_alerts (key, message, limit_value)
  values (p_key, p_message, p_limit)
  on conflict (key) do update set
    message = excluded.message,
    limit_value = excluded.limit_value,
    hits = public.capacity_alerts.hits + 1,
    hit_at = now(),
    acknowledged_at = null,
    acknowledged_by = null;
$$;
revoke all on function public.capacity_hit(text, text, integer) from public, anon;
grant execute on function public.capacity_hit(text, text, integer) to authenticated, service_role;

select 'ok' as tout_est_bon;
