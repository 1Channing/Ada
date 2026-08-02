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
export type Currency = 'EUR' | 'DKK' | 'SEK' | 'HUF' | 'UNKNOWN';

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
  // Secondary structured attributes — OPTIONAL and additive. The study
  // pipeline never reads them; they exist so the Ingestion page can confirm
  // gearbox / power / doors / seats / color / vehicle-type from real listing
  // data. Populated where a parser can extract them (Leboncoin today), null
  // otherwise. Enum fields (gearbox/color/vehicleType) hold the human LABEL,
  // not the site's opaque URL code.
  gearbox?: string | null;
  powerDin?: number | null;
  doors?: number | null;
  seats?: number | null;
  color?: string | null;
  vehicleType?: string | null;
  // Structured brand/fuel labels (seller-declared), when the parser can read
  // them. More reliable than the title, which often omits the brand
  // ("Megane E-Tech" with no "Renault") or the energy. Human label, not code.
  brand?: string | null;
  fuel?: string | null;
  // Data-quality attributes: professional vs private seller (VAT implications)
  // and the price nature — Bilbasen serves "WithoutTax"/engros prices that
  // must never enter a median. Raw site labels, interpreted downstream.
  sellerType?: string | null;
  /** Modèle STRUCTURÉ déclaré par le site (Subito features /car, Gaspedaal
   *  JSON-LD `model`) — permet le post-filtre modèle quand l'URL du site n'a
   *  pas pu le poser (adaptateurs v1). Null quand le site ne le donne pas. */
  model?: string | null;
  priceType?: string | null;
}

/**
 * Study criteria for filtering and matching
 */
export interface StudyCriteria {
  brand: string;
  model: string;
  year: number;
  max_mileage: number;
  trim_text?: string | null;
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
  scrapeMode: 'fast' | 'full' | 'detailed';
  scrapingConfig?: ScrapingConfig;
}
