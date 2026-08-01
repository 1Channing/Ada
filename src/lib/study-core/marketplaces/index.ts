/**
 * Single entry point for the marketplace site-adapter registry.
 * Adding a new marketplace: create a new adapter file in this folder,
 * import it and register it below — no other file needs to change.
 */

import { siteRegistry } from './registry';
import { leboncoinAdapter } from './leboncoin';
import { marktplaatsAdapter } from './marktplaats';
import { bilbasenAdapter } from './bilbasen';
import { mobiledeAdapter } from './mobilede';
import { autoscout24Adapters } from './autoscout24';
import { subitoAdapter } from './subito';
import { gaspedaalAdapter } from './gaspedaal';

siteRegistry.register(leboncoinAdapter);
siteRegistry.register(marktplaatsAdapter);
siteRegistry.register(bilbasenAdapter);
siteRegistry.register(mobiledeAdapter);
// Extension du réseau (01/08) : Subito (IT) + Gaspedaal (NL), v1 sur preuve.
siteRegistry.register(subitoAdapter);
siteRegistry.register(gaspedaalAdapter);
// AutoScout24: one instance per country (FR/DE/NL/IT/ES/BE), same taxonomy.
for (const adapter of autoscout24Adapters) siteRegistry.register(adapter);

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
export { decomposeUrl, type DetectedParams } from './urlDecompose';
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
  CandidateSegment,
} from './types';
