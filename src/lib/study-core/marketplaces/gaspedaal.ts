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
 * v2 (02/08) : le MODÈLE entre dans le chemin — grammaire prouvée par l'URL
 * humaine Channing apprise en mémoire (confidence 1) :
 *   /bmw/5-serie/hybride?bmin=2022&bmax=2022&kmax=90000&trefw=M+sport&srt=df-a
 * → /{brand}/{model}/{fuel}. Le slug modèle N'EST PAS inventé : il vient du
 * dictionnaire moissonné gp:model:<marque> (labels JSON-LD du site lui-même,
 * ex. « 5-serie » — le label EST le slug, prouvé par la paire URL/JSON-LD),
 * réinjecté via learnEnumValues. Modèle sans slug appris → omis (fail-open,
 * page marque + tri en aval). Pagination non prouvée : page 1 = 100 annonces.
 */

import type {
  SiteAdapter, SearchCriteria, BuildUrlResult,
  SiteValidationResult, ZyteProfileOverrides, CandidateSegment,
} from './types';
import type { ScrapedListing } from '../types';
import { defaultBuildPaginatedUrl } from './registry';
import { resolveYearRange } from './urlTemplate';
import { modelKeyLoose } from '../business-logic';

const URL_TEMPLATE = 'https://www.gaspedaal.nl/{brand}/{model}/{fuel}?bmin={yearFrom}&bmax={yearTo}&kmax={mileage}&srt=df-a';

// Slugs PROUVÉS par URLs humaines (01/08 hybride, 02/08 /bmw/diesel) — le
// reste vient du dictionnaire gp:fuel moissonné (vocabulaire du site :
// Benzine, Elektrisch, LPG, Waterstof — slug = label minuscule, même
// dérivation que hybride/diesel), réinjecté par learnEnumValues.
const FUEL_SLUG: Record<string, string> = {
  HYBRIDE: 'hybride', HYBRID: 'hybride',
  PLUG_IN_HYBRID: 'hybride', MILD_HYBRID: 'hybride',
  DIESEL: 'diesel',
};

// Nos noms canoniques ← slug néerlandais (traduction sémantique fixe).
const CANON_BY_FUEL_SLUG: Record<string, string[]> = {
  benzine: ['ESSENCE', 'PETROL', 'GASOLINE'],
  diesel: ['DIESEL'],
  elektrisch: ['ELECTRIQUE', 'ELECTRIC'],
  hybride: ['HYBRIDE', 'HYBRID', 'PLUG_IN_HYBRID', 'MILD_HYBRID'],
  lpg: ['LPG', 'GPL'],
  waterstof: ['HYDROGENE', 'HYDROGEN'],
};
const LEARNED_FUEL_SLUG: Record<string, string> = {};

// Miroir local de brandKey (services/marketData) — l'adaptateur reste pur
// (pas d'import de la couche services) ; mêmes deux alias.
const brandIdKey = (v: string): string => {
  // Déburrage avant le strip : 'ŠKODA' donnait 'KODA' (Š supprimé, pas
  // translittéré) et ratait la marque apprise 'Skoda' (constat ENYAQ 18/08).
  const k = (v ?? '').toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Z0-9]/g, '');
  return k === 'MERCEDESBENZ' ? 'MERCEDES' : k === 'VW' ? 'VOLKSWAGEN' : k;
};

// Slugs MARQUE appris (gp:brand moissonné — le label du site EST le slug,
// même dérivation que les modèles). Preuve du besoin (campagne 02/08 16h) :
// notre slugify('MERCEDES') → /mercedes, slug inconnu du site qui a servi
// une page toutes-marques (300 annonces mélangées, marque rejetée 0 %) —
// le site dit « Mercedes-Benz » → /mercedes-benz.
const LEARNED_BRAND_SLUG: Record<string, string> = {};

// Slugs modèle appris : marque (slug) → clé de jetons triés → slug du site.
// Indexé par label ET par code (identiques sur ce site, mais restons larges).
const LEARNED_MODEL_SLUG = new Map<string, Map<string, string>>();

function learnEnumValues(field: string, pairs: Array<{ code: string; label: string }>): void {
  if (field === 'gp:brand') {
    for (const p of pairs) {
      for (const k of [brandIdKey(p.label), brandIdKey(p.code)]) {
        if (k && !LEARNED_BRAND_SLUG[k]) LEARNED_BRAND_SLUG[k] = p.code;
      }
    }
    return;
  }
  if (field === 'gp:fuel') {
    for (const p of pairs) {
      for (const canon of CANON_BY_FUEL_SLUG[p.code] ?? []) {
        if (!LEARNED_FUEL_SLUG[canon]) LEARNED_FUEL_SLUG[canon] = p.code;
      }
    }
    return;
  }
  if (field.startsWith('gp:model:')) {
    const brand = field.slice('gp:model:'.length);
    const byKey = LEARNED_MODEL_SLUG.get(brand) ?? new Map<string, string>();
    for (const p of pairs) {
      for (const k of [modelKeyLoose(p.label), modelKeyLoose(p.code)]) {
        if (k && !byKey.has(k)) byKey.set(k, p.code);
      }
    }
    LEARNED_MODEL_SLUG.set(brand, byKey);
  }
}

function fuelSlugFor(fuel: string | null | undefined): string | undefined {
  if (!fuel) return undefined;
  const canon = String(fuel).trim().toUpperCase();
  return FUEL_SLUG[canon] ?? LEARNED_FUEL_SLUG[canon];
}

function modelSlugFor(brandSlug: string, model: string | null | undefined): string | undefined {
  if (!model) return undefined;
  return LEARNED_MODEL_SLUG.get(brandSlug)?.get(modelKeyLoose(model));
}

/** Slug marque : appris (gp:brand — « Mercedes-Benz » → mercedes-benz) sinon
 *  dérivé mécaniquement du nom déclaré. */
function brandSlugFor(brand: string | null | undefined): string {
  const raw = brand ?? '';
  return LEARNED_BRAND_SLUG[brandIdKey(raw)] ?? slugify(raw);
}

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
  const brandSlug = brandSlugFor(params.brand);
  const fuelSlug = fuelSlugFor(params.fuel);
  if (params.fuel && !fuelSlug) {
    warnings.push(`[LINKGEN_WARNING] Gaspedaal: carburant "${params.fuel}" sans slug prouvé — filtre omis`);
  }
  // Grammaire /{brand}/{model}/{fuel} prouvée par URL humaine (mémoire
  // /bmw/5-serie/hybride). Slug modèle = dictionnaire moissonné, ou — en
  // découverte-validation UNIQUEMENT (derivedModelSlug) — hypothèse slugify
  // vérifiée par le scrape structuré. Les études n'hypothèquent jamais.
  let modelSlug = modelSlugFor(brandSlug, params.model);
  if (params.model && !modelSlug && params.derivedModelSlug) {
    modelSlug = slugify(String(params.model));
    warnings.push(`[LINKGEN] Gaspedaal: slug modèle HYPOTHÈSE "${modelSlug}" (dérivé, à valider par le scrape)`);
  }
  if (params.model && !modelSlug) {
    warnings.push(`[LINKGEN_WARNING] Gaspedaal: modèle "${params.model}" sans slug moissonné — page marque, tri en aval`);
  }
  const qs = new URLSearchParams();
  const { yearFrom, yearTo } = resolveYearRange(params);
  if (yearFrom) qs.set('bmin', yearFrom);
  if (yearTo) qs.set('bmax', yearTo);
  if (params.mileage) qs.set('kmax', String(params.mileage));
  // Tri — preuve par paire d'URLs humaines (Channing 02/08) : srt=pr-a =
  // « Prijs laag-hoog », srt=df-a = relevantie. Études/précision : pr-a (le
  // bas du marché est ce qu'on arbitre). Découverte : df-a — le tri prix
  // rendrait toujours les mêmes annonces bas de gamme (décision 02/08).
  qs.set('srt', params.sort === 'relevance' ? 'df-a' : 'pr-a');
  const path = [brandSlug, modelSlug, fuelSlug].filter(Boolean).join('/');
  return {
    url: `https://www.gaspedaal.nl/${path}?${qs.toString()}`, warnings,
    modelExpressed: !params.model || Boolean(modelSlug),
  };
}

function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
  const listings = parseSearchResults(html, url);
  const wantBrand = (params.brand ?? '').trim().toLowerCase();
  const brandHits = wantBrand ? listings.filter((l) => (l.brand ?? '').toLowerCase().includes(wantBrand)).length : listings.length;
  const brandOk = listings.length > 0 && brandHits / listings.length >= 0.8;
  // Modèle posé en URL (slug moissonné trouvé) → vérification par le modèle
  // STRUCTURÉ des annonces ; sans slug → page marque, honnêtement non appliqué.
  const modelPosed = Boolean(params.model && (modelSlugFor(brandSlugFor(params.brand), params.model) || params.derivedModelSlug));
  const wantModelKey = params.model ? modelKeyLoose(params.model) : '';
  const modelHits = wantModelKey ? listings.filter((l) => modelKeyLoose(l.model) === wantModelKey).length : 0;
  const modelOk = modelPosed && listings.length > 0 && modelHits / listings.length >= 0.8;
  const issues: SiteValidationResult['issues'] = [];
  if (!brandOk && wantBrand) issues.push({ type: 'brand_missing' });
  if (params.model && !modelPosed) issues.push({ type: 'model_not_applied' });
  if (params.model && modelPosed && !modelOk) issues.push({ type: 'model_missing' });
  if (listings.length === 0) issues.push({ type: 'no_listings' });
  return {
    site: 'GASPEDAAL', url, listingCount,
    sampleListings: listings.slice(0, 5).map((l) => ({ title: l.title, price: l.price, year: l.year, mileage: l.mileage, fuel: l.fuel ?? '', url: l.listing_url })),
    appliedFilters: { brand: brandOk, model: modelOk, year: true, mileage: true, fuel: Boolean(fuelSlugFor(params.fuel)), trim: false, sort: true },
    score: brandOk ? (modelOk ? 90 : 70) : 30,
    status: listings.length === 0 ? 'invalid' : brandOk ? (modelOk ? 'valid' : 'partial') : 'invalid',
    issues,
    evidence: { structuredFieldsAvailable: true, fieldsUsed: ['brand', 'model', 'fuel', 'gearbox', 'year', 'mileage', 'color', 'doors', 'price'], missingFields: [] },
  };
}

// Segment carburant du chemin : slug = label du site (dictionnaire gp:fuel
// moissonné 02/08 : Benzine, Diesel, Elektrisch, Hybride, LPG, Waterstof).
// Sert à distinguer /audi/elektrisch (fuel) de /bmw/5-serie (modèle).
const FUEL_PATH_TO_CANON: Record<string, string> = {
  benzine: 'ESSENCE', diesel: 'DIESEL', elektrisch: 'ELECTRIQUE',
  hybride: 'HYBRIDE', lpg: 'LPG', waterstof: 'HYDROGENE',
};

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const out: Partial<SearchCriteria> = {};
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs[0]) out.brand = segs[0].replace(/-/g, ' ').toUpperCase();
    // Grammaire /{brand}/{model?}/{fuel?} : le 2e segment est un carburant
    // s'il appartient au vocabulaire du site, sinon un modèle.
    const rest = segs.slice(1);
    for (const seg of rest) {
      const canon = FUEL_PATH_TO_CANON[seg];
      if (canon) out.fuel = canon;
      else if (!out.model) out.model = seg.replace(/-/g, ' ').toUpperCase();
    }
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
    for (const seg of segs.slice(1)) {
      const isFuel = Boolean(FUEL_PATH_TO_CANON[seg]);
      out.push({
        raw: seg, location: 'path',
        paramName: isFuel ? '_path:fuel' : '_path:model',
        guessField: isFuel ? 'fuel' : 'model',
      });
    }
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

  mapBrand: (raw) => brandSlugFor(raw),
  mapModel: (raw) => raw.trim(),
  mapFuel: (raw) => fuelSlugFor(raw) ?? '',
  supportsParam: () => false,
  learnEnumValues,

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
