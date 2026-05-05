import { validateLeboncoin } from './leboncoinValidator';
import { validateMarktplaats } from './marktplaatsValidator';
import { validateBilbasen } from './bilbasenValidator';
import type { SiteKey, LinkGenParams } from '../types';
import type { SiteValidationResult } from './types';

export function validateSite(
  site: SiteKey,
  html: string,
  url: string,
  params: LinkGenParams,
  listingCount: number
): SiteValidationResult {
  if (site === 'LEBONCOIN') return validateLeboncoin(html, url, params, listingCount);
  if (site === 'MARKTPLAATS') return validateMarktplaats(html, url, params, listingCount);
  return validateBilbasen(html, url, params, listingCount);
}

export type { SiteValidationResult, SampleListing, AppliedFilters } from './types';
