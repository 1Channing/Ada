/*
  # Intra : la vitrine des véhicules disponibles sur l'Accueil MC Export
  #   (12/10 soir, Channing : « à côté d'Export, un onglet Intra qui reprend
  #   l'aperçu de l'offre et nous permet, à l'équipe de gestion MC Export, de
  #   publier certaines offres au choix dans l'accueil des utilisateurs — une
  #   petite vitrine, et qu'ils puissent cliquer sur l'étude de marché
  #   correspondante pour vérifier le marché »)

  intra_showcase : une ligne par véhicule publié depuis une offre. La ligne
  PHOTOGRAPHIE le véhicule (marque, modèle, version, km, énergie…), le prix
  MC Export HT et le relevé de marché du lot au moment de la publication :
  la vitrine ne bouge pas si l'offre est retravaillée ensuite ; republier
  rafraîchit. Données MC Export : lisibles par les comptes MC Export,
  publiées / retirées par ceux qui ont l'onglet Offres. Additif, idempotent.
*/
create table if not exists public.intra_showcase (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid references public.supplier_offers(id) on delete cascade,
  offer_title text not null default '',
  vehicle_id text not null,
  lot_key text,
  vehicle jsonb not null default '{}'::jsonb,
  price_ht integer,
  market jsonb,
  note text not null default '',
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (offer_id, vehicle_id)
);
create index if not exists idx_intra_showcase_published on public.intra_showcase (published_at desc);
alter table public.intra_showcase enable row level security;
drop policy if exists "intra_showcase_select" on public.intra_showcase;
create policy "intra_showcase_select" on public.intra_showcase
  for select to authenticated using ((select public.ada_is_mc_export()));
drop policy if exists "intra_showcase_write" on public.intra_showcase;
create policy "intra_showcase_write" on public.intra_showcase
  for all to authenticated
  using ((select public.ada_is_mc_export()) and (select public.ada_can_see_any(array['offres'])))
  with check ((select public.ada_is_mc_export()) and (select public.ada_can_see_any(array['offres'])));
grant select, insert, update, delete on public.intra_showcase to authenticated;

select exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'intra_showcase')
   and exists (select 1 from pg_policies where tablename = 'intra_showcase' and policyname = 'intra_showcase_select')
   and exists (select 1 from pg_policies where tablename = 'intra_showcase' and policyname = 'intra_showcase_write') as tout_est_bon;
