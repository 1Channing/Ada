-- ═══════════════════════════════════════════════════════════════════════════
-- OFFRES FOURNISSEUR (décision Channing 14/09/2026) : importer n'importe quel
-- fichier fournisseur, le normaliser, y appliquer notre règle de prix, notre
-- charte et notre logo, choisir les pays à relever, rééditer Excel et PDF.
-- Une offre = un document de travail d'ÉQUIPE (lisible et modifiable par
-- tout compte connecté), ses véhicules normalisés en JSON (une trentaine de
-- lignes par fichier : un document, pas une table). Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.supplier_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  supplier text not null default '',
  source_filename text not null default '',
  layout text not null default 'flat',
  mappings jsonb not null default '[]'::jsonb,
  vehicles jsonb not null default '[]'::jsonb,
  price_rule jsonb not null default '{"mode":"margin","margin":500}'::jsonb,
  countries text[] not null default '{}',
  notes text not null default '',
  status text not null default 'draft',        -- draft | sent | closed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_supplier_offers_updated on public.supplier_offers (updated_at desc);

alter table public.supplier_offers enable row level security;
drop policy if exists "supplier_offers_team" on public.supplier_offers;
create policy "supplier_offers_team" on public.supplier_offers
  for all to authenticated using (true) with check (true);

select 'ok' as tout_est_bon;
