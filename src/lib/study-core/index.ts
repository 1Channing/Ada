/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STUDY CORE - UNIFIED EXECUTION PIPELINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH FOR STUDY EXECUTION.
 *
 * This module provides a unified API for executing market studies that produces
 * IDENTICAL RESULTS regardless of execution environment (browser, Node.js, Deno).
 *
 * **GUARANTEED PARITY:**
 * - Same filtering logic (price floor, leasing, damage, brand/model)
 * - Same median calculation (top 6 cheapest, average of middle two)
 * - Same opportunity detection (threshold comparison)
 * - Same listing normalization
 *
 * **EXECUTION MODES:**
 * - INSTANT: User-triggered from UI (uses src/lib/scraperClient.ts for scraping)
 * - SCHEDULED: Background jobs (uses worker/scraper.js for scraping)
 *
 * Both modes MUST call functions from this module for business logic.
 *
 * **USAGE:**
 * ```typescript
 * import { executeStudyAnalysis, filterListingsByStudy } from './study-core';
 *
 * // Get listings from scraper (environment-specific)
 * const targetListings = await scraper.searchListings(targetUrl);
 * const sourceListings = await scraper.searchListings(sourceUrl);
 *
 * // Execute study (unified logic)
 * const result = executeStudyAnalysis(
 *   targetListings.listings,
 *   sourceListings.listings,
 *   study,
 *   threshold
 * );
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Export all types
export type {
  Currency,
  ScrapedListing,
  StudyCriteria,
  MarketStats,
  SearchResult,
  ScrapingConfig,
  OpportunityResult,
  StudyExecutionResult,
  StudyExecutionParams,
} from './types';

// Export business logic functions
export {
  toEur,
  matchesBrandModel,
  shouldFilterListing,
  filterListingsByStudy,
  computeTargetMarketStats,
  detectOpportunity,
  executeStudyAnalysis,
  hashStudyResult,
} from './business-logic';

// Export scraping helpers
export {
  DEFAULT_SCRAPING_CONFIG,
  BLOCKED_KEYWORDS,
  detectBlockedContent,
  getZyteRequestProfile,
  normalizeMarktplaatsListing,
  findListingLikeObjects,
  validateSearchResult,
  hashListingPool,
  type ScraperImplementation,
  // Pure parser functions
  coreParseSearchPage,
  selectParserByHostname,
  buildPaginatedUrl,
  detectTotalPages,
  normalizeListingUrl,
  type MarketplaceParser,
} from './scraping';

// Export unified scraping implementation
export {
  coreScrapeSearch,
  DEFAULT_SCRAPER_CONFIG as DEFAULT_CORE_SCRAPER_CONFIG,
  type CoreScraperConfig,
} from './scrapingImpl';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VERSION AND METADATA
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Study core version for tracking synchronization
 */
export const STUDY_CORE_VERSION = '1.0.0';

/**
 * Last synchronization date
 */
export const LAST_SYNC_DATE = '2026-01-07';

/**
 * Feature flags for gradual rollout
 */
export interface FeatureFlags {
  /**
   * Use shared core for study execution
   * Set to false to use legacy implementations
   */
  USE_SHARED_CORE: boolean;

  /**
   * Enable parity validation logging
   */
  ENABLE_PARITY_VALIDATION: boolean;

  /**
   * Enable detailed debug logging
   */
  ENABLE_DEBUG_LOGGING: boolean;
}

/**
 * Default feature flags (safe defaults)
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  USE_SHARED_CORE: false, // Default OFF for safety
  ENABLE_PARITY_VALIDATION: true,
  ENABLE_DEBUG_LOGGING: false,
};

/**
 * Get feature flags from environment
 *
 * Supports both browser (import.meta.env) and Node.js (process.env)
 */
export function getFeatureFlags(): FeatureFlags {
  // Try browser environment first
  const env =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env
      : typeof process !== 'undefined' && process.env
        ? process.env
        : {};

  return {
    USE_SHARED_CORE:
      env.VITE_USE_SHARED_CORE === 'true' || env.USE_SHARED_CORE === 'true',
    ENABLE_PARITY_VALIDATION:
      env.VITE_ENABLE_PARITY_VALIDATION !== 'false' &&
      env.ENABLE_PARITY_VALIDATION !== 'false',
    ENABLE_DEBUG_LOGGING:
      env.VITE_ENABLE_DEBUG_LOGGING === 'true' || env.ENABLE_DEBUG_LOGGING === 'true',
  };
}

/**
 * Check if shared core is enabled
 */
export function isSharedCoreEnabled(): boolean {
  const flags = getFeatureFlags();
  return flags.USE_SHARED_CORE;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PARITY VALIDATION
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { StudyExecutionResult } from './types';
import { hashStudyResult } from './business-logic';

/**
 * Compare two study results for parity
 *
 * @param result1 - First result (e.g., instant)
 * @param result2 - Second result (e.g., scheduled)
 * @param tolerance - Price difference tolerance in EUR (default 2)
 * @returns Parity check result
 */
export function checkParity(
  result1: StudyExecutionResult,
  result2: StudyExecutionResult,
  tolerance = 2
): {
  matches: boolean;
  differences: string[];
} {
  const differences: string[] = [];

  // Status must match exactly
  if (result1.status !== result2.status) {
    differences.push(
      `Status mismatch: ${result1.status} vs ${result2.status}`
    );
  }

  // Median price must match within tolerance
  const medianDiff = Math.abs(result1.targetMedianPrice - result2.targetMedianPrice);
  if (medianDiff > tolerance) {
    differences.push(
      `Median price differs by ${medianDiff.toFixed(0)}€ (tolerance: ${tolerance}€): ${result1.targetMedianPrice.toFixed(0)} vs ${result2.targetMedianPrice.toFixed(0)}`
    );
  }

  // Best source price must match within tolerance
  if (result1.bestSourcePrice !== null && result2.bestSourcePrice !== null) {
    const sourceDiff = Math.abs(result1.bestSourcePrice - result2.bestSourcePrice);
    if (sourceDiff > tolerance) {
      differences.push(
        `Best source price differs by ${sourceDiff.toFixed(0)}€: ${result1.bestSourcePrice.toFixed(0)} vs ${result2.bestSourcePrice.toFixed(0)}`
      );
    }
  }

  // Filtered counts should match (but may vary slightly due to timing)
  if (result1.filteredTargetCount !== result2.filteredTargetCount) {
    differences.push(
      `Filtered target count: ${result1.filteredTargetCount} vs ${result2.filteredTargetCount}`
    );
  }

  if (result1.filteredSourceCount !== result2.filteredSourceCount) {
    differences.push(
      `Filtered source count: ${result1.filteredSourceCount} vs ${result2.filteredSourceCount}`
    );
  }

  return {
    matches: differences.length === 0,
    differences,
  };
}

/**
 * Log parity check results
 *
 * @param studyId - Study identifier
 * @param parityResult - Parity check result
 * @param mode1 - First mode name (e.g., "INSTANT")
 * @param mode2 - Second mode name (e.g., "SCHEDULED")
 */
export function logParityResult(
  studyId: string,
  parityResult: { matches: boolean; differences: string[] },
  mode1 = 'INSTANT',
  mode2 = 'SCHEDULED'
): void {
  const flags = getFeatureFlags();
  if (!flags.ENABLE_PARITY_VALIDATION && !flags.ENABLE_DEBUG_LOGGING) {
    return;
  }

  if (parityResult.matches) {
    console.log(
      `[PARITY] ✅ ${studyId}: ${mode1} and ${mode2} results match`
    );
  } else {
    console.warn(
      `[PARITY] ❌ ${studyId}: ${mode1} and ${mode2} results differ:`
    );
    parityResult.differences.forEach(diff => {
      console.warn(`[PARITY]    - ${diff}`);
    });
  }
}
