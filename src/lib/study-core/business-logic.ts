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

// DEBUG: Study debug instrumentation flag
const STUDY_DEBUG = typeof process !== 'undefined' && process.env?.STUDY_DEBUG === 'true';

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
 * Known trim variant mappings for common trims.
 * Maps base trim keyword to list of acceptable variants.
 *
 * Example: "GR" → ["gr", "gr sport", "gazoo racing"]
 * This prevents false matches like "Sport" from passing as "GR Sport"
 */
const TRIM_VARIANT_MAP: Record<string, string[]> = {
  'gr': ['gr', 'gr sport', 'gr-sport', 'gazoo racing', 'gazoo-racing'],
  'rs': ['rs', 'rs line', 'rs-line'],
  'gt': ['gt', 'gt line', 'gt-line'],
  'r-line': ['r-line', 'r line', 'rline'],
  's-line': ['s-line', 's line', 'sline'],
  'sport': ['sport', 'sport line', 'sportline'],
  'dynamic': ['dynamic', 'dynamique'],
  'prestige': ['prestige'],
  'luxury': ['luxury', 'luxe'],
};

/**
 * Check if a listing matches the specified trim.
 *
 * **CRITICAL:**
 * - Marktplaats URL-based trim filtering (#q:) is CLIENT-SIDE ONLY
 * - Zyte returns unfiltered HTML, so we MUST filter in code
 * - This filter is applied BEFORE sorting and median calculation
 *
 * **Matching Strategy:**
 * 1. If trim has known variants (e.g., GR → "gr sport", "gazoo racing"), check all variants
 * 2. Otherwise, use safe token matching (trim tokens must appear in title/description)
 * 3. Case-insensitive, normalized matching
 *
 * @param listing - Listing to check
 * @param trim - Trim keyword (e.g., "GR", "Sport", "Dynamic")
 * @returns true if listing matches trim
 */
function matchesTrim(listing: ScrapedListing, trim: string): boolean {
  if (!trim) return true; // No trim filter

  const trimLower = trim.toLowerCase().trim();
  const text = `${listing.title} ${listing.description}`.toLowerCase();

  // Strategy 1: Check known variants
  const knownVariants = TRIM_VARIANT_MAP[trimLower];
  if (knownVariants) {
    return knownVariants.some(variant => text.includes(variant));
  }

  // Strategy 2: Safe token matching for unknown trims
  // All trim tokens must appear in text (prevents false matches)
  const trimTokens = trimLower
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);

  if (trimTokens.length === 0) return true;

  return trimTokens.every(token => text.includes(token));
}

/**
 * DEBUG HELPER: Detect specific filter rejection reason (mirrors shouldFilterListing logic).
 * This is ONLY used for debug instrumentation and does NOT replace shouldFilterListing.
 *
 * @param listing - Listing to check
 * @returns Rejection reason or null if passes
 */
function detectFilterReason(listing: ScrapedListing): 'price_floor' | 'monthly_price' | 'damaged' | null {
  const text = `${listing.title} ${listing.description}`;
  const textLower = text.toLowerCase();

  // Check 1: Price floor
  const priceEur = toEur(listing.price, listing.currency);
  if (priceEur <= 2000) {
    return 'price_floor';
  }

  // Check 2: Monthly pricing
  const isMonthly = isPriceMonthly(textLower);
  const isLowMonthlyPrice =
    listing.price_type === 'per-month' ||
    (listing.price >= 200 && listing.price <= 500 && isMonthly);

  if (isLowMonthlyPrice || isMonthly) {
    return 'monthly_price';
  }

  // Check 3: Damaged vehicles
  if (isDamagedVehicle(text)) {
    return 'damaged';
  }

  return null;
}

/**
 * SECOND PASS FILTER: Apply study-specific criteria:
 * - Brand/model match
 * - Year filter (must be >= study year)
 * - Mileage filter (if specified)
 * - **Trim filter (CODE-LEVEL, not URL-based)**
 *
 * **CRITICAL CHANGE (2026-01-23):**
 * Trim filtering is now CODE-DRIVEN, not URL-based. This is because:
 * 1. Marktplaats #q: parameter is client-side only (not applied by Zyte)
 * 2. Scraped listings may include non-trim vehicles
 * 3. Trim filter MUST be applied before sorting and median calculation
 *
 * This ensures that ONLY trim-matching listings are used for the 6-cheapest selection.
 *
 * @param listings - Listings to filter
 * @param study - Study criteria
 * @returns Filtered listings matching all criteria
 */
export function filterListingsByStudy(
  listings: ScrapedListing[],
  study: StudyCriteria
): ScrapedListing[] {
  // LAYER C: Initialize debug tracking if enabled
  const rejectionBuckets = STUDY_DEBUG ? {
    price_floor: [] as Array<{ listing: ScrapedListing; detail: string }>,
    monthly_price: [] as Array<{ listing: ScrapedListing; detail: string }>,
    damaged: [] as Array<{ listing: ScrapedListing; detail: string }>,
    year: [] as Array<{ listing: ScrapedListing; detail: string }>,
    mileage: [] as Array<{ listing: ScrapedListing; detail: string }>,
    brand_model: [] as Array<{ listing: ScrapedListing; detail: string }>,
    trim: [] as Array<{ listing: ScrapedListing; detail: string }>,
  } : null;

  let afterShouldFilterCount = 0;

  const filtered = listings.filter(listing => {
    // Apply first-pass filters
    const shouldFilter = shouldFilterListing(listing);
    if (shouldFilter) {
      // Track rejection reason if debug enabled
      if (STUDY_DEBUG && rejectionBuckets) {
        const reason = detectFilterReason(listing);
        if (reason && rejectionBuckets[reason].length < 5) {
          const priceEur = toEur(listing.price, listing.currency);
          rejectionBuckets[reason].push({
            listing,
            detail: `€${priceEur.toFixed(0)} (${listing.price} ${listing.currency})`,
          });
        }
      }
      return false;
    }

    if (STUDY_DEBUG) {
      afterShouldFilterCount++;
    }

    // Filter by year (must be >= study year)
    if (listing.year && listing.year < study.year) {
      if (STUDY_DEBUG && rejectionBuckets && rejectionBuckets.year.length < 5) {
        rejectionBuckets.year.push({
          listing,
          detail: `year ${listing.year} < ${study.year}`,
        });
      }
      return false;
    }

    // Filter by mileage (if study specifies a max)
    if (study.max_mileage > 0 && listing.mileage && listing.mileage > study.max_mileage) {
      if (STUDY_DEBUG && rejectionBuckets && rejectionBuckets.mileage.length < 5) {
        rejectionBuckets.mileage.push({
          listing,
          detail: `${listing.mileage}km > ${study.max_mileage}km`,
        });
      }
      return false;
    }

    // Filter by brand/model match
    const matchResult = matchesBrandModel(listing.title, study.brand, study.model);
    if (!matchResult.matches) {
      if (STUDY_DEBUG && rejectionBuckets && rejectionBuckets.brand_model.length < 5) {
        rejectionBuckets.brand_model.push({
          listing,
          detail: `brand/model mismatch`,
        });
      }
      return false;
    }

    // Filter by trim (CODE-LEVEL, not URL-based)
    if (study.trim_text && !matchesTrim(listing, study.trim_text)) {
      if (STUDY_DEBUG && rejectionBuckets && rejectionBuckets.trim.length < 5) {
        rejectionBuckets.trim.push({
          listing,
          detail: `trim mismatch (expected: ${study.trim_text})`,
        });
      }
      return false;
    }

    return true;
  });

  // LAYER C: Output debug summary if enabled
  if (STUDY_DEBUG && rejectionBuckets) {
    try {
      const parsedCount = listings.length;
      const passedCount = filtered.length;
      const rejectedCount = parsedCount - passedCount;

      console.log(`[STUDY_DEBUG_FILTER] === FILTER SUMMARY ===`);
      console.log(`[STUDY_DEBUG_FILTER] Total input (parsedCount): ${parsedCount}`);
      console.log(`[STUDY_DEBUG_FILTER] After shouldFilter: ${afterShouldFilterCount}`);
      console.log(`[STUDY_DEBUG_FILTER] After criteria filters (passedCount): ${passedCount}`);
      console.log(`[STUDY_DEBUG_FILTER] Total rejected: ${rejectedCount}`);
      console.log(`[STUDY_DEBUG_FILTER] Rejected by price_floor: ${rejectionBuckets.price_floor.length}`);
      console.log(`[STUDY_DEBUG_FILTER] Rejected by monthly_price: ${rejectionBuckets.monthly_price.length}`);
      console.log(`[STUDY_DEBUG_FILTER] Rejected by damaged: ${rejectionBuckets.damaged.length}`);
      console.log(`[STUDY_DEBUG_FILTER] Rejected by year: ${rejectionBuckets.year.length}`);
      console.log(`[STUDY_DEBUG_FILTER] Rejected by mileage: ${rejectionBuckets.mileage.length}`);
      console.log(`[STUDY_DEBUG_FILTER] Rejected by brand_model: ${rejectionBuckets.brand_model.length}`);
      console.log(`[STUDY_DEBUG_FILTER] Rejected by trim: ${rejectionBuckets.trim.length}`);

      // Show examples for each bucket that has rejections
      for (const [bucket, items] of Object.entries(rejectionBuckets)) {
        if (items.length > 0) {
          console.log(`[STUDY_DEBUG_FILTER] === EXAMPLES: ${bucket} (showing up to 5) ===`);
          items.forEach((item) => {
            const l = item.listing;
            const price = l.price ? `€${l.price}` : '€0';
            const year = l.year || 'null';
            const mileage = l.mileage ? `${l.mileage}km` : 'null km';
            const title = (l.title || '').substring(0, 60);
            console.log(`[STUDY_DEBUG_FILTER] ${price} | ${year} | ${mileage} | ${title} | ${item.detail}`);
          });
        }
      }
    } catch (err) {
      console.error(`[STUDY_DEBUG_FILTER] Error in debug instrumentation:`, err);
    }
  }

  return filtered;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRICING AND STATISTICS
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Debug flag for trim filtering diagnostics.
 * Set to true to enable detailed logging of trim filter results.
 */
const DEBUG_TRIM_FILTER = true;

/**
 * Compute market statistics from filtered listings.
 *
 * **CRITICAL BUSINESS RULE:**
 * - Uses the 6 CHEAPEST listings only (MAX_TARGET_LISTINGS = 6)
 * - Median calculation: average of two middle values for even counts
 * - All prices converted to EUR before calculation
 *
 * @param listings - Filtered listings (already passed all filters)
 * @param debugLabel - Optional label for debug logging (e.g., "TARGET" or "SOURCE")
 * @returns Market statistics including median, average, min, max, percentiles
 */
export function computeTargetMarketStats(
  listings: ScrapedListing[],
  debugLabel?: string
): MarketStats {
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

  // CRITICAL DEBUG: Log all prices BEFORE sorting
  console.log(`\n[MEDIAN_DEBUG ${debugLabel || 'UNKNOWN'}] === STAGE 1: INPUT ===`);
  console.log(`[MEDIAN_DEBUG] Total listings received: ${listings.length}`);
  const allPricesBeforeSort = listings.map(l => ({
    price: l.price,
    currency: l.currency,
    priceEur: toEur(l.price, l.currency),
    title: l.title.substring(0, 50)
  }));
  console.log(`[MEDIAN_DEBUG] All prices (unsorted):`);
  allPricesBeforeSort.slice(0, 10).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.price} ${p.currency} → €${p.priceEur.toFixed(0)} - ${p.title}`);
  });
  if (allPricesBeforeSort.length > 10) {
    console.log(`  ... and ${allPricesBeforeSort.length - 10} more`);
  }

  // Sort by price (EUR) ascending
  const sortedListings = listings
    .map(l => ({ ...l, priceEur: toEur(l.price, l.currency) }))
    .sort((a, b) => a.priceEur - b.priceEur);

  // CRITICAL DEBUG: Log first 10 sorted prices
  console.log(`\n[MEDIAN_DEBUG] === STAGE 2: AFTER NUMERIC SORT (ASC) ===`);
  console.log(`[MEDIAN_DEBUG] First 10 sorted prices (numeric sort):`);
  sortedListings.slice(0, 10).forEach((l, i) => {
    console.log(`  ${i + 1}. €${l.priceEur.toFixed(0)} (${l.price} ${l.currency}) - ${l.title.substring(0, 50)}`);
  });

  // Take top 6 cheapest
  const limitedListings = sortedListings.slice(0, MAX_TARGET_LISTINGS);
  const pricesInEur = limitedListings.map(l => l.priceEur);
  const sum = pricesInEur.reduce((acc, price) => acc + price, 0);

  // STUDY_DEBUG: Log the exact prices used for median calculation
  if (STUDY_DEBUG) {
    try {
      console.log(`[STUDY_DEBUG_STATS] Using MAX_TARGET_LISTINGS=${MAX_TARGET_LISTINGS} for median calculation`);
      console.log(`[STUDY_DEBUG_STATS] Actually using top N=${limitedListings.length} (filtered count may be less than 6)`);
      console.log(`[STUDY_DEBUG_STATS] TOP N prices for median: [${pricesInEur.map(p => `€${p.toFixed(0)}`).join(', ')}]`);
    } catch (err) {
      console.error(`[STUDY_DEBUG_STATS] Error in debug instrumentation:`, err);
    }
  }

  // CRITICAL DEBUG: Show the exact top 6 prices used for stats
  console.log(`\n[MEDIAN_DEBUG] === STAGE 3: TOP 6 CHEAPEST (used for stats) ===`);
  console.log(`[MEDIAN_DEBUG] Exact top6 prices array:`);
  pricesInEur.forEach((p, i) => {
    console.log(`  top6[${i}] = €${p.toFixed(0)} - ${limitedListings[i].title.substring(0, 50)}`);
  });

  // Debug logging: Show which listings were used for median calculation
  if (DEBUG_TRIM_FILTER && debugLabel) {
    console.log(`\n[${debugLabel} MEDIAN DEBUG]`);
    console.log(`Total filtered listings: ${listings.length}`);
    console.log(`Using 6 cheapest listings for median:`);
    limitedListings.forEach((l, i) => {
      console.log(`  ${i + 1}. €${l.priceEur.toFixed(0)} - ${l.title.substring(0, 60)}`);
    });
  }

  // Percentile calculation helper
  const getPercentile = (arr: number[], p: number) => {
    const index = Math.ceil((arr.length * p) / 100) - 1;
    return arr[Math.max(0, index)];
  };

  // MEDIAN CALCULATION: Average of two middle values for even counts
  console.log(`\n[MEDIAN_DEBUG] === STAGE 4: MEDIAN COMPUTATION ===`);
  console.log(`[MEDIAN_DEBUG] Array length: ${pricesInEur.length}`);
  console.log(`[MEDIAN_DEBUG] Is even: ${pricesInEur.length % 2 === 0}`);

  let medianPrice: number;
  if (pricesInEur.length % 2 === 0) {
    const idx1 = pricesInEur.length / 2 - 1;
    const idx2 = pricesInEur.length / 2;
    const val1 = pricesInEur[idx1];
    const val2 = pricesInEur[idx2];
    medianPrice = (val1 + val2) / 2;
    console.log(`[MEDIAN_DEBUG] Even count: taking average of middle two`);
    console.log(`[MEDIAN_DEBUG]   pricesInEur[${idx1}] = €${val1.toFixed(2)}`);
    console.log(`[MEDIAN_DEBUG]   pricesInEur[${idx2}] = €${val2.toFixed(2)}`);
    console.log(`[MEDIAN_DEBUG]   median = (${val1.toFixed(2)} + ${val2.toFixed(2)}) / 2 = €${medianPrice.toFixed(2)}`);
  } else {
    const idx = Math.floor(pricesInEur.length / 2);
    medianPrice = pricesInEur[idx];
    console.log(`[MEDIAN_DEBUG] Odd count: taking middle value`);
    console.log(`[MEDIAN_DEBUG]   pricesInEur[${idx}] = €${medianPrice.toFixed(2)}`);
  }

  const stats = {
    median_price: medianPrice,
    average_price: sum / pricesInEur.length,
    min_price: pricesInEur[0],
    max_price: pricesInEur[pricesInEur.length - 1],
    count: limitedListings.length,
    percentile_25: getPercentile(pricesInEur, 25),
    percentile_75: getPercentile(pricesInEur, 75),
  };

  console.log(`\n[MEDIAN_DEBUG] === FINAL STATS ===`);
  console.log(`[MEDIAN_DEBUG] Count: ${stats.count}`);
  console.log(`[MEDIAN_DEBUG] Range: €${stats.min_price.toFixed(0)} - €${stats.max_price.toFixed(0)}`);
  console.log(`[MEDIAN_DEBUG] Median: €${stats.median_price.toFixed(0)}`);
  console.log(`[MEDIAN_DEBUG] Average: €${stats.average_price.toFixed(0)}`);
  console.log(`[MEDIAN_DEBUG] P25: €${stats.percentile_25.toFixed(0)}`);
  console.log(`[MEDIAN_DEBUG] P75: €${stats.percentile_75.toFixed(0)}`);

  return stats;
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

  // Debug logging: Show filtering progress
  if (DEBUG_TRIM_FILTER && study.trim_text) {
    console.log(`\n[TRIM FILTER DEBUG]`);
    console.log(`Study: ${study.brand} ${study.model} - Trim: "${study.trim_text}"`);
    console.log(`Raw listings: Target=${rawTargetCount}, Source=${rawSourceCount}`);
  }

  // Filter target listings
  const filteredTargetListings = filterListingsByStudy(targetListings, study);
  const filteredTargetCount = filteredTargetListings.length;

  // Debug logging: Show trim filter results
  if (DEBUG_TRIM_FILTER && study.trim_text) {
    const rejectedTarget = rawTargetCount - filteredTargetCount;
    console.log(`Target: ${filteredTargetCount} passed, ${rejectedTarget} rejected by trim filter`);
  }

  // If no valid target listings, return NULL result
  if (filteredTargetCount === 0) {
    return {
      status: 'NULL',
      targetStats: computeTargetMarketStats([], 'TARGET'),
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
  const targetStats = computeTargetMarketStats(filteredTargetListings, 'TARGET');
  const targetMedianPrice = targetStats.median_price;

  // Filter source listings
  const filteredSourceListings = filterListingsByStudy(sourceListings, study);
  const filteredSourceCount = filteredSourceListings.length;

  // Debug logging: Show trim filter results
  if (DEBUG_TRIM_FILTER && study.trim_text) {
    const rejectedSource = rawSourceCount - filteredSourceCount;
    console.log(`Source: ${filteredSourceCount} passed, ${rejectedSource} rejected by trim filter`);
  }

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
