-- ANTI-COLLISION négociations (28/08) : « ce véhicule est déjà en négociation
-- avec X ». Les négociations restent PERSONNELLES (RLS negotiations_own
-- intact) ; cette fonction est la seule fenêtre inter-comptes, et n'expose
-- QUE le nécessaire : URL de l'annonce (clé de rapprochement), propriétaire,
-- notes, dates. Jamais les prix demandés/négociés des collègues.
create or replace function public.negotiation_conflicts()
returns table (
  listing_url text,
  owner_id uuid,
  owner_name text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
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
         n.updated_at
  from public.negotiations n
  left join public.profiles p on p.id = n.user_id
  where n.status <> 'closed'
    and n.listing_url <> '';
$$;

grant execute on function public.negotiation_conflicts() to authenticated, anon;

select 'ok' as tout_est_bon;
