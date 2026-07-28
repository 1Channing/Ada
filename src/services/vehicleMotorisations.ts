import { sharedSupabase as supabase } from '../lib/supabaseShared';
import { brandKey } from './marketData';
import { refModelKey } from './vehicleRef';

/**
 * Référentiel MOTORISATIONS — immatriculations neuves UE (EEA, 2020-2025).
 * Répond à UNE question pour le planificateur : « ce combo modèle × carburant
 * × année existe-t-il dans la réalité ? » avec les pare-feux validés (27/07) :
 *
 *   1. FAIL-OPEN : modèle absent de la table → jamais signalé improbable.
 *   2. Blocage sur PREUVE seulement : modèle bien couvert (≥ MIN_MODEL_TOTAL
 *      immat. toutes énergies) ET zéro immat. dans le carburant demandé.
 *   3. Année jugée avec marge ± 1 an, et uniquement à l'intérieur de la
 *      période couverte par la source (2020-2025) — hors période : ok.
 *   4. Variantes « e- » : eVito/E-208 vivent sous leur propre clé (EVITO,
 *      E208) — un contrôle ELECTRIQUE unionne clé et E+clé avant verdict.
 *   5. Bruit de saisie (prouvé 27/07) : l'EEA contient des anomalies — BMW
 *      Série 1 « électrique » : 3 immat. sur 461 251, X3 : 28 sur 502 432.
 *      Un carburant est réputé ABSENT sous un seuil relatif au volume du
 *      modèle (0,1 %, borné [20, 500]) — sinon 3 fautes de frappe suffisent
 *      à faire passer « Série 1 électrique » pour un marché réel.
 *
 * Phase 1 : le planificateur se contente de DÉPRIORISER les « improbables »
 * (traçable dans la raison de l'étude). Aucun blocage tant que la boîte noire
 * n'a pas prouvé zéro faux positif.
 */

export interface MotoRow {
  fuel: string;
  years: Record<string, number>;
  total: number;
}

/** Clé `${brandKey}|${refModelKey}` → lignes carburant. */
export type MotoMap = Record<string, MotoRow[]>;

/** Seuil de couverture : sous ce volume total (toutes énergies), le modèle
 *  est considéré mal couvert par la source → aucun verdict (fail-open).
 *  Protège les modèles très récents des millésimes provisoires (Elroq : 26). */
export const MIN_MODEL_TOTAL = 1000;

/** Période couverte par la source — hors de [min-1, max+1], aucun verdict. */
const SOURCE_YEAR_MIN = 2020;
const SOURCE_YEAR_MAX = 2025;

const PAGE = 1000;

export async function loadMotorisations(): Promise<MotoMap> {
  const map: MotoMap = {};
  for (let fromRow = 0; ; fromRow += PAGE) {
    const { data, error } = await supabase
      .from('vehicle_ref_motorisations')
      .select('brand_key, model_key, fuel, years, total')
      .range(fromRow, fromRow + PAGE - 1);
    if (error) throw new Error(`vehicle_ref_motorisations: ${error.message}`);
    for (const r of data ?? []) {
      const key = `${r.brand_key}|${r.model_key}`;
      (map[key] ??= []).push({
        fuel: r.fuel,
        years: (r.years ?? {}) as Record<string, number>,
        total: r.total ?? 0,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return map;
}

let cache: { at: number; map: MotoMap } | null = null;
const TTL = 10 * 60 * 1000;

/** Table absente / vide / erreur réseau → map vide = AUCUN verdict (fail-open). */
export async function getMotorisationsCached(): Promise<MotoMap> {
  if (cache && Date.now() - cache.at < TTL) return cache.map;
  try {
    const map = await loadMotorisations();
    cache = { at: Date.now(), map };
    return map;
  } catch {
    return cache?.map ?? {};
  }
}

export interface MotoVerdict {
  unlikely: boolean;
  /** Raison chiffrée, affichée dans le rapport de campagne (traçabilité). */
  detail?: string;
  /**
   * Force du verdict (phase 2, 28/07) :
   *  - 'zero'  : 0 immat. UE sur toute la période, modèle bien couvert — le
   *              seul verdict assez sûr pour EXCLURE un combo au ciblage forcé.
   *  - 'noise' : quelques immat. anecdotiques — dépriorisation seulement
   *              (un micro-marché d'import reste possible).
   *  - 'year'  : le carburant existe mais pas autour de cette année —
   *              dépriorisation seulement.
   */
  severity?: 'zero' | 'noise' | 'year';
}

/**
 * Total d'immatriculations UE d'un carburant pour un modèle (suggestion PHEV
 * du planificateur). null = modèle inconnu ou mal couvert (fail-open).
 */
export function motoFuelTotal(map: MotoMap, brand: string, model: string, fuel: string): number | null {
  const mk = refModelKey(brand, model);
  if (!mk) return null;
  const rows = map[`${brandKey(brand)}|${mk}`] ?? [];
  if (rows.length === 0) return null;
  const modelTotal = rows.reduce((s, r) => s + r.total, 0);
  if (modelTotal < MIN_MODEL_TOTAL) return null;
  return rows.filter((r) => r.fuel === fuel).reduce((s, r) => s + r.total, 0);
}

export function comboMotoVerdict(
  map: MotoMap,
  brand: string,
  model: string,
  fuel: string | null | undefined,
  year: number | null | undefined,
): MotoVerdict {
  if (!fuel) return { unlikely: false };
  const bk = brandKey(brand);
  const mk = refModelKey(brand, model);
  if (!mk) return { unlikely: false };

  let rows = map[`${bk}|${mk}`] ?? [];
  // Variantes « e- » : pour un contrôle ELECTRIQUE, le e-Vito (clé EVITO)
  // compte pour le Vito — jamais de blocage à cause d'un préfixe.
  if (fuel === 'ELECTRIQUE') {
    rows = [...rows, ...(map[`${bk}|E${mk}`] ?? [])];
  }
  if (rows.length === 0) return { unlikely: false }; // modèle inconnu → fail-open

  const modelTotal = rows.reduce((s, r) => s + r.total, 0);
  if (modelTotal < MIN_MODEL_TOTAL) return { unlikely: false }; // mal couvert

  const fuelRows = rows.filter((r) => r.fuel === fuel);
  const fuelTotal = fuelRows.reduce((s, r) => s + r.total, 0);
  // Pare-feu n° 5 : sous ce seuil, les immat. sont du bruit de saisie EEA,
  // pas un marché (le seuil ne peut créer que des DÉPRIORISATIONS, phase 1).
  const noiseCeil = Math.max(20, Math.min(500, modelTotal * 0.001));
  if (fuelTotal < noiseCeil) {
    return {
      unlikely: true,
      severity: fuelTotal === 0 ? 'zero' : 'noise',
      detail: fuelTotal === 0
        ? `0 immat. UE 2020-2025 en ${fuel} (${modelTotal.toLocaleString('fr-FR')} immat. autres énergies)`
        : `≈0 immat. UE 2020-2025 en ${fuel} (${fuelTotal} anomalies sur ${modelTotal.toLocaleString('fr-FR')})`,
    };
  }

  if (year != null && year - 1 <= SOURCE_YEAR_MAX && year + 1 >= SOURCE_YEAR_MIN) {
    let around = 0;
    for (const r of fuelRows) {
      for (const dy of [-1, 0, 1]) around += r.years[String(year + dy)] ?? 0;
    }
    if (around === 0) {
      return {
        unlikely: true,
        severity: 'year',
        detail: `${fuel} existe (${fuelTotal.toLocaleString('fr-FR')} immat.) mais 0 en ${year} ± 1`,
      };
    }
  }
  return { unlikely: false };
}
