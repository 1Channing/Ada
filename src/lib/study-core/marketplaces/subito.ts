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
import { parsePublishedAt } from '../parsers/shared';
import { resolveYearRange } from './urlTemplate';
import { modelKeyLoose } from '../business-logic';

const URL_TEMPLATE =
  'https://www.subito.it/annunci-italia/vendita/auto/{brand}/{fuel}/?ys={yearFrom}&ye={yearTo}';

// Seuls slugs PROUVÉS (URL humaine du 01/08). Tout le reste est omis de
// l'URL — fail-open : mieux vaut une page plus large que du guessing.
const FUEL_SLUG: Record<string, string> = {
  HYBRIDE: 'ibrida', HYBRID: 'ibrida', IBRIDA: 'ibrida',
  // La famille couvre les rechargeables comme sur Marktplaats — l'annonce
  // elle-même (features /fuel) et le texte raffinent ensuite.
  PLUG_IN_HYBRID: 'ibrida', MILD_HYBRID: 'ibrida',
  // URL humaine 02/08 : /auto/bmw/elettrica/?q=m+sport&order=priceasc…
  ELECTRIQUE: 'elettrica', ELECTRIC: 'elettrica', ELETTRICA: 'elettrica',
  // URL humaine 02/08 soir : /auto/bmw/serie-1/diesel/…
  DIESEL: 'diesel',
  // URL humaine 26/08 : /auto/bmw/benzina/?q=M+sport.
  ESSENCE: 'benzina', PETROL: 'benzina', GASOLINE: 'benzina', BENZINA: 'benzina',
};

// Segments carburant PROUVÉS du chemin — sert à distinguer, dans
// /auto/{brand}/{model?}/{fuel?}/, un modèle d'un carburant.
const FUEL_PATH_TO_CANON: Record<string, string> = {
  ibrida: 'HYBRIDE', elettrica: 'ELECTRIQUE', diesel: 'DIESEL', benzina: 'ESSENCE',
};

// me= : km max en CODE ENUM du site, PAS en km. Une seule correspondance
// PROUVÉE (URL humaine 26/08 : me=18 sur le filtre « 90 000 km »). Les
// autres codes sont inconnus → filtre omis + warning, jamais deviné.
const MILEAGE_ENUM: Record<number, string> = { 90000: '18' };

// Slugs MODÈLE appris depuis le dictionnaire moissonné sb:model:<marque>
// (label « Serie 1 » → slug slugify = serie-1). Grammaire du chemin
// /auto/{brand}/{model}/{fuel}/ PROUVÉE par la paire d'URLs humaines du
// 02/08 soir : /auto/bmw/serie-1/diesel/?q=m+sport&order=priceasc&ys=&ye=.
// Un modèle sans label moissonné est OMIS (fail-open, page marque).
const LEARNED_MODEL_SLUG = new Map<string, Map<string, string>>();

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

/** Mise en ligne : les blocs JSON-LD de la page portent `datePublished` ISO
 *  par annonce (sonde 28/08 — "datePublished":"2026-08-28T13:53:15"), mappés
 *  ici par URL pour compléter le champ `date` des objets AdItem. */
function jsonLdPublishedByUrl(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (node: unknown): void => {
        if (!node) return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (typeof node !== 'object') return;
        const o = node as Record<string, unknown>;
        const u = typeof o.url === 'string' ? o.url : typeof o['@id'] === 'string' ? String(o['@id']) : null;
        const d = typeof o.datePublished === 'string' ? o.datePublished : null;
        if (u && d && !out.has(u)) out.set(u, d);
        for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
      };
      walk(JSON.parse(m[1]));
    } catch { /* bloc illisible */ }
  }
  return out;
}

function parseSearchResults(html: string, _url: string): ScrapedListing[] {
  const data = nextDataItems(html);
  if (!data) return [];
  const ldDates = jsonLdPublishedByUrl(html);
  const out: ScrapedListing[] = [];
  for (const ad of data.ads) {
    if (ad.kind !== 'AdItem') continue;
    const price = fNum(ad, '/price');
    if (price == null || price <= 0) continue;
    const listingUrl = ad.urls?.default ?? '';
    const adAny = ad as { date?: unknown; datePublished?: unknown };
    out.push({
      title: ad.subject ?? '',
      description: ad.body ?? '',
      price,
      currency: 'EUR',
      price_type: 'one-off',
      year: fNum(ad, '/year'),
      mileage: fNum(ad, '/mileage_scalar'),
      trim: fv(ad, '/car', 2)?.value ?? null, // Versione
      listing_url: listingUrl,
      brand: fv(ad, '/car', 0)?.value ?? null,
      model: fv(ad, '/car', 1)?.value ?? null,
      fuel: fv(ad, '/fuel')?.value ?? null,
      gearbox: fv(ad, '/gearbox')?.value ?? null,
      sellerType: null,
      publishedAt: parsePublishedAt(adAny.date ?? adAny.datePublished ?? ldDates.get(listingUrl)),
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

function modelSlugFor(brandSlug: string, model: string | null | undefined): string | undefined {
  if (!model) return undefined;
  return LEARNED_MODEL_SLUG.get(brandSlug)?.get(modelKeyLoose(model));
}

function learnEnumValues(field: string, pairs: Array<{ code: string; label: string }>): void {
  if (!field.startsWith('sb:model:')) return;
  const brand = field.slice('sb:model:'.length);
  const byKey = LEARNED_MODEL_SLUG.get(brand) ?? new Map<string, string>();
  for (const p of pairs) {
    // Le CODE est un enum opaque du site ('004796') — le slug d'URL se
    // dérive du LABEL (« Serie 1 » → serie-1, prouvé par l'URL humaine).
    const k = modelKeyLoose(p.label);
    const slug = slugify(p.label);
    if (k && slug && !byKey.has(k)) byKey.set(k, slug);
  }
  LEARNED_MODEL_SLUG.set(brand, byKey);
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const brandSlug = slugify(params.brand || '');
  const fuelSlug = params.fuel ? FUEL_SLUG[String(params.fuel).trim().toUpperCase()] : undefined;
  if (params.fuel && !fuelSlug) {
    warnings.push(`[LINKGEN_WARNING] Subito: carburant "${params.fuel}" sans slug prouvé — filtre omis`);
  }
  // Modèle dans le CHEMIN — grammaire /auto/{brand}/{model}/{fuel}/ prouvée
  // par la paire d'URLs humaines du 02/08 soir (/auto/bmw/serie-1/diesel/).
  // Slug = label moissonné sb:model:<marque> slugifié, jamais inventé ;
  // sans label appris, repli : q= texte (derivedModelSlug) ou page marque.
  const modelSlug = modelSlugFor(brandSlug, params.model);
  const validateModel = Boolean(!modelSlug && params.model && params.derivedModelSlug && !(params.trim && String(params.trim).trim()));
  if (params.model && !modelSlug && !validateModel) {
    warnings.push(`[LINKGEN_WARNING] Subito: modèle "${params.model}" sans label moissonné — page marque, tri par le structuré en aval`);
  }
  const path = `/annunci-italia/vendita/auto/${brandSlug}${modelSlug ? `/${modelSlug}` : ''}${fuelSlug ? `/${fuelSlug}` : ''}/`;
  const qs = new URLSearchParams();
  // Finition en texte libre q= — URL humaine 02/08 : ?q=m+sport.
  if (params.trim && String(params.trim).trim()) qs.set('q', String(params.trim).trim().toLowerCase());
  else if (validateModel) qs.set('q', String(params.model).trim().toLowerCase());
  // Tri prouvé par paire d'URLs humaines 02/08 (order=priceasc vs
  // order=relevance). Études/précision : prix croissant. Découverte :
  // relevance — meilleure couverture de gamme (décision Channing 02/08).
  qs.set('order', params.sort === 'relevance' ? 'relevance' : 'priceasc');
  const { yearFrom, yearTo } = resolveYearRange(params);
  if (yearFrom) qs.set('ys', yearFrom);
  if (yearTo) qs.set('ye', yearTo);
  // km max : me= en CODE ENUM (URL humaine 26/08 : me=18 = 90 000 km).
  // Codes des autres paliers inconnus → omission + warning, jamais deviné.
  const km = Number(params.mileage);
  if (Number.isFinite(km) && km > 0) {
    const meCode = MILEAGE_ENUM[km];
    if (meCode) qs.set('me', meCode);
    else warnings.push(`[LINKGEN_WARNING] Subito: km max ${km} sans code enum me= prouvé — filtre omis, tri en aval`);
  }
  // Puissance min hps= en CV & boîte gr=2 (Automatico) — PROUVÉS URL
  // humaine 26/08 : …&hps=150&gr=2 (gearbox key '2' = Automatico, confirmé
  // par le dictionnaire /gearbox des annonces).
  const power = params.powerFrom ?? params.minPower;
  if (power !== undefined && String(power).trim()) qs.set('hps', String(power));
  if (/^AUTOMAT/i.test(String(params.gearbox ?? '').trim())) qs.set('gr', '2');
  return {
    url: `https://www.subito.it${path}?${qs.toString()}`, warnings,
    modelExpressed: !params.model || Boolean(modelSlug || validateModel),
  };
}

function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
  const listings = parseSearchResults(html, url);
  const wantBrand = (params.brand ?? '').trim().toLowerCase();
  const brandHits = wantBrand ? listings.filter((l) => (l.brand ?? '').toLowerCase().includes(wantBrand)).length : listings.length;
  const brandOk = listings.length > 0 && brandHits / listings.length >= 0.8;
  // Modèle posé via q= (découverte-validation) → vérification par le modèle
  // STRUCTURÉ (/car Modello) ; sinon page marque, honnêtement non appliqué.
  const modelPosed = Boolean(params.model && (
    modelSlugFor(slugify(params.brand || ''), params.model)
    || (params.derivedModelSlug && !(params.trim && String(params.trim).trim()))));
  const wantModelKey = params.model ? modelKeyLoose(params.model) : '';
  const modelHits = wantModelKey ? listings.filter((l) => modelKeyLoose(l.model) === wantModelKey).length : 0;
  const modelOk = modelPosed && listings.length > 0 && modelHits / listings.length >= 0.8;
  const issues: SiteValidationResult['issues'] = [];
  if (!brandOk && wantBrand) issues.push({ type: 'brand_missing' });
  if (params.model && !modelPosed) issues.push({ type: 'model_not_applied' });
  if (params.model && modelPosed && !modelOk) issues.push({ type: 'model_missing' });
  if (listings.length === 0) issues.push({ type: 'no_listings' });
  return {
    site: 'SUBITO', url, listingCount,
    sampleListings: listings.slice(0, 5).map((l) => ({ title: l.title, price: l.price, year: l.year, mileage: l.mileage, fuel: l.fuel ?? '', url: l.listing_url })),
    appliedFilters: { brand: brandOk, model: modelOk, year: true, mileage: false, fuel: Boolean(params.fuel && FUEL_SLUG[String(params.fuel).toUpperCase()]), trim: false, sort: false },
    score: brandOk ? (modelOk ? 90 : 70) : 30,
    status: listings.length === 0 ? 'invalid' : brandOk ? (modelOk ? 'valid' : 'partial') : 'invalid',
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
    // /auto/{brand}/{model?}/{fuel?}/ : un segment est un carburant s'il
    // appartient au vocabulaire prouvé, sinon un modèle.
    for (const seg of segs.slice(i + 2)) {
      const canon = FUEL_PATH_TO_CANON[seg];
      if (canon) out.fuel = canon;
      else if (!out.model) out.model = seg.replace(/-/g, ' ').toUpperCase();
    }
    const q = u.searchParams.get('q');
    if (q) out.trim = q;
    const ys = u.searchParams.get('ys'), ye = u.searchParams.get('ye');
    if (ys && /^\d{4}$/.test(ys)) out.yearFrom = ys;
    if (ye && /^\d{4}$/.test(ye)) out.yearTo = ye;
    // me= : code enum → km, seulement pour les correspondances prouvées.
    const me = u.searchParams.get('me');
    const kmHit = Object.entries(MILEAGE_ENUM).find(([, v]) => v === me)?.[0];
    if (kmHit) out.mileage = kmHit;
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
    for (const seg of segs.slice(i + 2)) {
      const isFuel = Boolean(FUEL_PATH_TO_CANON[seg]);
      out.push({
        raw: seg, location: 'path',
        paramName: isFuel ? '_path:fuel' : '_path:model',
        guessField: isFuel ? 'fuel' : 'model',
      });
    }
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
  learnEnumValues,

  buildSearchUrl,
  // Pagination o=N — PROUVÉE par paire d'URLs humaines 02/08 soir
  // (page 2 : …&o=2&ys=2023&ye=2023). Le scan profond devient effectif.
  buildPaginatedUrl: (baseUrl: string, pageNumber: number): string => {
    if (pageNumber <= 1) return baseUrl;
    try {
      const u = new URL(baseUrl);
      u.searchParams.set('o', String(pageNumber));
      return u.toString();
    } catch { return baseUrl; }
  },
  parseSearchResults,
  scoreSearchResults,
  generateCorrectionHypotheses: () => [],
  getFetchProfile: (): ZyteProfileOverrides => ({}),

  detectEmptyState,
  harvestTaxonomy,
  prefillCriteriaFromUrl,
  extractCandidateSegments,
};
