/*
  # Boîte à apprendre (01/10, demande Channing)

  Les cas qu'ADA ne sait pas encore traiter — première entrée : les
  vitrines de concession non reconnues (Hedin le 01/10) — ne sont plus de
  simples erreurs : chaque cas est enregistré ici, dédoublonné sur
  (kind, key), compté à chaque nouvelle rencontre, pour être traité
  ensemble (Centre de vérité → À apprendre, outil MCP learning_cases).
  Différent de la boîte noire technique (worker_logs).

  kind    : dealer_site_unknown (d'autres viendront : site d'annonces non
            reconnu, document non lu…)
  key     : identifiant stable du cas (hôte du site…)
  detail  : indices techniques repérés (titre de page, frameworks…)
  status  : open | done | ignored

  Additif, idempotent. Lecture et clôture pour l'équipe ; l'écriture des
  cas est faite par le worker (clé service).
*/

create table if not exists learning_cases (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  key text not null,
  title text not null,
  url text,
  contact_id uuid references network_contacts(id) on delete set null,
  submitted_by text,
  detail jsonb,
  status text not null default 'open',          -- open | done | ignored
  seen_count integer not null default 1,
  resolution text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (kind, key)
);
create index if not exists idx_learning_cases_status on learning_cases (status, last_seen_at desc);

alter table learning_cases enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'learning_cases' and policyname = 'equipe_learning_cases_select') then
    create policy "equipe_learning_cases_select" on learning_cases for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'learning_cases' and policyname = 'equipe_learning_cases_update') then
    create policy "equipe_learning_cases_update" on learning_cases for update to authenticated using (true) with check (true);
  end if;
end $$;

select 'ok' as tout_est_bon;
