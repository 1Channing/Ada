/**
 * Ada — l'adresse d'une découverte de concessions (17/10) : les pages
 * AutoScout24 d'un pays pour une marque (modèle facultatif), les annonces
 * les plus récentes d'abord ; utilitaires = catégorie X du site (preuve
 * 17/10 : /lst/ford/transit-custom?atype=X). Partagée par le worker (qui lit
 * les pages) et l'onglet Agents (qui montre l'adresse). Testée par
 * test/agents-mail.test.ts.
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
