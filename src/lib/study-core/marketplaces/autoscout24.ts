/**
 * AutoScout24 site adapter — pan-European, one instance per country.
 *
 * AS24 is a single marketplace served on per-country TLDs (autoscout24.fr,
 * .de, .nl, .it, .es, .be), each restricting listings with a `cy` code. We
 * register ONE adapter instance per country via `makeAutoscout24Adapter`, so
 * each carries its own `countryCode` — which is what feeds the Market
 * Intelligence per-country comparison. Adding a country = one line in the
 * COUNTRIES list below, no new logic.
 *
 * Taxonomy class: "readable" (like Leboncoin). Brand/model are URL-path slugs
 * (`/lst/toyota/c-hr`), so no learned ID dictionary is needed — the slug IS
 * the name. Fuel/gearbox are small fixed code tables verified from public
 * AS24 search URLs (fuel B/D/E/2/3/L/C, gear A/M/S).
 */

import { parseListings } from '../parsers/autoscout24';
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

// ─── Taxonomy (verified from public AS24 search URLs) ───────────────────────────

// Canonical (uppercased) → AS24 `fuel` code.
// B=petrol, D=diesel, E=electric, 2=petrol-hybrid, 3=diesel-hybrid, L=LPG, C=CNG.
const FUEL_MAP: Record<string, string> = {
  ESSENCE: 'B', GASOLINE: 'B', PETROL: 'B', BENZIN: 'B', BENZINA: 'B', GASOLINA: 'B',
  DIESEL: 'D', GASOIL: 'D',
  ELECTRIQUE: 'E', ELECTRIC: 'E', ELEKTRO: 'E', ELETTRICA: 'E', ELECTRICO: 'E',
  HYBRIDE: '2', HYBRID: '2', IBRIDA: '2', HIBRIDO: '2',
  PLUG_IN_HYBRID: '2', PHEV: '2',
  GPL: 'L', LPG: 'L', AUTOGAS: 'L',
  GNV: 'C', CNG: 'C', ERDGAS: 'C', METANO: 'C',
};
const FUEL_CODE_TO_LABEL: Record<string, string> = {
  B: 'ESSENCE', D: 'DIESEL', E: 'ELECTRIQUE', '2': 'HYBRIDE', '3': 'HYBRIDE', L: 'GPL', C: 'GNV',
};

// Canonical (uppercased) → AS24 `gear` code. A=automatic, M=manual, S=semi-auto.
const GEAR_MAP: Record<string, string> = {
  AUTOMATIQUE: 'A', AUTOMATIC: 'A', AUTOMATIK: 'A', AUTOMATICA: 'A', AUTOMATISCH: 'A',
  MANUELLE: 'M', MANUAL: 'M', MANUELL: 'M', MANUALE: 'M', SCHALTGETRIEBE: 'M',
  SEMI: 'S', 'SEMI-AUTOMATIC': 'S', SEMIAUTOMATIC: 'S', SEMIAUTOMATIQUE: 'S',
};
const GEAR_CODE_TO_LABEL: Record<string, string> = { A: 'Automatique', M: 'Manuelle', S: 'Semi-automatique' };

const UNSUPPORTED_PARAMS: string[] = []; // AS24 supports power, unlike Leboncoin.

interface CountryCfg {
  key: string;
  country: string;    // display name (FR)
  countryCode: string; // ISO alpha-2 — matches linkgen_mapping_memory / snapshots
  domain: string;
  cy: string;         // AS24 country filter code
}

const COUNTRIES: CountryCfg[] = [
  { key: 'AUTOSCOUT_FR', country: 'France', countryCode: 'FR', domain: 'autoscout24.fr', cy: 'F' },
  { key: 'AUTOSCOUT_DE', country: 'Allemagne', countryCode: 'DE', domain: 'autoscout24.de', cy: 'D' },
  { key: 'AUTOSCOUT_NL', country: 'Pays-Bas', countryCode: 'NL', domain: 'autoscout24.nl', cy: 'NL' },
  { key: 'AUTOSCOUT_IT', country: 'Italie', countryCode: 'IT', domain: 'autoscout24.it', cy: 'I' },
  { key: 'AUTOSCOUT_ES', country: 'Espagne', countryCode: 'ES', domain: 'autoscout24.es', cy: 'E' },
  { key: 'AUTOSCOUT_BE', country: 'Belgique', countryCode: 'BE', domain: 'autoscout24.be', cy: 'B' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Name → URL slug: strip accents, lowercase, non-alnum → '-'. */
function slug(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function mapFuel(raw: string): string {
  return FUEL_MAP[raw.trim().toUpperCase()] ?? '';
}
function mapGear(raw: string): string {
  return GEAR_MAP[raw.trim().toUpperCase()] ?? '';
}

function firstNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// ─── Fuel inference from listing text (language-aware, all AS24 markets) ─────────

function inferFuel(title: string, description: string): string {
  const t = (title + ' ' + description).toLowerCase();
  if (/\bdiesel\b|gasoil|tdi|hdi|dci|cdi|crdi/.test(t)) return 'diesel';
  if (/plug.?in|hybride rechargeable|phev/.test(t)) return 'phev';
  if (/hybrid|hybride|ibrida|híbrido|hibrido/.test(t)) return 'hybrid';
  if (/electr|élektr|elektr|elettric|eléctric|electrico/.test(t)) return 'electric';
  if (/\bgpl\b|\blpg\b|autogas/.test(t)) return 'lpg';
  if (/\bcng\b|\bgnv\b|erdgas|metano/.test(t)) return 'cng';
  if (/essence|benzin|benzina|gasolina|petrol|benzine/.test(t)) return 'petrol';
  return '';
}

// ─── Scoring (study validator path) ─────────────────────────────────────────────

function statusFromScore(score: number): 'valid' | 'partial' | 'invalid' {
  if (score >= 80) return 'valid';
  if (score >= 60) return 'partial';
  return 'invalid';
}

function scoreSample(sample: SampleListing[], params: SearchCriteria, url: string):
  { score: number; appliedFilters: AppliedFilters; issues: LinkGenIssue[] } {
  const normBrand = normalizeForMatch(params.brand ?? '');
  const normModel = normalizeForMatch(params.model ?? '');
  const normFuel = params.fuel ? normalizeForMatch(params.fuel) : null;
  const normTrim = params.trim ? normalizeForMatch(params.trim) : null;

  const yearFromV = params.yearFrom ? Number(params.yearFrom) : (params.year ? Number(params.year) : null);
  const yearToV = params.yearTo ? Number(params.yearTo) : null;
  const maxMileage = params.mileage ? Number(params.mileage) : null;

  let brandHit = false, modelHit = false, yearHit = false, mileageHit = false, fuelHit = false, trimHit = false;
  for (const l of sample) {
    const nt = normalizeForMatch(l.title);
    if (!brandHit && normBrand && nt.includes(normBrand)) brandHit = true;
    if (!modelHit && normModel && nt.includes(normModel)) modelHit = true;
    if (!trimHit && normTrim && nt.includes(normTrim)) trimHit = true;
    if (!yearHit && l.year !== null) {
      if (yearFromV && yearToV) yearHit = l.year >= yearFromV && l.year <= yearToV;
      else if (yearFromV) yearHit = l.year >= yearFromV;
    }
    if (!mileageHit && l.mileage !== null && maxMileage !== null) mileageHit = l.mileage <= maxMileage;
    if (!fuelHit && normFuel) {
      const lf = normalizeForMatch(l.fuel);
      if (lf && lf.includes(normFuel)) fuelHit = true;
    }
  }

  let score = 0;
  if (brandHit) score += 20;
  if (modelHit) score += 25;
  if (!yearFromV || yearHit) score += 15;
  if (!maxMileage || mileageHit) score += 15;
  if (!normFuel || fuelHit) score += 15;
  if (!normTrim || trimHit) score += 10;

  const issues: LinkGenIssue[] = [];
  if (!brandHit) issues.push({ type: 'brand_missing' });
  if (!modelHit) issues.push({ type: 'model_missing' });
  if (normFuel && !fuelHit) issues.push({ type: 'fuel_mismatch' });
  if (yearFromV && !yearHit && sample.some((l) => l.year !== null)) issues.push({ type: 'year_filter_not_applied' });
  if (maxMileage && !mileageHit && sample.some((l) => l.mileage !== null)) issues.push({ type: 'mileage_filter_not_applied' });

  const appliedFilters: AppliedFilters = {
    brand: brandHit, model: modelHit,
    year: !yearFromV || yearHit, mileage: !maxMileage || mileageHit,
    fuel: !normFuel || fuelHit, trim: !normTrim || trimHit,
    sort: url.includes('sort=') || url.includes('desc='),
  };
  return { score, appliedFilters, issues };
}

// ─── Factory ────────────────────────────────────────────────────────────────────

function makeAutoscout24Adapter(cfg: CountryCfg): SiteAdapter {
  const URL_TEMPLATE =
    `https://www.${cfg.domain}/lst/{brand}/{model}` +
    `?atype=C&cy=${cfg.cy}&fregfrom={yearFrom}&fregto={yearTo}&kmto={mileage}` +
    `&fuel={fuel}&sort=price&desc=0&ustate=N,U`;

  function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
    const warnings: string[] = [];
    const brandSlug = slug(String(params.brand ?? ''));
    const modelSlug = slug(String(params.model ?? ''));

    const segs = ['lst'];
    if (brandSlug) segs.push(brandSlug);
    if (brandSlug && modelSlug) segs.push(modelSlug);
    const path = '/' + segs.join('/');

    const qs = new URLSearchParams();
    qs.set('atype', 'C');
    qs.set('cy', cfg.cy);
    const { yearFrom, yearTo } = resolveYearRange(params);
    if (yearFrom) qs.set('fregfrom', yearFrom);
    if (yearTo) qs.set('fregto', yearTo);
    if (params.mileage) qs.set('kmto', String(params.mileage));
    const mappedFuel = params.fuel ? mapFuel(params.fuel) : '';
    if (mappedFuel) qs.set('fuel', mappedFuel);
    else if (params.fuel) warnings.push(`[LINKGEN_WARNING] AutoScout24: unknown fuel "${params.fuel}", filter dropped`);
    const mappedGear = params.gearbox ? mapGear(params.gearbox) : '';
    if (mappedGear) qs.set('gear', mappedGear);
    const power = params.minPower ?? params.powerFrom;
    if (power) { qs.set('powerfrom', String(power)); qs.set('powertype', 'hp'); }
    qs.set('sort', 'price');
    qs.set('desc', '0');
    qs.set('ustate', 'N,U');
    if (params.trim && params.trim.trim()) {
      warnings.push('[LINKGEN_WARNING] AutoScout24 has no reliable free-text trim filter; trim confirmed via listing text, not URL');
    }

    return { url: `https://www.${cfg.domain}${path}?${qs.toString()}`, warnings };
  }

  function generateCorrectionHypotheses(params: SearchCriteria, issueTypes: Set<string>):
    Array<{ url: string; reason: string }> {
    const result: Array<{ url: string; reason: string }> = [];
    // H1: fuel mapping suspect → drop fuel.
    if (issueTypes.has('fuel_mismatch') && params.fuel) {
      const { url } = buildSearchUrl({ ...params, fuel: undefined });
      result.push({ url, reason: 'AUTOSCOUT H1: fuel filter removed (mismatch)' });
    }
    // H2: model not applied → widen to brand-only (drop model + secondary filters).
    if (result.length === 0 && (issueTypes.has('model_missing') || issueTypes.has('parser_failed_on_html'))) {
      const { url } = buildSearchUrl({ ...params, model: '', fuel: undefined, gearbox: undefined });
      result.push({ url, reason: 'AUTOSCOUT H2: widened to brand-only (model not applied)' });
    }
    return result;
  }

  function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
    const raw = parseListings(html, url).slice(0, 10);
    const sampleListings: SampleListing[] = raw.map((l) => ({
      title: l.title, price: l.price, year: l.year, mileage: l.mileage,
      fuel: l.fuel ?? inferFuel(l.title, l.description), url: l.listing_url,
    }));
    const { score, appliedFilters, issues } = scoreSample(sampleListings, params, url);
    const structuredFieldsAvailable = raw.some((l) => l.year !== null || l.mileage !== null);
    if (raw.length === 0 && html.length > 100_000) issues.push({ type: 'parser_failed_on_html' });

    return {
      site: cfg.key, url, listingCount, sampleListings, appliedFilters, score,
      status: statusFromScore(score), issues,
      evidence: {
        structuredFieldsAvailable,
        fieldsUsed: structuredFieldsAvailable ? ['title', 'year', 'mileage'] : ['title'],
        missingFields: structuredFieldsAvailable ? [] : ['year', 'mileage'],
      },
      parserDetails: {
        htmlLength: html.length,
        parserUsed: 'study-core/parsers/autoscout24',
        parsedSampleCount: raw.length,
        extractionMethod: '__NEXT_DATA__ JSON',
      },
    };
  }

  function getFetchProfile(attempt: number): ZyteProfileOverrides {
    // AS24 is Cloudflare-protected but server-renders its listings into
    // __NEXT_DATA__. First attempts use Zyte's raw-HTML unblocker
    // (httpResponseBody) — its anti-ban stack defeats Cloudflare and the SSR
    // HTML already carries the data (no browser needed, faster/cheaper). If the
    // raw path keeps coming back blocked, escalate to a full headless browser
    // with a long settle wait for the JS challenge to resolve.
    if (attempt <= 2) {
      return { httpResponseBody: true, geolocation: cfg.countryCode };
    }
    return { geolocation: cfg.countryCode, actions: [{ action: 'waitForTimeout', timeout: 8 }] };
  }

  // ─── Ingestion support ──────────────────────────────────────────────────────

  function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
    const d = decomposeUrl(url);
    if (!d) return {};
    const out: Partial<SearchCriteria> = {};

    // Path: /lst/{brand-slug}/{model-slug}
    const lstIdx = d.pathSegments.indexOf('lst');
    if (lstIdx >= 0) {
      const brandSlug = d.pathSegments[lstIdx + 1];
      const modelSlug = d.pathSegments[lstIdx + 2];
      if (brandSlug) out.brand = brandSlug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      if (modelSlug) out.model = modelSlug.toUpperCase(); // keep 'C-HR' intact
    }

    const q = d.queryParams;
    if (/^\d{4}$/.test(q['fregfrom'] ?? '')) out.yearFrom = q['fregfrom'];
    if (/^\d{4}$/.test(q['fregto'] ?? '')) out.yearTo = q['fregto'];
    const km = firstNumber(q['kmto']);
    if (km != null) out.mileage = String(km);
    if (q['fuel'] && FUEL_CODE_TO_LABEL[q['fuel']]) out.fuel = FUEL_CODE_TO_LABEL[q['fuel']];
    if (q['gear'] && GEAR_CODE_TO_LABEL[q['gear']]) out.gearbox = GEAR_CODE_TO_LABEL[q['gear']];
    const power = firstNumber(q['powerfrom']);
    if (power != null) out.powerFrom = String(power);

    return out;
  }

  function extractCandidateSegments(url: string): CandidateSegment[] {
    const d = decomposeUrl(url);
    if (!d) return [];
    const out: CandidateSegment[] = [];

    const lstIdx = d.pathSegments.indexOf('lst');
    if (lstIdx >= 0) {
      const brandSlug = d.pathSegments[lstIdx + 1];
      const modelSlug = d.pathSegments[lstIdx + 2];
      if (brandSlug) out.push({ raw: brandSlug, location: 'path', paramName: '_path:brand', guessField: 'brand' });
      if (modelSlug) out.push({ raw: modelSlug, location: 'path', paramName: '_path:model', guessField: 'model' });
    }

    const map: Record<string, NonNullable<CandidateSegment['guessField']>> = {
      fregfrom: 'year', fregto: 'year', kmto: 'mileage', fuel: 'fuel', gear: 'gearbox', powerfrom: 'power',
    };
    for (const [k, v] of Object.entries(d.queryParams)) {
      if (k in map && v) out.push({ raw: v, location: 'query', paramName: k, guessField: map[k] });
    }
    return out;
  }

  return {
    key: cfg.key,
    displayName: `AutoScout24 ${cfg.countryCode}`,
    country: cfg.country,
    countryCode: cfg.countryCode,
    domain: cfg.domain,
    urlTemplate: URL_TEMPLATE,

    mapBrand: (raw) => raw.trim(),   // AS24 slug = the name; slugged at buildSearchUrl
    mapModel: (raw) => raw.trim(),
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
}

export const autoscout24Adapters: SiteAdapter[] = COUNTRIES.map(makeAutoscout24Adapter);
