/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SITE ADAPTER CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One implementation per marketplace (Leboncoin, Marktplaats, Bilbasen, ...).
 * Adding a marketplace means adding a new file under study-core/marketplaces/
 * that implements SiteAdapter, plus one registration call in index.ts —
 * never touching shared dispatch logic (generator.ts, siteValidators,
 * correctionStrategies, or this file).
 *
 * This module has no dependency on linkgen/ or Supabase — it must stay
 * importable identically from the browser, the Node worker and Deno Edge
 * Functions, matching the rest of study-core.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ScrapedListing } from '../types';
import type { DetailPageData } from '../detailParsers';

/** A site key is validated at runtime against the registry, not at compile time. */
export type SiteKey = string;

export type ValidationStatus = 'not_checked' | 'valid' | 'partial' | 'invalid';

/** Raw, unmapped vehicle/search criteria — as typed by the user. */
export interface SearchCriteria {
  brand: string;
  model: string;
  year?: string | number;
  yearFrom?: string | number;
  yearTo?: string | number;
  mileage?: string | number;
  fuel?: string;
  trim?: string;
  minPower?: string | number;
}

export interface LinkGenIssue {
  type:
    | 'brand_missing'
    | 'model_missing'
    | 'fuel_mismatch'
    | 'low_listing_count'
    | 'fetch_failed'
    | 'no_zyte_key'
    | 'parse_error'
    | 'wrong_domain'
    | 'fuel_mapping_suspect'
    | 'model_not_applied'
    | 'trim_not_applied'
    | 'year_filter_not_applied'
    | 'mileage_filter_not_applied'
    | 'sort_not_applied'
    | 'no_listings'
    | 'parser_failed_on_html'
    | 'trim_removed_for_broader_market';
}

export interface AppliedFilters {
  brand: boolean;
  model: boolean;
  year: boolean;
  mileage: boolean;
  fuel: boolean;
  trim: boolean;
  sort: boolean;
}

export interface SampleListing {
  title: string;
  price: number;
  year: number | null;
  mileage: number | null;
  fuel: string;
  url: string;
}

export interface SiteValidationResult {
  site: SiteKey;
  url: string;
  listingCount: number;
  sampleListings: SampleListing[];
  appliedFilters: AppliedFilters;
  score: number;
  status: ValidationStatus;
  issues: LinkGenIssue[];
  evidence: {
    structuredFieldsAvailable: boolean;
    fieldsUsed: string[];
    missingFields: string[];
  };
  parserDetails?: {
    htmlLength: number;
    parserUsed: string;
    parsedSampleCount: number;
    extractionMethod: string;
  };
}

export interface BuildUrlResult {
  url: string;
  /** Human-readable warnings, e.g. an unsupported param that was dropped. */
  warnings: string[];
}

export interface ZyteProfileOverrides {
  geolocation?: string;
  javascript?: boolean;
  actions?: Array<{ action: string; timeout: number }>;
}

/**
 * One implementation per marketplace. Methods are pure (no I/O) — fetching
 * HTML is the caller's job, adapters only decide URLs, taxonomy, scoring and
 * correction strategy for their site.
 *
 * NOTE on params: buildSearchUrl and generateCorrectionHypotheses receive
 * RAW, unmapped criteria and map internally (mirrors the pre-refactor
 * generateSearchUrl, which mapped brand/model/fuel then templated).
 * scoreSearchResults also receives raw criteria — it matches user intent
 * against listing text, not against the site-specific mapped URL parameter
 * values, so mapping would be the wrong comparison there.
 */
export interface SiteAdapter {
  readonly key: SiteKey;
  readonly displayName: string;
  readonly country: string;
  readonly domain: string;
  /** The site's default search URL template, exposed for memory-based URL reconstruction. */
  readonly urlTemplate: string;

  mapBrand(raw: string): string;
  mapModel(raw: string): string;
  mapFuel(raw: string): string;
  supportsParam(param: 'minPower'): boolean;

  buildSearchUrl(params: SearchCriteria): BuildUrlResult;
  buildPaginatedUrl(baseUrl: string, pageNumber: number): string;

  parseSearchResults(html: string, url: string): ScrapedListing[];
  /** Deferred: no adapter implements this yet (see ADA architecture discussion, 2026-07-15). */
  parseDetailPage?(html: string, listingUrl: string): DetailPageData;

  scoreSearchResults(
    html: string,
    url: string,
    params: SearchCriteria,
    listingCount: number
  ): SiteValidationResult;

  generateCorrectionHypotheses(
    params: SearchCriteria,
    issueTypes: Set<string>
  ): Array<{ url: string; reason: string }>;

  /** Pure config for the caller's Zyte request — no fetch happens here. */
  getFetchProfile(attempt: number): ZyteProfileOverrides;
  /** Optional per-site override of the shared keyword-based block detector. */
  detectBlocked?(html: string, hasListings: boolean): boolean;
}

export interface SiteRegistry {
  register(adapter: SiteAdapter): void;
  get(key: SiteKey): SiteAdapter;
  has(key: SiteKey): boolean;
  all(): SiteAdapter[];
  byDomain(hostname: string): SiteAdapter | undefined;
}
