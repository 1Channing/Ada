import { parseListings } from '../../study-core/parsers/leboncoin';
import { normalizeForMatch } from '../normalizer';
import type { LinkGenParams } from '../types';
import type { SiteValidationResult, SampleListing, AppliedFilters } from './types';

export function validateLeboncoin(
  html: string,
  url: string,
  params: LinkGenParams,
  listingCount: number
): SiteValidationResult {
  const htmlLength = html.length;

  // Use production study-core parser (read-only — no modification of study-core logic)
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

  const { score, appliedFilters, issues } = scoreSample(sampleListings, params, url, htmlLength);
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

// ─── shared helpers ───────────────────────────────────────────────────────────

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
  params: LinkGenParams,
  url: string,
  _htmlLength: number
): { score: number; appliedFilters: AppliedFilters; issues: import('../types').LinkGenIssue[] } {
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

  const issues: import('../types').LinkGenIssue[] = [];
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
