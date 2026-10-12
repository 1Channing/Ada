/*
  # Équipe : activité des comptes de prospection (12/10 soir, Channing :
  #   « pour chaque utilisateur d'un compte prospection, voir les
  #   négociations en cours et le nombre d'analyses lancées depuis
  #   l'ouverture du compte »)

  1. negotiation_analyses : UNE LIGNE PAR ANALYSE LANCÉE (lecture IA d'une
     annonce : à l'ajout, ou relance des photos). Le worker ne journalise
     pas ces lectures et ne connaît pas l'auteur : c'est le front qui trace,
     au moment où le job démarre. Chacun écrit les siennes ; les admins
     lisent tout.
     Reprise : chaque négociation dont les photos viennent d'une lecture
     d'annonce (chemin negotiations/…/photo_NN) compte pour UNE analyse sûre,
     datée de l'ajout — un plancher honnête pour l'historique d'avant.
  2. admin_list_analyses() : par compte, total, aujourd'hui, 7 jours,
     première et dernière (pas de plafond de lignes : agrégé côté base).
  3. admin_list_negotiations() v2 : + numéro du vendeur, suite d'appel
     (outcome, archived_at), nombre de photos, « dans l'Open space ».
  Additif, idempotent.
*/
create table if not exists public.negotiation_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  negotiation_id uuid references public.negotiations(id) on delete set null,
  listing_url text not null default '',
  -- 'ajout' (lecture à l'enregistrement), 'relance' (photos relancées), 'reprise' (historique d'avant le compteur)
  source text not null default 'ajout',
  created_at timestamptz not null default now()
);
create index if not exists idx_negotiation_analyses_user on public.negotiation_analyses (user_id, created_at desc);
alter table public.negotiation_analyses enable row level security;
drop policy if exists "negotiation_analyses_insert" on public.negotiation_analyses;
create policy "negotiation_analyses_insert" on public.negotiation_analyses
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "negotiation_analyses_select" on public.negotiation_analyses;
create policy "negotiation_analyses_select" on public.negotiation_analyses
  for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin));

-- Reprise de l'historique : une analyse sûre par négociation aux photos lues.
insert into public.negotiation_analyses (user_id, negotiation_id, listing_url, source, created_at)
select n.user_id, n.id, n.listing_url, 'reprise', n.created_at
  from public.negotiations n
 where n.photos::text like '%/negotiations/%/photo\_%'
   and not exists (select 1 from public.negotiation_analyses a where a.negotiation_id = n.id);

create or replace function public.admin_list_analyses()
returns table (user_id uuid, total bigint, today bigint, week bigint, first_at timestamptz, last_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id,
         count(*)::bigint as total,
         count(*) filter (where (a.created_at at time zone 'Europe/Paris')::date = (now() at time zone 'Europe/Paris')::date)::bigint as today,
         count(*) filter (where a.created_at >= now() - interval '7 days')::bigint as week,
         min(a.created_at) as first_at,
         max(a.created_at) as last_at
    from public.negotiation_analyses a
   where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
   group by a.user_id;
$$;
grant execute on function public.admin_list_analyses() to authenticated;

drop function if exists public.admin_list_negotiations();
create function public.admin_list_negotiations()
returns table (
  id uuid,
  user_id uuid,
  title text,
  listing_url text,
  asking_price numeric,
  negotiated_price numeric,
  status text,
  notes text,
  updated_at timestamptz,
  created_at timestamptz,
  phone text,
  outcome text,
  archived_at timestamptz,
  photos_count integer,
  in_open_space boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.user_id, n.title, n.listing_url,
         n.asking_price::numeric, n.negotiated_price::numeric, n.status, n.notes,
         n.updated_at, n.created_at,
         n.phone, n.outcome, n.archived_at,
         (case when jsonb_typeof(n.photos) = 'array' then jsonb_array_length(n.photos) else 0 end)::integer as photos_count,
         exists (select 1 from public.open_space_items i where i.negotiation_id = n.id) as in_open_space
    from public.negotiations n
   where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
   order by n.updated_at desc;
$$;
grant execute on function public.admin_list_negotiations() to authenticated;

select exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'negotiation_analyses')
   and exists (select 1 from pg_proc where proname = 'admin_list_analyses')
   and exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                where s.nspname = 'public' and p.proname = 'admin_list_negotiations'
                  and pg_get_function_result(p.oid) like '%in_open_space%') as tout_est_bon;
