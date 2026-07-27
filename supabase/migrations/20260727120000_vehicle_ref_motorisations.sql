-- Référentiel MOTORISATIONS (source EEA — immatriculations neuves UE 2020-2025).
-- Une ligne par (marque, modèle, carburant) avec les immatriculations par année.
-- Sert au planificateur de campagnes : dépriorisation (phase 1) puis blocage
-- (phase 2) des combos carburant × modèle × année jamais immatriculés — avec
-- pare-feux fail-open (voir src/services/vehicleMotorisations.ts).
-- Additif — aucune table existante modifiée.
create table if not exists public.vehicle_ref_motorisations (
  id uuid primary key default gen_random_uuid(),
  brand_key text not null,
  model_key text not null,
  fuel text not null,
  years jsonb not null default '{}'::jsonb,
  total integer not null default 0,
  source text not null,
  created_at timestamptz not null default now(),
  unique (brand_key, model_key, fuel, source)
);

create index if not exists idx_vehicle_ref_motorisations_combo
  on public.vehicle_ref_motorisations (brand_key, model_key);

alter table public.vehicle_ref_motorisations enable row level security;

drop policy if exists "vehicle_ref_motorisations_select_anon" on public.vehicle_ref_motorisations;
create policy "vehicle_ref_motorisations_select_anon" on public.vehicle_ref_motorisations
  for select to anon, authenticated using (true);

-- Écriture réservée au service_role (worker) — les données arrivent par le
-- fichier supabase/data/vehicle_ref_motorisations.sql appliqué manuellement.
