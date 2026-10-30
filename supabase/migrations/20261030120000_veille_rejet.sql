-- ═══════════════════════════════════════════════════════════════════════════
-- REJETER UN LEAD DE VEILLE (30/10/2026) — demande Channing : « ajouter la
-- possibilité de rejeter un lead lorsqu'il ne correspond pas aux critères ».
-- Statut 'rejected' sur prospect_watch_hits (taken_by = qui l'a rejeté) : le
-- lead disparaît pour toute l'organisation, la mémoire de la veille le garde
-- (il ne reviendra pas). La policy de prise accepte désormais saved OU
-- rejected, toujours depuis inbox et à son nom. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "prospect_watch_hits_take" on public.prospect_watch_hits;
create policy "prospect_watch_hits_take" on public.prospect_watch_hits
  for update to authenticated
  using (status = 'inbox' and public.ada_watch_visible(watch_id))
  with check (status in ('saved', 'rejected') and taken_by = auth.uid() and public.ada_watch_visible(watch_id));

select exists (select 1 from pg_policies where tablename = 'prospect_watch_hits' and policyname = 'prospect_watch_hits_take'
                 and with_check like '%rejected%') as tout_est_bon;
