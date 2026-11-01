-- ═══════════════════════════════════════════════════════════════════════════
-- VEILLES PARTAGÉES ENTRE MANAGERS (01/11/2026) — demande Channing : « deux
-- managers d'une même organisation de prospection voient les veilles des uns
-- et des autres et les corrigent si besoin ». La lecture existait déjà
-- (policy prospect_watches_org_select) ; ici l'ÉCRITURE : un manager peut
-- modifier, lancer, mettre en pause ou supprimer une veille dont les leads
-- vont à son organisation (lead_org, sinon celle de l'auteur). L'auteur
-- reste l'auteur (user_id inchangé) ; un commercial ne peut toujours rien
-- changer. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "prospect_watches_org_manager_update" on public.prospect_watches;
create policy "prospect_watches_org_manager_update" on public.prospect_watches
  for update to authenticated
  using (public.ada_is_manager() and coalesce(lead_org, public.organisation_of(user_id)) = public.my_organisation())
  with check (public.ada_is_manager() and coalesce(lead_org, public.organisation_of(user_id)) = public.my_organisation());

drop policy if exists "prospect_watches_org_manager_delete" on public.prospect_watches;
create policy "prospect_watches_org_manager_delete" on public.prospect_watches
  for delete to authenticated
  using (public.ada_is_manager() and coalesce(lead_org, public.organisation_of(user_id)) = public.my_organisation());

select exists (select 1 from pg_policies where tablename = 'prospect_watches' and policyname = 'prospect_watches_org_manager_update')
   and exists (select 1 from pg_policies where tablename = 'prospect_watches' and policyname = 'prospect_watches_org_manager_delete') as tout_est_bon;
