/*
  # Verrous stricts par organisation (12/10 soir, Channing : « il faut poser
  #   des verrous stricts, on ne peut pas risquer une fuite de donnée »)

  État prouvé le 12/10 à 14 h (requêtes sur la prod) :
  - la RPC negotiation_conflicts répond à la clé anon SANS compte : noms,
    titres, numéros et notes des négociations MC Export (grant to anon) ;
  - le verrou par onglet du 11/10 (verrou_onglet) couvre ventes, contacts,
    pièces, offres, carte, trésorerie — mais laisse transactions_admin à tout
    compte qui a Négociations (donc Weecars), et une trentaine de tables
    partagées (campagnes, mémoire d'ingestion, marché, veille, retours,
    télémétrie, journaux…) sans aucun verrou : « for all to authenticated
    using (true) » depuis le 27/09.

  Ce SQL, idempotent, additif (rien d'existant n'est supprimé sauf des
  droits anon) :
  1. organisations.business_access : l'organisation a-t-elle accès aux
     DONNÉES MÉTIER partagées (ventes, contacts, campagnes, marché, veille,
     retours…) ? MC Export oui ; Mon agence automobile oui (Segre a des
     onglets MC Export depuis le 07/09 — à couper d'un clic dans Équipe si
     tu ne le veux plus) ; Weecars non. Un compte sans accès métier ne
     touche que SES négociations, l'Open space et les archives de SON
     organisation.
  2. ada_org_business() : la règle (admin, ou organisation à accès métier).
  3. verrou_org : une règle RESTRICTIVE par table partagée = accès métier ET
     onglet qui montre cette donnée (même logique que le verrou du 11/10 ;
     les deux s'additionnent). Lecture seule verrouillée pour les retours et
     la télémétrie (tout compte peut encore en écrire). Toute table du
     schéma hors de cette carte est réservée aux admins (filet). Le worker
     et les fonctions serveur (clé service) ne sont pas concernés.
  4. anon : plus aucune RPC métier (negotiation_conflicts, my_organisation,
     organisation_of, is_admin_user, truth_active_studies) ; la RPC
     anti-collision exige un compte ; truth_active_studies exige un admin.
  5. Vues : security_invoker = les verrous des tables s'appliquent à travers.
  6. Fichiers admin-documents : hors photos de négociation, accès métier
     requis (en plus du verrou par dossier du 11/10).
  Vérification à la fin : droits effectifs par compte, verrous posés.
*/

-- 1. Accès métier par organisation --------------------------------------------
alter table public.organisations add column if not exists business_access boolean not null default false;
update public.organisations set business_access = true where name in ('MC Export', 'Mon agence automobile');

-- 2. La règle ------------------------------------------------------------------
create or replace function public.ada_org_business()
returns boolean
language sql stable security definer set search_path = public
as $$
  -- Identité obligatoire : sans auth.uid(), my_organisation() retomberait sur « MC Export ».
  select auth.uid() is not null
     and (public.ada_is_admin()
          or coalesce((select o.business_access from public.organisations o where o.name = public.my_organisation()), false));
$$;
revoke all on function public.ada_org_business() from public, anon;
grant execute on function public.ada_org_business() to authenticated;

-- 3. Verrous par table ----------------------------------------------------------
do $$
declare
  t record;
  cond text;
  mapped text[] := array[]::text[];
  -- Déjà bornées à la personne, à l'organisation ou aux admins : on n'y touche pas.
  skip text[] := array['profiles', 'negotiations', 'negotiation_folders', 'negotiation_analyses',
                       'daily_searches', 'daily_search_hits', 'open_space_items', 'open_space_notes',
                       'open_space_seen', 'user_tasks', 'auth_allowlist', 'bank_statements', 'bank_lines', 'vat_returns'];
  n_tables int := 0;
begin
  for t in
    select * from (values
      -- Ventes et dossiers (métier) ------------------------------------------------
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
      -- Sourcing : campagnes, ingestion, mémoire ----------------------------------
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
      -- Marché, études, confiance ---------------------------------------------------
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
      -- Retours et télémétrie : lecture verrouillée, écriture ouverte à tout compte -
      ('ada_feedback',             array['*'], 'read_update'),
      ('app_usage_events',         null, 'read'),
      -- Réservé aux admins ----------------------------------------------------------
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
      when t.tabs = array['*'] then '(select public.ada_org_business())'
      else format('((select public.ada_org_business()) and (select public.ada_can_see_any(%L::text[])))', t.tabs)
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

  -- Filet : toute autre table du schéma public → admins seulement.
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

-- 4. Clé anon : plus aucune RPC métier ; anti-collision avec compte ; étalon admin --
revoke execute on function public.negotiation_conflicts() from public, anon;
revoke execute on function public.my_organisation() from public, anon;
revoke execute on function public.organisation_of(uuid) from public, anon;
revoke execute on function public.is_admin_user() from public, anon;
revoke execute on function public.truth_active_studies() from public, anon;

create or replace function public.negotiation_conflicts()
returns table (
  listing_url text,
  owner_id uuid,
  owner_name text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  status text,
  phone text,
  outcome text,
  archived_at timestamptz,
  title text
)
language sql
security definer
set search_path = public
as $$
  select n.listing_url,
         n.user_id,
         coalesce(nullif(p.display_name, ''), 'collègue'),
         n.notes,
         n.created_at,
         n.updated_at,
         n.status,
         n.phone,
         n.outcome,
         n.archived_at,
         n.title
  from public.negotiations n
  left join public.profiles p on p.id = n.user_id
  where auth.uid() is not null
    and n.status <> 'closed'
    and (n.listing_url <> '' or coalesce(n.phone, '') <> '')
    and coalesce(nullif(p.organisation, ''), 'MC Export') = public.my_organisation();
$$;
grant execute on function public.negotiation_conflicts() to authenticated;

create or replace function public.truth_active_studies()
returns table (
  id uuid,
  label text,
  brand text,
  model text,
  fuel text,
  "trim" text,
  trim_target text,
  year_min int,
  year_max int,
  mileage_max int,
  gearbox text,
  power_min int,
  source_country text,
  target_country text
)
language sql stable
security definer
set search_path = public
as $$
  select
    d.id, d.label, d.brand, d.model, d.fuel, d.trim, d.trim_target,
    d.year_min, d.year_max, d.mileage_max, d.gearbox, d.power_min,
    d.source_country, d.target_country
  from daily_searches d
  where d.active and public.ada_is_admin()
$$;
grant execute on function public.truth_active_studies() to authenticated;

-- 5. Vues : les verrous des tables s'appliquent à travers ------------------------
do $$
declare v text;
begin
  foreach v in array array['market_listing_observations_all', 'v_running_scheduled_jobs', 'v_stale_scheduled_jobs', 'v_scheduled_job_stats'] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I set (security_invoker = on)', v);
    end if;
  end loop;
end $$;

-- 6. Fichiers : hors photos de négociation, accès métier requis -------------------
drop policy if exists verrou_org_admin_documents on storage.objects;
create policy verrou_org_admin_documents on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'admin-documents' or name like 'negotiations/%' or (select public.ada_org_business()))
  with check (bucket_id <> 'admin-documents' or name like 'negotiations/%' or (select public.ada_org_business()));

-- 7. Vérification ------------------------------------------------------------------
select p.display_name,
       coalesce(nullif(p.organisation, ''), 'MC Export') as organisation,
       coalesce((select o.business_access from public.organisations o where o.name = coalesce(nullif(p.organisation, ''), 'MC Export')), false) as acces_metier,
       coalesce(p.is_admin, false) as admin,
       public.ada_user_can_see_tab(p.id, 'wf:ventes')       as ventes,
       public.ada_user_can_see_tab(p.id, 'wf:negociations') as negociations,
       public.ada_user_can_see_tab(p.id, 'market')          as market
  from public.profiles p
 order by organisation, p.display_name;

select count(*) as tables_verrouillees from pg_policies where policyname = 'verrou_org';

select exists (select 1 from pg_proc where proname = 'ada_org_business')
   and exists (select 1 from pg_policies where tablename = 'transactions_admin' and policyname = 'verrou_org')
   and exists (select 1 from pg_policies where tablename = 'linkgen_campaigns' and policyname = 'verrou_org')
   and exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'verrou_org_admin_documents')
   and (select business_access from public.organisations where name = 'MC Export')
   and not coalesce((select business_access from public.organisations where name = 'Weecars'), false)
   and not has_function_privilege('anon', 'public.negotiation_conflicts()', 'execute') as tout_est_bon;
