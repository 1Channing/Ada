/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STUDY CORE - BUSINESS LOGIC (SINGLE SOURCE OF TRUTH)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THIS MODULE CONTAINS ALL BUSINESS LOGIC FOR MARKET STUDY EXECUTION.
 *
 * **CRITICAL:**
 * - ALL pricing calculations happen here
 * - ALL filtering rules are defined here
 * - ALL opportunity detection uses this logic
 * - Both INSTANT and SCHEDULED searches use this code
 *
 * **DO NOT:**
 * - Duplicate this logic elsewhere
 * - Create "similar" or "equivalent" implementations
 * - Add business rules outside this module
 *
 * **WHY THIS EXISTS:**
 * Previously, instant searches (frontend) and scheduled searches (backend)
 * had separate implementations that drifted apart. This module ensures
 * DETERMINISTIC results regardless of execution environment.
 *
 * **EXTRACTED FROM:**
 * src/lib/study-engine.ts (which now re-exports from here)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {
  Currency,
  ScrapedListing,
  StudyCriteria,
  MarketStats,
  OpportunityResult,
  StudyExecutionResult,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CURRENCY CONVERSION
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FX_RATES: Record<Currency, number> = {
  EUR: 1,
  DKK: 0.13, // Updated conversion rate
  UNKNOWN: 1,
};

/**
 * Convert any currency to EUR using fixed exchange rates.
 * This ensures consistent pricing across all markets.
 *
 * @param price - Price in original currency
 * @param currency - Currency code
 * @returns Price in EUR
 */
export function toEur(price: number, currency: Currency): number {
  return price * (FX_RATES[currency] ?? 1);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FILTERING LOGIC - DETECT INVALID LISTINGS
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Detect if price appears to be monthly (leasing/rental).
 * Keywords are market-specific (French, Dutch, Danish, English).
 *
 * @param text - Lowercase text to check
 * @returns true if monthly price detected
 */
function isPriceMonthly(text: string): boolean {
  const monthlyKeywords = [
    '/mois',
    '€/mois',
    '€ / mois',
    'per month',
    '€/month',
    'par mois',
    'p/m',
    '/maand',
    '€/mnd',
    'per maand',
    '/month',
    'lease',
    'privé lease',
    'private lease',
    'loa',
    'lld',
    'operational lease',
    'leasing',
    'maandelijkse betaling',
  ];
  return monthlyKeywords.some(kw => text.includes(kw));
}

/**
 * Detect if vehicle is damaged, salvage, or for parts.
 * Keywords are market-specific (French, Dutch, Danish, English).
 *
 * @param text - Text to check (case-insensitive)
 * @returns true if damage indicators found
 */
function isDamagedVehicle(text: string): boolean {
  const textLower = text.toLowerCase();

  const damageKeywords = [
    'accidenté',
    'véhicule accidenté',
    'épave',
    'choc',
    'réparé suite à choc',
    'châssis tordu',
    'damaged',
    'accident damage',
    'salvage',
    'cat c',
    'cat d',
    'cat s',
    'cat n',
    'written off',
    'write off',
    'schade',
    'ongeval',
    'schadeauto',
    'total loss',
    'skadet',
    'skade',
    'kollisionsskade',
    'ulykke',
    'for parts',
    'pour pièces',
    'non roulant',
    'as is',
    'hs',
    'hors service',
    'parts only',
    'dépanneuse',
    'not running',
    'moteur hs',
  ];

  return damageKeywords.some(keyword => textLower.includes(keyword));
}

/**
 * Check if listing title matches expected brand and model.
 * Uses token-based matching for flexibility with naming variations.
 *
 * @param title - Listing title
 * @param brand - Expected brand name
 * @param model - Expected model name
 * @returns Match result with reason if failed
 */
export function matchesBrandModel(
  title: string,
  brand: string,
  model: string
): { matches: boolean; reason: string } {
  const titleLower = title.toLowerCase();
  const brandLower = brand.toLowerCase();

  if (!titleLower.includes(brandLower)) {
    return {
      matches: false,
      reason: `Brand "${brand}" not found in title`,
    };
  }

  const modelTokens = model
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);

  const missingTokens = modelTokens.filter(token => !titleLower.includes(token));

  if (missingTokens.length > 0) {
    return {
      matches: false,
      reason: `Model tokens missing: ${missingTokens.join(', ')}`,
    };
  }

  return { matches: true, reason: '' };
}

/**
 * FIRST PASS FILTER: Check if listing should be filtered out due to:
 * - Price too low (≤2000€) - likely leasing or scam
 * - Monthly/leasing pricing
 * - Damaged vehicle
 *
 * @param listing - Listing to check
 * @returns true if listing should be filtered out
 */
export function shouldFilterListing(listing: ScrapedListing): boolean {
  const text = `${listing.title} ${listing.description}`;
  const textLower = text.toLowerCase();

  // Filter 1: Price floor (prevents leasing offers from polluting dataset)
  const priceEur = toEur(listing.price, listing.currency);
  if (priceEur <= 2000) {
    return true;
  }

  // Filter 2: Monthly pricing (leasing/rental)
  const isMonthly = isPriceMonthly(textLower);
  const isLowMonthlyPrice =
    listing.price_type === 'per-month' ||
    (listing.price >= 200 && listing.price <= 500 && isMonthly);

  if (isLowMonthlyPrice || isMonthly) {
    return true;
  }

  // Filter 3: Damaged vehicles
  if (isDamagedVehicle(text)) {
    return true;
  }

  return false;
}

/**
 * SECOND PASS FILTER: Apply study-specific criteria:
 * - Brand/model match
 * - Year filter (must be >= study year, not more than 1 year older)
 * - Mileage filter (if specified)
 *
 * @param listings - Listings to filter
 * @param study - Study criteria
 * @returns Filtered listings matching all criteria
 */
export function filterListingsByStudy(
  listings: ScrapedListing[],
  study: StudyCriteria
): ScrapedListing[] {
  return listings.filter(listing => {
    // Apply first-pass filters
    if (shouldFilterListing(listing)) {
      return false;
    }

    // Filter by year (must be within 1 year of target year)
    if (listing.year && listing.year < study.year) {
      return false;
    }

    // Filter by mileage (if study specifies a max)
    if (study.max_mileage > 0 && listing.mileage && listing.mileage > study.max_mileage) {
      return false;
    }

    // Filter by brand/model match
    const matchResult = matchesBrandModel(listing.title, study.brand, study.model);
    if (!matchResult.matches) {
      return false;
    }

    return true;
  });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRICING AND STATISTICS
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Compute market statistics from filtered listings.
 *
 * **CRITICAL BUSINESS RULE:**
 * - Uses the 6 CHEAPEST listings only (MAX_TARGET_LISTINGS = 6)
 * - Median calculation: average of two middle values for even counts
 * - All prices converted to EUR before calculation
 *
 * @param listings - Filtered listings (already passed all filters)
 * @returns Market statistics including median, average, min, max, percentiles
 */
export function computeTargetMarketStats(listings: ScrapedListing[]): MarketStats {
  if (listings.length === 0) {
    return {
      median_price: 0,
      average_price: 0,
      min_price: 0,
      max_price: 0,
      count: 0,
      percentile_25: 0,
      percentile_75: 0,
    };
  }

  // BUSINESS RULE: Use only the 6 cheapest listings
  const MAX_TARGET_LISTINGS = 6;

  // Sort by price (EUR) ascending
  const sortedListings = listings
    .map(l => ({ ...l, priceEur: toEur(l.price, l.currency) }))
    .sort((a, b) => a.priceEur - b.priceEur);

  // Take top 6 cheapest
  const limitedListings = sortedListings.slice(0, MAX_TARGET_LISTINGS);
  const pricesInEur = limitedListings.map(l => l.priceEur);
  const sum = pricesInEur.reduce((acc, price) => acc + price, 0);

  // Percentile calculation helper
  const getPercentile = (arr: number[], p: number) => {
    const index = Math.ceil((arr.length * p) / 100) - 1;
    return arr[Math.max(0, index)];
  };

  // MEDIAN CALCULATION: Average of two middle values for even counts
  const medianPrice =
    pricesInEur.length % 2 === 0
      ? (pricesInEur[pricesInEur.length / 2 - 1] + pricesInEur[pricesInEur.length / 2]) / 2
      : pricesInEur[Math.floor(pricesInEur.length / 2)];

  return {
    median_price: medianPrice,
    average_price: sum / pricesInEur.length,
    min_price: pricesInEur[0],
    max_price: pricesInEur[pricesInEur.length - 1],
    count: limitedListings.length,
    percentile_25: getPercentile(pricesInEur, 25),
    percentile_75: getPercentile(pricesInEur, 75),
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPPORTUNITY DETECTION
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Determine if a market opportunity exists.
 *
 * **OPPORTUNITY CRITERIA:**
 * 1. Price difference >= threshold
 * 2. Find up to 5 interesting listings below (target_median - threshold)
 *
 * @param targetListings - Filtered target market listings
 * @param sourceListings - Filtered source market listings
 * @param threshold - Minimum price difference in EUR
 * @param maxInterestingListings - Maximum interesting listings to return (default 5)
 * @returns Opportunity result with pricing and interesting listings
 */
export function detectOpportunity(
  targetListings: ScrapedListing[],
  sourceListings: ScrapedListing[],
  threshold: number,
  maxInterestingListings = 5
): OpportunityResult {
  // Compute target market median
  const targetStats = computeTargetMarketStats(targetListings);
  const targetMedianPrice = targetStats.median_price;

  // If no valid target price, no opportunity
  if (targetMedianPrice === 0 || sourceListings.length === 0) {
    return {
      hasOpportunity: false,
      targetMedianPrice,
      bestSourcePrice: 0,
      priceDifference: 0,
      interestingListings: [],
    };
  }

  // Find best (cheapest) source price
  const sourcePricesEur = sourceListings
    .map(l => toEur(l.price, l.currency))
    .sort((a, b) => a - b);
  const bestSourcePrice = sourcePricesEur[0];

  // Calculate price difference
  const priceDifference = targetMedianPrice - bestSourcePrice;

  // Check if opportunity exists
  const hasOpportunity = priceDifference >= threshold;

  // Find interesting listings (priced below target median - threshold)
  const maxInterestingPrice = targetMedianPrice - threshold;
  const interestingListings = sourceListings
    .filter(l => toEur(l.price, l.currency) <= maxInterestingPrice)
    .sort((a, b) => toEur(a.price, a.currency) - toEur(b.price, b.currency))
    .slice(0, maxInterestingListings);

  return {
    hasOpportunity,
    targetMedianPrice,
    bestSourcePrice,
    priceDifference,
    interestingListings,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXECUTION ENGINE - HIGH-LEVEL API
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Execute a complete market study analysis.
 *
 * This is the MAIN ENTRY POINT for study execution. It orchestrates:
 * 1. Filtering target and source listings
 * 2. Computing target market statistics
 * 3. Detecting opportunities
 *
 * @param targetListings - Raw target market listings
 * @param sourceListings - Raw source market listings
 * @param study - Study criteria
 * @param threshold - Opportunity threshold in EUR
 * @returns Complete execution result with status and metrics
 */
export function executeStudyAnalysis(
  targetListings: ScrapedListing[],
  sourceListings: ScrapedListing[],
  study: StudyCriteria,
  threshold: number
): StudyExecutionResult {
  const rawTargetCount = targetListings.length;
  const rawSourceCount = sourceListings.length;

  // Filter target listings
  const filteredTargetListings = filterListingsByStudy(targetListings, study);
  const filteredTargetCount = filteredTargetListings.length;

  // If no valid target listings, return NULL result
  if (filteredTargetCount === 0) {
    return {
      status: 'NULL',
      targetStats: computeTargetMarketStats([]),
      targetMedianPrice: 0,
      bestSourcePrice: null,
      priceDifference: null,
      interestingListings: [],
      filteredTargetCount: 0,
      filteredSourceCount: 0,
      rawTargetCount,
      rawSourceCount,
    };
  }

  // Compute target market statistics
  const targetStats = computeTargetMarketStats(filteredTargetListings);
  const targetMedianPrice = targetStats.median_price;

  // Filter source listings
  const filteredSourceListings = filterListingsByStudy(sourceListings, study);
  const filteredSourceCount = filteredSourceListings.length;

  // If no valid source listings, return NULL result
  if (filteredSourceCount === 0) {
    return {
      status: 'NULL',
      targetStats,
      targetMedianPrice,
      bestSourcePrice: null,
      priceDifference: null,
      interestingListings: [],
      filteredTargetCount,
      filteredSourceCount: 0,
      rawTargetCount,
      rawSourceCount,
    };
  }

  // Detect opportunity
  const opportunity = detectOpportunity(filteredTargetListings, filteredSourceListings, threshold);

  return {
    status: opportunity.hasOpportunity ? 'OPPORTUNITIES' : 'NULL',
    targetStats,
    targetMedianPrice: opportunity.targetMedianPrice,
    bestSourcePrice: opportunity.bestSourcePrice,
    priceDifference: opportunity.priceDifference,
    interestingListings: opportunity.interestingListings,
    filteredTargetCount,
    filteredSourceCount,
    rawTargetCount,
    rawSourceCount,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VALIDATION AND TESTING
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Create a deterministic hash of a study execution result.
 * Used to verify that instant and scheduled searches produce identical results.
 *
 * @param result - Study execution result
 * @returns Deterministic hash string
 */
export function hashStudyResult(result: StudyExecutionResult): string {
  return JSON.stringify({
    status: result.status,
    targetMedianPrice: Math.round(result.targetMedianPrice * 100) / 100,
    bestSourcePrice: result.bestSourcePrice
      ? Math.round(result.bestSourcePrice * 100) / 100
      : null,
    priceDifference: result.priceDifference
      ? Math.round(result.priceDifference * 100) / 100
      : null,
    filteredTargetCount: result.filteredTargetCount,
    filteredSourceCount: result.filteredSourceCount,
    interestingCount: result.interestingListings.length,
  });
}
