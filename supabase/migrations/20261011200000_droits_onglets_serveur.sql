/*
  # Droits par onglet APPLIQUÉS PAR LA BASE (11/10, demande Channing :
  #   « on protège mieux que ça » — Achille voyait des onglets interdits)

  Jusqu'ici, les onglets permis (page Équipe, profiles.allowed_tabs) ne
  faisaient que masquer des pages dans le navigateur : toutes les règles
  d'équipe sont « for all to authenticated using (true) », donc un compte
  connecté lisait ventes, contacts, pièces d'identité et trésorerie par l'API,
  quels que soient ses onglets.

  Ce SQL ajoute un VERROU par-dessus les règles existantes, sans les toucher :
  une règle RESTRICTIVE par table sensible (Postgres exige alors la règle
  d'équipe ET le verrou). Rollback = supprimer les règles « verrou_onglet ».
  Le worker, ada-mcp et les fonctions serveur (clé service) ne sont pas
  concernés.

  Même logique que src/lib/appTabs.ts (grantedTabs) :
  - admin → tout ; compte bloqué → rien ; pas de profil → rien ;
  - allowed_tabs NULL → tout SAUF les droits sur autorisation explicite
    (opportunites, carte:edition, offres) ;
  - liste → ses clés, plus les clés historiques « workflow » (études,
    résultats, archives) et « ventes » (négociations, ventes).

  Tables verrouillées :
  - Ventes (wf:ventes)      : contacts, contact_documents, vehicles_admin,
                              dossier_documents, dossier_emails,
                              documents_admin_history
  - Ventes ou Négociations  : transactions_admin (« Pousser en vente » écrit
                              depuis Négociations)
  - Trésorerie (admin)      : bank_statements, bank_lines, vat_returns
  - Offres (offres)         : supplier_offers
  - Carte (carte)           : network_contacts, network_contact_models
  - Fichiers admin-documents: offres/ → offres ; negotiations/ → négociations
                              ou ventes ; tout le reste (dossiers/, contacts/,
                              transactions/…) → ventes

  À coller dans Supabase → SQL Editor. Idempotent : peut être recollé.
  Vérification à la fin : un tableau des droits effectifs par compte.
*/

-- 1. Fonctions de droits ------------------------------------------------------

create or replace function public.ada_user_can_see_tab(p_user uuid, p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when coalesce((to_jsonb(p) ->> 'blocked')::boolean, false) then false
      when coalesce(p.is_admin, false) then true
      when p.allowed_tabs is null then p_key <> all (array['opportunites', 'carte:edition', 'offres'])
      else p_key = any (p.allowed_tabs)
        or (p_key = any (array['wf:etudes', 'wf:resultats', 'wf:archives']) and 'workflow' = any (p.allowed_tabs))
        or (p_key = any (array['wf:negociations', 'wf:ventes']) and 'ventes' = any (p.allowed_tabs))
    end
    from public.profiles p
    where p.id = p_user
  ), false);
$$;

create or replace function public.ada_can_see_any(p_keys text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from unnest(p_keys) k where public.ada_user_can_see_tab(auth.uid(), k));
$$;

create or replace function public.ada_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select coalesce(p.is_admin, false) and not coalesce((to_jsonb(p) ->> 'blocked')::boolean, false)
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

/** Droit sur un fichier du bucket admin-documents, d'après son dossier. */
create or replace function public.ada_can_see_admin_file(p_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when p_name like 'offres/%' then public.ada_can_see_any(array['offres'])
    when p_name like 'negotiations/%' then public.ada_can_see_any(array['wf:negociations', 'wf:ventes'])
    else public.ada_can_see_any(array['wf:ventes'])
  end;
$$;

revoke all on function public.ada_user_can_see_tab(uuid, text) from public, anon, authenticated;
revoke all on function public.ada_can_see_any(text[]) from public, anon;
revoke all on function public.ada_is_admin() from public, anon;
revoke all on function public.ada_can_see_admin_file(text) from public, anon;
grant execute on function public.ada_can_see_any(text[]) to authenticated;
grant execute on function public.ada_is_admin() to authenticated;
grant execute on function public.ada_can_see_admin_file(text) to authenticated;

-- 2. Verrous par table --------------------------------------------------------
-- « (select …) » : la fonction est évaluée une fois par requête, pas par ligne.

do $$
declare
  t record;
  cond text;
begin
  for t in
    select * from (values
      ('contacts',                array['wf:ventes']),
      ('contact_documents',       array['wf:ventes']),
      ('vehicles_admin',          array['wf:ventes']),
      ('dossier_documents',       array['wf:ventes']),
      ('dossier_emails',          array['wf:ventes']),
      ('documents_admin_history', array['wf:ventes']),
      ('transactions_admin',      array['wf:ventes', 'wf:negociations']),
      ('supplier_offers',         array['offres']),
      ('network_contacts',        array['carte']),
      ('network_contact_models',  array['carte']),
      ('bank_statements',         null),
      ('bank_lines',              null),
      ('vat_returns',             null)
    ) as v(tbl, tabs)
  loop
    if to_regclass('public.' || t.tbl) is null then
      raise notice 'Table absente, ignorée : %', t.tbl;
      continue;
    end if;
    cond := case when t.tabs is null
      then '(select public.ada_is_admin())'
      else format('(select public.ada_can_see_any(%L::text[]))', t.tabs) end;
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('drop policy if exists verrou_onglet on public.%I', t.tbl);
    execute format('create policy verrou_onglet on public.%I as restrictive for all to authenticated using (%s) with check (%s)', t.tbl, cond, cond);
  end loop;
end $$;

-- 3. Verrou sur les fichiers du bucket admin-documents -----------------------

drop policy if exists verrou_onglet_admin_documents on storage.objects;
create policy verrou_onglet_admin_documents on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'admin-documents' or public.ada_can_see_admin_file(name))
  with check (bucket_id <> 'admin-documents' or public.ada_can_see_admin_file(name));

-- 4. Vérification : droits effectifs par compte -------------------------------

select p.display_name,
       coalesce(p.is_admin, false) as admin,
       p.allowed_tabs,
       public.ada_user_can_see_tab(p.id, 'wf:ventes')       as ventes,
       public.ada_user_can_see_tab(p.id, 'wf:negociations') as negociations,
       public.ada_user_can_see_tab(p.id, 'offres')          as offres,
       public.ada_user_can_see_tab(p.id, 'carte')           as carte
  from public.profiles p
 order by p.display_name;

select tablename, policyname, permissive
  from pg_policies
 where policyname like 'verrou_onglet%'
 order by tablename;

/*
  Rollback (si besoin) :
    do $$ declare t record; begin
      for t in select schemaname, tablename from pg_policies where policyname = 'verrou_onglet' loop
        execute format('drop policy verrou_onglet on %I.%I', t.schemaname, t.tablename);
      end loop;
    end $$;
    drop policy if exists verrou_onglet_admin_documents on storage.objects;
*/
