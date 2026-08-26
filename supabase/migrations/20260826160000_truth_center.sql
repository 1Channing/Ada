/*
  TRUTH CENTER — BRIQUE 1 (validée Channing 26/08) : balayage automatique
  + dossiers de vérité. AUCUN scrape ajouté — tout est calculé depuis les
  données déjà en base (snapshots + observations chaudes).

  - truth_config   : seuils CONFIGURABLES (jamais de logique figée — §7/§24
    du plan) ; modifier une ligne suffit, pas de redéploiement.
  - truth_dossiers : un dossier par (segment, signal), upserté à chaque
    balayage — score de doute, couche fautive présumée, priorité par usage
    réel (1 = étude quotidienne active), statuts simples V1.
  - truth_evidence : preuves humaines horodatées (profondeur observée,
    conformité champ par champ, URL manuelle) — remplie par la brique 2 (UI).
  - truth_sweep()  : le balayage — service_role uniquement, appelé par le
    worker après la vague quotidienne. Signaux V1 : variation/zéro de
    profondeur, pollution du sample, médiane aberrante, chute de complétude.

  Le worker ouvre AUSSI des dossiers en direct (signaux 'dictionnaire' et
  'url_incomplete') quand une étude quotidienne ne peut pas générer une URL
  complète — c'est la file de résorption des trous marques/modèles.

  RÉPARATION incluse (constat 26/08 soir) : les tables mi_dashboard_* sont
  invisibles pour les clés publiques (RLS activé sans politiques — vraisem-
  blablement le Security Advisor Supabase) → le MI retombait en silence sur
  les fonctions de repli. On pose des politiques de lecture explicites et on
  re-remplit. Idempotent dans tous les cas.
*/

-- ── 0. RÉPARATION étage 1 : lecture des tables mi_dashboard_* ───────────────
alter table mi_dashboard_dimensions enable row level security;
alter table mi_dashboard_medians    enable row level security;
alter table mi_dashboard_meta       enable row level security;
do $$ begin
  create policy "anon_select_mi_dd" on mi_dashboard_dimensions for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth_select_mi_dd" on mi_dashboard_dimensions for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon_select_mi_dm" on mi_dashboard_medians for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth_select_mi_dm" on mi_dashboard_medians for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon_select_mi_dmeta" on mi_dashboard_meta for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth_select_mi_dmeta" on mi_dashboard_meta for select to authenticated using (true);
exception when duplicate_object then null; end $$;
grant select on mi_dashboard_dimensions, mi_dashboard_medians, mi_dashboard_meta to anon, authenticated;
select mi_refresh_dashboards();

-- ── 1. Seuils configurables ─────────────────────────────────────────────────
create table if not exists truth_config (
  key text primary key,
  value numeric not null,
  description text not null default ''
);
alter table truth_config enable row level security;
do $$ begin
  create policy "auth_select_truth_config" on truth_config for select to authenticated using (true);
exception when duplicate_object then null; end $$;
grant select on truth_config to authenticated;

insert into truth_config (key, value, description) values
  ('depth_variation_pct', 50, 'Écart % vs médiane historique qui ouvre un dossier profondeur'),
  ('depth_min_history',   20, 'Profondeur historique minimale pour que la variation compte'),
  ('pollution_pct',       25, '% d''annonces hors segment qui ouvre un dossier pollution'),
  ('median_ratio',         2, 'Facteur (x ou /) vs médiane historique qui ouvre un dossier prix'),
  ('completeness_drop_pts', 30, 'Chute (points de %) de complétude d''un champ qui ouvre un dossier'),
  ('min_sample',          20, 'Taille minimale d''échantillon pour juger un signal')
on conflict (key) do nothing;

-- ── 2. Les dossiers de vérité ───────────────────────────────────────────────
create table if not exists truth_dossiers (
  id uuid primary key default gen_random_uuid(),
  site text not null default '',
  country text not null default '',
  brand text not null default '',
  model text not null default '',
  fuel text not null default '',
  signal text not null,
  -- Couche fautive PRÉSUMÉE : dictionnaire | url | parsing | canonicalisation
  -- | profondeur | inconnue — le diagnostic, pas le verdict.
  layer text not null default 'inconnue',
  doubt_score numeric not null default 0,
  -- 1 = segment d'une étude quotidienne ACTIVE (impact business direct).
  priority int not null default 2,
  -- detected → needs_evidence → verified | accepted_variance | obsolete
  status text not null default 'detected',
  summary text not null default '',
  details jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (site, country, brand, model, fuel, signal)
);
create index if not exists idx_truth_dossiers_open
  on truth_dossiers (status, priority, doubt_score desc);

alter table truth_dossiers enable row level security;
do $$ begin
  create policy "auth_select_truth_dossiers" on truth_dossiers for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth_update_truth_dossiers" on truth_dossiers for update to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
grant select on truth_dossiers to authenticated;
-- L'UI (brique 2) ne change que le statut ; le reste appartient au balayage.
grant update (status, resolved_at) on truth_dossiers to authenticated;

-- ── 3. Les preuves humaines (remplies par la brique 2) ──────────────────────
create table if not exists truth_evidence (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references truth_dossiers(id) on delete cascade,
  kind text not null,                    -- profondeur | criteres | url | screenshot | commentaire
  observed_count int,                    -- profondeur affichée par le site
  criteria_check jsonb,                  -- { "marque": "ok"|"ko"|"inconnu", … }
  manual_url text,
  comment text,
  submitted_by text not null default '',
  created_at timestamptz not null default now()
);
alter table truth_evidence enable row level security;
do $$ begin
  create policy "auth_select_truth_evidence" on truth_evidence for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "auth_insert_truth_evidence" on truth_evidence for insert to authenticated with check (true);
exception when duplicate_object then null; end $$;
grant select, insert on truth_evidence to authenticated;

-- ── 4. Priorité par usage réel ──────────────────────────────────────────────
create or replace function truth_priority(p_brand text, p_model text)
returns int language sql stable as $$
  select case when exists (
    select 1 from daily_searches d
    where d.active
      and ada_brand_key(d.brand) = ada_brand_key(p_brand)
      and (coalesce(p_model, '') = ''
           or ada_model_key(d.brand, coalesce(d.model, '')) = ada_model_key(p_brand, p_model))
  ) then 1 else 2 end
$$;

-- ── 5. Le balayage ──────────────────────────────────────────────────────────
create or replace function truth_sweep()
returns int
language plpgsql
set statement_timeout to '120s'
as $$
declare
  v_var_pct numeric := coalesce((select value from truth_config where key = 'depth_variation_pct'), 50);
  v_min_hist numeric := coalesce((select value from truth_config where key = 'depth_min_history'), 20);
  v_poll_pct numeric := coalesce((select value from truth_config where key = 'pollution_pct'), 25);
  v_ratio numeric := coalesce((select value from truth_config where key = 'median_ratio'), 2);
  v_drop_pts numeric := coalesce((select value from truth_config where key = 'completeness_drop_pts'), 30);
  v_min_n numeric := coalesce((select value from truth_config where key = 'min_sample'), 20);
  n int; total int := 0;
begin
  -- A/B/C — profondeur : dernier listing_count vs médiane historique (2-30 j).
  with latest as (
    select distinct on (site, country, upper(brand), upper(model), lower(fuel))
      site, country, upper(brand) as brand, upper(model) as model, lower(fuel) as fuel,
      listing_count, scraped_at
    from market_snapshots
    where listing_count is not null and brand <> '' and model <> ''
    order by site, country, upper(brand), upper(model), lower(fuel), scraped_at desc
  ),
  hist as (
    select site, country, upper(brand) as brand, upper(model) as model, lower(fuel) as fuel,
      percentile_cont(0.5) within group (order by listing_count) as med,
      count(*) as n
    from market_snapshots
    where listing_count is not null and brand <> '' and model <> ''
      and scraped_at >= now() - interval '30 days'
      and scraped_at <  now() - interval '2 days'
    group by 1, 2, 3, 4, 5
    having count(*) >= 3
  ),
  flagged as (
    select l.*, h.med,
      case when l.listing_count = 0 then 'profondeur_zero' else 'profondeur_variation' end as signal,
      round(abs(l.listing_count - h.med) / greatest(h.med, 1) * 100) as dev_pct
    from latest l
    join hist h using (site, country, brand, model, fuel)
    where h.med >= v_min_hist
      and l.scraped_at >= now() - interval '2 days'
      and (l.listing_count = 0
           or abs(l.listing_count - h.med) / greatest(h.med, 1) * 100 >= v_var_pct)
  )
  insert into truth_dossiers (site, country, brand, model, fuel, signal, layer, doubt_score, priority, summary, details)
  select site, country, brand, model, fuel, signal,
    case when signal = 'profondeur_zero' then 'url' else 'profondeur' end,
    least(100, case when signal = 'profondeur_zero' then 90 else dev_pct end),
    truth_priority(brand, model),
    format('Profondeur %s vs médiane historique %s (%s%%)', listing_count, round(med), dev_pct),
    jsonb_build_object('listing_count', listing_count, 'median_hist', round(med), 'dev_pct', dev_pct, 'snapshot_at', scraped_at)
  from flagged
  on conflict (site, country, brand, model, fuel, signal) do update set
    doubt_score = excluded.doubt_score, priority = excluded.priority,
    summary = excluded.summary, details = excluded.details, last_seen_at = now();
  get diagnostics n = row_count; total := total + n;

  -- E — pollution du sample : part d'annonces dont le modèle canonique ne
  -- correspond pas au segment du snapshot (préfixes tolérés : « RAV4 » et
  -- « RAV4 Plug-in Hybrid » ne se comptent pas comme pollution).
  with poll as (
    select s.site, s.country, upper(s.brand) as brand, upper(s.model) as model, lower(s.fuel) as fuel,
      count(*) as n,
      count(*) filter (
        where o.model_key <> '' and k.smk <> ''
          and not (o.model_key like k.smk || '%' or k.smk like o.model_key || '%')
      ) as bad
    from market_listing_observations o
    join market_snapshots s on s.id = o.snapshot_id
    cross join lateral (select ada_model_key(s.brand, s.model) as smk) k
    where o.scraped_at >= now() - interval '7 days' and s.model <> ''
    group by 1, 2, 3, 4, 5
    having count(*) >= v_min_n
  )
  insert into truth_dossiers (site, country, brand, model, fuel, signal, layer, doubt_score, priority, summary, details)
  select site, country, brand, model, fuel, 'pollution_sample', 'canonicalisation',
    least(100, round(bad::numeric / n * 200)),
    truth_priority(brand, model),
    format('%s/%s annonces hors segment (%s%%)', bad, n, round(bad::numeric / n * 100)),
    jsonb_build_object('sample', n, 'polluted', bad, 'pct', round(bad::numeric / n * 100))
  from poll
  where bad::numeric / n * 100 >= v_poll_pct
  on conflict (site, country, brand, model, fuel, signal) do update set
    doubt_score = excluded.doubt_score, priority = excluded.priority,
    summary = excluded.summary, details = excluded.details, last_seen_at = now();
  get diagnostics n = row_count; total := total + n;

  -- F — médiane aberrante : médiane 7 j vs médiane 8-30 j (identités canoniques).
  with recent as (
    select brand_key as bk, model_key as mk, lower(fuel) as fuel, upper(country) as country,
      min(brand) as brand, min(model) as model,
      percentile_cont(0.5) within group (order by price) as med, count(*) as n
    from market_listing_observations
    where scraped_at >= now() - interval '7 days'
      and price >= 1000 and not title_damaged and coalesce(model, '') <> ''
    group by 1, 2, 3, 4
    having count(*) >= v_min_n
  ),
  base as (
    select brand_key as bk, model_key as mk, lower(fuel) as fuel, upper(country) as country,
      percentile_cont(0.5) within group (order by price) as med, count(*) as n
    from market_listing_observations
    where scraped_at >= now() - interval '30 days'
      and scraped_at <  now() - interval '7 days'
      and price >= 1000 and not title_damaged and coalesce(model, '') <> ''
    group by 1, 2, 3, 4
    having count(*) >= v_min_n
  )
  insert into truth_dossiers (site, country, brand, model, fuel, signal, layer, doubt_score, priority, summary, details)
  select '', r.country, upper(r.brand), upper(r.model), r.fuel, 'mediane_aberrante', 'parsing',
    80, truth_priority(r.brand, r.model),
    format('Médiane 7 j %s € vs %s € sur 8-30 j', round(r.med), round(b.med)),
    jsonb_build_object('median_recent', round(r.med), 'median_base', round(b.med), 'n_recent', r.n, 'n_base', b.n)
  from recent r
  join base b using (bk, mk, fuel, country)
  where r.med > b.med * v_ratio or r.med < b.med / v_ratio
  on conflict (site, country, brand, model, fuel, signal) do update set
    doubt_score = excluded.doubt_score, priority = excluded.priority,
    summary = excluded.summary, details = excluded.details, last_seen_at = now();
  get diagnostics n = row_count; total := total + n;

  -- H — chute de complétude par SITE : % de champs renseignés 7 j vs 8-30 j.
  with recent as (
    select site,
      avg((fuel <> '')::int) * 100 as fuel_pct,
      avg((year is not null)::int) * 100 as year_pct,
      avg((mileage is not null)::int) * 100 as km_pct,
      count(*) as n
    from market_listing_observations
    where scraped_at >= now() - interval '7 days'
    group by site having count(*) >= v_min_n
  ),
  base as (
    select site,
      avg((fuel <> '')::int) * 100 as fuel_pct,
      avg((year is not null)::int) * 100 as year_pct,
      avg((mileage is not null)::int) * 100 as km_pct,
      count(*) as n
    from market_listing_observations
    where scraped_at >= now() - interval '30 days'
      and scraped_at <  now() - interval '7 days'
    group by site having count(*) >= v_min_n
  )
  insert into truth_dossiers (site, country, brand, model, fuel, signal, layer, doubt_score, priority, summary, details)
  select r.site, '', '', '', '', 'completude_chute', 'parsing',
    70, 2,
    format('Complétude en chute sur %s : fuel %s→%s%%, année %s→%s%%, km %s→%s%%',
      r.site, round(b.fuel_pct), round(r.fuel_pct), round(b.year_pct), round(r.year_pct), round(b.km_pct), round(r.km_pct)),
    jsonb_build_object('fuel', jsonb_build_array(round(b.fuel_pct), round(r.fuel_pct)),
                       'year', jsonb_build_array(round(b.year_pct), round(r.year_pct)),
                       'mileage', jsonb_build_array(round(b.km_pct), round(r.km_pct)),
                       'n_recent', r.n, 'n_base', b.n)
  from recent r
  join base b using (site)
  where (b.fuel_pct - r.fuel_pct) >= v_drop_pts
     or (b.year_pct - r.year_pct) >= v_drop_pts
     or (b.km_pct - r.km_pct) >= v_drop_pts
  on conflict (site, country, brand, model, fuel, signal) do update set
    doubt_score = excluded.doubt_score, summary = excluded.summary,
    details = excluded.details, last_seen_at = now();
  get diagnostics n = row_count; total := total + n;

  return total;
end;
$$;

revoke all on function truth_sweep() from public;
revoke all on function truth_sweep() from anon;
revoke all on function truth_sweep() from authenticated;
grant execute on function truth_sweep() to service_role;
revoke all on function truth_priority(text, text) from public;
revoke all on function truth_priority(text, text) from anon;
revoke all on function truth_priority(text, text) from authenticated;
grant execute on function truth_priority(text, text) to service_role;

-- ── 6. Premier balayage ─────────────────────────────────────────────────────
select truth_sweep();

-- ── 7. Contrôle (seul résultat affiché) ─────────────────────────────────────
select
      (select count(*) from truth_config) >= 6
  and (select count(*) from mi_dashboard_dimensions) > 0
  and (select count(*) from mi_dashboard_meta) = 2
  and not has_function_privilege('anon', 'truth_sweep()', 'execute')
  and has_function_privilege('service_role', 'truth_sweep()', 'execute')
  as tout_est_bon;
