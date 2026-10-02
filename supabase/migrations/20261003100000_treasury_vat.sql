/*
  # Trésorerie : TVA déclarée et point de départ (03/10, décision Channing :
  « je valide ton plan, go » ; « j'ai le relevé de demande de TVA depuis
  janvier 2026, ajoute un onglet sur Trésorerie pour les ajouter »)

  - vat_returns : une ligne par mois déclaré (TVA collectée, déductible,
    nette due, crédit demandé en remboursement, crédit reporté), saisie à
    la main ou pré-remplie depuis le PDF déposé. Admin seulement.
  - app_config 'treasury_opening' : le bilan au 31/12/2025 (premier exercice,
    01/06/2024 → 31/12/2025) comme point zéro de 2026 — disponibilités,
    créance de TVA, IS dû, stock, acomptes, clients, fournisseurs.

  Additif, idempotent.
*/

create table if not exists vat_returns (
  id uuid primary key default gen_random_uuid(),
  period_month text not null unique,          -- 2026-01
  declared_on date,
  collected numeric,                          -- TVA collectée (brute due)
  deductible numeric,                         -- TVA déductible
  net_due numeric,                            -- TVA nette à payer (0 si crédit)
  credit_requested numeric,                   -- remboursement de crédit demandé
  credit_carried numeric,                     -- crédit reporté
  source text,                                -- nom du fichier déposé
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table vat_returns enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'vat_returns' and policyname = 'vat_returns_admin') then
    create policy "vat_returns_admin" on vat_returns for all to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
      with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
  end if;
end $$;

-- Bilan au 31/12/2025 (liasse 2024-2025, IS normal) : point de départ 2026.
insert into app_config (key, value) values ('treasury_opening', '{
  "as_of": "2025-12-31",
  "fiscal_year": "01/06/2024 → 31/12/2025",
  "cash": 99540,
  "vat_credit": 49954,
  "corporate_tax_due": 31514,
  "stock": 46034,
  "advances_paid": 49410,
  "receivables_clients": 15840,
  "payables_suppliers": 69754,
  "advances_received": 45940,
  "revenue": 5909867,
  "result": 120608,
  "other_debts": 3052
}'::jsonb)
on conflict (key) do nothing;

select 'ok' as tout_est_bon;
