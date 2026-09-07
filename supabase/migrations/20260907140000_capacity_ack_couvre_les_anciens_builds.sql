-- ═══════════════════════════════════════════════════════════════════════════
-- ALERTES DE CAPACITÉ — l'acquittement TIENT (07/09/2026, constat Channing :
-- « j'ai toujours l'alerte » après « Traité »). Cause : un onglet encore sur
-- l'ANCIEN build (celui qui plafonnait) retouchait la clé au rechargement et
-- rouvrait l'alerte, alors que le correctif était déjà déployé.
-- Règle : « Traité » couvre tout code construit AVANT l'acquittement. Une
-- touche venant d'un build antérieur est comptée (hits) mais ne rouvre pas ;
-- seule une touche d'un build postérieur — le plafond est atteint par le
-- code corrigé, fait nouveau — rouvre l'alerte. Sans build connu (appelant
-- ancien), comportement d'origine : réouverture.
-- Additif, idempotent. La signature à 3 arguments reste servie.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.capacity_hit(p_key text, p_message text, p_limit integer, p_build timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ack timestamptz;
begin
  select acknowledged_at into v_ack from public.capacity_alerts where key = p_key;
  if not found then
    insert into public.capacity_alerts (key, message, limit_value) values (p_key, p_message, p_limit);
    return;
  end if;
  if v_ack is not null and p_build is not null and p_build <= v_ack then
    -- Touche d'un build couvert par l'acquittement : comptée, pas rouverte.
    update public.capacity_alerts
      set hits = hits + 1, hit_at = now()
      where key = p_key;
    return;
  end if;
  update public.capacity_alerts
    set message = p_message, limit_value = p_limit,
        hits = hits + 1, hit_at = now(),
        acknowledged_at = null, acknowledged_by = null
    where key = p_key;
end;
$$;

create or replace function public.capacity_hit(p_key text, p_message text, p_limit integer)
returns void
language sql
security definer
set search_path = public
as $$
  select public.capacity_hit(p_key, p_message, p_limit, null::timestamptz);
$$;

revoke all on function public.capacity_hit(text, text, integer, timestamptz) from public, anon;
grant execute on function public.capacity_hit(text, text, integer, timestamptz) to authenticated, service_role;
revoke all on function public.capacity_hit(text, text, integer) from public, anon;
grant execute on function public.capacity_hit(text, text, integer) to authenticated, service_role;

select 'ok' as tout_est_bon;
