/*
  # Chaque organisation ne voit que ses données (12/10 soir, Channing : « à
  #   quoi sert le bouton données MC Export ? je veux que chaque organisation
  #   ait ses propres données, non partagées »)

  Le SQL précédent (20261012190000) posait un droit par organisation
  (business_access) que l'admin pouvait ouvrir à une autre organisation.
  Règle retenue, sans bouton : les données partagées d'ADA (ventes,
  contacts, dossiers, campagnes, mémoire d'ingestion, marché, veille,
  retours, journaux…) appartiennent à MC EXPORT. Seuls ses comptes y
  accèdent, dans les onglets qu'ils ont. Toute autre organisation (Weecars,
  Mon agence automobile…) ne touche que ses négociations, son Open space,
  ses archives, ses rappels.

  - ada_is_mc_export() remplace ada_org_business() ;
  - chaque règle verrou_org est reposée avec cette fonction (même carte
    table → onglets que le 12/10), puis l'ancienne fonction et la colonne
    business_access sont retirées ;
  - fichiers admin-documents : hors photos de négociation, MC Export seulement.
  Idempotent ; ne suppose pas que le SQL précédent ait été collé.
*/

create or replace function public.ada_is_mc_export()
returns boolean
language sql stable security definer set search_path = public
as $$
  -- Identité obligatoire : sans auth.uid(), my_organisation() retomberait sur « MC Export ».
  select auth.uid() is not null and (public.ada_is_admin() or public.my_organisation() = 'MC Export');
$$;
revoke all on function public.ada_is_mc_export() from public, anon;
grant execute on function public.ada_is_mc_export() to authenticated;

do $$
declare
  t record;
  cond text;
  mapped text[] := array[]::text[];
  skip text[] := array['profiles', 'negotiations', 'negotiation_folders', 'negotiation_analyses',
                       'daily_searches', 'daily_search_hits', 'open_space_items', 'open_space_notes',
                       'open_space_seen', 'user_tasks', 'auth_allowlist', 'bank_statements', 'bank_lines', 'vat_returns'];
  n_tables int := 0;
begin
  for t in
    select * from (values
      ('contacts',                 array['wf:ventes'], 'all'),
      ('contact_documents',        array['wf:ventes'], 'all'),
      ('vehicles_admin',           array['wf:ventes'], 'all'),
      ('dossier_documents',        array['wf:ventes'], 'all'),
      ('dossier_emails',           array['wf:ventes'], 'all'),
      ('documents_admin_history',  array['wf:ventes'], 'all'),
      ('sales',                    array['wf:ventes'], 'all'),
      ('transactions_admin',       array['wf:ventes', 'wf:negociations'], 'all'),
      ('supplier_offers',          array['offres'], 'all'),
      ('network_contacts',         array['carte'], 'all'),
      ('network_contact_models',   array['carte'], 'all'),
      ('network_stock_runs',       array['carte'], 'all'),
      ('network_stock_vehicles',   array['carte'], 'all'),
      ('linkgen_campaigns',        array['atelier', 'market', 'historique'], 'all'),
      ('linkgen_campaign_items',   array['atelier', 'market', 'historique'], 'all'),
      ('linkgen_error_dossiers',   array['atelier'], 'all'),
      ('linkgen_mapping_candidates', array['atelier'], 'all'),
      ('linkgen_mapping_runs',     array['atelier'], 'all'),
      ('linkgen_mapping_samples',  array['atelier'], 'all'),
      ('linkgen_url_samples',      array['atelier'], 'all'),
      ('linkgen_ingestion_events', array['atelier', 'historique'], 'all'),
      ('linkgen_mapping_memory',   array['atelier', 'historique', 'market', 'wf:etudes', 'wf:resultats'], 'all'),
      ('linkgen_enum_mappings',    array['atelier', 'historique', 'market', 'wf:etudes', 'wf:resultats'], 'all'),
      ('vehicle_ref_generations',  array['atelier', 'historique', 'market', 'wf:etudes', 'wf:resultats'], 'all'),
      ('vehicle_ref_motorisations', array['atelier', 'historique', 'market', 'wf:etudes', 'wf:resultats'], 'all'),
      ('vehicle_fuel_evidence',    array['atelier', 'historique', 'market', 'wf:etudes', 'wf:resultats'], 'all'),
      ('job_runs',                 array['atelier', 'historique'], 'all'),
      ('market_snapshots',         array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('market_listing_observations', array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('market_listing_observations_archive', array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('market_opportunity_acks',  array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('market_rescan_optouts',    array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('mi_dashboard_dimensions',  array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('mi_dashboard_medians',     array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('mi_dashboard_meta',        array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('mi_saved_searches',        array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('truth_confidence',         array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('truth_golden',             array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('truth_digests',            array['market', 'wf:etudes', 'wf:resultats', 'opportunites', 'atelier'], 'all'),
      ('legal_watch_entries',      array['veille', 'market'], 'all'),
      ('country_fiscal_profiles',  array['veille', 'market'], 'all'),
      ('app_config',               array['market', 'offres', 'wf:ventes', 'atelier', 'veille'], 'all'),
      ('capacity_alerts',          array['atelier', 'market', 'offres'], 'all'),
      ('learning_cases',           array['atelier', 'market', 'offres'], 'all'),
      ('ada_feedback',             array['*'], 'read_update'),
      ('app_usage_events',         null, 'read'),
      ('worker_logs',              null, 'all'),
      ('organisations',            null, 'all'),
      ('truth_dossiers',           null, 'all'),
      ('truth_evidence',           null, 'all'),
      ('truth_benchmarks',         null, 'all'),
      ('negotiation_notes',        null, 'all'),
      ('listings',                 null, 'all'),
      ('market_studies',           null, 'all'),
      ('market_study_definitions', null, 'all'),
      ('search_queries',           null, 'all'),
      ('study_scrape_pages',       null, 'all'),
      ('scheduled_study_runs',     null, 'all'),
      ('study_runs',               null, 'all'),
      ('study_run_results',        null, 'all'),
      ('study_run_logs',           null, 'all'),
      ('study_run_result_listings', null, 'all'),
      ('study_source_listings',    null, 'all')
    ) as v(tbl, tabs, cmd)
  loop
    mapped := mapped || t.tbl;
    if to_regclass('public.' || t.tbl) is null then
      raise notice 'Table absente, ignorée : %', t.tbl;
      continue;
    end if;
    cond := case
      when t.tabs is null then '(select public.ada_is_admin())'
      when t.tabs = array['*'] then '(select public.ada_is_mc_export())'
      else format('((select public.ada_is_mc_export()) and (select public.ada_can_see_any(%L::text[])))', t.tabs)
    end;
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('drop policy if exists verrou_org on public.%I', t.tbl);
    execute format('drop policy if exists verrou_org_update on public.%I', t.tbl);
    if t.cmd = 'all' then
      execute format('create policy verrou_org on public.%I as restrictive for all to authenticated using (%s) with check (%s)', t.tbl, cond, cond);
    else
      execute format('create policy verrou_org on public.%I as restrictive for select to authenticated using (%s)', t.tbl, cond);
      if t.cmd = 'read_update' then
        execute format('create policy verrou_org_update on public.%I as restrictive for update to authenticated using (%s) with check (%s)', t.tbl, cond, cond);
      end if;
    end if;
    n_tables := n_tables + 1;
  end loop;

  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename <> all (mapped || skip)
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('drop policy if exists verrou_org on public.%I', t.tablename);
    execute format('create policy verrou_org on public.%I as restrictive for all to authenticated using ((select public.ada_is_admin())) with check ((select public.ada_is_admin()))', t.tablename);
    raise notice 'Table hors carte, réservée aux admins : %', t.tablename;
    n_tables := n_tables + 1;
  end loop;
  raise notice 'verrou_org posé sur % table(s)', n_tables;
end $$;

drop policy if exists verrou_org_admin_documents on storage.objects;
create policy verrou_org_admin_documents on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'admin-documents' or name like 'negotiations/%' or (select public.ada_is_mc_export()))
  with check (bucket_id <> 'admin-documents' or name like 'negotiations/%' or (select public.ada_is_mc_export()));

-- L'ancien droit par organisation disparaît (plus aucune règle ne le référence).
drop function if exists public.ada_org_business();
alter table public.organisations drop column if exists business_access;

select p.display_name,
       coalesce(nullif(p.organisation, ''), 'MC Export') as organisation,
       (coalesce(p.is_admin, false) or coalesce(nullif(p.organisation, ''), 'MC Export') = 'MC Export') as donnees_mc_export,
       public.ada_user_can_see_tab(p.id, 'wf:ventes')       as ventes,
       public.ada_user_can_see_tab(p.id, 'wf:negociations') as negociations,
       public.ada_user_can_see_tab(p.id, 'market')          as market
  from public.profiles p
 order by organisation, p.display_name;

select count(*) as tables_verrouillees from pg_policies where policyname = 'verrou_org';

select exists (select 1 from pg_proc where proname = 'ada_is_mc_export')
   and not exists (select 1 from pg_proc where proname = 'ada_org_business')
   and not exists (select 1 from information_schema.columns where table_name = 'organisations' and column_name = 'business_access')
   and exists (select 1 from pg_policies where tablename = 'transactions_admin' and policyname = 'verrou_org' and qual like '%ada_is_mc_export%')
   and exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'verrou_org_admin_documents' and qual like '%ada_is_mc_export%') as tout_est_bon;
