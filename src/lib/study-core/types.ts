/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STUDY CORE - SHARED TYPE DEFINITIONS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module defines all shared types used across the unified study execution
 * pipeline. These types are used by both INSTANT and SCHEDULED study runs.
 *
 * **CRITICAL:**
 * - These types are the contract between all execution environments
 * - Changes here affect browser, Node.js, and Deno environments
 * - Keep types simple and serializable (no DOM/environment-specific types)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Supported currency types
 */
export type Currency = 'EUR' | 'DKK' | 'UNKNOWN';

/**
 * A single scraped vehicle listing from any marketplace
 */
export interface ScrapedListing {
  title: string;
  price: number;
  currency: Currency;
  mileage: number | null;
  year: number | null;
  trim: string | null;
  listing_url: string;
  description: string;
  price_type: 'one-off' | 'per-month' | 'unknown';
}

/**
 * Study criteria for filtering and matching
 */
export interface StudyCriteria {
  brand: string;
  model: string;
  year: number;
  max_mileage: number;
}

/**
 * Market statistics computed from filtered listings
 */
export interface MarketStats {
  median_price: number;
  average_price: number;
  min_price: number;
  max_price: number;
  count: number;
  percentile_25: number;
  percentile_75: number;
}

/**
 * Result from scraping a marketplace URL
 */
export interface SearchResult {
  listings: ScrapedListing[];
  blockedByProvider?: boolean;
  blockReason?: string;
  error?: 'SCRAPER_FAILED';
  errorReason?: string;
  diagnostics?: any;
  zyteStatusCode?: number | null;
  retryCount?: number;
  extractionMethod?: string | null;
}

/**
 * Configuration for scraping operations
 */
export interface ScrapingConfig {
  apiKey: string;
  endpoint: string;
  maxRetries: number;
  retryDelays: number[];
}

/**
 * Opportunity detection result
 */
export interface OpportunityResult {
  hasOpportunity: boolean;
  targetMedianPrice: number;
  bestSourcePrice: number;
  priceDifference: number;
  interestingListings: ScrapedListing[];
}

/**
 * Complete study execution result
 */
export interface StudyExecutionResult {
  status: 'NULL' | 'OPPORTUNITIES' | 'TARGET_BLOCKED';
  targetStats: MarketStats;
  targetMedianPrice: number;
  bestSourcePrice: number | null;
  priceDifference: number | null;
  interestingListings: ScrapedListing[];
  filteredTargetCount: number;
  filteredSourceCount: number;
  rawTargetCount: number;
  rawSourceCount: number;
}

/**
 * Parameters for study execution
 */
export interface StudyExecutionParams {
  study: StudyCriteria;
  targetUrl: string;
  sourceUrl: string;
  threshold: number;
  scrapeMode: 'fast' | 'full';
  scrapingConfig?: ScrapingConfig;
}
