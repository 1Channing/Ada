/*
  # Stock des concessions de la carte (30/09, demande Channing)

  Un contact de la carte dont la vitrine est un site de concession reconnu
  (fournisseurs dvnl, datamotive, autodata — preuves du 30/09) peut être
  relevé : chaque voiture de son stock devient une ligne de
  `network_stock_vehicles`, vue pour la première fois / pour la dernière
  fois / disparue ; chaque relevé laisse un bilan dans `network_stock_runs`
  (nouveaux, disparus, prix changés). Le diff entre deux relevés = vélocité
  et force de proposition.

  Additif, idempotent. Lecture pour les comptes connectés ; l'écriture est
  faite par le worker (clé service).
*/

create table if not exists network_stock_runs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references network_contacts(id) on delete cascade,
  url text not null,
  provider text,
  status text not null default 'running',       -- running | done | failed
  total integer,
  new_count integer,
  gone_count integer,
  price_changes integer,
  pages integer,
  warnings jsonb,
  error text,
  submitted_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_network_stock_runs_contact on network_stock_runs (contact_id, started_at desc);

create table if not exists network_stock_vehicles (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references network_contacts(id) on delete cascade,
  external_id text not null,
  url text,
  title text,
  brand text,
  model text,
  price numeric,
  price_prev numeric,
  km integer,
  year integer,
  fuel text,
  gearbox text,
  plate text,
  vin text,
  body text,
  image text,
  listed_at timestamptz,                         -- date de mise en ligne quand le site la donne
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  gone_at timestamptz,
  last_run_id uuid,
  gone_run_id uuid,
  unique (contact_id, external_id)
);
create index if not exists idx_network_stock_vehicles_contact on network_stock_vehicles (contact_id, gone_at, last_seen_at desc);

alter table network_stock_runs enable row level security;
alter table network_stock_vehicles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'network_stock_runs' and policyname = 'equipe_network_stock_runs') then
    create policy "equipe_network_stock_runs" on network_stock_runs for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'network_stock_vehicles' and policyname = 'equipe_network_stock_vehicles') then
    create policy "equipe_network_stock_vehicles" on network_stock_vehicles for select to authenticated using (true);
  end if;
end $$;

select 'ok' as tout_est_bon;
