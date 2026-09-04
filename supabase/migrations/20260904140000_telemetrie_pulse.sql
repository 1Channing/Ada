-- ═══════════════════════════════════════════════════════════════════════════
-- TÉLÉMÉTRIE : battement de présence (04/09/2026) — demande Channing : temps
-- d'activité par personne et par semaine (4 semaines). Un changement de page
-- ne mesure pas une durée ; le front écrit désormais un événement
-- kind='pulse' toutes les 5 min quand l'onglet est visible et l'utilisateur
-- actif. kind='page' = l'événement historique (pages visitées).
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.app_usage_events
  add column if not exists kind text not null default 'page';
create index if not exists idx_app_usage_events_kind_at on public.app_usage_events (kind, at desc);

select 'ok' as tout_est_bon;
