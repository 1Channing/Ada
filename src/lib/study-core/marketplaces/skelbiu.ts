/**
 * SKELBIU.LT — adaptateur v1 (02/08/2026), écrit sur PREUVE.
 *
 * Étalon : URLs humaines Channing du 02/08 soir :
 *   /skelbimai/?…&category_id=21575&…&year_min=2020&year_max=2023&fuel[]=8&mileage_max=90000
 *   … prix asc  : orderBy=3 (défaut : orderBy=-1)
 *   … page 2    : /skelbimai/2?… (numéro DANS LE CHEMIN)
 *   … sans mod. : category_id=101 (toutes autos)
 * → marque/modèle = CATEGORY_ID opaque (21575 = Toyota RAV4 prouvé, 101 =
 *   toutes autos) — appris par URLs humaines, jamais deviné.
 *
 * Codes carburant PROUVÉS PAR LE SITE LUI-MÊME (select name="fuel[]" du
 * formulaire, dump recon 02/08) : 1 Benzinas · 2 Benzinas+dujos ·
 * 3 Dyzelinas · 5 Elektra · 6 Etanolis · 7 Kitas · 8 Benzinas+elektra ·
 * 9 Dyzelinas+dujos · 10 Dyzelinas+elektra.
 *
 * Annonces (recon) : cartes HTML `gallery-item` — ancre /skelbimai/…-<id>.html
 * + data-item-id, h3 titre, params (« 2020 m. », carburant, moteur, boîte,
 * « 90000 km »), prix « 22 750 € ». Les images viennent d'autoplius-img :
 * Skelbiu AGRÈGE Autoplius — un site pour deux. EUR natif.
 */

import type {
  SiteAdapter, SearchCriteria, BuildUrlResult,
  SiteValidationResult, ZyteProfileOverrides, CandidateSegment,
} from './types';
import type { ScrapedListing } from '../types';
import { resolveYearRange } from './urlTemplate';

// Nos noms canoniques → code fuel[] du site (dictionnaire du formulaire).
const FUEL_CODE: Record<string, string> = {
  ESSENCE: '1', PETROL: '1', GASOLINE: '1',
  DIESEL: '3',
  HYBRIDE: '8', HYBRID: '8', PLUG_IN_HYBRID: '8', MILD_HYBRID: '8',
  ELECTRIQUE: '5', ELECTRIC: '5',
};

// Catégories PROUVÉES (URLs humaines 02/08) — arbre à trois niveaux :
//   31    = Automobiliai (TOUTES les autos — URL humaine « sans marques »)
//   101   = Toyota (catégorie MARQUE — URL humaine « sans modèle »)
//   21575 = Toyota RAV4 (catégorie MODÈLE)
// Le reste de l'arbre est opaque et s'apprend par URLs humaines — jamais
// deviné. (1re version : 101 pris pour « toutes autos » → chaque recherche
// non-Toyota servait la page Toyota, constat campagne 02/08 soir.)
const CATEGORY_ALL_CARS = '31';
const CATEGORY_BRAND_ID: Record<string, string> = { TOYOTA: '101' };
const CATEGORY_ID: Record<string, string> = { 'TOYOTA|RAV4': '21575' };

const canon = (v: string) => (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function parseSearchResults(html: string): ScrapedListing[] {
  const out: ScrapedListing[] = [];
  // Cartes galerie : ancre fiche + bloc contenu (h3 + params + prix).
  const re = /<a href="(\/skelbimai\/[^"]+-(\d+)\.html)"[^>]*data-item-id="\2"[\s\S]{0,4000}?<\/a>/g;
  for (const m of html.matchAll(re)) {
    const block = m[0];
    const url = `https://www.skelbiu.lt${m[1]}`;
    const title = block.match(/<h3>([^<]+)<\/h3>/)?.[1]?.trim() ?? '';
    const priceRaw = block.match(/class="price">([\d\s ]+)€/)?.[1] ?? '';
    const price = Number(priceRaw.replace(/[\s ]/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue;
    const params = [...block.matchAll(/class="param">([^<]+)</g)].map((p) => p[1].trim());
    const year = Number(params.find((p) => /^\d{4}\s*m\.?$/.test(p))?.match(/\d{4}/)?.[0]);
    const kmRaw = params.find((p) => /km\s*$/.test(p));
    const mileage = Number((kmRaw ?? '').replace(/[^\d]/g, ''));
    const fuel = params.find((p) => /benzin|dyzel|elektra|dujos|etanol/i.test(p)) ?? null;
    const gearbox = params.find((p) => /automat|mechan/i.test(p)) ?? null;
    out.push({
      title, description: '', price, currency: 'EUR', price_type: 'one-off',
      year: Number.isFinite(year) ? year : null,
      mileage: Number.isFinite(mileage) && mileage > 0 ? mileage : null,
      trim: null, listing_url: url,
      brand: null, model: null, // pas de champ structuré par carte — le titre porte « Toyota Rav4, … »
      fuel, gearbox,
    });
  }
  return out;
}

/** Moisson : les SELECTS du formulaire embarquent les dictionnaires du site
 *  (fuel[], body[]) — codes + labels lituaniens, appris tels quels. */
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
  for (const [name, field] of [['fuel[]', 'sk:fuel'], ['body[]', 'sk:body']] as const) {
    const i = html.indexOf(`name="${name}"`);
    if (i < 0) continue;
    for (const m of html.slice(i, i + 3000).matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/g)) {
      push(field, m[1], m[2].trim());
    }
  }
  return out;
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const bk = canon(params.brand || '');
  const mk = canon(params.model || '');
  // category_id : grain modèle si appris, sinon MARQUE si apprise, sinon
  // toutes-autos + tri texte en aval.
  const categoryId = (mk && CATEGORY_ID[`${bk}|${mk}`]) || CATEGORY_BRAND_ID[bk] || CATEGORY_ALL_CARS;
  if ((params.brand || params.model) && categoryId === CATEGORY_ALL_CARS) {
    warnings.push(`[LINKGEN_WARNING] Skelbiu: "${params.brand ?? ''} ${params.model ?? ''}" sans category_id appris — recherche toutes-autos, tri par le texte en aval`);
  } else if (params.model && !CATEGORY_ID[`${bk}|${mk}`]) {
    warnings.push(`[LINKGEN_WARNING] Skelbiu: modèle "${params.model}" sans catégorie apprise — page marque, tri par le texte en aval`);
  }
  const fuelCode = params.fuel ? FUEL_CODE[String(params.fuel).trim().toUpperCase()] : undefined;
  if (params.fuel && !fuelCode) {
    warnings.push(`[LINKGEN_WARNING] Skelbiu: carburant "${params.fuel}" sans code — filtre omis`);
  }
  // Squelette de paramètres calqué sur l'URL humaine (le site attend le
  // formulaire complet — champs vides inclus).
  const qs = new URLSearchParams();
  qs.set('keywords', '');
  qs.set('autocompleted', '1');
  qs.set('search', '1');
  qs.set('cities', '');
  qs.set('distance', '0');
  qs.set('mainCity', '1');
  qs.set('category_id', categoryId);
  qs.set('user_type', '0');
  qs.set('ad_since_min', '0');
  qs.set('ad_since_max', '0');
  qs.set('visited_page', '1');
  // orderBy=3 = prix croissant, -1 = défaut (paire d'URLs humaines 02/08).
  qs.set('orderBy', params.sort === 'relevance' ? '-1' : '3');
  qs.set('detailsSearch', '1');
  qs.set('cost_min', '');
  qs.set('cost_max', '');
  qs.set('type', '0');
  const { yearFrom, yearTo } = resolveYearRange(params);
  qs.set('year_min', yearFrom || '');
  qs.set('year_max', yearTo || '');
  if (fuelCode) qs.append('fuel[]', fuelCode);
  qs.set('engine_min', '');
  qs.set('engine_max', '');
  qs.set('power_min', '');
  qs.set('power_max', '');
  qs.set('mileage_min', '');
  qs.set('mileage_max', params.mileage ? String(params.mileage) : '');
  return {
    url: `https://www.skelbiu.lt/skelbimai/?${qs.toString()}`, warnings,
    modelExpressed: !params.model || Boolean(mk && CATEGORY_ID[`${bk}|${mk}`]),
  };
}

function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
  const listings = parseSearchResults(html);
  const wantBrand = (params.brand ?? '').trim().toLowerCase();
  const brandHits = wantBrand ? listings.filter((l) => l.title.toLowerCase().includes(wantBrand)).length : listings.length;
  const brandOk = listings.length > 0 && brandHits / listings.length >= 0.8;
  const issues: SiteValidationResult['issues'] = [];
  if (!brandOk && wantBrand) issues.push({ type: 'brand_missing' });
  if (params.model) issues.push({ type: 'model_not_applied' }); // sauf category apprise — l'analyse texte tranche
  if (listings.length === 0) issues.push({ type: 'no_listings' });
  return {
    site: 'SKELBIU', url, listingCount,
    sampleListings: listings.slice(0, 5).map((l) => ({ title: l.title, price: l.price, year: l.year, mileage: l.mileage, fuel: l.fuel ?? '', url: l.listing_url })),
    appliedFilters: { brand: brandOk, model: false, year: true, mileage: true, fuel: Boolean(params.fuel && FUEL_CODE[String(params.fuel).toUpperCase()]), trim: false, sort: true },
    score: brandOk ? 70 : 30,
    status: listings.length === 0 ? 'invalid' : brandOk ? 'partial' : 'invalid',
    issues,
    evidence: { structuredFieldsAvailable: true, fieldsUsed: ['year', 'mileage', 'fuel', 'gearbox', 'price'], missingFields: ['brand', 'model'] },
  };
}

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const out: Partial<SearchCriteria> = {};
  try {
    const u = new URL(url);
    const cat = u.searchParams.get('category_id') ?? '';
    const hit = Object.entries(CATEGORY_ID).find(([, v]) => v === cat)?.[0];
    if (hit) {
      const [b, m] = hit.split('|');
      out.brand = b;
      out.model = m;
    } else {
      const bHit = Object.entries(CATEGORY_BRAND_ID).find(([, v]) => v === cat)?.[0];
      if (bHit) out.brand = bHit;
    }
    const ym = u.searchParams.get('year_min'), yx = u.searchParams.get('year_max');
    if (ym && /^\d{4}$/.test(ym)) out.yearFrom = ym;
    if (yx && /^\d{4}$/.test(yx)) out.yearTo = yx;
    const mm = u.searchParams.get('mileage_max');
    if (mm && /^\d+$/.test(mm)) out.mileage = mm;
    const fuel = u.searchParams.get('fuel[]');
    const canonFuel = Object.entries(FUEL_CODE).find(([, v]) => v === fuel)?.[0];
    if (canonFuel) out.fuel = canonFuel;
  } catch { /* URL illisible */ }
  return out;
}

function extractCandidateSegments(url: string): CandidateSegment[] {
  const out: CandidateSegment[] = [];
  try {
    const u = new URL(url);
    const cat = u.searchParams.get('category_id');
    if (cat && cat !== CATEGORY_ALL_CARS) out.push({ raw: cat, location: 'query', paramName: 'category_id', guessField: 'model' });
    for (const [p, f] of [['year_min', 'year'], ['year_max', 'year'], ['mileage_max', 'mileage'], ['fuel[]', 'fuel']] as const) {
      const v = u.searchParams.get(p);
      if (v) out.push({ raw: v, location: 'query', paramName: p, guessField: f });
    }
  } catch { /* ignore */ }
  return out;
}

export const skelbiuAdapter: SiteAdapter = {
  key: 'SKELBIU',
  displayName: 'Skelbiu',
  country: 'Lithuania',
  countryCode: 'LT',
  domain: 'skelbiu.lt',
  urlTemplate: 'https://www.skelbiu.lt/skelbimai/?category_id={model}&year_min={yearFrom}&year_max={yearTo}',

  mapBrand: (raw) => raw.trim(),
  mapModel: (raw) => raw.trim(),
  mapFuel: (raw) => FUEL_CODE[raw.trim().toUpperCase()] ?? '',
  supportsParam: () => false,

  buildSearchUrl,
  // Pagination /skelbimai/N?… — PROUVÉE par URL humaine (page 2 dans le CHEMIN).
  buildPaginatedUrl: (baseUrl: string, pageNumber: number): string => {
    if (pageNumber <= 1) return baseUrl;
    try {
      const u = new URL(baseUrl);
      u.pathname = u.pathname.replace(/\/skelbimai\/?/, `/skelbimai/${pageNumber}`);
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
