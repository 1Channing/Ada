/**
 * Marktplaats (NL) site adapter.
 *
 * Migrated as-is from the pre-refactor:
 *   - src/lib/linkgen/templates.ts (MARKTPLAATS template/domain/country)
 *   - src/lib/linkgen/mappings.ts (MARKTPLAATS brand/model/fuel maps)
 *   - src/lib/linkgen/generator.ts (MARKTPLAATS branch of generateSearchUrl, buildMarktplaatsQuery, normalizeToken)
 *   - src/lib/linkgen/siteValidators/marktplaatsValidator.ts (validateMarktplaats)
 *   - src/lib/linkgen/correctionStrategies.ts (marktplaatsHypotheses)
 *   - src/lib/study-core/scraping.ts (getZyteRequestProfile — Marktplaats-only JS escalation branch)
 *
 * No behavior change intended — see ADA architecture discussion, 2026-07-15.
 */

import { parseListings } from '../parsers/marktplaats';
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
  'https://www.marktplaats.nl/l/auto-s/#q:{query}' +
  '|constructionYearFrom:{yearFrom}' +
  '|constructionYearTo:{yearTo}' +
  '|mileageTo:{mileage}' +
  '|sortBy:PRICE' +
  '|sortOrder:INCREASING';

const BRAND_MAP: Record<string, string> = {
  TOYOTA: 'toyota',
  BMW: 'bmw',
  MERCEDES: 'mercedes-benz',
  VOLKSWAGEN: 'volkswagen',
  AUDI: 'audi',
  PEUGEOT: 'peugeot',
  RENAULT: 'renault',
  FORD: 'ford',
  HONDA: 'honda',
  NISSAN: 'nissan',
  HYUNDAI: 'hyundai',
  KIA: 'kia',
  VOLVO: 'volvo',
  SKODA: 'skoda',
  SEAT: 'seat',
  CITROEN: 'citroen',
  OPEL: 'opel',
};

const MODEL_MAP: Record<string, string> = {
  RAV4: 'rav4',
  'RAV 4': 'rav4',
  YARIS: 'yaris',
  COROLLA: 'corolla',
  CAMRY: 'camry',
  PRIUS: 'prius',
  'C-HR': 'c-hr',
  CHR: 'c-hr',
  GOLF: 'golf',
  POLO: 'polo',
  PASSAT: 'passat',
  '3 SERIES': '3-series',
  '5 SERIES': '5-series',
  'A-CLASS': 'a-klasse',
  'C-CLASS': 'c-klasse',
  'E-CLASS': 'e-klasse',
  // French Mercedes naming (Leboncoin-learned models) → Dutch native
  'CLASSE A': 'a-klasse',
  'CLASSE B': 'b-klasse',
  'CLASSE C': 'c-klasse',
  'CLASSE E': 'e-klasse',
  'CLASSE S': 's-klasse',
  'CLASSE V': 'v-klasse',
  'CLASSE CLA': 'cla',
  'CLASSE CLS': 'cls',
  'CLASSE GLA': 'gla',
  'CLASSE GLB': 'glb',
  'CLASSE GLC': 'glc',
  'CLASSE GLE': 'gle',
  CLA: 'cla',
  GLA: 'gla',
  GLC: 'glc',
  GLE: 'gle',
};

const FUEL_MAP: Record<string, string> = {
  ESSENCE: 'benzine',
  DIESEL: 'diesel',
  HYBRIDE: 'hybride',
  ELECTRIQUE: 'elektrisch',
  GPL: 'lpg',
  GASOLINE: 'benzine',
  PETROL: 'benzine',
  HYBRID: 'hybride',
  ELECTRIC: 'elektrisch',
  PLUG_IN_HYBRID: 'plug-in-hybride',
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

function normalizeToken(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '+')
    .replace(/[^a-z0-9+\-]/g, '');
}

// Build the Marktplaats q= query: brand+model[+trim], no duplication, no empty segments
function buildQuery(brand: string, model: string, trim?: string): string {
  const normBrand = normalizeToken(brand);
  const normModel = normalizeToken(model);

  const base = [normBrand, normModel].filter(Boolean).join('+');

  if (!trim || !trim.trim()) return base;

  const normTrim = normalizeToken(trim);
  if (!normTrim) return base;

  // Anti-duplication: check if trim tokens are already present in base
  const baseParts = base.split('+');
  const trimParts = normTrim.split('+');
  const alreadyPresent = trimParts.every((t) => baseParts.includes(t));

  if (alreadyPresent) return base;

  return `${base}+${normTrim}`;
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  if (params.minPower !== undefined && UNSUPPORTED_PARAMS.includes('minPower')) {
    warnings.push('[LINKGEN_WARNING] minPower ignored for MARKTPLAATS until mapping is implemented');
  }

  const mappedBrand = mapBrand(params.brand || '');
  const mappedModel = mapModel(params.model || '');
  const { yearFrom, yearTo } = resolveYearRange(params);

  // Brand goes in the PATH (site's own category filter — guaranteed) whenever
  // we know its slug; only model+trim stay in the free-text search. Putting
  // "seat leon" wholesale in #q: returned mixed-brand samples (4% brand match)
  // — the site's category page can't make that mistake.
  const brandSlug = BRAND_MAP[(params.brand ?? '').trim().toUpperCase()] ?? null;
  const query = brandSlug
    ? buildQuery('', mappedModel, params.trim)
    : buildQuery(mappedBrand, mappedModel, params.trim);
  if (!brandSlug && params.brand) {
    warnings.push(`[LINKGEN_WARNING] MARKTPLAATS: marque "${params.brand}" sans slug connu — recherche texte (fiabilité moindre)`);
  }

  const hashParts = [`q:${query}`];
  if (yearFrom) hashParts.push(`constructionYearFrom:${yearFrom}`);
  if (yearTo) hashParts.push(`constructionYearTo:${yearTo}`);
  if (params.mileage) hashParts.push(`mileageTo:${params.mileage}`);
  hashParts.push('sortBy:PRICE', 'sortOrder:INCREASING');

  const base = brandSlug
    ? `https://www.marktplaats.nl/l/auto-s/${brandSlug}/`
    : 'https://www.marktplaats.nl/l/auto-s/';
  return { url: `${base}#${hashParts.join('|')}`, warnings };
}

// H1: fuel suspect → drop fuel; else regenerate
// H2: brand+model without trim
function generateCorrectionHypotheses(
  params: SearchCriteria,
  issueTypes: Set<string>
): Array<{ url: string; reason: string }> {
  const result: Array<{ url: string; reason: string }> = [];

  if (issueTypes.has('fuel_mapping_suspect') && params.fuel) {
    const { url } = buildSearchUrl({ ...params, fuel: undefined });
    if (url) result.push({ url, reason: 'MARKTPLAATS H1: fuel removed (mapping suspect)' });
  } else {
    const { url } = buildSearchUrl(params);
    if (url) result.push({ url, reason: 'MARKTPLAATS H1: regenerated full query brand+model+trim' });
  }

  if (result.length < 2 && params.trim) {
    const { url } = buildSearchUrl({ ...params, trim: undefined });
    if (url) result.push({ url, reason: 'MARKTPLAATS H2: trim removed, brand+model only' });
  }

  return result;
}

function inferFuelFromTitle(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  if (text.includes('diesel')) return 'diesel';
  // Hybride AVANT électrique : « Hybride Elektrisch/Benzine » doit rester
  // hybride ; et le néerlandais s'écrit « elektrisch » (k), pas « electr ».
  if (text.includes('hybrid')) return 'hybrid';
  if (text.includes('electr') || text.includes('elektr')) return 'electric';
  if (text.includes('benzine') || text.includes('petrol')) return 'petrol';
  if (text.includes('lpg')) return 'lpg';
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

  // Marktplaats uses hash params for sort
  const sortApplied = url.includes('sort') || url.includes('sortBy') || url.includes('sortOrder') || url.includes('order=') || url.includes('|so:');

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
  const extractionMethod = 'DOM card regex + JSON fallback';

  console.log('[SCOUT_PARSE] MARKTPLAATS', {
    htmlLength,
    parserUsed: 'study-core/parsers/marktplaats',
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
    console.log('[SCOUT_PARSE] structured_fields_missing site=MARKTPLAATS url=' + url);
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
    console.warn('[SCOUT_PARSE] parser_failed_on_html — htmlLength=' + htmlLength + ' but 0 listings extracted site=MARKTPLAATS');
  }

  return {
    site: 'MARKTPLAATS',
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
      parserUsed: 'study-core/parsers/marktplaats',
      parsedSampleCount,
      extractionMethod,
    },
  };
}

// ─── Ingestion support ────────────────────────────────────────────────────────

/**
 * Marktplaats taxonomy fields are opaque internal IDs — the user fills the
 * form. Only hash-fragment numeric filters are readable and prefilled.
 */
/** slug → canonical (e.g. 'volkswagen' → 'VOLKSWAGEN', 'c-hr' → 'C-HR'). */
function reverseLookup(map: Record<string, string>, slug: string): string {
  const t = slug.trim().toLowerCase();
  for (const [canonical, mapped] of Object.entries(map)) {
    if (mapped.toLowerCase() === t) return canonical;
  }
  return slug.trim();
}

/**
 * Brand/model sit in the PATH — /{brandSlug}/f/{modelSlug[+facet…]}/{ids}/ —
 * so a pasted native Marktplaats URL must pre-fill them from there (query/hash
 * only carry year+mileage). Mirrors extractCandidateSegments' path grammar.
 */
function pathBrandModel(segs: string[]): { brand?: string; model?: string } {
  const fIdx = segs.indexOf('f');
  if (fIdx <= 0) return {};
  const out: { brand?: string; model?: string } = {};
  const brandSlug = segs[fIdx - 1];
  if (brandSlug && brandSlug !== 'l' && brandSlug !== 'auto-s') out.brand = brandSlug;
  const modelSlug = (segs[fIdx + 1] ?? '').split('+').filter(Boolean)[0];
  if (modelSlug) out.model = modelSlug;
  return out;
}

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const d = decomposeUrl(url);
  if (!d) return {};
  const h = d.hashParams;
  const out: Partial<SearchCriteria> = {};
  const path = pathBrandModel(d.pathSegments);
  if (path.brand) out.brand = reverseLookup(BRAND_MAP, path.brand);
  if (path.model) out.model = reverseLookup(MODEL_MAP, path.model);
  // The free text (#q:) feeds the site's "Variant" box — when the model is
  // already pinned by a path facet, that text is a FINITION, not a model.
  if (h['q'] && path.model) out.trim = h['q'].replace(/\+/g, ' ').trim();
  if (h['constructionYearFrom'] && /^\d{4}$/.test(h['constructionYearFrom'])) out.yearFrom = h['constructionYearFrom'];
  if (h['constructionYearTo'] && /^\d{4}$/.test(h['constructionYearTo'])) out.yearTo = h['constructionYearTo'];
  if (h['mileageTo'] && /^\d+$/.test(h['mileageTo'])) out.mileage = h['mileageTo'];
  return out;
}

/**
 * Path grammar observed on live marktplaats.nl category searches:
 *   /{brandSlug}/f/{slugToken[+slugToken...]}/{id[+id...]}/
 * The IDs after the slug segment align positionally with the slug tokens
 * (first token = model, following tokens = facets such as a fuel GROUP).
 * All of this is hypothesis only — the discovery scrape decides.
 */
function extractCandidateSegments(url: string): CandidateSegment[] {
  const d = decomposeUrl(url);
  if (!d) return [];
  const out: CandidateSegment[] = [];

  const segs = d.pathSegments;
  const fIdx = segs.indexOf('f');
  if (fIdx > 0 && segs.length > fIdx + 1) {
    const brandSlug = segs[fIdx - 1];
    if (brandSlug && brandSlug !== 'l' && brandSlug !== 'auto-s') {
      out.push({ raw: brandSlug, location: 'path', paramName: '_path:brand_slug', guessField: 'brand' });
    }

    const slugTokens = segs[fIdx + 1].split('+').filter(Boolean);
    const idTokens = (segs[fIdx + 2] ?? '').split('+').filter((t) => /^\d+$/.test(t));

    slugTokens.forEach((tok, i) => {
      out.push({
        raw: idTokens[i] ?? tok,
        location: 'path',
        paramName: i === 0 ? '_path:model_id' : `_path:facet_id_${i}`,
        guessField: i === 0 ? 'model' : 'fuel',
        slugText: tok,
      });
    });
  }

  // Hash-based URLs (#q:...) — readable, same treatment as named params
  const h = d.hashParams;
  if (h['q']) out.push({ raw: h['q'], location: 'hash', paramName: 'q' });
  if (h['constructionYearFrom']) out.push({ raw: h['constructionYearFrom'], location: 'hash', paramName: 'constructionYearFrom', guessField: 'year' });
  if (h['constructionYearTo']) out.push({ raw: h['constructionYearTo'], location: 'hash', paramName: 'constructionYearTo', guessField: 'year' });
  if (h['mileageTo']) out.push({ raw: h['mileageTo'], location: 'hash', paramName: 'mileageTo', guessField: 'mileage' });

  return out;
}

function inferFuel(title: string, description: string): string {
  return inferFuelFromTitle(title, description);
}

function getFetchProfile(attempt: number): ZyteProfileOverrides {
  // Ported from study-core/scraping.ts:getZyteRequestProfile — Marktplaats was
  // the only site with escalation; attempt maps 1:1 to the old profileLevel.
  if (attempt >= 3) {
    return {
      geolocation: 'NL',
      javascript: true,
      actions: [{ action: 'waitForTimeout', timeout: 2.0 }],
    };
  }
  if (attempt >= 2) {
    return { geolocation: 'NL', javascript: true };
  }
  return {};
}

export const marktplaatsAdapter: SiteAdapter = {
  key: 'MARKTPLAATS',
  displayName: 'Marktplaats',
  country: 'Netherlands',
  countryCode: 'NL',
  domain: 'marktplaats.nl',
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
