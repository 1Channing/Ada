/*
  # Ada et Dana — la recherche de comptes (17/10, étape 2 ; Channing : « les
  #   retours leasing, loueurs, les acheteurs / vendeurs des gros groupes de
  #   concessions, les fleet managers, les revendeurs B2B… il y a tous les
  #   pays à travailler »)

  - agent_accounts : les entreprises qu'une agente trouve par recherche web,
    que les annonces ne montrent pas — sociétés de leasing, loueurs, flottes,
    groupes, négociants B2B pour Dana ; groupes, revendeurs, flottes qui
    renouvellent pour Ada. Leur site officiel (vérifié), leur taille, pourquoi
    elles comptent, les pages où elles ont été vues. Une entreprise par
    agente, par site web et par pays (la filiale belge et la filiale
    néerlandaise d'un même groupe sont deux comptes).
  - agent_prospects.account_id : la fiche d'un compte trouvé par recherche
    (comme dealer_id pour un garage de l'annuaire).
  - agent_tasks : nouvelle sorte « recherche_comptes ».
  - agent_settings.auto_research_per_day : recherches lancées d'office par
    jour, du lundi au vendredi (2 pour chacune au départ).
  Rien n'est envoyé : les comptes passent par la qualification, puis les
  premiers contacts à valider (ou « pour vous », pour un grand compte).
  Additif, idempotent. À coller après agents_comptes.
*/

-- 1. Les comptes trouvés par recherche ---------------------------------------------------
create table if not exists public.agent_accounts (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agent_settings(agent),
  -- leasing, loueur, flotte, groupe, negociant_b2b (Dana) ; groupe, revendeur, flotte (Ada).
  segment text not null,
  country text,
  name text not null,
  website text not null,
  web_key text generated always as (public.ada_web_key(website)) stored,
  name_key text generated always as (public.ada_dealer_key(name)) stored,
  city text,
  -- Ce qui montre sa taille, tel qu'écrit (« flotte de 12 000 véhicules »).
  size_hint text,
  -- Pourquoi elle compte pour MC Export (une phrase).
  why text,
  -- [url] : les pages où la recherche l'a vue.
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'nouveau' check (status in ('nouveau', 'qualifie', 'ecarte')),
  task_id uuid references public.agent_tasks(id) on delete set null,
  prospect_id uuid references public.agent_prospects(id) on delete set null,
  found_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un vrai site d'entreprise (pas un site d'annonces ni un réseau social), une fois par agente et par pays.
  constraint agent_accounts_site check (public.ada_web_key(website) <> ''),
  constraint agent_accounts_agent_web unique (agent, web_key, country)
);
create index if not exists idx_agent_accounts_agent on public.agent_accounts (agent, status, found_at desc);

alter table public.agent_accounts enable row level security;
drop policy if exists "agent_accounts_select" on public.agent_accounts;
create policy "agent_accounts_select" on public.agent_accounts
  for select to authenticated using ((select public.ada_can_drive_agents()));
-- L'équipe écarte un compte (ou le remet à qualifier) ; le reste vient du worker.
drop policy if exists "agent_accounts_update" on public.agent_accounts;
create policy "agent_accounts_update" on public.agent_accounts
  for update to authenticated
  using ((select public.ada_can_drive_agents()))
  with check ((select public.ada_can_drive_agents()));
revoke all on public.agent_accounts from anon, authenticated;
grant select on public.agent_accounts to authenticated;
grant update (status, updated_at) on public.agent_accounts to authenticated;
grant all on public.agent_accounts to service_role;

-- 2. La fiche d'un compte -------------------------------------------------------------------
alter table public.agent_prospects add column if not exists account_id uuid references public.agent_accounts(id) on delete set null;
create unique index if not exists agent_prospects_agent_account_key on public.agent_prospects (agent, account_id) where account_id is not null;

-- 3. La tâche et le réglage -------------------------------------------------------------------
alter table public.agent_tasks drop constraint if exists agent_tasks_kind_check;
alter table public.agent_tasks add constraint agent_tasks_kind_check
  check (kind in ('decouverte_concessions', 'qualification', 'premier_mail', 'recherche_comptes'));

do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'agent_settings' and column_name = 'auto_research_per_day') then
    alter table public.agent_settings add column auto_research_per_day integer not null default 0;
    -- Une seule fois : deux recherches par jour pour chacune.
    update public.agent_settings set auto_research_per_day = 2;
  end if;
end $$;
alter table public.agent_settings drop constraint if exists agent_settings_research_limit;
alter table public.agent_settings add constraint agent_settings_research_limit check (auto_research_per_day between 0 and 20);
grant update (auto_research_per_day) on public.agent_settings to authenticated;

-- 4. Vérification ------------------------------------------------------------------
select exists (select 1 from information_schema.tables where table_name = 'agent_accounts')
   and exists (select 1 from information_schema.columns where table_name = 'agent_prospects' and column_name = 'account_id')
   and exists (select 1 from pg_constraint where conname = 'agent_tasks_kind_check' and pg_get_constraintdef(oid) like '%recherche_comptes%')
   and exists (select 1 from information_schema.columns where table_name = 'agent_settings' and column_name = 'auto_research_per_day')
   and (select bool_and(auto_research_per_day >= 0) from public.agent_settings) as tout_est_bon;
