/*
  # Organisations (12/10, Channing : « les comptes inscrits sont enregistrés
  #   par organisation — Weecars X ville, Mon agence automobile, MC Export… —
  #   et les Open spaces appartiennent à chaque organisation »)

  - profiles.organisation : texte libre posé par l'admin (page Équipe) ;
    les comptes existants passent « MC Export ».
  - my_organisation() / organisation_of(uuid) : lecture sûre (security
    definer) pour les politiques.
  - Open space : les annonces poussées, leurs notes et la lecture des
    négociations partagées ne circulent qu'au sein d'une organisation.
  - Anti-collision (negotiation_conflicts v3) : « déjà en négo chez X » et
    « vendeur déjà vu » ne regardent que les comptes de MA organisation —
    deux sociétés ne voient pas qui négocie quoi chez l'autre. Même forme de
    retour que la v2 (téléphone, statut, choix d'après appel, titre), drop
    puis create pour rester collable seul.
  - admin_set_organisation(p_user, p_org) : seul un admin change
    l'organisation d'un compte (profiles_update_own interdit sinon).
  Additif, idempotent. Les colonnes phone / outcome / archived_at sont
  ajoutées si la migration 20261012120000 n'est pas encore passée.
*/
alter table public.profiles add column if not exists organisation text;
update public.profiles set organisation = 'MC Export' where organisation is null or organisation = '';

alter table public.negotiations add column if not exists phone text;
alter table public.negotiations add column if not exists outcome text;
alter table public.negotiations add column if not exists archived_at timestamptz;

create or replace function public.organisation_of(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(p.organisation, ''), 'MC Export') from public.profiles p where p.id = p_user;
$$;
create or replace function public.my_organisation()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(public.organisation_of(auth.uid()), 'MC Export');
$$;
grant execute on function public.organisation_of(uuid) to authenticated, anon;
grant execute on function public.my_organisation() to authenticated, anon;

create or replace function public.admin_set_organisation(p_user uuid, p_org text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Réservé aux admins.';
  end if;
  update public.profiles set organisation = coalesce(nullif(trim(p_org), ''), 'MC Export') where id = p_user;
  if not found then raise exception 'Profil introuvable.'; end if;
end $$;
revoke all on function public.admin_set_organisation(uuid, text) from public, anon;
grant execute on function public.admin_set_organisation(uuid, text) to authenticated;

-- Open space par organisation.
drop policy if exists "open_space_items_select" on public.open_space_items;
create policy "open_space_items_select" on public.open_space_items for select to authenticated
  using (public.organisation_of(pushed_by) = public.my_organisation());
drop policy if exists "open_space_notes_select" on public.open_space_notes;
create policy "open_space_notes_select" on public.open_space_notes for select to authenticated
  using (exists (select 1 from public.open_space_items i where i.id = item_id and public.organisation_of(i.pushed_by) = public.my_organisation()));
drop policy if exists "open_space_notes_insert" on public.open_space_notes;
create policy "open_space_notes_insert" on public.open_space_notes for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.open_space_items i where i.id = item_id and public.organisation_of(i.pushed_by) = public.my_organisation()));
drop policy if exists "negotiations_open_space_read" on public.negotiations;
create policy "negotiations_open_space_read" on public.negotiations for select to authenticated
  using (exists (select 1 from public.open_space_items o where o.negotiation_id = negotiations.id and public.organisation_of(o.pushed_by) = public.my_organisation()));

-- Anti-collision v3 : même organisation seulement.
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
    and (n.listing_url <> '' or coalesce(n.phone, '') <> '')
    and coalesce(nullif(p.organisation, ''), 'MC Export') = public.my_organisation();
$$;
grant execute on function public.negotiation_conflicts() to authenticated, anon;

select exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'organisation')
   and (select count(*) from public.profiles where coalesce(organisation, '') = '') = 0
   and exists (select 1 from pg_proc where proname = 'admin_set_organisation')
   and exists (select 1 from pg_proc where proname = 'my_organisation')
   and (select count(*) from pg_proc where proname = 'negotiation_conflicts') = 1 as tout_est_bon;
