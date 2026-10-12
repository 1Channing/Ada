/*
  # Inscription avec choix de l'organisation (12/10 soir, Channing : « quand
  #   on crée un compte, un menu déroulant pour choisir une organisation — il
  #   doit y en avoir 3 dont Weecars, comme ça les gars peuvent créer leurs
  #   comptes »)

  - Trois organisations de départ : MC Export, Weecars, Mon agence automobile
    (renommables / complétables dans Équipe).
  - public_organisations() : la liste, lisible AVANT connexion (page
    d'inscription) — noms seulement.
  - À la naissance du profil, l'organisation est, dans l'ordre : celle de
    l'adresse autorisée (posée par l'admin, elle prime), sinon celle choisie à
    l'inscription (si elle existe dans la liste — gardée dans les métadonnées
    du compte pour survivre à la confirmation d'e-mail), sinon MC Export.
  - organisations.default_tabs : les onglets que reçoit tout NOUVEAU compte
    de l'organisation (« Weecars n'auront que des comptes prospection » →
    ['wf:negociations']) ; NULL = tout. Posé à la naissance du profil quand
    aucun droit n'est encore enregistré ; l'admin reste libre de changer
    les onglets d'un compte après.
  Additif, idempotent ; suppose la migration 20261012140000 passée.
*/
alter table public.organisations add column if not exists default_tabs text[];
insert into public.organisations (name, default_tabs) values
  ('MC Export', null),
  ('Weecars', array['wf:negociations']),
  ('Mon agence automobile', null)
on conflict (name) do nothing;
update public.organisations set default_tabs = array['wf:negociations'] where name = 'Weecars' and default_tabs is null;

create or replace function public.public_organisations()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select name from public.organisations order by (name = 'MC Export') desc, name;
$$;
grant execute on function public.public_organisations() to anon, authenticated;

create or replace function public.profile_default_organisation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_meta text;
  v_org text;
begin
  if tg_op = 'INSERT' then
    select u.email, nullif(trim(u.raw_user_meta_data->>'organisation'), '')
      into v_email, v_meta
      from auth.users u where u.id = new.id;
    -- 1. L'adresse autorisée porte une organisation : elle prime.
    select a.organisation into v_org
      from public.auth_allowlist a
     where lower(a.email) = lower(coalesce(v_email, '')) and coalesce(a.organisation, '') <> ''
     limit 1;
    -- 2. Sinon le choix fait à l'inscription (ligne ou métadonnées), s'il est dans la liste.
    if v_org is null and coalesce(new.organisation, '') <> ''
       and exists (select 1 from public.organisations o where o.name = new.organisation) then
      v_org := new.organisation;
    end if;
    if v_org is null and v_meta is not null
       and exists (select 1 from public.organisations o where o.name = v_meta) then
      v_org := v_meta;
    end if;
    new.organisation := coalesce(v_org, 'MC Export');
    -- 3. Les onglets par défaut de l'organisation, si aucun droit n'est posé.
    if new.allowed_tabs is null then
      select o.default_tabs into new.allowed_tabs from public.organisations o where o.name = new.organisation;
    end if;
  elsif coalesce(new.organisation, '') = '' then
    new.organisation := 'MC Export';
  end if;
  insert into public.organisations (name) values (new.organisation) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists trg_profile_default_organisation on public.profiles;
create trigger trg_profile_default_organisation
  before insert or update of organisation on public.profiles
  for each row execute function public.profile_default_organisation();

select (select count(*) from public.organisations where name in ('MC Export', 'Weecars', 'Mon agence automobile')) = 3
   and exists (select 1 from public.organisations where name = 'Weecars' and default_tabs = array['wf:negociations'])
   and exists (select 1 from pg_proc where proname = 'public_organisations')
   and exists (select 1 from pg_trigger where tgname = 'trg_profile_default_organisation') as tout_est_bon;
