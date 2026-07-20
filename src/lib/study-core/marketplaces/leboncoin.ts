/**
 * Leboncoin (FR) site adapter.
 *
 * Migrated as-is from the pre-refactor:
 *   - src/lib/linkgen/templates.ts (LEBONCOIN template/domain/country)
 *   - src/lib/linkgen/mappings.ts (LEBONCOIN brand/model/fuel maps)
 *   - src/lib/linkgen/generator.ts (LEBONCOIN branch of generateSearchUrl)
 *   - src/lib/linkgen/siteValidators/leboncoinValidator.ts (validateLeboncoin)
 *   - src/lib/linkgen/correctionStrategies.ts (leboncoinHypotheses, buildLeboncoinModelCandidates)
 *
 * No behavior change intended — see ADA architecture discussion, 2026-07-15.
 */

import { parseListings } from '../parsers/leboncoin';
import { normalizeForMatch } from './normalizer';
import { applyTemplate, resolveYearRange } from './urlTemplate';
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
  'https://www.leboncoin.fr/recherche?category=2' +
  '&u_car_brand={brand}' +
  '&u_car_model={model}' +
  '&regdate={yearFrom}-{yearTo}' +
  '&mileage=min-{mileage}' +
  '&fuel={fuel}' +
  '&text={trim}' +
  '&sort=price&order=asc';

const BRAND_MAP: Record<string, string> = {
  TOYOTA: 'TOYOTA',
  BMW: 'BMW',
  MERCEDES: 'MERCEDES-BENZ',
  VOLKSWAGEN: 'VOLKSWAGEN',
  AUDI: 'AUDI',
  PEUGEOT: 'PEUGEOT',
  RENAULT: 'RENAULT',
  FORD: 'FORD',
  HONDA: 'HONDA',
  NISSAN: 'NISSAN',
  HYUNDAI: 'HYUNDAI',
  KIA: 'KIA',
  VOLVO: 'VOLVO',
  SKODA: 'SKODA',
  SEAT: 'SEAT',
  CITROEN: 'CITROEN',
  OPEL: 'OPEL',
};

const MODEL_MAP: Record<string, string> = {
  RAV4: 'RAV 4',
  'RAV 4': 'RAV 4',
  YARIS: 'YARIS',
  COROLLA: 'COROLLA',
  CAMRY: 'CAMRY',
  PRIUS: 'PRIUS',
  'C-HR': 'C-HR',
  CHR: 'C-HR',
  GOLF: 'GOLF',
  POLO: 'POLO',
  PASSAT: 'PASSAT',
};

// Codes verified live on leboncoin.fr/recherche — do not modify without re-verification
// 1=Essence, 2=Diesel, 3=GPL, 4=Electrique, 5=Autre (used for PHEV), 6=Hybride, 7=GNV
const FUEL_MAP: Record<string, string> = {
  ESSENCE: '1',
  GASOLINE: '1',
  PETROL: '1',
  DIESEL: '2',
  GPL: '3',
  ELECTRIQUE: '4',
  ELECTRIC: '4',
  PLUG_IN_HYBRID: '5',
  HYBRIDE: '6',
  HYBRID: '6',
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

/**
 * Leboncoin's u_car_model accepts a COMMA-SEPARATED list of enum values and
 * matches ANY of them. The site's enums are inconsistent ('RAV 4' display
 * form, 'TOYOTA_RAV4' brand-prefixed, mixed-case learned forms) and a wrong
 * single token silently serves the UNFILTERED brand page (campaign logs:
 * TOYOTA_bZ4X → brand-wide results, COROLLA → 0 annonce). Proven working
 * form in the same campaign: 'C-HR,TOYOTA_C-HR' → 100/100 confirmées. We
 * send every plausible spelling — wrong ones match nothing, the right one
 * filters.
 */
function modelParamCandidates(brandMapped: string, modelMapped: string): string {
  const display = modelMapped.trim();
  const compact = display.replace(/\s+/g, '');
  const brand = brandMapped.trim();
  const out: string[] = [];
  for (const v of [display, compact, `${brand}_${compact}`, `${brand}_${display}`]) {
    if (v && v !== brand && !out.includes(v)) out.push(v);
  }
  // Espaces encodés (%20) comme le fait le site, virgules littérales (le
  // séparateur de liste doit rester brut).
  return out.map((v) => encodeURIComponent(v)).join(',');
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  if (params.minPower !== undefined && UNSUPPORTED_PARAMS.includes('minPower')) {
    warnings.push('[LINKGEN_WARNING] minPower ignored for LEBONCOIN until mapping is implemented');
  }

  const mappedBrand = mapBrand(params.brand || '');
  const mappedModel = mapModel(params.model || '');
  const mappedFuel = params.fuel ? mapFuel(params.fuel) : null;
  const { yearFrom, yearTo } = resolveYearRange(params);

  const vars: Record<string, string> = { brand: mappedBrand, model: modelParamCandidates(mappedBrand, mappedModel) };
  if (yearFrom) vars['yearFrom'] = yearFrom;
  if (yearTo) vars['yearTo'] = yearTo;
  if (params.mileage) vars['mileage'] = String(params.mileage);
  if (mappedFuel) vars['fuel'] = mappedFuel;
  if (params.trim && params.trim.trim()) vars['trim'] = params.trim.trim();

  const url = applyTemplate(URL_TEMPLATE, vars);
  return { url, warnings };
}

// ─── buildLeboncoinModelCandidates ────────────────────────────────────────────
// Returns candidate u_car_model values in priority order.
// 1. BRAND_MODEL (combined uppercase, e.g. TOYOTA_YARIS)
// 2. brand_model (combined lowercase)
// 3. MODEL only (already the default — included so caller can detect duplication)
function buildModelCandidates(brand: string, model: string): string[] {
  const normBrand = brand.trim().toUpperCase().replace(/\s+/g, '_');
  const normModel = model.trim().toUpperCase().replace(/\s+/g, '_');
  const combined = `${normBrand}_${normModel}`;
  const combinedLower = combined.toLowerCase();
  const modelOnly = normModel;

  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of [combined, combinedLower, modelOnly]) {
    if (!seen.has(c)) { seen.add(c); result.push(c); }
  }
  return result;
}

// Priority: 1. BRAND_MODEL format if model_not_applied/parser_failed_on_html, 2. drop trim+fuel
function generateCorrectionHypotheses(
  params: SearchCriteria,
  issueTypes: Set<string>
): Array<{ url: string; reason: string }> {
  const result: Array<{ url: string; reason: string }> = [];

  const modelNotApplied = issueTypes.has('model_not_applied') || issueTypes.has('parser_failed_on_html');

  // H1: try BRAND_MODEL combined format for the model parameter
  if (modelNotApplied || !issueTypes.has('fuel_mapping_suspect')) {
    const candidates = buildModelCandidates(params.brand ?? '', params.model ?? '');
    const brandModelCandidate = candidates[0]; // e.g. TOYOTA_YARIS
    if (brandModelCandidate) {
      const { url } = buildSearchUrl({
        ...params,
        model: brandModelCandidate,
        fuel: modelNotApplied ? undefined : params.fuel, // drop fuel if model was main issue
      });
      if (url) {
        result.push({
          url,
          reason: `LEBONCOIN H1: model param changed to combined format ${brandModelCandidate}`,
        });
      }
    }
  }

  // H1-alt: if fuel was the issue, drop fuel
  if (result.length === 0 && issueTypes.has('fuel_mapping_suspect') && params.fuel) {
    const { url } = buildSearchUrl({ ...params, fuel: undefined });
    if (url) result.push({ url, reason: 'LEBONCOIN H1: fuel filter removed (mapping suspect)' });
  }

  // H2: drop trim + fuel, keep model+year+mileage (widest structured search)
  if (result.length < 2 && (params.fuel || params.trim)) {
    const { url } = buildSearchUrl({ ...params, fuel: undefined, trim: undefined });
    if (url) result.push({ url, reason: 'LEBONCOIN H2: fuel + trim removed (widest structured fallback)' });
  }

  return result;
}

function inferFuelFromTitle(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  if (text.includes('diesel')) return 'diesel';
  if (text.includes('electr') || text.includes('électr')) return 'electric';
  if (text.includes('hybrid') || text.includes('hybride')) return 'hybrid';
  if (text.includes('essence') || text.includes('benzin') || text.includes('petrol')) return 'petrol';
  if (text.includes('gpl') || text.includes('lpg')) return 'gpl';
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

  const sortApplied = url.includes('sort') || url.includes('order=');

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

  // trim_removed_for_broader_market: trim was requested but none of the listings matched it
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
  const extractionMethod = '__NEXT_DATA__ JSON';

  console.log('[SCOUT_PARSE] LEBONCOIN', {
    htmlLength,
    parserUsed: 'study-core/parsers/leboncoin',
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
    console.log('[SCOUT_PARSE] structured_fields_missing site=LEBONCOIN url=' + url);
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

  // parser_failed_on_html: HTML was large enough but we got 0 listings
  if (parsedSampleCount === 0 && htmlLength > 100_000) {
    issues.push({ type: 'parser_failed_on_html' });
    console.warn('[SCOUT_PARSE] parser_failed_on_html — htmlLength=' + htmlLength + ' but 0 listings extracted site=LEBONCOIN');
  }

  return {
    site: 'LEBONCOIN',
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
      parserUsed: 'study-core/parsers/leboncoin',
      parsedSampleCount,
      extractionMethod,
    },
  };
}

function getFetchProfile(_attempt: number): ZyteProfileOverrides {
  // No JS-rendering escalation for Leboncoin today — matches pre-refactor
  // getZyteRequestProfile(), which only special-cased Marktplaats.
  return {};
}

// ─── Ingestion support ────────────────────────────────────────────────────────

// Canonical reverse of FUEL_MAP: codes verified live on leboncoin.fr.
// Not auto-inverted because several declared labels share a code
// (ESSENCE/GASOLINE/PETROL → '1'); we pick one canonical label per code.
const FUEL_CODE_TO_LABEL: Record<string, string> = {
  '1': 'ESSENCE',
  '2': 'DIESEL',
  '3': 'GPL',
  '4': 'ELECTRIQUE',
  '5': 'PLUG_IN_HYBRID',
  '6': 'HYBRIDE',
  '7': 'GNV',
};

function reverseLookup(map: Record<string, string>, siteValue: string): string {
  const target = siteValue.trim().toLowerCase();
  for (const [canonical, mapped] of Object.entries(map)) {
    if (mapped.toLowerCase() === target) return canonical;
  }
  return siteValue.trim();
}

/**
 * Leboncoin's u_car_model is brand-prefixed, e.g. "MERCEDES-BENZ_Classe CLA".
 * Strip the brand prefix so the form shows the clean model ("Classe CLA")
 * the way listing titles spell it. Falls back to a known-model reverse
 * lookup, then to the raw value.
 */
function cleanLeboncoinModel(rawParam: string): string {
  // u_car_model peut porter une LISTE ('RAV 4,TOYOTA_RAV4') — la première
  // valeur (forme d'affichage) représente le modèle.
  const raw = (rawParam.split(',')[0] ?? rawParam).trim();
  const reversed = reverseLookup(MODEL_MAP, raw);
  if (reversed !== raw) return reversed;
  const underscoreIdx = raw.indexOf('_');
  if (underscoreIdx > 0 && underscoreIdx < raw.length - 1) {
    return raw.slice(underscoreIdx + 1).trim();
  }
  return raw;
}

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const d = decomposeUrl(url);
  if (!d) return {};
  const q = d.queryParams;
  const out: Partial<SearchCriteria> = {};

  if (q['u_car_brand']) out.brand = reverseLookup(BRAND_MAP, q['u_car_brand']);
  if (q['u_car_model']) out.model = cleanLeboncoinModel(q['u_car_model']);
  if (q['regdate']) {
    // Format 'YYYY-YYYY' (also tolerate 'YYYY-max' / 'min-YYYY')
    const [from, to] = q['regdate'].split('-');
    if (/^\d{4}$/.test(from ?? '')) out.yearFrom = from;
    if (/^\d{4}$/.test(to ?? '')) out.yearTo = to;
  }
  if (q['mileage']) {
    // Format 'min-80000' — take the trailing number
    const m = q['mileage'].match(/(\d+)\s*$/);
    if (m) out.mileage = m[1];
  }
  if (q['fuel'] && FUEL_CODE_TO_LABEL[q['fuel']]) out.fuel = FUEL_CODE_TO_LABEL[q['fuel']];
  if (q['text']) out.trim = q['text'];

  // Numeric secondary filters are readable directly (value === human value).
  // Enum secondary filters (gearbox/color/vehicle_type) carry an opaque code
  // we don't reverse — the user declares those, the scrape learns the code.
  const powerFrom = firstNumber(q['horse_power_din']);
  if (powerFrom != null) out.powerFrom = String(powerFrom);
  const doors = firstNumber(q['doors'] ?? q['nb_doors']);
  if (doors != null) out.doors = String(doors);
  const seats = firstNumber(q['seats'] ?? q['nb_seats']);
  if (seats != null) out.seats = String(seats);

  return out;
}

// Maps real Leboncoin query-param names to the business field they encode.
const LEBONCOIN_PARAM_TO_FIELD: Record<string, NonNullable<CandidateSegment['guessField']>> = {
  u_car_brand: 'brand',
  u_car_model: 'model',
  regdate: 'year',
  mileage: 'mileage',
  fuel: 'fuel',
  text: 'trim',
  gearbox: 'gearbox',
  horse_power_din: 'power',
  vehicle_type: 'vehicleType',
  doors: 'doors',
  nb_doors: 'doors',
  seats: 'seats',
  nb_seats: 'seats',
  vehicle_color: 'color',
  couleur: 'color',
};

function firstNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function extractCandidateSegments(url: string): CandidateSegment[] {
  const d = decomposeUrl(url);
  if (!d) return [];
  // Drive off the ACTUAL decomposed params so we capture whatever the user's
  // URL really contains, including secondary filters.
  return Object.entries(d.queryParams)
    .filter(([k]) => k in LEBONCOIN_PARAM_TO_FIELD)
    .map(([k, v]) => ({
      raw: v,
      location: 'query' as const,
      paramName: k,
      guessField: LEBONCOIN_PARAM_TO_FIELD[k],
    }));
}

function inferFuel(title: string, description: string): string {
  // Wraps the Scout-internal detector, normalising 'gpl' to the canonical
  // cross-site token 'lpg' (the Scout keeps its own output untouched).
  const raw = inferFuelFromTitle(title, description);
  return raw === 'gpl' ? 'lpg' : raw;
}

export const leboncoinAdapter: SiteAdapter = {
  key: 'LEBONCOIN',
  displayName: 'Leboncoin',
  country: 'France',
  countryCode: 'FR',
  domain: 'leboncoin.fr',
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
