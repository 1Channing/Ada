/*
  # Ada et Dana — les leçons (19/10, Channing : « c'est ici qu'il faut
  #   affûter nos armes ! »)

  - agent_lessons : ce que l'équipe corrige devient une leçon que l'agente
    relit. Une correction (le bon contact donné sur une fiche, un brouillon
    refusé avec son motif, un brouillon corrigé avant l'envoi) donne une
    leçon PROPOSÉE, en une phrase générale (sans nom ni adresse de
    personne) ; un administrateur la valide, la reformule ou la rejette, et
    peut en écrire une lui-même. Une leçon validée part dans les consignes
    de l'agente — pour chercher (la fiche, « Chercher plus loin »), pour
    écrire (les mails), ou pour tout —, pour un type d'entreprise et un
    pays, ou pour tous.
  Les règles d'honnêteté ne sont pas des leçons : elles ne se changent pas.
  Lecture : qui pilote les agentes ; écriture : les administrateurs ; le
  worker propose (clé de service). Additif, idempotent. À coller après
  agents_recherche.
*/

create table if not exists public.agent_lessons (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agent_settings(agent),
  status text not null default 'proposee' check (status in ('proposee', 'validee', 'rejetee')),
  -- recherche : la fiche et « Chercher plus loin » ; mail : les mails ; tout : les deux.
  scope text not null default 'recherche' check (scope in ('recherche', 'mail', 'tout')),
  -- Un type de compte (« groupe », « leasing »…) ou une nature de fiche ; null : pour tous.
  segment text,
  -- Un pays (code ISO) ; null : partout.
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  text text not null check (char_length(text) between 5 and 600),
  source text not null default 'manuel' check (source in ('bon_contact', 'refus', 'correction', 'manuel')),
  -- D'où vient la leçon : la fiche, le message.
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists idx_agent_lessons_agent on public.agent_lessons (agent, status, created_at desc);

alter table public.agent_lessons enable row level security;
drop policy if exists "agent_lessons_select" on public.agent_lessons;
create policy "agent_lessons_select" on public.agent_lessons
  for select to authenticated using ((select public.ada_can_drive_agents()));
drop policy if exists "agent_lessons_insert" on public.agent_lessons;
create policy "agent_lessons_insert" on public.agent_lessons
  for insert to authenticated
  with check ((select public.ada_is_mc_export()) and (select public.ada_is_admin()));
drop policy if exists "agent_lessons_update" on public.agent_lessons;
create policy "agent_lessons_update" on public.agent_lessons
  for update to authenticated
  using ((select public.ada_is_mc_export()) and (select public.ada_is_admin()))
  with check ((select public.ada_is_mc_export()) and (select public.ada_is_admin()));
drop policy if exists "agent_lessons_delete" on public.agent_lessons;
create policy "agent_lessons_delete" on public.agent_lessons
  for delete to authenticated
  using ((select public.ada_is_mc_export()) and (select public.ada_is_admin()));
revoke all on public.agent_lessons from anon, authenticated;
grant select, insert, delete on public.agent_lessons to authenticated;
grant update (status, scope, segment, country, text, decided_by, decided_at, updated_at) on public.agent_lessons to authenticated;
grant all on public.agent_lessons to service_role;

-- Vérification ------------------------------------------------------------------
select exists (select 1 from information_schema.tables where table_name = 'agent_lessons')
   and exists (select 1 from pg_policies where tablename = 'agent_lessons' and policyname = 'agent_lessons_update') as tout_est_bon;
