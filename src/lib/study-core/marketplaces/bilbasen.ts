/**
 * Bilbasen (DK) site adapter.
 *
 * Migrated as-is from the pre-refactor:
 *   - src/lib/linkgen/templates.ts (BILBASEN template/domain/country)
 *   - src/lib/linkgen/mappings.ts (BILBASEN brand/model/fuel maps)
 *   - src/lib/linkgen/generator.ts (BILBASEN branch of generateSearchUrl)
 *   - src/lib/linkgen/siteValidators/bilbasenValidator.ts (validateBilbasen)
 *   - src/lib/linkgen/correctionStrategies.ts (bilbasenHypotheses)
 *
 * No behavior change intended — see ADA architecture discussion, 2026-07-15.
 * Note: the Bilbasen template has no {trim} placeholder (trim was never
 * injected for this site pre-refactor) — preserved as-is, not a new gap.
 */

import { parseListings } from '../parsers/bilbasen';
import { normalizeForMatch } from './normalizer';
import { resolveYearRange } from './urlTemplate';
import { defaultBuildPaginatedUrl } from './registry';
import { decomposeUrl } from './urlDecompose';
import type {
  SiteAdapter,
  SearchCriteria,
  BuildUrlResult,
  SiteValidationResult,
  SampleListing,
  AppliedFilters,
  LinkGenIssue,
  ZyteProfileOverrides,
  CandidateSegment,
} from './types';

const URL_TEMPLATE =
  'https://www.bilbasen.dk/brugt/bil' +
  '?make={brand}' +
  '&model={model}' +
  '&yearfrom={yearFrom}' +
  '&yearto={yearTo}' +
  '&mileageto={mileage}' +
  '&fuel={fuel}' +
  '&hpfrom={powerFrom}' +
  '&sortby=price&sortorder=asc';

const BRAND_MAP: Record<string, string> = {
  TOYOTA: 'Toyota',
  BMW: 'BMW',
  MERCEDES: 'Mercedes-Benz',
  VOLKSWAGEN: 'Volkswagen',
  AUDI: 'Audi',
  PEUGEOT: 'Peugeot',
  RENAULT: 'Renault',
  FORD: 'Ford',
  HONDA: 'Honda',
  NISSAN: 'Nissan',
  HYUNDAI: 'Hyundai',
  KIA: 'Kia',
  VOLVO: 'Volvo',
  SKODA: 'Skoda',
  SEAT: 'Seat',
  CITROEN: 'Citroen',
  OPEL: 'Opel',
};

const MODEL_MAP: Record<string, string> = {
  RAV4: 'RAV4',
  'RAV 4': 'RAV4',
  YARIS: 'Yaris',
  COROLLA: 'Corolla',
  CAMRY: 'Camry',
  PRIUS: 'Prius',
  'C-HR': 'C-HR',
  CHR: 'C-HR',
  GOLF: 'Golf',
  POLO: 'Polo',
  PASSAT: 'Passat',
  '3 SERIES': '3',
  '5 SERIES': '5',
  'A-CLASS': 'A-Klasse',
  'C-CLASS': 'C-Klasse',
  'E-CLASS': 'E-Klasse',
};

const FUEL_MAP: Record<string, string> = {
  ESSENCE: 'Benzin',
  DIESEL: 'Diesel',
  HYBRIDE: 'Hybrid',
  ELECTRIQUE: 'El',
  GASOLINE: 'Benzin',
  PETROL: 'Benzin',
  HYBRID: 'Hybrid',
  ELECTRIC: 'El',
  PLUG_IN_HYBRID: 'Plugin-hybrid',
  GPL: '',
};

const UNSUPPORTED_PARAMS: string[] = [];

function mapBrand(raw: string): string {
  return BRAND_MAP[raw.trim().toUpperCase()] ?? raw.trim();
}

function mapModel(raw: string): string {
  return MODEL_MAP[raw.trim().toUpperCase()] ?? raw.trim();
}

function mapFuel(raw: string): string {
  return FUEL_MAP[raw.trim().toUpperCase()] ?? raw.trim();
}

/** Bilbasen path slug: lowercase, spaces/underscores → '-' (native URL form). */
function pathSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9.-]/g, '');
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];

  // Brand/model go in the PATH — campaign #6 (Tiguan) proved the site silently
  // IGNORES ?make=&model= query params ("Diesel - 5864 brugte", mixed brands).
  // The native form /brugt/bil/{brand}/{model} is the site's own filter
  // (human-confirmed with /brugt/bil/skoda/elroq).
  const brandSlug = pathSlug(mapBrand(params.brand || ''));
  const modelSlug = pathSlug(mapModel(params.model || ''));
  const segs = ['https://www.bilbasen.dk/brugt/bil'];
  if (brandSlug) segs.push(brandSlug);
  if (brandSlug && modelSlug) segs.push(modelSlug);

  const qs = new URLSearchParams();
  const { yearFrom, yearTo } = resolveYearRange(params);
  if (yearFrom) qs.set('yearfrom', yearFrom);
  if (yearTo) qs.set('yearto', yearTo);
  if (params.mileage) qs.set('mileageto', String(params.mileage));
  // Only inject fuel if mapping produced a non-empty value (GPL maps to '' for Bilbasen)
  const mappedFuel = params.fuel ? mapFuel(params.fuel) : null;
  if (mappedFuel && mappedFuel.trim()) qs.set('fuel', mappedFuel);
  // Native param `hpfrom` — human-confirmed (ingestion 89/89 with hpfrom=250).
  const power = params.powerFrom ?? params.minPower;
  if (power !== undefined && String(power).trim()) qs.set('hpfrom', String(power));
  qs.set('sortby', 'price');
  qs.set('sortorder', 'asc');

  return { url: `${segs.join('/')}?${qs.toString()}`, warnings };
}

// H1: fuel suspect → drop fuel; else regenerate structured
// H2: brand+model only
function generateCorrectionHypotheses(
  params: SearchCriteria,
  issueTypes: Set<string>
): Array<{ url: string; reason: string }> {
  const result: Array<{ url: string; reason: string }> = [];

  if (issueTypes.has('fuel_mapping_suspect') && params.fuel) {
    const { url } = buildSearchUrl({ ...params, fuel: undefined });
    if (url) result.push({ url, reason: 'BILBASEN H1: fuel removed (mapping suspect)' });
  } else {
    const { url } = buildSearchUrl(params);
    if (url) result.push({ url, reason: 'BILBASEN H1: regenerated structured params brand+model' });
  }

  if (result.length < 2 && (params.fuel || params.trim)) {
    const { url } = buildSearchUrl({ ...params, fuel: undefined, trim: undefined });
    if (url) result.push({ url, reason: 'BILBASEN H2: fuel + trim removed, brand+model only' });
  }

  return result;
}

function inferFuelFromTitle(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  if (text.includes('diesel')) return 'diesel';
  if (text.includes('el') || text.includes('elbil') || text.includes('electr')) return 'electric';
  if (text.includes('hybrid')) return 'hybrid';
  if (text.includes('benzin') || text.includes('petrol')) return 'petrol';
  if (text.includes('lpg') || text.includes('autogas')) return 'lpg';
  return '';
}

function statusFromScore(score: number): 'valid' | 'partial' | 'invalid' {
  if (score >= 80) return 'valid';
  if (score >= 60) return 'partial';
  return 'invalid';
}

function scoreSample(
  sample: SampleListing[],
  params: SearchCriteria,
  url: string
): { score: number; appliedFilters: AppliedFilters; issues: LinkGenIssue[] } {
  const normBrand = normalizeForMatch(params.brand ?? '');
  const normModel = normalizeForMatch(params.model ?? '');
  const normFuel = params.fuel ? normalizeForMatch(params.fuel) : null;
  const normTrim = params.trim ? normalizeForMatch(params.trim) : null;

  const yearFrom = params.yearFrom ? Number(params.yearFrom) : (params.year ? Number(params.year) : null);
  const yearTo = params.yearTo ? Number(params.yearTo) : null;
  const maxMileage = params.mileage ? Number(params.mileage) : null;

  let brandHit = false;
  let modelHit = false;
  let yearHit = false;
  let mileageHit = false;
  let fuelHit = false;
  let trimHit = false;

  for (const l of sample) {
    const normTitle = normalizeForMatch(l.title);
    if (!brandHit && normBrand && normTitle.includes(normBrand)) brandHit = true;
    if (!modelHit && normModel && normTitle.includes(normModel)) modelHit = true;
    if (!trimHit && normTrim && normTitle.includes(normTrim)) trimHit = true;

    if (!yearHit && l.year !== null) {
      const y = l.year;
      if (yearFrom && yearTo) yearHit = y >= yearFrom && y <= yearTo;
      else if (yearFrom) yearHit = y >= yearFrom;
    }

    if (!mileageHit && l.mileage !== null && maxMileage !== null) {
      mileageHit = l.mileage <= maxMileage;
    }

    if (!fuelHit && normFuel) {
      const listingFuel = normalizeForMatch(l.fuel);
      if (listingFuel && listingFuel.includes(normFuel)) fuelHit = true;
    }
  }

  const sortApplied = url.includes('sort') || url.includes('orderBy') || url.includes('order=');

  let score = 0;
  if (brandHit) score += 20;
  if (modelHit) score += 25;
  if (!yearFrom || yearHit) score += 15;
  if (!maxMileage || mileageHit) score += 15;
  if (!normFuel || fuelHit) score += 15;
  if (!normTrim || trimHit) score += 10;

  const issues: LinkGenIssue[] = [];
  if (!brandHit) issues.push({ type: 'brand_missing' });
  if (!modelHit) issues.push({ type: 'model_missing' });
  if (normFuel && !fuelHit) issues.push({ type: 'fuel_mismatch' });
  if (yearFrom && !yearHit && sample.some((l) => l.year !== null)) issues.push({ type: 'year_filter_not_applied' });
  if (maxMileage && !mileageHit && sample.some((l) => l.mileage !== null)) issues.push({ type: 'mileage_filter_not_applied' });

  if (normTrim && !trimHit && sample.length > 0) {
    issues.push({ type: 'trim_removed_for_broader_market' });
  }

  const appliedFilters: AppliedFilters = {
    brand: brandHit,
    model: modelHit,
    year: !yearFrom || yearHit,
    mileage: !maxMileage || mileageHit,
    fuel: !normFuel || fuelHit,
    trim: !normTrim || trimHit,
    sort: sortApplied,
  };

  return { score, appliedFilters, issues };
}

function scoreSearchResults(
  html: string,
  url: string,
  params: SearchCriteria,
  listingCount: number
): SiteValidationResult {
  const htmlLength = html.length;

  const rawAll = parseListings(html, url);
  const raw = rawAll.slice(0, 10);

  const parsedSampleCount = raw.length;
  const firstCandidateTitle = raw[0]?.title ?? null;
  const extractionMethod = 'context-window anchor regex';

  console.log('[SCOUT_PARSE] BILBASEN', {
    htmlLength,
    parserUsed: 'study-core/parsers/bilbasen',
    rawListingCandidatesCount: rawAll.length,
    parsedSampleCount,
    firstCandidateTitle,
    extractionMethod,
  });

  const structuredFieldsAvailable = raw.some((l) => l.year !== null || l.mileage !== null);
  const fieldsUsed: string[] = ['title'];
  const missingFields: string[] = [];

  if (structuredFieldsAvailable) {
    if (raw.some((l) => l.year !== null)) fieldsUsed.push('year');
    else missingFields.push('year');
    if (raw.some((l) => l.mileage !== null)) fieldsUsed.push('mileage');
    else missingFields.push('mileage');
  } else {
    missingFields.push('year', 'mileage');
    console.log('[SCOUT_PARSE] structured_fields_missing site=BILBASEN url=' + url);
  }

  const sampleListings: SampleListing[] = raw.map((l) => ({
    title: l.title,
    price: l.price,
    year: l.year,
    mileage: l.mileage,
    fuel: inferFuelFromTitle(l.title, l.description),
    url: l.listing_url,
  }));

  const { score, appliedFilters, issues } = scoreSample(sampleListings, params, url);
  const status = statusFromScore(score);

  if (parsedSampleCount === 0 && htmlLength > 100_000) {
    issues.push({ type: 'parser_failed_on_html' });
    console.warn('[SCOUT_PARSE] parser_failed_on_html — htmlLength=' + htmlLength + ' but 0 listings extracted site=BILBASEN');
  }

  return {
    site: 'BILBASEN',
    url,
    listingCount,
    sampleListings,
    appliedFilters,
    score,
    status,
    issues,
    evidence: {
      structuredFieldsAvailable,
      fieldsUsed,
      missingFields,
    },
    parserDetails: {
      htmlLength,
      parserUsed: 'study-core/parsers/bilbasen',
      parsedSampleCount,
      extractionMethod,
    },
  };
}

function getFetchProfile(_attempt: number): ZyteProfileOverrides {
  // No JS-rendering escalation for Bilbasen today — matches pre-refactor
  // getZyteRequestProfile(), which only special-cased Marktplaats.
  return {};
}

// ─── Ingestion support ────────────────────────────────────────────────────────

const FUEL_SITE_TO_LABEL: Record<string, string> = {
  'benzin': 'ESSENCE',
  'diesel': 'DIESEL',
  'el': 'ELECTRIQUE',
  'hybrid': 'HYBRIDE',
  'plugin-hybrid': 'PLUG_IN_HYBRID',
  // Native numeric codes. ONLY human-confirmed codes belong here ('3' proven
  // electric via ingestion 89/89) — unknown codes go through the learned enum
  // dictionary (linkgen_enum_mappings), never guessed.
  '3': 'ELECTRIQUE',
};

function reverseLookup(map: Record<string, string>, siteValue: string): string {
  const target = siteValue.trim().toLowerCase();
  for (const [canonical, mapped] of Object.entries(map)) {
    if (mapped.toLowerCase() === target) return canonical;
  }
  return siteValue.trim();
}

/**
 * Bilbasen exposes brand/model two ways: ADA-generated URLs put them in the
 * query (`?make=&model=`), but the native search URLs users paste carry them
 * in the PATH — `/brugt/bil/{brand}/{model}[/...]`. Pull them from the path so
 * re-pasting a native URL still pre-fills the form.
 */
function pathBrandModel(segs: string[]): { brand?: string; model?: string } {
  const i = segs.findIndex((s) => s.toLowerCase() === 'bil');
  if (i >= 0 && segs[i + 1]) return { brand: segs[i + 1], model: segs[i + 2] };
  return {};
}

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const d = decomposeUrl(url);
  if (!d) return {};
  const q = d.queryParams;
  const out: Partial<SearchCriteria> = {};

  const path = pathBrandModel(d.pathSegments);
  const rawMake = q['make'] ?? path.brand;
  const rawModel = q['model'] ?? path.model;
  if (rawMake) out.brand = reverseLookup(BRAND_MAP, rawMake);
  if (rawModel) out.model = reverseLookup(MODEL_MAP, rawModel);
  if (q['yearfrom'] && /^\d{4}$/.test(q['yearfrom'])) out.yearFrom = q['yearfrom'];
  if (q['yearto'] && /^\d{4}$/.test(q['yearto'])) out.yearTo = q['yearto'];
  if (q['mileageto'] && /^\d+$/.test(q['mileageto'])) out.mileage = q['mileageto'];
  if (q['fuel'] && FUEL_SITE_TO_LABEL[q['fuel'].toLowerCase()]) out.fuel = FUEL_SITE_TO_LABEL[q['fuel'].toLowerCase()];
  if (q['hpfrom'] && /^\d+$/.test(q['hpfrom'])) out.powerFrom = q['hpfrom'];
  if (q['free']) out.trim = q['free'];

  return out;
}

function extractCandidateSegments(url: string): CandidateSegment[] {
  const d = decomposeUrl(url);
  if (!d) return [];
  const q = d.queryParams;
  const out: CandidateSegment[] = [];
  const push = (paramName: string, guessField: CandidateSegment['guessField']) => {
    if (q[paramName]) out.push({ raw: q[paramName], location: 'query', paramName, guessField });
  };
  // Native-path brand/model (when not already in query).
  const path = pathBrandModel(d.pathSegments);
  if (!q['make'] && path.brand) out.push({ raw: path.brand, location: 'path', paramName: 'make', guessField: 'brand' });
  if (!q['model'] && path.model) out.push({ raw: path.model, location: 'path', paramName: 'model', guessField: 'model' });
  push('make', 'brand');
  push('model', 'model');
  push('yearfrom', 'year');
  push('yearto', 'year');
  push('mileageto', 'mileage');
  push('fuel', 'fuel');
  push('hpfrom', 'power');
  push('free', 'trim');
  return out;
}

/**
 * Danish fuel detection with word boundaries. Deliberately NOT reusing the
 * Scout-internal inferFuelFromTitle: its `text.includes('el')` matches 'el'
 * inside any word ('model', 'gele'…), which is tolerable for a Scout score
 * but not for a 100%-certainty ingestion decision.
 */
function inferFuel(title: string, description: string): string {
  const text = ` ${(title + ' ' + description).toLowerCase()} `;
  if (/\bdiesel\b/.test(text)) return 'diesel';
  if (/\bplug-?in\b|\bplugin-?hybrid\b|\bphev\b/.test(text)) return 'hybrid';
  if (/\bhybrid\b/.test(text)) return 'hybrid';
  if (/\bel\b|\belbil\b|\belektrisk\b|\belectric\b/.test(text)) return 'electric';
  if (/\bbenzin\b|\bpetrol\b/.test(text)) return 'petrol';
  if (/\blpg\b|\bautogas\b/.test(text)) return 'lpg';
  return '';
}

export const bilbasenAdapter: SiteAdapter = {
  key: 'BILBASEN',
  displayName: 'Bilbasen',
  country: 'Denmark',
  countryCode: 'DK',
  domain: 'bilbasen.dk',
  urlTemplate: URL_TEMPLATE,

  mapBrand,
  mapModel,
  mapFuel,
  supportsParam: (param) => !UNSUPPORTED_PARAMS.includes(param),

  buildSearchUrl,
  buildPaginatedUrl: defaultBuildPaginatedUrl,

  parseSearchResults: parseListings,

  scoreSearchResults,
  generateCorrectionHypotheses,

  getFetchProfile,

  prefillCriteriaFromUrl,
  extractCandidateSegments,
  inferFuel,
};
