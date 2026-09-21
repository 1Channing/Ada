/**
 * PREUVE DE MARCHÉ « MODÈLE × CARBURANT » (21/09, décision Channing).
 *
 * Lecture de vehicle_fuel_evidence (moisson worker : agrégations coches.net,
 * facettes Marktplaats) et verdict pour le planificateur de campagne :
 *  - 'proven'    : le modèle existe dans ce carburant sur au moins un site
 *                  avec un volume réel (≥ 3 annonces) ou sur deux sites ;
 *  - 'absent'    : la MARQUE est couverte dans ce carburant sur ≥ 2 sites et
 *                  le modèle n'apparaît sur aucun — le combo n'est pas
 *                  planifié (BMW 2-Series Gran Coupé électrique…) ;
 *  - 'unlikely'  : marque couverte sur un seul site, modèle absent — on
 *                  déprioritise sans exclure (marché d'un seul pays) ;
 *  - 'unknown'   : marque jamais vue dans ce carburant, ou table absente —
 *                  fail-open, rien ne change.
 * Clés : brandKey × modelFamilyKey (Mokka-e, Corsa Electric ≡ famille).
 */

import { sharedSupabase as supabase } from '../supabaseShared';
import { brandKey } from '../../services/marketData';
import { modelFamilyKey } from '../study-core/business-logic';

export interface FuelEvidenceEntry { sites: string[]; count: number; labels: string[] }
export interface MarketFuelEvidence {
  /** `${brandKey}|${modelFamilyKey}` → carburant → preuve. */
  byCombo: Record<string, Record<string, FuelEvidenceEntry>>;
  /** carburant → clés marque couvertes → sites où la marque a des modèles. */
  brandSites: Record<string, Record<string, string[]>>;
  rows: number;
}

export const MIN_PROVEN_COUNT = 3;

export async function loadMarketFuelEvidence(): Promise<MarketFuelEvidence | null> {
  const byCombo: MarketFuelEvidence['byCombo'] = {};
  const brandSites: MarketFuelEvidence['brandSites'] = {};
  let rows = 0;
  // Table hors des types générés (migration 21/09) : client délié, comme les
  // autres tables ajoutées après la génération des types.
  const db = supabase as unknown as { from: (t: string) => { select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { range: (a: number, b: number) => Promise<{ data: unknown[] | null; error: unknown }> } } } };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('vehicle_fuel_evidence')
      .select('site, fuel, brand_key, model_key, model, listing_count')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) return null; // table absente / illisible → fail-open
    for (const r of (data ?? []) as Array<{ site: string; fuel: string; brand_key: string; model_key: string; model: string; listing_count: number }>) {
      rows++;
      const fuel = String(r.fuel).toUpperCase();
      const combo = `${r.brand_key}|${r.model_key}`;
      const e = ((byCombo[combo] ??= {})[fuel] ??= { sites: [], count: 0, labels: [] });
      if (!e.sites.includes(r.site)) e.sites.push(r.site);
      e.count += r.listing_count ?? 0;
      if (!e.labels.includes(r.model)) e.labels.push(r.model);
      const bs = ((brandSites[fuel] ??= {})[r.brand_key] ??= []);
      if (!bs.includes(r.site)) bs.push(r.site);
    }
    if (!data || data.length < 1000) break;
  }
  return { byCombo, brandSites, rows };
}

export type FuelEvidenceVerdict =
  | { kind: 'proven'; detail: string }
  | { kind: 'absent'; detail: string }
  | { kind: 'unlikely'; detail: string }
  | { kind: 'unknown' };

export function fuelEvidenceVerdict(ev: MarketFuelEvidence | null | undefined, brand: string, model: string, fuel: string | null | undefined): FuelEvidenceVerdict {
  if (!ev || !fuel) return { kind: 'unknown' };
  const f = String(fuel).toUpperCase();
  const bk = brandKey(brand);
  const mk = modelFamilyKey(model);
  if (!bk || !mk) return { kind: 'unknown' };
  const entry = ev.byCombo[`${bk}|${mk}`]?.[f];
  if (entry && (entry.count >= MIN_PROVEN_COUNT || entry.sites.length >= 2)) {
    return { kind: 'proven', detail: `${entry.count} annonce(s) ${f.toLowerCase()} sur ${entry.sites.join(', ')} (${entry.labels.join(', ')})` };
  }
  const sites = ev.brandSites[f]?.[bk] ?? [];
  if (entry) return { kind: 'unlikely', detail: `${entry.count} annonce(s) ${f.toLowerCase()} seulement (${entry.sites.join(', ')})` };
  if (sites.length >= 2) return { kind: 'absent', detail: `jamais vu en ${f.toLowerCase()} sur ${sites.join(', ')} alors que la marque y est couverte` };
  if (sites.length === 1) return { kind: 'unlikely', detail: `absent en ${f.toLowerCase()} sur ${sites[0]} (marque couverte, un seul site)` };
  return { kind: 'unknown' };
}
