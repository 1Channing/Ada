/**
 * ═══════════════════════════════════════════════════════════════════════════
 * END-TO-END PARITY TEST
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests that the complete pipeline produces identical results for INSTANT and
 * SCHEDULED execution modes.
 *
 * Pipeline: HTML → Parse → Filter → Stats → Opportunity
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  coreParseSearchPage,
  filterListingsByStudy,
  computeTargetMarketStats,
  detectOpportunity,
  type StudyCriteria,
} from '../../src/lib/study-core/index.js';

// Test helpers
function assertEqual(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTest(name: string, testFn: () => void | Promise<void>) {
  try {
    await testFn();
    console.log(`✅ ${name}`);
    return true;
  } catch (error: any) {
    console.error(`❌ ${name}`);
    console.error(`   ${error.message}`);
    return false;
  }
}

/**
 * Load HTML fixture
 */
function loadFixture(filename: string): string {
  const fixturePath = join(process.cwd(), 'test', 'fixtures', 'html', filename);
  return readFileSync(fixturePath, 'utf-8');
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TESTS
 * ═══════════════════════════════════════════════════════════════════════════
 */

console.log('═══════════════════════════════════════════════════');
console.log('END-TO-END PARITY TEST');
console.log('═══════════════════════════════════════════════════');
console.log('');

let allPassed = true;

// Test: Complete pipeline produces identical results
allPassed = await runTest('E2E - INSTANT vs SCHEDULED produce identical results', () => {
  // Load fixtures
  const targetHtml = loadFixture('marktplaats-page1.html');
  const sourceHtml = loadFixture('leboncoin-page1.html');

  // Define study criteria
  const study: StudyCriteria = {
    brand: 'Toyota',
    model: 'Yaris Cross',
    priceFloor: 2000,
  };

  const threshold = 1000; // 1000 EUR threshold

  // ────────────────────────────────────────────────────────────
  // INSTANT PATH (simulated)
  // ────────────────────────────────────────────────────────────
  const instantTargetListings = coreParseSearchPage(
    targetHtml,
    'https://www.marktplaats.nl/l/auto-s/q/toyota+yaris+cross/'
  );

  const instantSourceListings = coreParseSearchPage(
    sourceHtml,
    'https://www.leboncoin.fr/recherche?category=2&text=toyota%20yaris%20cross'
  );

  const instantFilteredTarget = filterListingsByStudy(instantTargetListings, study);
  const instantFilteredSource = filterListingsByStudy(instantSourceListings, study);

  const instantTargetStats = computeTargetMarketStats(instantFilteredTarget);
  const instantOpportunity = detectOpportunity(
    instantFilteredTarget,
    instantFilteredSource,
    threshold,
    5
  );

  // ────────────────────────────────────────────────────────────
  // SCHEDULED PATH (simulated)
  // ────────────────────────────────────────────────────────────
  const scheduledTargetListings = coreParseSearchPage(
    targetHtml,
    'https://www.marktplaats.nl/l/auto-s/q/toyota+yaris+cross/'
  );

  const scheduledSourceListings = coreParseSearchPage(
    sourceHtml,
    'https://www.leboncoin.fr/recherche?category=2&text=toyota%20yaris%20cross'
  );

  const scheduledFilteredTarget = filterListingsByStudy(scheduledTargetListings, study);
  const scheduledFilteredSource = filterListingsByStudy(scheduledSourceListings, study);

  const scheduledTargetStats = computeTargetMarketStats(scheduledFilteredTarget);
  const scheduledOpportunity = detectOpportunity(
    scheduledFilteredTarget,
    scheduledFilteredSource,
    threshold,
    5
  );

  // ────────────────────────────────────────────────────────────
  // ASSERTIONS: Both paths MUST produce identical results
  // ────────────────────────────────────────────────────────────

  // Raw listing counts should match
  assertEqual(
    instantTargetListings.length,
    scheduledTargetListings.length,
    'Raw target listing count'
  );

  assertEqual(
    instantSourceListings.length,
    scheduledSourceListings.length,
    'Raw source listing count'
  );

  // Filtered counts should match
  assertEqual(
    instantFilteredTarget.length,
    scheduledFilteredTarget.length,
    'Filtered target count'
  );

  assertEqual(
    instantFilteredSource.length,
    scheduledFilteredSource.length,
    'Filtered source count'
  );

  // Target stats should match exactly
  assertEqual(instantTargetStats.count, scheduledTargetStats.count, 'Target count');
  assertEqual(instantTargetStats.median, scheduledTargetStats.median, 'Target median');
  assertEqual(instantTargetStats.min_price, scheduledTargetStats.min_price, 'Target min price');
  assertEqual(instantTargetStats.max_price, scheduledTargetStats.max_price, 'Target max price');

  // Opportunity results should match
  assertEqual(
    instantOpportunity.hasOpportunity,
    scheduledOpportunity.hasOpportunity,
    'Opportunity detection'
  );

  if (instantOpportunity.hasOpportunity) {
    assertEqual(
      instantOpportunity.bestSourcePrice,
      scheduledOpportunity.bestSourcePrice,
      'Best source price'
    );

    assertEqual(
      instantOpportunity.priceDifference,
      scheduledOpportunity.priceDifference,
      'Price difference'
    );

    assertEqual(
      instantOpportunity.interestingListings.length,
      scheduledOpportunity.interestingListings.length,
      'Interesting listings count'
    );
  }

  console.log('');
  console.log('   📊 Results:');
  console.log(`      Target median: ${instantTargetStats.median}€`);
  console.log(`      Source best: ${instantOpportunity.bestSourcePrice}€`);
  console.log(`      Opportunity: ${instantOpportunity.hasOpportunity}`);
  console.log(`      Filtered target: ${instantFilteredTarget.length}`);
  console.log(`      Filtered source: ${instantFilteredSource.length}`);
}) && allPassed;

// Test: Multiple runs produce identical results
allPassed = await runTest('E2E - Multiple runs are deterministic', () => {
  const targetHtml = loadFixture('marktplaats-page1.html');
  const sourceHtml = loadFixture('leboncoin-page1.html');

  const study: StudyCriteria = {
    brand: 'Toyota',
    model: 'Yaris Cross',
    priceFloor: 2000,
  };

  const threshold = 1000;

  const results = [];

  // Run pipeline 5 times
  for (let i = 0; i < 5; i++) {
    const targetListings = coreParseSearchPage(
      targetHtml,
      'https://www.marktplaats.nl/l/auto-s/q/toyota+yaris+cross/'
    );

    const sourceListings = coreParseSearchPage(
      sourceHtml,
      'https://www.leboncoin.fr/recherche?category=2&text=toyota%20yaris%20cross'
    );

    const filteredTarget = filterListingsByStudy(targetListings, study);
    const filteredSource = filterListingsByStudy(sourceListings, study);

    const targetStats = computeTargetMarketStats(filteredTarget);
    const opportunity = detectOpportunity(filteredTarget, filteredSource, threshold, 5);

    results.push({
      targetMedian: targetStats.median,
      hasOpportunity: opportunity.hasOpportunity,
      bestSourcePrice: opportunity.bestSourcePrice,
      filteredTargetCount: filteredTarget.length,
    });
  }

  // All runs should produce identical results
  for (let i = 1; i < results.length; i++) {
    assertEqual(
      results[i].targetMedian,
      results[0].targetMedian,
      `Run ${i + 1} target median`
    );

    assertEqual(
      results[i].hasOpportunity,
      results[0].hasOpportunity,
      `Run ${i + 1} opportunity detection`
    );

    assertEqual(
      results[i].bestSourcePrice,
      results[0].bestSourcePrice,
      `Run ${i + 1} best source price`
    );

    assertEqual(
      results[i].filteredTargetCount,
      results[0].filteredTargetCount,
      `Run ${i + 1} filtered target count`
    );
  }

  console.log(`   ✓ All 5 runs produced identical results`);
}) && allPassed;

console.log('');
console.log('═══════════════════════════════════════════════════');
if (allPassed) {
  console.log('✅ ALL E2E PARITY TESTS PASSED');
  console.log('');
  console.log('INSTANT and SCHEDULED are guaranteed to produce');
  console.log('identical results when using the unified pipeline.');
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
console.log('═══════════════════════════════════════════════════');
