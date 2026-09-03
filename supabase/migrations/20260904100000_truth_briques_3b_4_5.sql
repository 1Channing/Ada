-- ═══════════════════════════════════════════════════════════════════════════
-- TRUTH CENTER — briques 3b / 4 / 5 (GO Channing 03/09/2026). Additif,
-- idempotent. Trois tables écrites par le WORKER (service_role) à la fin de
-- chaque vague d'études, lues par tout utilisateur connecté :
--   truth_confidence : BADGE DE CONFIANCE par segment (site, pays, marque,
--                      modèle) — score 0..100 + composantes lisibles.
--   truth_digests    : ROUTINE DU MATIN — un digest par jour (JSON + résumé).
--   truth_golden     : CAS DORÉS — URLs de preuve figées ; rejoués à chaque
--                      vague ; un échec ouvre un dossier et BLOQUE les
--                      auto-validations de mappings du site (boucle de
--                      correction verrouillée par la preuve).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.truth_confidence (
  site text not null,
  country text not null,
  brand text not null,
  model text not null default '',
  score integer not null,
  label text not null,                     -- 'fiable' | 'a_surveiller' | 'douteux'
  components jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (site, country, brand, model)
);
create index if not exists idx_truth_confidence_score on public.truth_confidence (score);

create table if not exists public.truth_digests (
  day date primary key,
  generated_at timestamptz not null default now(),
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.truth_golden (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  label text not null,
  params jsonb not null,                   -- LinkGenParams (marque seule + la valeur)
  criterion text not null,                 -- clé du registre (année, km, carburant, boîte, puissance, finition, carrosserie)
  source text not null default 'auto',     -- 'auto' (état prouvé figé) | 'bibliotheque' | 'manuel'
  created_by text,
  created_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_status text,                        -- 'pass' | 'fail'
  last_url text,
  last_detail text
);
create index if not exists idx_truth_golden_site on public.truth_golden (site, last_status);

alter table public.truth_confidence enable row level security;
alter table public.truth_digests    enable row level security;
alter table public.truth_golden     enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'truth_confidence' and policyname = 'auth_select_truth_confidence') then
    create policy "auth_select_truth_confidence" on public.truth_confidence for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'truth_digests' and policyname = 'auth_select_truth_digests') then
    create policy "auth_select_truth_digests" on public.truth_digests for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'truth_golden' and policyname = 'auth_select_truth_golden') then
    create policy "auth_select_truth_golden" on public.truth_golden for select to authenticated using (true);
  end if;
  -- Les cas dorés se FIGENT depuis la Bibliothèque (admins) et se retirent
  -- de même ; le worker (service_role) les rejoue et les seed.
  if not exists (select 1 from pg_policies where tablename = 'truth_golden' and policyname = 'admin_write_truth_golden') then
    create policy "admin_write_truth_golden" on public.truth_golden for all to authenticated
      using (exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin))
      with check (exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin));
  end if;
end $$;

grant select on public.truth_confidence, public.truth_digests, public.truth_golden to authenticated;
grant insert, update, delete on public.truth_golden to authenticated;

select 'ok' as tout_est_bon;
