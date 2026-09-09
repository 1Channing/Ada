-- ═══════════════════════════════════════════════════════════════════════════
-- TÉLÉMÉTRIE — rattacher les événements ORPHELINS à leur compte (09/09/2026,
-- constat Channing : « plus de comptes que d'utilisateurs »). Avant le
-- correctif du 09/09, le premier événement de chaque session partait avant
-- la restauration de session : user_id nul, libellé = prénom historique ou
-- identifiant d'appareil. Attribution prouvée par corrélation à 90 s :
--   appareil-uh4m53 → Channing ; appareil-7u5tsh → Antoine ;
--   libellés « channing »/« antoine » sans compte → le compte du même nom.
-- appareil-7tum4z (1 événement, 02/09, personne derrière) : supprimé.
-- Idempotent (ne touche que les lignes sans user_id).
-- ═══════════════════════════════════════════════════════════════════════════

update public.app_usage_events e
set user_id = u.id
from auth.users u
where e.user_id is null
  and u.email = 'channing@mc-export.com'
  and (lower(trim(e.visitor)) in ('channing', 'appareil-uh4m53'));

update public.app_usage_events e
set user_id = u.id
from auth.users u
where e.user_id is null
  and u.email = 'segre@monagenceautomobile.fr'
  and (lower(trim(e.visitor)) in ('antoine', 'appareil-7u5tsh'));

delete from public.app_usage_events
where user_id is null and lower(trim(visitor)) like 'appareil-%';

select 'ok' as tout_est_bon;
