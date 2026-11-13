/*
  DEMANDES DU SITE : DROIT « demandes » SUR AUTORISATION EXPLICITE (13/11/2026)
  Channing : « ajoute la case pour l'onglet Demandes afin que je puisse l'ajouter pour les gars ».

  Jusqu'ici l'onglet Demandes et les e-mails de réponse (dossier_emails.lead_id) étaient réservés aux
  administrateurs. Désormais :
  1. ada_user_can_see_tab : la clé « demandes » est sur autorisation explicite (comme opportunites, carte:edition,
     offres, agents) — « rien d'enregistré = tout » ne la donne pas, seule une liste qui la nomme l'accorde.
  2. verrou_org (dossier_emails) : les e-mails rattachés à une demande sont lisibles et créables par tout compte
     MC Export qui a le droit « demandes » (les admins l'ont toujours).
  La lecture et le traitement des demandes (site_leads) restaient déjà ouverts à l'équipe MC Export.

  À coller dans Supabase → SQL Editor. Idempotent : peut être recollé.
*/

create or replace function public.ada_user_can_see_tab(p_user uuid, p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when coalesce((to_jsonb(p) ->> 'blocked')::boolean, false) then false
      when coalesce(p.is_admin, false) then true
      when p.allowed_tabs is null then p_key <> all (array['opportunites', 'carte:edition', 'offres', 'agents', 'demandes'])
      else p_key = any (p.allowed_tabs)
        or (p_key = any (array['wf:etudes', 'wf:resultats', 'wf:archives']) and 'workflow' = any (p.allowed_tabs))
        or (p_key = any (array['wf:negociations', 'wf:ventes']) and 'ventes' = any (p.allowed_tabs))
    end
    from public.profiles p
    where p.id = p_user
  ), false);
$$;
revoke all on function public.ada_user_can_see_tab(uuid, text) from public, anon, authenticated;

drop policy if exists verrou_org on public.dossier_emails;
create policy verrou_org on public.dossier_emails as restrictive for all to authenticated
  using ((select public.ada_is_mc_export()) and (
    (select public.ada_can_see_any('{wf:ventes}'::text[]))
    or (contact_id is not null and (select public.ada_can_see_any('{carte}'::text[])))
    or (lead_id is not null and (select public.ada_can_see_any('{demandes}'::text[])))))
  with check ((select public.ada_is_mc_export()) and (
    (select public.ada_can_see_any('{wf:ventes}'::text[]))
    or (contact_id is not null and (select public.ada_can_see_any('{carte}'::text[])))
    or (lead_id is not null and (select public.ada_can_see_any('{demandes}'::text[])))));

select
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dossier_emails' and policyname = 'verrou_org' and qual like '%demandes%')
  and (select prosrc like '%''demandes''%' from pg_proc where proname = 'ada_user_can_see_tab' limit 1) as tout_est_bon;
