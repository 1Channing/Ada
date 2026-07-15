/**
 * Single entry point for the marketplace site-adapter registry.
 * Adding a new marketplace: create a new adapter file in this folder,
 * import it and register it below — no other file needs to change.
 */

import { siteRegistry } from './registry';
import { leboncoinAdapter } from './leboncoin';
import { marktplaatsAdapter } from './marktplaats';
import { bilbasenAdapter } from './bilbasen';

siteRegistry.register(leboncoinAdapter);
siteRegistry.register(marktplaatsAdapter);
siteRegistry.register(bilbasenAdapter);

export function getSiteAdapter(key: string) {
  return siteRegistry.get(key);
}

export function hasSiteAdapter(key: string): boolean {
  return siteRegistry.has(key);
}

export function allSiteAdapters() {
  return siteRegistry.all();
}

export function findSiteAdapterByDomain(hostname: string) {
  return siteRegistry.byDomain(hostname);
}

export { siteRegistry, defaultBuildPaginatedUrl, defaultDetectBlocked } from './registry';
export type {
  SiteAdapter,
  SiteKey,
  SiteRegistry,
  SearchCriteria,
  BuildUrlResult,
  ZyteProfileOverrides,
  ValidationStatus,
  LinkGenIssue,
  AppliedFilters,
  SampleListing,
  SiteValidationResult,
} from './types';
