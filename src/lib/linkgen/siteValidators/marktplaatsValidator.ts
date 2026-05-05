import { parseMarktplaasSample } from '../../scraperClient';
import { normalizeForMatch } from '../normalizer';
import type { LinkGenParams } from '../types';
import type { SiteValidationResult, SampleListing, AppliedFilters } from './types';

export function validateMarktplaats(
  html: string,
  url: string,
  params: LinkGenParams,
  listingCount: number
): SiteValidationResult {
  const raw = parseMarktplaasSample(html, url, 10);

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

  return {
    site: 'MARKTPLAATS',
    url,
    listingCount,
    sampleListings,
    appliedFilters,
    score,
    status,
    issues,
    evidence: { structuredFieldsAvailable, fieldsUsed, missingFields },
  };
}

function inferFuelFromTitle(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  if (text.includes('diesel')) return 'diesel';
  if (text.includes('electr')) return 'electric';
  if (text.includes('hybrid')) return 'hybrid';
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
  params: LinkGenParams,
  url: string
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

  // Marktplaats uses hash params for sort — check both
  const sortApplied = url.includes('sort') || url.includes('sortBy') || url.includes('sortOrder') || url.includes('order=') || url.includes('|so:');

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
