/**
 * SUBITO.IT — adaptateur v1 (01/08/2026), écrit sur PREUVE.
 *
 * Étalon : URL humaine Channing
 *   /annunci-italia/vendita/auto/toyota/ibrida/?order=relevance&me=18&ys=2023&ye=2023
 * + dump NEXT_DATA du 01/08 (recon jobs rec_msaxb3nj / dumps subito-*.json) :
 *   props.pageProps.initialState.items.{total,totalPages,originalList[]}
 *   chaque annonce (kind:AdItem) porte subject, body, date, urls.default et un
 *   dictionnaire features par URI AVEC CODES ENUM :
 *     /car     → values[0]=Marca {key:'000103',value:'TOYOTA'},
 *                values[1]=Modello {key:'004796',value:'Yaris Cross',group_key},
 *                values[2]=Versione (texte libre)
 *     /price   → key '22900' (€ entiers)   /year → key '2023' (immatriculation)
 *     /mileage_scalar → key '21400' (km)   /gearbox → {key:'2',value:'Automatico'}
 *     /fuel    → {key:'6',value:'Ibrida'}  /register_date → '04/2023'
 *
 * v1 VOLONTAIREMENT sans modèle dans l'URL (grammaire non prouvée) : la page
 * marque+carburant est scrapée, chaque annonce rend son marque/modèle
 * STRUCTURÉ, et la voie « URL apprise » (ingestion humaine d'une URL modèle)
 * prendra le relais comme pour Marktplaats. Pagination non prouvée non plus :
 * page 1 seulement (36 annonces embarquées mesurées).
 */

import type {
  SiteAdapter, SearchCriteria, BuildUrlResult,
  SiteValidationResult, ZyteProfileOverrides, CandidateSegment,
} from './types';
import type { ScrapedListing } from '../types';
import { defaultBuildPaginatedUrl } from './registry';
import { resolveYearRange } from './urlTemplate';

const URL_TEMPLATE =
  'https://www.subito.it/annunci-italia/vendita/auto/{brand}/{fuel}/?ys={yearFrom}&ye={yearTo}';

// Seuls slugs PROUVÉS (URL humaine du 01/08). Tout le reste est omis de
// l'URL — fail-open : mieux vaut une page plus large que du guessing.
const FUEL_SLUG: Record<string, string> = {
  HYBRIDE: 'ibrida', HYBRID: 'ibrida', IBRIDA: 'ibrida',
  // La famille couvre les rechargeables comme sur Marktplaats — l'annonce
  // elle-même (features /fuel) et le texte raffinent ensuite.
  PLUG_IN_HYBRID: 'ibrida', MILD_HYBRID: 'ibrida',
};

const slugify = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface SubitoFeatureValue { key?: string; value?: string; level?: number; group_key?: string }
interface SubitoAd {
  kind?: string; subject?: string; body?: string;
  urls?: { default?: string };
  features?: Record<string, { values?: SubitoFeatureValue[] }>;
}

function nextDataItems(html: string): { total: number | null; ads: SubitoAd[] } | null {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    const items = JSON.parse(m[1])?.props?.pageProps?.initialState?.items;
    if (!items || typeof items !== 'object') return null;
    const ads = Array.isArray(items.originalList) ? (items.originalList as SubitoAd[]) : [];
    return { total: typeof items.total === 'number' ? items.total : null, ads };
  } catch { return null; }
}

const fv = (ad: SubitoAd, uri: string, idx = 0): SubitoFeatureValue | undefined =>
  ad.features?.[uri]?.values?.[idx];
const fNum = (ad: SubitoAd, uri: string): number | null => {
  const k = fv(ad, uri)?.key;
  const n = k != null ? Number(k) : NaN;
  return Number.isFinite(n) ? n : null;
};

function parseSearchResults(html: string, _url: string): ScrapedListing[] {
  const data = nextDataItems(html);
  if (!data) return [];
  const out: ScrapedListing[] = [];
  for (const ad of data.ads) {
    if (ad.kind !== 'AdItem') continue;
    const price = fNum(ad, '/price');
    if (price == null || price <= 0) continue;
    out.push({
      title: ad.subject ?? '',
      description: ad.body ?? '',
      price,
      currency: 'EUR',
      price_type: 'one-off',
      year: fNum(ad, '/year'),
      mileage: fNum(ad, '/mileage_scalar'),
      trim: fv(ad, '/car', 2)?.value ?? null, // Versione
      listing_url: ad.urls?.default ?? '',
      brand: fv(ad, '/car', 0)?.value ?? null,
      fuel: fv(ad, '/fuel')?.value ?? null,
      gearbox: fv(ad, '/gearbox')?.value ?? null,
      sellerType: null,
    });
  }
  return out;
}

/** Vide confirmé par le site lui-même : items.total est DANS la page. */
function detectEmptyState(html: string): boolean | null {
  const data = nextDataItems(html);
  if (!data || data.total == null) return null;
  if (data.total === 0) return true;
  return data.ads.length > 0 ? false : false; // total>0 sans annonces lisibles = suspect, pas un vide
}

/** Moisson des CODES ENUM embarqués dans chaque annonce (marques, modèles
 *  avec group_key, carburants, boîtes) — c'était LA question de la recon. */
function harvestTaxonomy(html: string): Array<{ field: string; code: string; label: string }> {
  const data = nextDataItems(html);
  if (!data) return [];
  const out: Array<{ field: string; code: string; label: string }> = [];
  const seen = new Set<string>();
  const push = (field: string, code?: string, label?: string) => {
    if (!code || !label) return;
    const k = `${field}|${code}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ field, code, label });
  };
  for (const ad of data.ads) {
    const brand = fv(ad, '/car', 0);
    const model = fv(ad, '/car', 1);
    push('sb:brand', brand?.key, brand?.value);
    // Le modèle est scopé à sa marque (comme mp:model) : code unique du site.
    if (brand?.value) push(`sb:model:${slugify(brand.value)}`, model?.key, model?.value);
    push('sb:fuel', fv(ad, '/fuel')?.key, fv(ad, '/fuel')?.value);
    push('sb:gearbox', fv(ad, '/gearbox')?.key, fv(ad, '/gearbox')?.value);
  }
  return out;
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const brandSlug = slugify(params.brand || '');
  const fuelSlug = params.fuel ? FUEL_SLUG[String(params.fuel).trim().toUpperCase()] : undefined;
  if (params.fuel && !fuelSlug) {
    warnings.push(`[LINKGEN_WARNING] Subito: carburant "${params.fuel}" sans slug prouvé — filtre omis`);
  }
  if (params.model) {
    warnings.push('[LINKGEN_WARNING] Subito v1: modèle non posé en URL (grammaire non prouvée) — page marque, tri par le texte/structuré en aval');
  }
  const path = `/annunci-italia/vendita/auto/${brandSlug}${fuelSlug ? `/${fuelSlug}` : ''}/`;
  const qs = new URLSearchParams();
  const { yearFrom, yearTo } = resolveYearRange(params);
  if (yearFrom) qs.set('ys', yearFrom);
  if (yearTo) qs.set('ye', yearTo);
  const q = qs.toString();
  return { url: `https://www.subito.it${path}${q ? `?${q}` : ''}`, warnings };
}

function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
  const listings = parseSearchResults(html, url);
  const wantBrand = (params.brand ?? '').trim().toLowerCase();
  const brandHits = wantBrand ? listings.filter((l) => (l.brand ?? '').toLowerCase().includes(wantBrand)).length : listings.length;
  const brandOk = listings.length > 0 && brandHits / listings.length >= 0.8;
  const issues: SiteValidationResult['issues'] = [];
  if (!brandOk && wantBrand) issues.push({ type: 'brand_missing' });
  if (params.model) issues.push({ type: 'model_not_applied' }); // v1 : jamais posé en URL
  if (listings.length === 0) issues.push({ type: 'no_listings' });
  return {
    site: 'SUBITO', url, listingCount,
    sampleListings: listings.slice(0, 5).map((l) => ({ title: l.title, price: l.price, year: l.year, mileage: l.mileage, fuel: l.fuel ?? '', url: l.listing_url })),
    appliedFilters: { brand: brandOk, model: false, year: true, mileage: false, fuel: Boolean(params.fuel && FUEL_SLUG[String(params.fuel).toUpperCase()]), trim: false, sort: false },
    score: brandOk ? 70 : 30,
    status: listings.length === 0 ? 'invalid' : brandOk ? 'partial' : 'invalid',
    issues,
    evidence: { structuredFieldsAvailable: true, fieldsUsed: ['brand', 'model', 'fuel', 'gearbox', 'year', 'mileage', 'price'], missingFields: [] },
  };
}

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const out: Partial<SearchCriteria> = {};
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('auto');
    if (i >= 0 && segs[i + 1]) out.brand = segs[i + 1].replace(/-/g, ' ').toUpperCase();
    if (i >= 0 && segs[i + 2] === 'ibrida') out.fuel = 'HYBRIDE';
    const ys = u.searchParams.get('ys'), ye = u.searchParams.get('ye');
    if (ys && /^\d{4}$/.test(ys)) out.yearFrom = ys;
    if (ye && /^\d{4}$/.test(ye)) out.yearTo = ye;
  } catch { /* URL illisible */ }
  return out;
}

function extractCandidateSegments(url: string): CandidateSegment[] {
  const out: CandidateSegment[] = [];
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('auto');
    if (i >= 0 && segs[i + 1]) out.push({ raw: segs[i + 1], location: 'path', paramName: '_path:brand', guessField: 'brand' });
    if (i >= 0 && segs[i + 2]) out.push({ raw: segs[i + 2], location: 'path', paramName: '_path:fuel', guessField: 'fuel' });
    if (i >= 0 && segs[i + 3]) out.push({ raw: segs[i + 3], location: 'path', paramName: '_path:model', guessField: 'model' });
    for (const [p, f] of [['ys', 'year'], ['ye', 'year'], ['me', 'mileage']] as const) {
      const v = u.searchParams.get(p);
      if (v) out.push({ raw: v, location: 'query', paramName: p, guessField: f });
    }
  } catch { /* ignore */ }
  return out;
}

export const subitoAdapter: SiteAdapter = {
  key: 'SUBITO',
  displayName: 'Subito',
  country: 'Italy',
  countryCode: 'IT',
  domain: 'subito.it',
  urlTemplate: URL_TEMPLATE,

  mapBrand: (raw) => slugify(raw),
  mapModel: (raw) => raw.trim(),
  mapFuel: (raw) => FUEL_SLUG[raw.trim().toUpperCase()] ?? '',
  supportsParam: () => false,

  buildSearchUrl,
  buildPaginatedUrl: defaultBuildPaginatedUrl, // pagination réelle non prouvée : page 1
  parseSearchResults,
  scoreSearchResults,
  generateCorrectionHypotheses: () => [],
  getFetchProfile: (): ZyteProfileOverrides => ({}),

  detectEmptyState,
  harvestTaxonomy,
  prefillCriteriaFromUrl,
  extractCandidateSegments,
};
