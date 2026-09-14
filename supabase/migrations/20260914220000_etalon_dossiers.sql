-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTALON HUMAIN → DOSSIERS DE VÉRITÉ (question Channing 14/09 : « comment la
-- correction se fait-elle ? faut-il que je te demande de tout vérifier ? »).
-- Non : chaque ligne d'étalon enregistrée avec un ÉCART (ADA < 90 % de
-- l'humain, ou ADA > humain) ouvre d'elle-même un dossier « etalon_ecart »
-- dans Doutes remarqués, avec les deux comptes et les deux URLs. Le moteur
-- de diagnostic du worker compare les URLs (critère présent chez l'humain,
-- absent chez ADA) et propose la cause ; l'écart résorbé referme le dossier.
-- Lecture anon de l'étalon : le rituel de relecture des logs peut le lire.
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'truth_benchmarks' and policyname = 'anon_select_truth_benchmarks') then
    create policy "anon_select_truth_benchmarks" on public.truth_benchmarks for select to anon using (true);
  end if;
end $$;

create or replace function public.truth_benchmark_report(p_benchmark uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.truth_benchmarks%rowtype;
  s record;
  existing uuid;
  gap_pct integer;
  has_gap boolean;
  v_summary text;
  v_details jsonb;
begin
  select * into b from public.truth_benchmarks where id = p_benchmark;
  if not found or auth.uid() is null then return 'none'; end if;
  select id, label, brand, model, fuel into s from public.daily_searches where id = b.search_id;
  select d.id into existing from public.truth_dossiers d
   where d.signal = 'etalon_ecart' and d.resolved_at is null and d.details->>'benchmark_id' = p_benchmark::text
   limit 1;

  has_gap := b.human_count is not null and b.human_count > 0
             and (b.ada_count is null or b.ada_count < 0.9 * b.human_count or b.ada_count > b.human_count);

  if not has_gap then
    if existing is not null then
      update public.truth_dossiers
         set status = 'verified', resolved_at = now(), last_seen_at = now(),
             summary = format('Écart résorbé : ADA %s vs humain %s (%s, semaine %s)', coalesce(b.ada_count::text, '—'), b.human_count, b.site, b.week)
       where id = existing;
      return 'resolved';
    end if;
    return 'none';
  end if;

  gap_pct := least(100, round(100.0 * abs(coalesce(b.ada_count, 0) - b.human_count) / b.human_count))::integer;
  v_summary := format('Étalon %s : ADA %s vs humain %s sur %s (%s) — %s',
                      b.week, coalesce(b.ada_count::text, '—'), b.human_count, b.site, b.side,
                      case when b.ada_count is null then 'aucun relevé ADA'
                           when b.ada_count > b.human_count then 'ADA voit PLUS que l''humain (mapping trop large ?)'
                           else format('ADA ne voit que %s %%', round(100.0 * b.ada_count / b.human_count)) end);
  v_details := jsonb_build_object(
    'benchmark_id', p_benchmark::text, 'week', b.week, 'study', coalesce(s.label, b.search_label),
    'segment_key', 'study:' || b.search_id::text, 'side', b.side,
    'ada_count', b.ada_count, 'human_count', b.human_count, 'ada_url', b.ada_url, 'human_url', b.human_url,
    'ada_at', b.ada_at, 'note', b.note, 'filled_at', b.filled_at);

  if existing is not null then
    update public.truth_dossiers
       set doubt_score = gap_pct, summary = v_summary, details = v_details, last_seen_at = now(), status = 'detected'
     where id = existing;
    return 'updated';
  end if;

  insert into public.truth_dossiers (site, country, brand, model, fuel, signal, layer, doubt_score, priority, status, summary, details, first_detected_at, last_seen_at)
  values (b.site, b.country, coalesce(s.brand, ''), coalesce(s.model, ''), coalesce(s.fuel, ''), 'etalon_ecart', 'etalon',
          gap_pct, 1, 'detected', v_summary, v_details, now(), now());
  return 'opened';
end;
$$;
revoke all on function public.truth_benchmark_report(uuid) from public, anon;
grant execute on function public.truth_benchmark_report(uuid) to authenticated;

select 'ok' as tout_est_bon;
