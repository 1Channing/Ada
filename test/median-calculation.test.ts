/**
 * Unit test for median calculation on top 6 cheapest prices
 *
 * This test verifies that the median is computed correctly from the first 6 cheapest
 * prices when sorted in ascending numeric order.
 */

import { computeTargetMarketStats } from '../src/lib/study-core/business-logic';
import type { ScrapedListing } from '../src/lib/study-core/types';

// Helper to create mock listing
function createMockListing(price: number, title: string = 'Test Listing'): ScrapedListing {
  return {
    title,
    price,
    currency: 'EUR',
    mileage: 50000,
    year: 2024,
    trim: null,
    listing_url: 'https://example.com',
    description: 'Test description',
    price_type: 'one-off',
  };
}

console.log('\n=== MEDIAN CALCULATION UNIT TEST ===\n');

// Test Case 1: Exact prices from user's scenario
console.log('Test Case 1: User-provided prices [52850, 52900, 54900, 54950, 54950, 55450]');
const testListings1 = [
  createMockListing(52850, 'Toyota 1'),
  createMockListing(52900, 'Toyota 2'),
  createMockListing(54900, 'Toyota 3'),
  createMockListing(54950, 'Toyota 4'),
  createMockListing(54950, 'Toyota 5'),  // duplicate price
  createMockListing(55450, 'Toyota 6'),
];

const stats1 = computeTargetMarketStats(testListings1, 'TEST1');
const expectedMedian1 = (54900 + 54950) / 2; // 54925

console.log(`\nExpected median: €${expectedMedian1} (average of 3rd and 4th: ${54900} + ${54950})`);
console.log(`Actual median: €${stats1.median_price}`);
console.log(`Match: ${Math.abs(stats1.median_price - expectedMedian1) < 0.01 ? '✅ PASS' : '❌ FAIL'}`);

// Verify other stats
console.log(`\nOther stats verification:`);
console.log(`  Count: ${stats1.count} (expected: 6) ${stats1.count === 6 ? '✅' : '❌'}`);
console.log(`  Min: €${stats1.min_price} (expected: 52850) ${stats1.min_price === 52850 ? '✅' : '❌'}`);
console.log(`  Max: €${stats1.max_price} (expected: 55450) ${stats1.max_price === 55450 ? '✅' : '❌'}`);

// Test Case 2: More than 6 listings (should only use top 6)
console.log('\n\nTest Case 2: 10 listings, should only use top 6 cheapest');
const testListings2 = [
  createMockListing(52850),
  createMockListing(52900),
  createMockListing(54900),
  createMockListing(54950),
  createMockListing(54950),
  createMockListing(55450),
  createMockListing(57900),  // These 4 should NOT
  createMockListing(58000),  // be included in
  createMockListing(60000),  // median calculation
  createMockListing(65000),  // (beyond top 6)
];

const stats2 = computeTargetMarketStats(testListings2, 'TEST2');
console.log(`\nExpected median: €${expectedMedian1} (still 54925, ignoring listings 7-10)`);
console.log(`Actual median: €${stats2.median_price}`);
console.log(`Match: ${Math.abs(stats2.median_price - expectedMedian1) < 0.01 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Count: ${stats2.count} (expected: 6) ${stats2.count === 6 ? '✅' : '❌'}`);
console.log(`Max: €${stats2.max_price} (expected: 55450, NOT 65000) ${stats2.max_price === 55450 ? '✅' : '❌'}`);

// Test Case 3: Unsorted input (should sort correctly)
console.log('\n\nTest Case 3: Unsorted prices, should sort numerically not alphabetically');
const testListings3 = [
  createMockListing(57900, 'Price 7'),  // Intentionally out of order
  createMockListing(52850, 'Price 1'),
  createMockListing(54950, 'Price 4'),
  createMockListing(52900, 'Price 2'),
  createMockListing(55450, 'Price 6'),
  createMockListing(54950, 'Price 5'),
  createMockListing(54900, 'Price 3'),
  createMockListing(60000, 'Price 8'),
];

const stats3 = computeTargetMarketStats(testListings3, 'TEST3');
console.log(`\nExpected median: €${expectedMedian1} (same result after sorting)`);
console.log(`Actual median: €${stats3.median_price}`);
console.log(`Match: ${Math.abs(stats3.median_price - expectedMedian1) < 0.01 ? '✅ PASS' : '❌ FAIL'}`);

// Test Case 4: String-like numbers (potential bug if prices are strings)
console.log('\n\nTest Case 4: Verify numeric sort (not string sort)');
// In numeric sort: 500, 1000, 5000, 10000, 50000, 100000
// In string sort: "1000", "10000", "100000", "5000", "500", "50000"
// Median of 6 items = avg of 3rd and 4th = (5000 + 10000) / 2 = 7500
const testListings4 = [
  createMockListing(5000),
  createMockListing(10000),
  createMockListing(500),
  createMockListing(1000),
  createMockListing(50000),
  createMockListing(100000),
];
const stats4 = computeTargetMarketStats(testListings4, 'TEST4');
const expectedMedian4 = (5000 + 10000) / 2; // 7500 (correct for sorted [500, 1000, 5000, 10000, 50000, 100000])
console.log(`Expected median: €${expectedMedian4} (average of 3rd and 4th: 5000 and 10000)`);
console.log(`Actual median: €${stats4.median_price}`);
console.log(`Match: ${Math.abs(stats4.median_price - expectedMedian4) < 0.01 ? '✅ PASS' : '❌ FAIL'}`);

console.log('\n=== END OF UNIT TESTS ===\n');

// Exit with appropriate code
const allPassed =
  Math.abs(stats1.median_price - expectedMedian1) < 0.01 &&
  stats1.count === 6 &&
  stats1.min_price === 52850 &&
  stats1.max_price === 55450 &&
  Math.abs(stats2.median_price - expectedMedian1) < 0.01 &&
  stats2.count === 6 &&
  stats2.max_price === 55450 &&
  Math.abs(stats3.median_price - expectedMedian1) < 0.01 &&
  Math.abs(stats4.median_price - expectedMedian4) < 0.01;

if (allPassed) {
  console.log('✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
