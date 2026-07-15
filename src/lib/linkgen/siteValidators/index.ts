import { getSiteAdapter } from '../../study-core/marketplaces';
import type { SiteKey, LinkGenParams } from '../types';
import type { SiteValidationResult } from './types';

export function validateSite(
  site: SiteKey,
  html: string,
  url: string,
  params: LinkGenParams,
  listingCount: number
): SiteValidationResult {
  return getSiteAdapter(site).scoreSearchResults(html, url, params, listingCount);
}

export type { SiteValidationResult, SampleListing, AppliedFilters } from './types';
