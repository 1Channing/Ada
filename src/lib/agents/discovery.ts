/**
 * Ada — l'adresse d'une découverte de concessions (17/10) : les annonces d'un
 * pays pour une marque (modèle facultatif), sur un des sites qu'ADA lit
 * (Channing, 17/10 : « fais tous les sites directement »).
 * - AutoScout24 : les annonces les plus récentes d'abord ; utilitaires =
 *   catégorie X du site (preuve 17/10 : /lst/ford/transit-custom?atype=X).
 * - Les autres sites : l'adresse de recherche de leur adaptateur, celle des
 *   études (aucune grammaire devinée) ; une marque que le site ne connaît pas
 *   encore dans ADA est refusée plutôt que de lire tout le site ; les
 *   utilitaires restent sur AutoScout24 (les autres les rangent à part).
 * Partagée par le worker (qui lit les pages) et l'onglet Agents (qui montre
 * les choix). Testée par test/agents-annuaire.test.ts et test/agents-sites.test.ts.
 */
import { getSiteAdapter } from '../study-core/marketplaces';
import type { SearchCriteria } from '../study-core/marketplaces/types';

/** Pays couverts par AutoScout24 dans ADA. */
export const DISCOVERY_COUNTRIES = ['FR', 'DE', 'NL', 'BE', 'ES', 'IT'] as const;

/**
 * Les sites où Ada découvre des garages, par pays (AutoScout24 d'abord : sa
 * fiche garage est la plus complète). Skelbiu n'y est pas : ses pages de
 * recherche ne donnent pas le vendeur.
 */
export const DISCOVERY_SITES: Record<string, string[]> = {
  FR: ['AUTOSCOUT', 'LEBONCOIN', 'LACENTRALE'],
  NL: ['AUTOSCOUT', 'MARKTPLAATS', 'GASPEDAAL'],
  BE: ['AUTOSCOUT'],
  DE: ['AUTOSCOUT', 'MOBILE_DE'],
  ES: ['AUTOSCOUT', 'COCHES'],
  IT: ['AUTOSCOUT', 'SUBITO'],
  DK: ['BILBASEN'],
  SE: ['BLOCKET'],
  HU: ['JOFOGAS'],
};

export const DISCOVERY_SITE_LABEL: Record<string, string> = {
  AUTOSCOUT: 'AutoScout24', LEBONCOIN: 'Leboncoin', LACENTRALE: 'La Centrale', MARKTPLAATS: 'Marktplaats', GASPEDAAL: 'Gaspedaal',
  MOBILE_DE: 'mobile.de', COCHES: 'coches.net', SUBITO: 'Subito', BILBASEN: 'Bilbasen', BLOCKET: 'Blocket', JOFOGAS: 'Jófogás',
};

export interface DiscoveryParams { site?: string; country: string; brand: string; model?: string; vans?: boolean; pages?: number }

const siteOf = (p: { site?: unknown }) => String(p.site ?? 'AUTOSCOUT').toUpperCase() || 'AUTOSCOUT';

/** La clé d'adaptateur ADA d'une découverte (« AUTOSCOUT_FR », « MARKTPLAATS »…). */
export function discoverySiteKey(p: Pick<DiscoveryParams, 'site' | 'country'>): string {
  const site = siteOf(p);
  return site === 'AUTOSCOUT' ? `AUTOSCOUT_${String(p.country ?? '').toUpperCase()}` : site;
}

export function discoveryUrl(p: DiscoveryParams): string {
  const country = String(p.country ?? '').toUpperCase();
  const site = siteOf(p);
  const brand = String(p.brand ?? '').trim();
  if (!brand) throw new Error('Une marque est nécessaire (ex. Toyota, Ford).');
  const model = String(p.model ?? '').trim();
  if (site === 'AUTOSCOUT') {
    if (!(DISCOVERY_COUNTRIES as readonly string[]).includes(country)) throw new Error(`AutoScout24 ne couvre pas ce pays dans ADA : ${country || '?'}`);
    const adapter = getSiteAdapter(`AUTOSCOUT_${country}`);
    if (!adapter) throw new Error(`AutoScout24 ${country} indisponible`);
    const built = adapter.buildSearchUrl({ brand, model, sort: 'relevance' } as SearchCriteria);
    const u = new URL(built.url);
    u.searchParams.set('sort', 'age');
    u.searchParams.set('desc', '1');
    if (p.vans) u.searchParams.set('atype', 'X');
    return u.toString();
  }
  const label = DISCOVERY_SITE_LABEL[site] ?? site;
  if (!(DISCOVERY_SITES[country] ?? []).includes(site)) throw new Error(`${label} ne couvre pas ce pays dans ADA : ${country || '?'}`);
  if (p.vans) throw new Error(`Utilitaires : AutoScout24 seulement pour l'instant (catégorie X) — ${label} les range dans une rubrique à part.`);
  const adapter = getSiteAdapter(site);
  if (!adapter) throw new Error(`${label} indisponible`);
  const url = adapter.buildSearchUrl({ brand, model, sort: 'relevance' } as SearchCriteria).url;
  // Marque pas encore apprise par ADA sur ce site : l'adaptateur rend la recherche
  // sans marque (ou rien) — on ne lit pas tout le site à la place.
  let wide: string | null = null;
  try { wide = adapter.buildSearchUrl({ brand: '', model: '', sort: 'relevance' } as SearchCriteria).url; } catch { wide = null; }
  if (!url || url === wide) throw new Error(`${label} : ADA ne connaît pas encore la marque « ${brand} » sur ce site (elle s'apprend quand une étude y passe) — choisissez une autre marque ou un autre site.`);
  return url;
}

/** Nombre de pages lues par une découverte : 1 à 10 (20 à 35 annonces par page selon le site). */
export const discoveryPages = (n: unknown): number => Math.max(1, Math.min(10, Math.round(Number(n ?? 5)) || 5));

/** Une découverte du cycle automatique : un site, un pays, une marque, voitures ou utilitaires. */
export interface DiscoveryPair { site: string; country: string; brand: string; vans: boolean }

/**
 * Les découvertes possibles pour des cibles : chaque marque sur chaque site de
 * chaque pays cible (les sites et les pays alternent), puis chaque marque
 * d'utilitaires sur AutoScout24, en alternance voitures / utilitaires.
 */
export function discoveryPairs(countries: string[], brands: string[], vanBrands: string[]): DiscoveryPair[] {
  const cs = [...new Set(countries.map((c) => c.toUpperCase()))].filter((c) => DISCOVERY_SITES[c]);
  // Tour de table : le 1er site de chaque pays, puis le 2e de chaque pays…
  const slots: Array<{ site: string; country: string }> = [];
  for (let rank = 0; rank < 3; rank++) for (const country of cs) { const site = DISCOVERY_SITES[country][rank]; if (site) slots.push({ site, country }); }
  const cars = brands.flatMap((brand) => slots.map((s) => ({ ...s, brand, vans: false })));
  const vanSlots = cs.filter((c) => DISCOVERY_SITES[c].includes('AUTOSCOUT'));
  const vans = vanBrands.flatMap((brand) => vanSlots.map((country) => ({ site: 'AUTOSCOUT', country, brand, vans: true })));
  const out: DiscoveryPair[] = [];
  for (let i = 0; i < Math.max(cars.length, vans.length); i++) {
    if (cars[i]) out.push(cars[i]);
    if (vans[i]) out.push(vans[i]);
  }
  return out;
}

const pairKey = (p: { site?: unknown; country?: unknown; brand?: unknown; vans?: unknown }) =>
  `${siteOf(p)}|${String(p.country ?? '').toUpperCase()}|${String(p.brand ?? '').trim().toLowerCase()}|${p.vans ? 1 : 0}`;

/**
 * La découverte la moins récente (jamais faite d'abord), d'après l'historique
 * des tâches ; `usable` écarte celles qu'on sait impossibles (marque pas
 * encore apprise sur ce site).
 */
export function nextDiscoveryPair(
  pairs: DiscoveryPair[],
  history: Array<{ params: Partial<DiscoveryParams> | null; created_at: string }>,
  usable: (p: DiscoveryPair) => boolean = () => true,
): DiscoveryPair | null {
  const last = new Map<string, number>();
  for (const h of history) {
    const k = pairKey(h.params ?? {});
    last.set(k, Math.max(last.get(k) ?? 0, Date.parse(h.created_at) || 0));
  }
  return [...pairs].sort((a, b) => (last.get(pairKey(a)) ?? 0) - (last.get(pairKey(b)) ?? 0)).find(usable) ?? null;
}
