/**
 * Référentiel constructeur (vehicle_ref_generations) — fenêtres de
 * commercialisation par modèle, clé canonique partagée entre l'importeur,
 * le planificateur de campagnes et le MI.
 *
 * Source of truth ~98 % (base Teoalida Europe, décision Channing 22/07) —
 * d'où le contrat FAIL-OPEN partout : un modèle absent du référentiel n'est
 * jamais bloqué ni filtré, il est seulement compté « hors référentiel ».
 */

import { sharedSupabase as supabase } from '../lib/supabaseShared';
import { brandKey, refModelKey } from './marketData';

// refModelKey vit désormais dans marketData (clé d'identité modèle de TOUT
// le système : MI, radar, purge, menus — chantier nommage 02/08). Ré-export
// pour les consommateurs historiques du référentiel.
export { refModelKey } from './marketData';

export interface RefWindow {
  brandLabel: string;
  modelLabel: string;
  yearFrom: number;
  /** null = au moins une génération encore en production. */
  yearTo: number | null;
}

export type RefWindowMap = Map<string, RefWindow>; // clé `${brandKey}|${refModelKey}`

export function refComboKey(brand: string, model: string): string {
  return `${brandKey(brand)}|${refModelKey(brand, model)}`;
}

/**
 * Charge TOUT le référentiel (paginé — PostgREST plafonne à ~1000 lignes) et
 * agrège par modèle : fenêtre = [min(year_from), max(year_to)], ouverte si
 * une génération est ouverte. Map vide si la table n'existe pas encore —
 * fail-open, rien ne change tant que le SQL n'est pas appliqué.
 */
export async function loadRefWindows(): Promise<RefWindowMap> {
  const map: RefWindowMap = new Map();
  const PAGE = 1000;
  for (let fromRow = 0; ; fromRow += PAGE) {
    const { data, error } = await supabase
      .from('vehicle_ref_generations')
      .select('brand_key, model_key, brand_label, model_label, year_from, year_to')
      .range(fromRow, fromRow + PAGE - 1);
    if (error || !data) break;
    for (const r of data as Array<Record<string, unknown>>) {
      const key = `${r.brand_key}|${r.model_key}`;
      const from = Number(r.year_from);
      const to = r.year_to == null ? null : Number(r.year_to);
      const cur = map.get(key);
      if (!cur) {
        map.set(key, {
          brandLabel: String(r.brand_label ?? ''), modelLabel: String(r.model_label ?? ''),
          yearFrom: from, yearTo: to,
        });
      } else {
        cur.yearFrom = Math.min(cur.yearFrom, from);
        if (cur.yearTo !== null) cur.yearTo = to === null ? null : Math.max(cur.yearTo, to);
      }
    }
    if (data.length < PAGE) break;
  }
  return map;
}

// Cache module (10 min) : le moteur de campagne consulte la fenêtre à chaque
// étude « marché vide » — on ne repaye pas 4 requêtes paginées à chaque fois.
let windowsCache: { at: number; map: RefWindowMap } | null = null;
export async function getRefWindowsCached(ttlMs = 10 * 60 * 1000): Promise<RefWindowMap> {
  if (windowsCache && Date.now() - windowsCache.at < ttlMs) return windowsCache.map;
  const map = await loadRefWindows();
  windowsCache = { at: Date.now(), map };
  return map;
}

/** Fenêtre d'un couple marque/modèle tel qu'écrit dans nos critères. */
export function findRefWindow(map: RefWindowMap, brand: string, model: string): RefWindow | null {
  return map.get(refComboKey(brand, model)) ?? null;
}

/**
 * Une année est-elle DANS la fenêtre ? Marge +1 en sortie (immatriculations
 * tardives du stock). Modèle inconnu → true (fail-open, par contrat).
 */
export function yearInRefWindow(win: RefWindow | null, year: number): boolean {
  if (!win) return true;
  if (year < win.yearFrom) return false;
  if (win.yearTo !== null && year > win.yearTo + 1) return false;
  return true;
}
