/*
  # Archives pour les comptes de prospection, profils bornés à l'organisation
  #   (12/10 soir, Channing : « si les comptes prospection n'ont pas l'onglet
  #   Archives, ajoute-le ; chaque archive appartient à son organisation,
  #   aucune donnée ne doit se croiser d'une organisation à l'autre »)

  1. Prospection seule = Négociations + Archives : l'organisation Weecars
     (default_tabs) et les comptes déjà réglés sur Négociations seulement.
  2. profiles : jusqu'ici lisible par TOUT compte connecté (politique du
     27/07, `using (true)`) — noms, téléphones et droits de MC Export
     lisibles depuis un compte Weecars par l'API. Désormais : soi-même, les
     collègues de SON organisation, et les admins. Les lectures de l'app
     restent couvertes (profil propre, noms de l'Open space et des rappels
     = même organisation, page Équipe = admin, RPC admin = security definer).
     is_admin_user() est security definer : une politique sur profiles ne
     peut pas relire profiles elle-même (récursion).
  Additif, idempotent ; suppose 20261012150000 passée.
*/
update public.organisations
   set default_tabs = array['wf:negociations', 'wf:archives']
 where default_tabs = array['wf:negociations'];
update public.profiles
   set allowed_tabs = array['wf:negociations', 'wf:archives']
 where allowed_tabs = array['wf:negociations'];

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.is_admin_user() to authenticated, anon;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.organisation_of(id) = public.my_organisation() or public.is_admin_user());

select exists (select 1 from pg_proc where proname = 'is_admin_user')
   and exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_select'
                 and qual like '%is_admin_user%')
   and (select count(*) from public.profiles where allowed_tabs = array['wf:negociations']) = 0 as tout_est_bon;
