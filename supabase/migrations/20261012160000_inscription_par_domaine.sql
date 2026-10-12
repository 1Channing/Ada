/*
  # Inscription par domaine (12/10 soir, constat Channing : « Database error
  #   saving new user » quand un gars de Weecars s'inscrit)

  Cause : le verrou d'inscription (auth_allowlist, cinq adresses mc-export /
  monagenceautomobile) refusait l'adresse, et Supabase masque l'exception du
  trigger derrière ce message générique. Deux remèdes :
  - l'écran dit désormais « Adresse non autorisée à s'inscrire » (front) ;
  - une ligne « @weecars.fr » dans les adresses autorisées ouvre TOUT le
    domaine, avec son organisation — plus besoin d'ajouter chaque adresse.
  Le trigger du verrou et celui de l'organisation du profil lisent l'adresse
  exacte, sinon le domaine. Additif, idempotent ; suppose 20261012150000.
*/
create or replace function public.allowlist_match(p_email text)
returns public.auth_allowlist
language sql
stable
security definer
set search_path = public
as $$
  select a.* from public.auth_allowlist a
   where lower(a.email) = lower(coalesce(p_email, ''))
      or (a.email like '@%' and lower(coalesce(p_email, '')) like '%' || lower(a.email))
   order by (a.email like '@%') asc
   limit 1;
$$;
revoke all on function public.allowlist_match(text) from public, anon, authenticated;

create or replace function public.enforce_auth_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- FAIL-OPEN : liste vide = aucun verrou (l'équipe n'est pas encore saisie).
  if not exists (select 1 from public.auth_allowlist) then
    return new;
  end if;
  if (public.allowlist_match(new.email)).email is not null then
    return new;
  end if;
  raise exception 'Inscription réservée aux adresses autorisées — demande à un admin d''ajouter ton adresse ou ton domaine.';
end;
$$;

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
    -- 1. L'adresse autorisée (exacte, sinon son domaine) porte une organisation : elle prime.
    v_org := nullif((public.allowlist_match(v_email)).organisation, '');
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

select exists (select 1 from pg_proc where proname = 'allowlist_match')
   and exists (select 1 from pg_trigger where tgname = 'trg_enforce_auth_allowlist')
   and exists (select 1 from pg_trigger where tgname = 'trg_profile_default_organisation') as tout_est_bon;
