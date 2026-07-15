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
import { applyTemplate, resolveYearRange } from './urlTemplate';
import { defaultBuildPaginatedUrl } from './registry';
import type {
  SiteAdapter,
  SearchCriteria,
  BuildUrlResult,
  SiteValidationResult,
  SampleListing,
  AppliedFilters,
  LinkGenIssue,
  ZyteProfileOverrides,
} from './types';

const URL_TEMPLATE =
  'https://www.bilbasen.dk/brugt/bil' +
  '?make={brand}' +
  '&model={model}' +
  '&yearfrom={yearFrom}' +
  '&yearto={yearTo}' +
  '&mileageto={mileage}' +
  '&fuel={fuel}' +
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

const UNSUPPORTED_PARAMS = ['minPower'];

function mapBrand(raw: string): string {
  return BRAND_MAP[raw.trim().toUpperCase()] ?? raw.trim();
}

function mapModel(raw: string): string {
  return MODEL_MAP[raw.trim().toUpperCase()] ?? raw.trim();
}

function mapFuel(raw: string): string {
  return FUEL_MAP[raw.trim().toUpperCase()] ?? raw.trim();
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  if (params.minPower !== undefined && UNSUPPORTED_PARAMS.includes('minPower')) {
    warnings.push('[LINKGEN_WARNING] minPower ignored for BILBASEN until mapping is implemented');
  }

  const mappedBrand = mapBrand(params.brand || '');
  const mappedModel = mapModel(params.model || '');
  const mappedFuel = params.fuel ? mapFuel(params.fuel) : null;
  const { yearFrom, yearTo } = resolveYearRange(params);

  const vars: Record<string, string> = { brand: mappedBrand, model: mappedModel };
  if (yearFrom) vars['yearFrom'] = yearFrom;
  if (yearTo) vars['yearTo'] = yearTo;
  if (params.mileage) vars['mileage'] = String(params.mileage);
  // Only inject fuel if mapping produced a non-empty value (GPL maps to '' for Bilbasen)
  if (mappedFuel && mappedFuel.trim()) vars['fuel'] = mappedFuel;

  const url = applyTemplate(URL_TEMPLATE, vars);
  return { url, warnings };
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

export const bilbasenAdapter: SiteAdapter = {
  key: 'BILBASEN',
  displayName: 'Bilbasen',
  country: 'Denmark',
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
};
