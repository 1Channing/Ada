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

let lastTruthMs = 0;

/**
 * TRUTH CENTER brique 1 (26/08) : balayage des signaux de doute — variation/
 * zéro de profondeur, pollution du sample, médiane aberrante, chute de
 * complétude — calculés PAR LA BASE (truth_sweep(), migration 20260826160000)
 * sur les données déjà acquises : zéro scrape, zéro coût Zyte. Upsert des
 * dossiers de vérité, priorisés par usage réel (études quotidiennes actives).
 * Au plus 1×/20 h, best-effort.
 */
export async function runTruthSweep(reason: string): Promise<void> {
  if (Date.now() - lastTruthMs < 20 * 3_600_000) return;
  lastTruthMs = Date.now();
  try {
    const { data, error } = await supabase.rpc('truth_sweep' as never);
    if (error) {
      console.warn(`[TRUTH] balayage (${reason}) échoué : ${error.message} — migration 20260826160000 appliquée ?`);
      lastTruthMs = 0;
      return;
    }
    console.warn(`[TRUTH] balayage (${reason}) : ${Number(data ?? 0)} dossier(s) de vérité ouverts/actualisés`);
  } catch (e) {
    console.warn(`[TRUTH] balayage (${reason}) :`, e instanceof Error ? e.message : e);
    lastTruthMs = 0;
  }
}

/**
 * File de résorption des trous de dictionnaire (Truth Center, signaux posés
 * EN DIRECT par les études quotidiennes) : URL non générable ou critère non
 * exprimé → un dossier par (site, segment, signal), priorité 1 (l'étude
 * tourne chaque jour). Le statut existant n'est jamais écrasé (upsert
 * partiel). Best-effort : jamais bloquant pour le scrape.
 */
export async function recordTruthGap(gap: {
  site: string; country: string; brand: string; model: string; fuel: string;
  signal: 'dictionnaire' | 'url_incomplete';
  summary: string; details: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await (supabase.from('truth_dossiers' as never) as never as {
      upsert: (v: unknown, o: unknown) => PromiseLike<{ error: { message: string } | null }>;
    }).upsert({
      site: gap.site, country: gap.country,
      brand: gap.brand.toUpperCase(), model: gap.model.toUpperCase(),
      fuel: (gap.fuel || '').toLowerCase(),
      signal: gap.signal,
      layer: gap.signal === 'dictionnaire' ? 'dictionnaire' : 'url',
      doubt_score: gap.signal === 'dictionnaire' ? 85 : 60,
      priority: 1,
      summary: gap.summary,
      details: gap.details,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'site,country,brand,model,fuel,signal' });
    if (error) console.warn(`[TRUTH] dossier ${gap.signal} ${gap.site} ${gap.brand} ${gap.model} :`, error.message);
  } catch (e) {
    console.warn('[TRUTH] dossier :', e instanceof Error ? e.message : e);
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
