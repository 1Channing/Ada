/*
  # Négociations : téléphone du vendeur, archives avec le choix d'après appel
  #   (12/10, Channing pour les comptes de prospection)

  - phone : le numéro du vendeur, seconde clé de doublon à côté de l'annonce
    (une annonce remise en ligne plus tard change d'identifiant, pas de
    numéro) ; un même numéro sur un autre véhicule prévient sans bloquer.
  - outcome / archived_at : après l'appel, « remettre dans le flux » (flux) ou
    « ne pas rappeler » (no_callback) ARCHIVENT la négociation (status =
    'archived') au lieu de la supprimer : la trace reste pour les doublons.
  - negotiation_conflicts v2 : l'anti-collision rend aussi le statut, le
    numéro, le choix d'après appel et le titre (jamais les prix), pour les
    négociations en cours ET archivées. Le type de retour change → drop puis
    create (CREATE OR REPLACE ne sait pas changer les colonnes).
  Additif, idempotent.
*/
alter table public.negotiations add column if not exists phone text;
alter table public.negotiations add column if not exists outcome text;
alter table public.negotiations add column if not exists archived_at timestamptz;
create index if not exists idx_negotiations_phone on public.negotiations (phone) where phone is not null and phone <> '';

drop function if exists public.negotiation_conflicts();
create function public.negotiation_conflicts()
returns table (
  listing_url text,
  owner_id uuid,
  owner_name text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  status text,
  phone text,
  outcome text,
  archived_at timestamptz,
  title text
)
language sql
security definer
set search_path = public
as $$
  select n.listing_url,
         n.user_id,
         coalesce(nullif(p.display_name, ''), 'collègue'),
         n.notes,
         n.created_at,
         n.updated_at,
         n.status,
         n.phone,
         n.outcome,
         n.archived_at,
         n.title
  from public.negotiations n
  left join public.profiles p on p.id = n.user_id
  where n.status <> 'closed'
    and (n.listing_url <> '' or coalesce(n.phone, '') <> '');
$$;
grant execute on function public.negotiation_conflicts() to authenticated, anon;

select exists (select 1 from information_schema.columns where table_name = 'negotiations' and column_name = 'phone')
   and exists (select 1 from information_schema.columns where table_name = 'negotiations' and column_name = 'outcome')
   and exists (select 1 from information_schema.columns where table_name = 'negotiations' and column_name = 'archived_at')
   and exists (select 1 from information_schema.columns where table_name = 'negotiations' and column_name = 'archived_at')
   and (select count(*) from pg_proc where proname = 'negotiation_conflicts') = 1 as tout_est_bon;
