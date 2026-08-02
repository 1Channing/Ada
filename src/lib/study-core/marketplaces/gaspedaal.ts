/**
 * GASPEDAAL.NL — adaptateur v1 (01/08/2026), écrit sur PREUVE.
 *
 * Agrégateur néerlandais. Étalon : URL humaine Channing
 *   /toyota/hybride?bmin=2023&bmax=2023&kmax=90000&srt=df-a
 * + dump JSON-LD du 01/08 (recon rec_msaxb0ww / gasp-ld0.json) : la page
 * embarque un ItemList schema.org de **100 annonces** entièrement structurées :
 *   item {@type:[Car,Product], name, brand, model, productionDate,
 *         mileageFromOdometer{value}, fuelType:'Hybride',
 *         vehicleTransmission:'Automaat', color, numberOfDoors,
 *         offers{price, priceCurrency:'EUR', seller{name,@type:AutoDealer}}}
 * L'@id de chaque item = URL de recherche + #<id interne> — c'est l'identité
 * d'annonce disponible (pas d'URL de fiche dans le JSON-LD) : suffisant pour
 * la déduplication et le suivi, le clic « Ouvrir » ancre la page de recherche.
 *
 * v1 sans modèle dans l'URL (grammaire non prouvée — la voie « URL apprise »
 * prendra le relais) ; pagination non prouvée : page 1 = 100 annonces.
 */

import type {
  SiteAdapter, SearchCriteria, BuildUrlResult,
  SiteValidationResult, ZyteProfileOverrides, CandidateSegment,
} from './types';
import type { ScrapedListing } from '../types';
import { defaultBuildPaginatedUrl } from './registry';
import { resolveYearRange } from './urlTemplate';

const URL_TEMPLATE = 'https://www.gaspedaal.nl/{brand}/{fuel}?bmin={yearFrom}&bmax={yearTo}&kmax={mileage}&srt=df-a';

// Slugs PROUVÉS par URLs humaines (01/08 hybride, 02/08 /bmw/diesel) — le
// reste est omis (fail-open).
const FUEL_SLUG: Record<string, string> = {
  HYBRIDE: 'hybride', HYBRID: 'hybride',
  PLUG_IN_HYBRID: 'hybride', MILD_HYBRID: 'hybride',
  DIESEL: 'diesel',
};

const slugify = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface GpItem {
  '@type'?: string | string[];
  '@id'?: string;
  name?: string; brand?: string; model?: string;
  productionDate?: number | string;
  mileageFromOdometer?: { value?: number };
  fuelType?: string; vehicleTransmission?: string; color?: string;
  numberOfDoors?: number;
  offers?: { price?: number; priceCurrency?: string; seller?: { name?: string; '@type'?: string } };
}

function jsonLdCars(html: string): GpItem[] {
  const out: GpItem[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const ld = JSON.parse(m[1]);
      if (ld?.['@type'] !== 'ItemList' || !Array.isArray(ld.itemListElement)) continue;
      for (const el of ld.itemListElement) {
        const item = el?.item as GpItem | undefined;
        const t = item?.['@type'];
        if (item && (Array.isArray(t) ? t.includes('Car') : t === 'Car')) out.push(item);
      }
    } catch { /* JSON-LD illisible — ignorer ce bloc */ }
  }
  return out;
}

function parseSearchResults(html: string, _url: string): ScrapedListing[] {
  const out: ScrapedListing[] = [];
  for (const it of jsonLdCars(html)) {
    const price = typeof it.offers?.price === 'number' ? it.offers.price : Number(it.offers?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const year = Number(it.productionDate);
    const mileage = Number(it.mileageFromOdometer?.value);
    out.push({
      title: it.name ?? '',
      description: '',
      price,
      currency: 'EUR', // priceCurrency:'EUR' prouvé sur les 100 items du dump
      price_type: 'one-off',
      year: Number.isFinite(year) ? year : null,
      mileage: Number.isFinite(mileage) ? mileage : null,
      trim: null,
      listing_url: it['@id'] ?? '',
      brand: it.brand ?? null,
      model: it.model ?? null,
      fuel: it.fuelType ?? null,
      gearbox: it.vehicleTransmission ?? null,
      color: it.color ?? null,
      doors: typeof it.numberOfDoors === 'number' ? it.numberOfDoors : null,
      sellerType: it.offers?.seller?.['@type'] ?? null,
    });
  }
  return out;
}

/** Moisson : marques/modèles/carburants depuis les annonces JSON-LD — le site
 *  n'a pas de codes opaques, le slug d'URL EST dérivable du label (preuve :
 *  /bmw/diesel, /toyota/hybride). Champ modèle scopé à sa marque. */
function harvestTaxonomy(html: string): Array<{ field: string; code: string; label: string }> {
  const out: Array<{ field: string; code: string; label: string }> = [];
  const seen = new Set<string>();
  const push = (field: string, code: string, label: string) => {
    if (!code || !label) return;
    const k = `${field}|${code}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ field, code, label });
  };
  for (const it of jsonLdCars(html)) {
    const brand = (it.brand ?? '').trim();
    const model = (it.model ?? '').trim();
    if (brand) push('gp:brand', slugify(brand), brand);
    if (brand && model) push(`gp:model:${slugify(brand)}`, slugify(model), model);
    const fuel = (it.fuelType ?? '').trim();
    if (fuel) push('gp:fuel', slugify(fuel), fuel);
  }
  return out;
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const brandSlug = slugify(params.brand || '');
  const fuelSlug = params.fuel ? FUEL_SLUG[String(params.fuel).trim().toUpperCase()] : undefined;
  if (params.fuel && !fuelSlug) {
    warnings.push(`[LINKGEN_WARNING] Gaspedaal: carburant "${params.fuel}" sans slug prouvé — filtre omis`);
  }
  if (params.model) {
    warnings.push('[LINKGEN_WARNING] Gaspedaal v1: modèle non posé en URL (grammaire non prouvée) — page marque, tri en aval');
  }
  const qs = new URLSearchParams();
  const { yearFrom, yearTo } = resolveYearRange(params);
  if (yearFrom) qs.set('bmin', yearFrom);
  if (yearTo) qs.set('bmax', yearTo);
  if (params.mileage) qs.set('kmax', String(params.mileage));
  // PRIX CROISSANT — preuve par paire d'URLs humaines (Channing 02/08) :
  // srt=pr-a = « Prijs laag-hoog », srt=df-a = relevantie. Le bas du marché
  // est ce qu'on arbitre : les études prennent pr-a.
  qs.set('srt', 'pr-a');
  return { url: `https://www.gaspedaal.nl/${brandSlug}${fuelSlug ? `/${fuelSlug}` : ''}?${qs.toString()}`, warnings };
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
    site: 'GASPEDAAL', url, listingCount,
    sampleListings: listings.slice(0, 5).map((l) => ({ title: l.title, price: l.price, year: l.year, mileage: l.mileage, fuel: l.fuel ?? '', url: l.listing_url })),
    appliedFilters: { brand: brandOk, model: false, year: true, mileage: true, fuel: Boolean(params.fuel && FUEL_SLUG[String(params.fuel).toUpperCase()]), trim: false, sort: true },
    score: brandOk ? 70 : 30,
    status: listings.length === 0 ? 'invalid' : brandOk ? 'partial' : 'invalid',
    issues,
    evidence: { structuredFieldsAvailable: true, fieldsUsed: ['brand', 'model', 'fuel', 'gearbox', 'year', 'mileage', 'color', 'doors', 'price'], missingFields: [] },
  };
}

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const out: Partial<SearchCriteria> = {};
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs[0]) out.brand = segs[0].replace(/-/g, ' ').toUpperCase();
    if (segs[1] === 'hybride') out.fuel = 'HYBRIDE';
    const bmin = u.searchParams.get('bmin'), bmax = u.searchParams.get('bmax'), kmax = u.searchParams.get('kmax');
    if (bmin && /^\d{4}$/.test(bmin)) out.yearFrom = bmin;
    if (bmax && /^\d{4}$/.test(bmax)) out.yearTo = bmax;
    if (kmax && /^\d+$/.test(kmax)) out.mileage = kmax;
  } catch { /* URL illisible */ }
  return out;
}

function extractCandidateSegments(url: string): CandidateSegment[] {
  const out: CandidateSegment[] = [];
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs[0]) out.push({ raw: segs[0], location: 'path', paramName: '_path:brand', guessField: 'brand' });
    if (segs[1]) out.push({ raw: segs[1], location: 'path', paramName: '_path:fuel', guessField: 'fuel' });
    if (segs[2]) out.push({ raw: segs[2], location: 'path', paramName: '_path:model', guessField: 'model' });
    for (const [p, f] of [['bmin', 'year'], ['bmax', 'year'], ['kmax', 'mileage']] as const) {
      const v = u.searchParams.get(p);
      if (v) out.push({ raw: v, location: 'query', paramName: p, guessField: f });
    }
  } catch { /* ignore */ }
  return out;
}

export const gaspedaalAdapter: SiteAdapter = {
  key: 'GASPEDAAL',
  displayName: 'Gaspedaal',
  country: 'Netherlands',
  countryCode: 'NL',
  domain: 'gaspedaal.nl',
  urlTemplate: URL_TEMPLATE,

  mapBrand: (raw) => slugify(raw),
  mapModel: (raw) => raw.trim(),
  mapFuel: (raw) => FUEL_SLUG[raw.trim().toUpperCase()] ?? '',
  supportsParam: () => false,

  buildSearchUrl,
  buildPaginatedUrl: defaultBuildPaginatedUrl, // pagination réelle non prouvée : page 1 (= 100 annonces)
  parseSearchResults,
  scoreSearchResults,
  generateCorrectionHypotheses: () => [],
  getFetchProfile: (): ZyteProfileOverrides => ({}),

  harvestTaxonomy,
  prefillCriteriaFromUrl,
  extractCandidateSegments,
};
