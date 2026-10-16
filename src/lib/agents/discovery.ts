/**
 * Ada — l'adresse d'une découverte de concessions (17/10) : les pages
 * AutoScout24 d'un pays pour une marque (modèle facultatif), les annonces
 * les plus récentes d'abord ; utilitaires = catégorie X du site (preuve
 * 17/10 : /lst/ford/transit-custom?atype=X). Partagée par le worker (qui lit
 * les pages) et l'onglet Agents (qui montre l'adresse). Testée par
 * test/agents-annuaire.test.ts.
 */
import { getSiteAdapter } from '../study-core/marketplaces';
import type { SearchCriteria } from '../study-core/marketplaces/types';

/** Pays couverts par AutoScout24 dans ADA. */
export const DISCOVERY_COUNTRIES = ['FR', 'DE', 'NL', 'BE', 'ES', 'IT'] as const;

export interface DiscoveryParams { country: string; brand: string; model?: string; vans?: boolean; pages?: number }

export function discoveryUrl(p: DiscoveryParams): string {
  const country = String(p.country ?? '').toUpperCase();
  if (!(DISCOVERY_COUNTRIES as readonly string[]).includes(country)) throw new Error(`AutoScout24 ne couvre pas ce pays dans ADA : ${country || '?'}`);
  const brand = String(p.brand ?? '').trim();
  if (!brand) throw new Error('Une marque est nécessaire (ex. Toyota, Ford).');
  const adapter = getSiteAdapter(`AUTOSCOUT_${country}`);
  if (!adapter) throw new Error(`AutoScout24 ${country} indisponible`);
  const built = adapter.buildSearchUrl({ brand, model: String(p.model ?? '').trim(), sort: 'relevance' } as SearchCriteria);
  const u = new URL(built.url);
  u.searchParams.set('sort', 'age');
  u.searchParams.set('desc', '1');
  if (p.vans) u.searchParams.set('atype', 'X');
  return u.toString();
}

/** Nombre de pages lues par une découverte : 1 à 10 (20 annonces par page). */
export const discoveryPages = (n: unknown): number => Math.max(1, Math.min(10, Math.round(Number(n ?? 5)) || 5));

/** Une découverte du cycle automatique : un pays, une marque, voitures ou utilitaires. */
export interface DiscoveryPair { country: string; brand: string; vans: boolean }

/**
 * Les découvertes possibles pour des cibles : chaque marque dans chaque pays
 * couvert (les pays alternent), puis chaque marque d'utilitaires, en
 * alternance voitures / utilitaires.
 */
export function discoveryPairs(countries: string[], brands: string[], vanBrands: string[]): DiscoveryPair[] {
  const cs = [...new Set(countries.map((c) => c.toUpperCase()))].filter((c) => (DISCOVERY_COUNTRIES as readonly string[]).includes(c));
  const cars = brands.flatMap((brand) => cs.map((country) => ({ country, brand, vans: false })));
  const vans = vanBrands.flatMap((brand) => cs.map((country) => ({ country, brand, vans: true })));
  const out: DiscoveryPair[] = [];
  for (let i = 0; i < Math.max(cars.length, vans.length); i++) {
    if (cars[i]) out.push(cars[i]);
    if (vans[i]) out.push(vans[i]);
  }
  return out;
}

const pairKey = (p: { country?: unknown; brand?: unknown; vans?: unknown }) =>
  `${String(p.country ?? '').toUpperCase()}|${String(p.brand ?? '').trim().toLowerCase()}|${p.vans ? 1 : 0}`;

/** La découverte la moins récente (jamais faite d'abord), d'après l'historique des tâches. */
export function nextDiscoveryPair(pairs: DiscoveryPair[], history: Array<{ params: Partial<DiscoveryParams> | null; created_at: string }>): DiscoveryPair | null {
  if (pairs.length === 0) return null;
  const last = new Map<string, number>();
  for (const h of history) {
    const k = pairKey(h.params ?? {});
    last.set(k, Math.max(last.get(k) ?? 0, Date.parse(h.created_at) || 0));
  }
  return [...pairs].sort((a, b) => (last.get(pairKey(a)) ?? 0) - (last.get(pairKey(b)) ?? 0))[0];
}
