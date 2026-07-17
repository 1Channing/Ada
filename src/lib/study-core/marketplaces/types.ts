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
  // Secondary filters (Ingestion). Enum fields hold the human label the user
  // declares (e.g. 'Automatique'); the site's opaque URL code is learned via
  // the discovery scrape, never hardcoded.
  gearbox?: string;
  powerFrom?: string | number;
  powerTo?: string | number;
  doors?: string | number;
  seats?: string | number;
  color?: string;
  vehicleType?: string;
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
  /**
   * Use Zyte's raw-HTML unblocker (`httpResponseBody`) instead of the headless
   * browser (`browserHtml`). Stronger against Cloudflare and cheaper; suitable
   * for server-rendered sites whose data is already in the initial HTML
   * (AutoScout SSRs listings into __NEXT_DATA__). `actions` are ignored in
   * this mode (no browser).
   */
  httpResponseBody?: boolean;
}

/**
 * A raw URL fragment that MIGHT encode a business field — either a readable
 * named param (Leboncoin `u_car_brand=TOYOTA`) or an opaque taxonomy ID
 * (Marktplaats path `1232`). `guessField` is only ever a hypothesis; the
 * discovery scrape decides whether it gets retained.
 */
export interface CandidateSegment {
  /** The raw value as it appears in the URL (e.g. 'TOYOTA', '1232'). */
  raw: string;
  location: 'path' | 'query' | 'hash';
  /** Query/hash param name, or a '_path:...' pseudo-name for path segments. */
  paramName: string;
  guessField?:
    | 'brand' | 'model' | 'fuel' | 'trim' | 'year' | 'mileage'
    | 'gearbox' | 'power' | 'doors' | 'seats' | 'color' | 'vehicleType';
  /** For opaque IDs aligned with a slug (Marktplaats), the slug text they sit next to. */
  slugText?: string;
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
  /** ISO-3166 alpha-2, matches the country codes stored in linkgen_mapping_memory / studies_v2. */
  readonly countryCode: string;
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

  // ─── Ingestion (URL learning from human-pasted searches) ──────────────────

  /**
   * Best-effort prefill of the ingestion form from a pasted URL.
   * Sites with readable params (Leboncoin, Bilbasen) fill most fields;
   * opaque-ID sites (Marktplaats) return only what is readable (hash
   * year/mileage filters) and leave taxonomy fields to the user.
   */
  prefillCriteriaFromUrl?(url: string): Partial<SearchCriteria>;

  /**
   * Decompose a pasted URL into candidate field↔segment hypotheses.
   * Never a certainty — the discovery scrape confirms or discards each one.
   */
  extractCandidateSegments?(url: string): CandidateSegment[];

  /**
   * Language-aware fuel detection from listing text (titles are in the
   * site's local language). Returns a canonical token
   * ('petrol'|'diesel'|'hybrid'|'electric'|'lpg') or '' when undetectable.
   */
  inferFuel?(title: string, description: string): string;
}

export interface SiteRegistry {
  register(adapter: SiteAdapter): void;
  get(key: SiteKey): SiteAdapter;
  has(key: SiteKey): boolean;
  all(): SiteAdapter[];
  byDomain(hostname: string): SiteAdapter | undefined;
}
