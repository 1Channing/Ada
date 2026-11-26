/*
  # Mon compte, PDF joints aux relances groupées, e-mail de test (26/11)

  Channing : « en cliquant sur le nom en haut à droite, chaque compte a accès à ses paramètres : nom, prénom,
  adresse … l'ajout d'une signature mail visuelle … la possibilité de s'envoyer un mail à soi-même pour vérifier » ;
  « j'aimerais pouvoir ajouter un PDF aux mails » (relance groupée de la Carte).

  1. profiles.address : l'adresse postale du compte (page Mon compte).
  2. Fichiers du bucket admin-documents :
     - signatures/… (image de signature, déposée depuis Mon compte) : tout compte MC Export connecté, plus
       seulement les comptes qui ont l'onglet Ventes ;
     - relances/… (PDF joints aux relances groupées) : les comptes qui ont l'onglet Carte.
     Le verrou d'organisation (MC Export seulement) reste tel quel.
  3. dossier_emails : un e-mail de test (kind 'test', vers sa propre adresse, sans dossier ni contact) est accepté
     pour tout compte MC Export, même sans l'onglet Ventes — le worker vérifie déjà que l'expéditeur est le compte
     qui a déposé la ligne. Les autres branches (Ventes / Carte / Demandes) ne bougent pas.

  Additif, idempotent.
*/

alter table public.profiles add column if not exists address text;

create or replace function public.ada_can_see_admin_file(p_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when p_name like 'offres/%' then public.ada_can_see_any(array['offres'])
    when p_name like 'negotiations/%' then public.ada_can_see_any(array['wf:negociations', 'wf:ventes'])
    when p_name like 'signatures/%' then auth.uid() is not null
    when p_name like 'relances/%' then public.ada_can_see_any(array['carte', 'wf:ventes'])
    else public.ada_can_see_any(array['wf:ventes'])
  end;
$$;
revoke all on function public.ada_can_see_admin_file(text) from public, anon;
grant execute on function public.ada_can_see_admin_file(text) to authenticated;

drop policy if exists verrou_org on public.dossier_emails;
create policy verrou_org on public.dossier_emails as restrictive for all to authenticated
  using ((select public.ada_is_mc_export()) and (
    (select public.ada_can_see_any('{wf:ventes}'::text[]))
    or (contact_id is not null and (select public.ada_can_see_any('{carte}'::text[])))
    or (lead_id is not null and (select public.ada_can_see_any('{demandes}'::text[])))
    or (kind = 'test' and transaction_id is null and sent_by = auth.uid())))
  with check ((select public.ada_is_mc_export()) and (
    (select public.ada_can_see_any('{wf:ventes}'::text[]))
    or (contact_id is not null and (select public.ada_can_see_any('{carte}'::text[])))
    or (lead_id is not null and (select public.ada_can_see_any('{demandes}'::text[])))
    or (kind = 'test' and transaction_id is null and sent_by = auth.uid())));

select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'address')
  and (select prosrc like '%signatures/%' from pg_proc where proname = 'ada_can_see_admin_file' limit 1)
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dossier_emails' and policyname = 'verrou_org' and qual like '%''test''%') as tout_est_bon;
