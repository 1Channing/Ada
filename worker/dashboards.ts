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
let lastArchiveMs = 0;

/**
 * ÉTAGE 2 (26/08) : bascule les observations de plus de 60 jours vers
 * l'archive requêtable (migration 20260826150000) — JAMAIS de suppression,
 * la vue market_listing_observations_all recolle chaud + archive. Par lots
 * de 20 000 (la fonction SQL est atomique par lot), au plus une fois par
 * 20 h, best-effort : un échec n'empêche jamais la vague quotidienne.
 * Appelée AVANT refreshDashboards — les tableaux se recalculent sur des
 * tables déjà rangées.
 */
export async function archiveOldObservations(reason: string): Promise<void> {
  if (Date.now() - lastArchiveMs < 20 * 3_600_000) return;
  lastArchiveMs = Date.now();
  let total = 0;
  try {
    // Plafond de tours : 25 lots = 500 k lignes max par nuit — largement au-
    // dessus du flux quotidien, borne dure contre une boucle infinie.
    for (let i = 0; i < 25; i++) {
      const { data, error } = await supabase.rpc('mi_archive_observations' as never, {
        p_keep_days: 60, p_batch: 20_000,
      } as never);
      if (error) {
        console.warn(`[ARCHIVE] bascule (${reason}) échouée : ${error.message} — migration 20260826150000 appliquée ?`);
        lastArchiveMs = 0;
        return;
      }
      const moved = Number(data ?? 0);
      total += moved;
      if (moved < 20_000) break;
    }
    if (total > 0) console.warn(`[ARCHIVE] ${total} observation(s) > 60 j déplacées vers l'archive (${reason})`);
  } catch (e) {
    console.warn(`[ARCHIVE] bascule (${reason}) :`, e instanceof Error ? e.message : e);
    lastArchiveMs = 0;
  }
}

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
