/*
  # Relevés de compte (02/10, demande Channing : « prendre les lignes de
  chaque relevé et en faire un tableau de frais mensuel, les classer, faire le
  lien avec les achats du tableau de ventes et voir où il y a une fuite »)

  Un relevé PDF (Revolut, Airwallex) déposé dans ADA → une ligne par
  mouvement, classée (carburant, péage, achat véhicule, vente encaissée,
  transfert interne…), rapprochée d'un dossier de vente par la plaque ou le
  VIN. Admin seulement (trésorerie de l'entreprise).

  Un relevé = (compte, mois) : redéposer le même mois le remplace.
  Additif, idempotent.
*/

create table if not exists bank_statements (
  id uuid primary key default gen_random_uuid(),
  account text not null,                       -- revolut | airwallex
  period_month text not null,                  -- 2026-08
  file_name text,
  uploaded_by uuid references profiles(id) on delete set null,
  currency text not null default 'EUR',
  opening_balance numeric,
  closing_balance numeric,
  line_count int not null default 0,
  warnings jsonb,
  created_at timestamptz not null default now(),
  unique (account, period_month)
);

create table if not exists bank_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references bank_statements(id) on delete cascade,
  account text not null,
  booked_on date not null,
  kind text,
  counterparty text,
  description text,
  amount_out numeric,
  amount_in numeric,
  balance numeric,
  currency text not null default 'EUR',
  plate text,
  vin text,
  category text not null default 'autre',
  category_auto text,
  transaction_id uuid references transactions_admin(id) on delete set null,
  match_how text,
  line_no int not null,
  created_at timestamptz not null default now(),
  unique (statement_id, line_no)
);
create index if not exists idx_bank_lines_month on bank_lines (booked_on);
create index if not exists idx_bank_lines_category on bank_lines (category);
create index if not exists idx_bank_lines_tx on bank_lines (transaction_id);

alter table bank_statements enable row level security;
alter table bank_lines enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'bank_statements' and policyname = 'bank_statements_admin') then
    create policy "bank_statements_admin" on bank_statements for all to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
      with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bank_lines' and policyname = 'bank_lines_admin') then
    create policy "bank_lines_admin" on bank_lines for all to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
      with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
  end if;
end $$;

select 'ok' as tout_est_bon;
