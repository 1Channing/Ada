/*
  # Accès réservé à l'équipe + pièces du dossier (27/09, demande Channing :
  #   « s'assurer que les données soient protégées, primordial, et que nos
  #   documents ne s'effacent plus »)

  Constats du 27/09 :
  - 114 règles d'accès ouvraient les tables au rôle `anon`, la clé embarquée
    dans le navigateur : lecture ET écriture sans se connecter ;
  - le bucket admin-documents était public : la pièce d'identité du gérant
    de SaleCar se téléchargeait sans clé, avec la seule URL (HTTP 200, 2,2 Mo) ;
  - une fonction de nettoyage effaçait l'historique des documents à 30 jours
    (supprimée du dépôt le 27/09 ; si elle est planifiée dans le tableau de
    bord Supabase, retirer la planification).

  Ce que fait ce SQL, en une fois, idempotent :
  1. `dossier_documents` : les pièces d'un dossier (carte grise, cessions,
     DA, Kbis, retours du prestataire), jamais purgées ;
  2. bucket admin-documents PRIVÉ — les fichiers s'ouvrent par URL signée,
     délivrée aux comptes connectés (le front est déjà déployé pour ça) ;
  3. chaque règle d'accès `anon` ou `public` est recréée pour `authenticated`
     avec la même condition, puis supprimée ; toute table sans RLS passe en
     RLS avec une règle équipe. Le worker (clé service) et les fonctions
     serveur ne sont pas concernés.
  Les inscriptions restent verrouillées par auth_allowlist (30/08) : un
  compte connecté = un membre de l'équipe.

  À coller UNE FOIS TOUT LE MONDE CONNECTÉ : sans compte, ADA ne montre plus
  rien (écran de connexion).
*/

-- 1. Pièces du dossier ---------------------------------------------------------
create table if not exists dossier_documents (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions_admin(id) on delete cascade,
  kind text not null default 'autre',          -- carte_grise | cession_achat | declaration_achat | cession_vente | kbis_acheteur | da_recepisse | dc_accuse | autre
  label text not null,
  path text not null,                          -- chemin dans admin-documents (dossiers/{transaction_id}/…)
  content_type text,
  size_bytes integer,
  source text not null default 'depose',       -- depose | genere | recu
  created_at timestamptz not null default now()
);
create index if not exists idx_dossier_documents_tx on dossier_documents (transaction_id, created_at);
alter table dossier_documents enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'dossier_documents' and policyname = 'equipe_dossier_documents') then
    create policy "equipe_dossier_documents" on dossier_documents for all to authenticated using (true) with check (true);
  end if;
end $$;

-- 2. Bucket privé ---------------------------------------------------------------
update storage.buckets set public = false where id = 'admin-documents';

-- 3. anon / public → authenticated, même condition ------------------------------
do $$
declare
  p record;
  newname text;
  n_converted int := 0;
  n_rls int := 0;
begin
  for p in
    select schemaname, tablename, policyname, permissive, cmd, qual, with_check, roles
      from pg_policies
     where (schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects'))
       and ('anon' = any(roles) or roles = '{public}'::name[])
  loop
    newname := left(p.policyname || ' (equipe)', 63);
    if not exists (select 1 from pg_policies where schemaname = p.schemaname and tablename = p.tablename and policyname = newname) then
      execute format('create policy %I on %I.%I as %s for %s to authenticated %s %s',
        newname, p.schemaname, p.tablename, p.permissive, p.cmd,
        case when p.qual is not null then 'using (' || p.qual || ')' else '' end,
        case when p.with_check is not null then 'with check (' || p.with_check || ')' else '' end);
    end if;
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    n_converted := n_converted + 1;
  end loop;

  -- Tables sans RLS : les droits de table suffisaient à anon. On active RLS
  -- et on donne à l'équipe ce qu'elle avait.
  for p in
    select schemaname, tablename from pg_tables
     where schemaname = 'public' and not rowsecurity
  loop
    execute format('alter table %I.%I enable row level security', p.schemaname, p.tablename);
    if not exists (select 1 from pg_policies where schemaname = p.schemaname and tablename = p.tablename and 'authenticated' = any(roles)) then
      execute format('create policy %I on %I.%I for all to authenticated using (true) with check (true)',
        left('equipe_' || p.tablename, 63), p.schemaname, p.tablename);
    end if;
    n_rls := n_rls + 1;
  end loop;

  raise notice 'Règles anon/public converties : %, tables passées en RLS : %', n_converted, n_rls;
end $$;

-- Preuve immédiate : plus aucune règle pour anon / public.
select count(*) as regles_anon_restantes from pg_policies
 where (schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects'))
   and ('anon' = any(roles) or roles = '{public}'::name[]);

select 'ok' as tout_est_bon;
