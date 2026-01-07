/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PARITY TESTS - BUSINESS LOGIC
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These tests verify that the unified business logic produces identical results
 * across different execution environments.
 *
 * **PURPOSE:**
 * - Ensure INSTANT and SCHEDULED runs produce matching results
 * - Detect any divergence in filtering, statistics, or opportunity detection
 * - Validate the unified study-core module
 *
 * **RUN TESTS:**
 * ```bash
 * npm run test:parity
 * ```
 *
 * **WHAT IS TESTED:**
 * - Currency conversion (toEur)
 * - Brand/model matching (matchesBrandModel)
 * - Listing filtering (shouldFilterListing, filterListingsByStudy)
 * - Market statistics (computeTargetMarketStats)
 * - Opportunity detection (detectOpportunity)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  toEur,
  matchesBrandModel,
  shouldFilterListing,
  filterListingsByStudy,
  computeTargetMarketStats,
  detectOpportunity,
  executeStudyAnalysis,
  checkParity,
  type ScrapedListing,
  type StudyCriteria,
} from '../../src/lib/study-core';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST FIXTURES
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MOCK_STUDY: StudyCriteria = {
  brand: 'Toyota',
  model: 'Yaris Cross',
  year: 2024,
  max_mileage: 50000,
};

const VALID_LISTING: ScrapedListing = {
  title: 'Toyota Yaris Cross 2024',
  price: 16500,
  currency: 'EUR',
  mileage: 15000,
  year: 2024,
  trim: null,
  listing_url: 'https://example.com/listing/1',
  description: '',
  price_type: 'one-off',
};

const LEASING_LISTING: ScrapedListing = {
  title: 'Toyota Yaris Cross 2024 Lease €299/mois',
  price: 299,
  currency: 'EUR',
  mileage: 0,
  year: 2024,
  trim: null,
  listing_url: 'https://example.com/listing/2',
  description: 'Private lease per month',
  price_type: 'per-month',
};

const DAMAGED_LISTING: ScrapedListing = {
  title: 'Toyota Yaris Cross 2024 Damaged',
  price: 8000,
  currency: 'EUR',
  mileage: 10000,
  year: 2024,
  trim: null,
  listing_url: 'https://example.com/listing/3',
  description: 'Accident damage, chassis tordu',
  price_type: 'one-off',
};

const LOW_PRICE_LISTING: ScrapedListing = {
  title: 'Toyota Yaris Cross 2024',
  price: 1500,
  currency: 'EUR',
  mileage: 5000,
  year: 2024,
  trim: null,
  listing_url: 'https://example.com/listing/4',
  description: '',
  price_type: 'one-off',
};

const WRONG_MODEL_LISTING: ScrapedListing = {
  title: 'Toyota Yaris 2024',
  price: 14000,
  currency: 'EUR',
  mileage: 10000,
  year: 2024,
  trim: null,
  listing_url: 'https://example.com/listing/5',
  description: '',
  price_type: 'one-off',
};

const WRONG_YEAR_LISTING: ScrapedListing = {
  title: 'Toyota Yaris Cross 2023',
  price: 15000,
  currency: 'EUR',
  mileage: 20000,
  year: 2023,
  trim: null,
  listing_url: 'https://example.com/listing/6',
  description: '',
  price_type: 'one-off',
};

const TARGET_MARKET_LISTINGS: ScrapedListing[] = [
  { ...VALID_LISTING, price: 15900, listing_url: 'https://example.com/t1' },
  { ...VALID_LISTING, price: 16200, listing_url: 'https://example.com/t2' },
  { ...VALID_LISTING, price: 16500, listing_url: 'https://example.com/t3' },
  { ...VALID_LISTING, price: 16800, listing_url: 'https://example.com/t4' },
  { ...VALID_LISTING, price: 17100, listing_url: 'https://example.com/t5' },
  { ...VALID_LISTING, price: 17500, listing_url: 'https://example.com/t6' },
  { ...VALID_LISTING, price: 22000, listing_url: 'https://example.com/t7' }, // Should be ignored (>6)
  { ...VALID_LISTING, price: 25000, listing_url: 'https://example.com/t8' }, // Should be ignored (>6)
];

const SOURCE_MARKET_LISTINGS: ScrapedListing[] = [
  { ...VALID_LISTING, price: 10000, listing_url: 'https://example.com/s1' },
  { ...VALID_LISTING, price: 10500, listing_url: 'https://example.com/s2' },
  { ...VALID_LISTING, price: 11000, listing_url: 'https://example.com/s3' },
  { ...VALID_LISTING, price: 11500, listing_url: 'https://example.com/s4' },
  { ...VALID_LISTING, price: 12000, listing_url: 'https://example.com/s5' },
];

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST RUNNER
 * ═══════════════════════════════════════════════════════════════════════════
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`❌ Assertion failed: ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `❌ ${message}\n   Expected: ${expected}\n   Actual: ${actual}`
    );
  }
}

function runTest(name: string, testFn: () => void): void {
  try {
    testFn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TESTS
 * ═══════════════════════════════════════════════════════════════════════════
 */

console.log('\n═══════════════════════════════════════════════════');
console.log('PARITY TESTS - BUSINESS LOGIC');
console.log('═══════════════════════════════════════════════════\n');

runTest('Currency conversion - EUR to EUR', () => {
  const result = toEur(16500, 'EUR');
  assertEqual(result, 16500, 'EUR should remain unchanged');
});

runTest('Currency conversion - DKK to EUR', () => {
  const result = toEur(100000, 'DKK');
  assertEqual(result, 13000, 'DKK should convert at 0.13 rate');
});

runTest('Brand/model matching - Valid match', () => {
  const result = matchesBrandModel('Toyota Yaris Cross 2024', 'Toyota', 'Yaris Cross');
  assert(result.matches, 'Should match valid brand and model');
});

runTest('Brand/model matching - Missing brand', () => {
  const result = matchesBrandModel('Honda Civic 2024', 'Toyota', 'Yaris Cross');
  assert(!result.matches, 'Should not match different brand');
});

runTest('Brand/model matching - Missing model token', () => {
  const result = matchesBrandModel('Toyota Yaris 2024', 'Toyota', 'Yaris Cross');
  assert(!result.matches, 'Should not match when model token missing');
});

runTest('Filtering - Leasing should be filtered', () => {
  const result = shouldFilterListing(LEASING_LISTING);
  assert(result, 'Leasing listings should be filtered');
});

runTest('Filtering - Damaged should be filtered', () => {
  const result = shouldFilterListing(DAMAGED_LISTING);
  assert(result, 'Damaged listings should be filtered');
});

runTest('Filtering - Low price should be filtered', () => {
  const result = shouldFilterListing(LOW_PRICE_LISTING);
  assert(result, 'Low price listings should be filtered (≤2000€)');
});

runTest('Filtering - Valid listing should not be filtered', () => {
  const result = shouldFilterListing(VALID_LISTING);
  assert(!result, 'Valid listings should not be filtered');
});

runTest('Study filtering - Should filter correctly', () => {
  const allListings = [
    VALID_LISTING,
    LEASING_LISTING,
    DAMAGED_LISTING,
    LOW_PRICE_LISTING,
    WRONG_MODEL_LISTING,
    WRONG_YEAR_LISTING,
  ];

  const filtered = filterListingsByStudy(allListings, MOCK_STUDY);

  assertEqual(filtered.length, 1, 'Should keep only 1 valid listing');
  assertEqual(filtered[0].listing_url, VALID_LISTING.listing_url, 'Should keep the valid listing');
});

runTest('Market stats - Top 6 cheapest only', () => {
  const stats = computeTargetMarketStats(TARGET_MARKET_LISTINGS);

  assertEqual(stats.count, 6, 'Should use only 6 listings');
  assertEqual(stats.min_price, 15900, 'Min should be first listing');
  assertEqual(stats.max_price, 17500, 'Max should be 6th listing, not 22000 or 25000');
});

runTest('Market stats - Median calculation (even count)', () => {
  const stats = computeTargetMarketStats(TARGET_MARKET_LISTINGS);

  const expectedMedian = (16500 + 16800) / 2;
  assertEqual(stats.median_price, expectedMedian, 'Median of 6 listings should be average of 3rd and 4th');
});

runTest('Opportunity detection - Should detect opportunity', () => {
  const opportunity = detectOpportunity(
    TARGET_MARKET_LISTINGS,
    SOURCE_MARKET_LISTINGS,
    5000
  );

  assert(opportunity.hasOpportunity, 'Should detect opportunity');
  assertEqual(opportunity.bestSourcePrice, 10000, 'Best source should be cheapest');

  const expectedMedian = (16500 + 16800) / 2;
  assertEqual(opportunity.targetMedianPrice, expectedMedian, 'Target median should match');

  const expectedDiff = expectedMedian - 10000;
  assert(opportunity.priceDifference >= 5000, `Price diff should be >= 5000 (was ${expectedDiff})`);
});

runTest('Opportunity detection - Interesting listings count', () => {
  const opportunity = detectOpportunity(
    TARGET_MARKET_LISTINGS,
    SOURCE_MARKET_LISTINGS,
    5000
  );

  assert(opportunity.interestingListings.length > 0, 'Should have interesting listings');
  assert(opportunity.interestingListings.length <= 5, 'Should have max 5 interesting listings');
});

runTest('Full study analysis - Deterministic results', () => {
  const result1 = executeStudyAnalysis(
    TARGET_MARKET_LISTINGS,
    SOURCE_MARKET_LISTINGS,
    MOCK_STUDY,
    5000
  );

  const result2 = executeStudyAnalysis(
    TARGET_MARKET_LISTINGS,
    SOURCE_MARKET_LISTINGS,
    MOCK_STUDY,
    5000
  );

  // Results should be identical
  assertEqual(result1.status, result2.status, 'Status should match');
  assertEqual(result1.targetMedianPrice, result2.targetMedianPrice, 'Target median should match');
  assertEqual(result1.bestSourcePrice, result2.bestSourcePrice, 'Best source should match');
  assertEqual(result1.priceDifference, result2.priceDifference, 'Price difference should match');
  assertEqual(result1.filteredTargetCount, result2.filteredTargetCount, 'Filtered target count should match');
  assertEqual(result1.filteredSourceCount, result2.filteredSourceCount, 'Filtered source count should match');
});

runTest('Parity check - Identical results', () => {
  const result1 = executeStudyAnalysis(
    TARGET_MARKET_LISTINGS,
    SOURCE_MARKET_LISTINGS,
    MOCK_STUDY,
    5000
  );

  const result2 = executeStudyAnalysis(
    TARGET_MARKET_LISTINGS,
    SOURCE_MARKET_LISTINGS,
    MOCK_STUDY,
    5000
  );

  const parityResult = checkParity(result1, result2, 2);

  assert(parityResult.matches, `Parity check should pass: ${parityResult.differences.join(', ')}`);
});

console.log('\n═══════════════════════════════════════════════════');
console.log('✅ ALL PARITY TESTS PASSED');
console.log('═══════════════════════════════════════════════════\n');
