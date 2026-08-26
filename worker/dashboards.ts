/**
 * Tableaux de bord MI précalculés (étage 1 anti-mille-feuille, 26/08).
 *
 * Le worker régénère les tables mi_dashboard_* après chaque vague
 * d'ÉCRITURE — les seuls moments où les chiffres peuvent changer — au lieu
 * de laisser chaque ouverture de page recalculer 400 k lignes. Best-effort
 * et étranglé : deux vagues rapprochées ne recalculent qu'une fois.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';

let lastRefreshMs = 0;

export async function refreshDashboards(reason: string, minIntervalMs = 10 * 60_000): Promise<void> {
  if (Date.now() - lastRefreshMs < minIntervalMs) return;
  lastRefreshMs = Date.now();
  try {
    const { error } = await supabase.rpc('mi_refresh_dashboards' as never);
    if (error) {
      console.warn(`[DASHBOARDS] recalcul (${reason}) échoué : ${error.message} — migration 20260826140000 appliquée ?`);
      lastRefreshMs = 0; // ne pas bloquer la prochaine tentative
    } else {
      console.warn(`[DASHBOARDS] tableaux MI recalculés (${reason})`);
    }
  } catch (e) {
    console.warn(`[DASHBOARDS] recalcul (${reason}) :`, e instanceof Error ? e.message : e);
    lastRefreshMs = 0;
  }
}
