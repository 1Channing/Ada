/**
 * BLOCKET.SE (mobility) — adaptateur v1 (02/08/2026), écrit sur PREUVE.
 *
 * Étalon : paires d'URLs humaines Channing du 02/08 soir :
 *   /mobility/search/car?fuel=6&mileage_to=9000&variant=1.813.3074&year_from=2000&year_to=2023
 *   … plug-in      : fuel=1352
 *   … multi-fuel   : fuel=6&fuel=1352 (paramètre répété)
 *   … prix asc     : &sort=PRICE_ASC
 *   … page 2       : &page=2
 *   … finition     : &q=Gr+sport
 *   … sans modèle  : &variant=0.813
 * → variant = codes hiérarchiques : `1.<marque>.<modèle>` / `0.<marque>` —
 *   813=Toyota, 3074=RAV4 PROUVÉS ; les autres s'apprennent par URLs humaines
 *   (segments candidats) — JAMAIS devinés. fuel=6 « Hybrid bensin »,
 *   fuel=1352 « Laddhybrid » (déclarés par l'opérateur, confirmés par les
 *   cartes). MIL SUÉDOIS : 1 mil = 10 km — l'URL 90 000 km → mileage_to=9000.
 *
 * Recon 02/08 (rec-blocket*.json) : JSON-LD CollectionPage → ItemList de
 * 49 Products (brand.name, model, description=FINITION, offers.price SEK,
 * url /mobility/item/<id>) ; année/mil/carburant/boîte dans la carte HTML :
 *   <span class="text-caption font-bold …">2023 ∙ 7 989 mil ∙ Hybrid bensin ∙ Automatisk</span>
 * fusionnée au Product par l'id d'annonce. totalCount : « 252 annons(er) »
 * dans la description du CollectionPage.
 */

import type {
  SiteAdapter, SearchCriteria, BuildUrlResult,
  SiteValidationResult, ZyteProfileOverrides, CandidateSegment,
} from './types';
import type { ScrapedListing } from '../types';
import { resolveYearRange } from './urlTemplate';
import { modelKeyLoose } from '../business-logic';

const URL_TEMPLATE = 'https://www.blocket.se/mobility/search/car?variant={brand}&year_from={yearFrom}&year_to={yearTo}';

// Codes carburant PROUVÉS (URLs humaines 02/08 : 6 hybride, 1352 plug-in ;
// 04/08 : 4 électrique — fuel=4 sur le Kona SE).
const FUEL_CODE: Record<string, string[]> = {
  HYBRIDE: ['6'], HYBRID: ['6'], MILD_HYBRID: ['6'],
  PLUG_IN_HYBRID: ['1352'],
  ELECTRIQUE: ['4'], ELECTRIC: ['4'],
};
// Codes fuel APPRIS (dictionnaire bl:fuelcode : code URL → libellé suédois,
// alimenté par les graines prouvées et les URLs humaines futures). Le label
// se range dans sa famille canonique par vocabulaire — laddhybrid AVANT
// hybrid (le second est contenu dans le premier).
const LEARNED_FUEL_CODE: Record<string, string[]> = {};
const FUEL_LABEL_PATTERNS: Array<[RegExp, string[]]> = [
  [/laddhybrid/i, ['PLUG_IN_HYBRID']],
  [/hybrid/i, ['HYBRIDE', 'HYBRID', 'MILD_HYBRID']],
  [/\bel\b|^el$|elektrisk/i, ['ELECTRIQUE', 'ELECTRIC']],
  [/bensin/i, ['ESSENCE', 'PETROL', 'GASOLINE']],
  [/diesel/i, ['DIESEL']],
];

// Codes variant PROUVÉS (813=Toyota par variant=0.813 ; 3074=RAV4 par
// variant=1.813.3074). Le RESTE de l'arbre vient du dictionnaire moissonné
// bl:brandcode / bl:modelcode:<marque> — codes lus dans les pages SEO
// « discover » DU SITE, réinjectés via learnEnumValues. Jamais devinés.
//
// ARBRE À 3 NIVEAUX (constat Channing 02/08 soir, X3 ⊂ X-Serie ⊂ BMW) :
//   variant=0.<marque> · 1.<marque>.<série> · 2.<marque>.<série>.<version>
// Les pages discover suivent la même hiérarchie (/bmw → /bmw/x-serie →
// /bmw/x-serie/x3 publie variant=2.749.2466.7798). Un code modèle appris
// peut donc être soit un id nu hérité (« 3074 », composé en 1.<b>.<m>),
// soit un JETON COMPLET (« 1.749.2466 », « 2.749.2466.7798 ») posé tel
// quel. À libellés équivalents, le niveau le plus PROFOND gagne (la
// version X3 est plus précise que la série X-Serie).
const BRAND_ID: Record<string, string> = { TOYOTA: '813' };
const MODEL_ID: Record<string, string> = { 'TOYOTA|RAV4': '3074' };
const LEARNED_BRAND_ID: Record<string, string> = {};
const LEARNED_MODEL_ID: Record<string, string> = {};

/** Profondeur d'un code modèle : id nu ≡ série (1) ; jeton n.x.y[.z] → n. */
const variantDepth = (code: string): number =>
  code.includes('.') ? Number(code.split('.')[0]) || 0 : 1;

/**
 * Mots génériques de série, dépouillés des DEUX côtés de l'appariement :
 * côté site les libellés portent « 4-Serie » / « CLA-Klass », côté études le
 * référentiel dit « 4-SERIES » / « SERIE 4 » / « CLASSE CLA » — sans ce
 * dépouillement symétrique, « 4-SERIES » ne trouvait jamais « 4-Serie »
 * (constat campagne 02/08 : no_url sur des séries pourtant apprises).
 */
const stripSeriesWords = (v: string): string => v
  .replace(/^(serien?|series|classe?|klasse?)[-\s]+/i, '')
  .replace(/[-\s]+(serien?|series|classe?|klasse?)$/i, '')
  .trim();

function learnEnumValues(field: string, pairs: Array<{ code: string; label: string }>): void {
  if (field === 'bl:fuelcode') {
    for (const p of pairs) {
      const fam = FUEL_LABEL_PATTERNS.find(([re]) => re.test(p.label))?.[1];
      for (const k of fam ?? []) {
        const list = (LEARNED_FUEL_CODE[k] ??= []);
        if (!list.includes(p.code)) list.push(p.code);
      }
    }
    return;
  }
  if (field === 'bl:brandcode') {
    for (const p of pairs) {
      const k = brandIdKey(p.label);
      if (k && !LEARNED_BRAND_ID[k]) LEARNED_BRAND_ID[k] = p.code;
    }
    return;
  }
  const m = field.match(/^bl:modelcode:(.+)$/);
  if (m) {
    const bk = brandIdKey(m[1].replace(/-/g, ' '));
    for (const p of pairs) {
      // Les séries Blocket sont suffixées dans leurs labels (« CLA-Klass »,
      // « NX-Serie ») : on indexe AUSSI le label dépouillé pour que « CLA »
      // (notre référentiel) trouve la série — la profondeur départage
      // toujours (une version exacte bat la série au même libellé).
      for (const lbl of new Set([p.label, stripSeriesWords(p.label)])) {
        const key = `${bk}|${modelKeyLoose(lbl)}`;
        const prev = LEARNED_MODEL_ID[key];
        if (!prev || variantDepth(p.code) > variantDepth(prev)) LEARNED_MODEL_ID[key] = p.code;
      }
    }
  }
}

const brandIdKey = (v: string): string => {
  const k = (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return k === 'MERCEDESBENZ' ? 'MERCEDES' : k === 'VW' ? 'VOLKSWAGEN' : k;
};

interface BlProduct {
  brand?: { name?: string }; model?: string; description?: string; name?: string;
  url?: string; offers?: { price?: string | number; priceCurrency?: string };
}

function jsonLdCollection(html: string): { items: BlProduct[]; total: number | null } {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const ld = JSON.parse(m[1]);
      if (ld?.['@type'] !== 'CollectionPage') continue;
      const items = (ld.mainEntity?.itemListElement ?? [])
        .map((el: { item?: BlProduct }) => el?.item)
        .filter((it: BlProduct | undefined): it is BlProduct => Boolean(it));
      const total = Number((String(ld.description ?? '').match(/(\d[\d\s ]*)\s*annons/i)?.[1] ?? '').replace(/[\s ]/g, ''));
      return { items, total: Number.isFinite(total) && total > 0 ? total : null };
    } catch { /* bloc illisible */ }
  }
  return { items: [], total: null };
}

/** Ligne carte « 2023 ∙ 7 989 mil ∙ Hybrid bensin ∙ Automatisk » par id. */
function htmlCaptionById(html: string, id: string): { year: number | null; mileageKm: number | null; fuel: string | null; gearbox: string | null } {
  const empty = { year: null, mileageKm: null, fuel: null, gearbox: null };
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return empty;
  const seg = html.slice(i, i + 6000).replace(/&nbsp;/g, ' ');
  const m = seg.match(/>\s*(\d{4})\s*∙\s*([\d\s ]+)\s*mil\s*∙\s*([^∙<]+?)\s*∙\s*([^<]+?)\s*</);
  if (!m) return empty;
  const mil = Number(m[2].replace(/[\s ]/g, ''));
  return {
    year: Number(m[1]),
    // MIL SUÉDOIS : 1 mil = 10 km (preuve : filtre 90 000 km → mileage_to=9000).
    mileageKm: Number.isFinite(mil) ? mil * 10 : null,
    fuel: m[3].trim(), gearbox: m[4].trim(),
  };
}

function parseSearchResults(html: string): ScrapedListing[] {
  const out: ScrapedListing[] = [];
  const { items } = jsonLdCollection(html);
  for (const it of items) {
    const price = Number(it.offers?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const url = it.url ?? '';
    const id = url.match(/\/item\/(\d+)/)?.[1] ?? '';
    const cap = id ? htmlCaptionById(html, id) : { year: null, mileageKm: null, fuel: null, gearbox: null };
    out.push({
      title: [it.name, it.description].filter(Boolean).join(' '),
      description: '',
      price, currency: 'SEK', price_type: 'one-off',
      year: cap.year, mileage: cap.mileageKm,
      trim: it.description?.trim() || null,
      listing_url: url,
      brand: it.brand?.name ?? null, model: it.model ?? null,
      fuel: cap.fuel, gearbox: cap.gearbox,
    });
  }
  return out;
}

const slugify = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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
  for (const l of parseSearchResults(html)) {
    const brand = (l.brand ?? '').trim();
    const model = (l.model ?? '').trim();
    if (brand) push('bl:brand', slugify(brand), brand);
    if (brand && model) push(`bl:model:${slugify(brand)}`, slugify(model), model);
    const fuel = (l.fuel ?? '').trim();
    if (fuel) push('bl:fuel', slugify(fuel), fuel);
  }
  return out;
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const qs = new URLSearchParams();
  // Codes carburant : les PROUVÉS (graines) puis les APPRIS (bl:fuelcode).
  const fuelKey = String(params.fuel ?? '').trim().toUpperCase();
  const fuelCodes = params.fuel ? (FUEL_CODE[fuelKey] ?? LEARNED_FUEL_CODE[fuelKey]) : undefined;
  if (params.fuel && !fuelCodes) {
    warnings.push(`[LINKGEN_WARNING] Blocket: carburant "${params.fuel}" sans code prouvé — filtre omis`);
  }
  for (const c of fuelCodes ?? []) qs.append('fuel', c);
  // MIL SUÉDOIS : km → mil (÷10) — l'oublier fausserait TOUTES les données.
  if (params.mileage) qs.set('mileage_to', String(Math.round(Number(params.mileage) / 10)));
  if (params.trim && String(params.trim).trim()) qs.set('q', String(params.trim).trim());
  if (params.sort !== 'relevance') qs.set('sort', 'PRICE_ASC');
  // variant : jeton complet appris (série/version) posé tel quel, sinon
  // 1.<marque>.<modèle> composé d'un id nu hérité, sinon 0.<marque>, sinon
  // omis (marché entier) — codes appris, jamais devinés.
  const bk = brandIdKey(params.brand || '');
  const brandId = BRAND_ID[bk] ?? LEARNED_BRAND_ID[bk];
  // Déclinaisons rechargeables NOMMÉES (URL humaine 02/08 : « RAV4 Plug-in
  // Hybrid » = série 1.813.2000660, distincte du RAV4 1.813.3074) : quand le
  // carburant demandé est plug-in, la série PHEV du modèle gagne — sinon la
  // recherche RAV4+fuel=1352 raterait tout ce que le site range à part.
  const phevId = params.model && String(params.fuel ?? '').trim().toUpperCase() === 'PLUG_IN_HYBRID'
    ? LEARNED_MODEL_ID[`${bk}|${modelKeyLoose(params.model + ' plug in hybrid')}`]
      ?? LEARNED_MODEL_ID[`${bk}|${modelKeyLoose(params.model + ' laddhybrid')}`]
    : undefined;
  const modelId = phevId ?? (params.model
    ? MODEL_ID[`${bk}|${(params.model || '').trim().toUpperCase()}`]
      ?? LEARNED_MODEL_ID[`${bk}|${modelKeyLoose(params.model)}`]
      ?? LEARNED_MODEL_ID[`${bk}|${modelKeyLoose(stripSeriesWords(params.model))}`]
    : undefined);
  if (modelId?.includes('.')) qs.set('variant', modelId);
  else if (brandId && modelId) qs.set('variant', `1.${brandId}.${modelId}`);
  else if (brandId) {
    qs.set('variant', `0.${brandId}`);
    if (params.model) warnings.push(`[LINKGEN_WARNING] Blocket: modèle "${params.model}" sans code variant appris — page marque, tri en aval`);
  } else if (params.brand) {
    warnings.push(`[LINKGEN_WARNING] Blocket: marque "${params.brand}" sans code variant appris — recherche large, tri en aval`);
  }
  const { yearFrom, yearTo } = resolveYearRange(params);
  if (yearFrom) qs.set('year_from', yearFrom);
  if (yearTo) qs.set('year_to', yearTo);
  qs.sort();
  return {
    url: `https://www.blocket.se/mobility/search/car?${qs.toString()}`, warnings,
    // Jeton complet : le modèle est exprimé même sans code marque (il l'embarque).
    modelExpressed: !params.model || Boolean(modelId && (modelId.includes('.') || brandId)),
  };
}

function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
  const listings = parseSearchResults(html);
  const wantBrand = (params.brand ?? '').trim().toLowerCase();
  const brandHits = wantBrand ? listings.filter((l) => (l.brand ?? '').toLowerCase().includes(wantBrand)).length : listings.length;
  const brandOk = listings.length > 0 && brandHits / listings.length >= 0.8;
  const wantModelKey = params.model ? modelKeyLoose(params.model) : '';
  const modelHits = wantModelKey ? listings.filter((l) => modelKeyLoose(l.model) === wantModelKey).length : 0;
  const modelOk = Boolean(wantModelKey) && listings.length > 0 && modelHits / listings.length >= 0.8;
  const issues: SiteValidationResult['issues'] = [];
  if (!brandOk && wantBrand) issues.push({ type: 'brand_missing' });
  if (params.model && !modelOk) issues.push({ type: 'model_not_applied' });
  if (listings.length === 0) issues.push({ type: 'no_listings' });
  return {
    site: 'BLOCKET', url, listingCount,
    sampleListings: listings.slice(0, 5).map((l) => ({ title: l.title, price: l.price, year: l.year, mileage: l.mileage, fuel: l.fuel ?? '', url: l.listing_url })),
    appliedFilters: { brand: brandOk, model: modelOk, year: true, mileage: true, fuel: Boolean(params.fuel && FUEL_CODE[String(params.fuel).toUpperCase()]), trim: false, sort: true },
    score: brandOk ? (modelOk ? 90 : 70) : 30,
    status: listings.length === 0 ? 'invalid' : brandOk ? (modelOk ? 'valid' : 'partial') : 'invalid',
    issues,
    evidence: { structuredFieldsAvailable: true, fieldsUsed: ['brand', 'model', 'trim', 'year', 'mileage', 'fuel', 'gearbox', 'price'], missingFields: [] },
  };
}

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const out: Partial<SearchCriteria> = {};
  try {
    const u = new URL(url);
    const variant = u.searchParams.get('variant') ?? '';
    const parts = variant.split('.');
    // 1.<brandId>.<modelId> / 0.<brandId> — codes opaques : on ne peut
    // préremplir que ce que les graines connaissent (Toyota/RAV4).
    const brandId = parts[1];
    const bk = Object.entries(BRAND_ID).find(([, v]) => v === brandId)?.[0];
    if (bk) out.brand = bk;
    if (parts[0] === '1' && parts[2] && bk) {
      const mk = Object.entries(MODEL_ID).find(([, v]) => v === parts[2])?.[0];
      if (mk) out.model = mk.split('|')[1];
    }
    const q = u.searchParams.get('q');
    if (q) out.trim = q;
    const yf = u.searchParams.get('year_from'), yt = u.searchParams.get('year_to');
    if (yf && /^\d{4}$/.test(yf)) out.yearFrom = yf;
    if (yt && /^\d{4}$/.test(yt)) out.yearTo = yt;
    const mt = u.searchParams.get('mileage_to');
    if (mt && /^\d+$/.test(mt)) out.mileage = String(Number(mt) * 10); // mil → km
  } catch { /* URL illisible */ }
  return out;
}

function extractCandidateSegments(url: string): CandidateSegment[] {
  const out: CandidateSegment[] = [];
  try {
    const u = new URL(url);
    const variant = u.searchParams.get('variant');
    if (variant) out.push({ raw: variant, location: 'query', paramName: 'variant', guessField: 'model' });
    for (const [p, f] of [['year_from', 'year'], ['year_to', 'year'], ['mileage_to', 'mileage'], ['fuel', 'fuel']] as const) {
      const v = u.searchParams.get(p);
      if (v) out.push({ raw: v, location: 'query', paramName: p, guessField: f });
    }
  } catch { /* ignore */ }
  return out;
}

export const blocketAdapter: SiteAdapter = {
  key: 'BLOCKET',
  displayName: 'Blocket',
  country: 'Sweden',
  countryCode: 'SE',
  domain: 'blocket.se',
  urlTemplate: URL_TEMPLATE,

  mapBrand: (raw) => BRAND_ID[brandIdKey(raw)] ?? LEARNED_BRAND_ID[brandIdKey(raw)] ?? '',
  learnEnumValues,
  mapModel: (raw) => raw.trim(),
  mapFuel: (raw) => (FUEL_CODE[raw.trim().toUpperCase()] ?? []).join(','),
  supportsParam: () => false,

  buildSearchUrl,
  // Pagination page=N — PROUVÉE par paire d'URLs humaines (page 2 : &page=2).
  buildPaginatedUrl: (baseUrl: string, pageNumber: number): string => {
    if (pageNumber <= 1) return baseUrl;
    try {
      const u = new URL(baseUrl);
      u.searchParams.set('page', String(pageNumber));
      return u.toString();
    } catch { return baseUrl; }
  },
  parseSearchResults: (html: string) => parseSearchResults(html),
  scoreSearchResults,
  generateCorrectionHypotheses: () => [],
  getFetchProfile: (): ZyteProfileOverrides => ({}),

  harvestTaxonomy,
  prefillCriteriaFromUrl,
  extractCandidateSegments,
};
