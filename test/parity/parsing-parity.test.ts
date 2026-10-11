/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PARSING PARITY TESTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests that pure parsers produce deterministic, stable results.
 * Uses HTML fixtures to ensure parser behavior is consistent.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { coreParseSearchPage } from '../../src/lib/study-core/index';

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
console.log('PARSING PARITY TESTS - PURE PARSERS');
console.log('═══════════════════════════════════════════════════');
console.log('');

let allPassed = true;

// Test 1: Marktplaats parsing
allPassed = await runTest('Marktplaats - Parse 2 listings from HTML', () => {
  const html = loadFixture('marktplaats-page1.html');
  const listings = coreParseSearchPage(html, 'https://www.marktplaats.nl/l/auto-s/q/toyota+yaris+cross/');

  assertEqual(listings.length, 2, 'Should extract 2 listings');
  assertEqual(listings[0].currency, 'EUR', 'Currency should be EUR');
  assert(listings[0].price === 16950, `First listing price should be 16950, got ${listings[0].price}`);
  assert(listings[0].title.includes('Toyota'), 'Title should include Toyota');
  assert(listings[0].listing_url.includes('marktplaats.nl'), 'URL should be normalized');
  assert(listings[0].year === 2024, 'Year should be 2024');
  assert(listings[0].mileage === 5000, 'Mileage should be 5000');
}) && allPassed;

// Test 2: Leboncoin parsing
allPassed = await runTest('Leboncoin - Parse 2 listings from __NEXT_DATA__', () => {
  const html = loadFixture('leboncoin-page1.html');
  const listings = coreParseSearchPage(html, 'https://www.leboncoin.fr/recherche?category=2&text=toyota%20yaris%20cross');

  assertEqual(listings.length, 2, 'Should extract 2 listings');
  assertEqual(listings[0].currency, 'EUR', 'Currency should be EUR');
  assert(listings[0].price === 16950, `First listing price should be 16950, got ${listings[0].price}`);
  assert(listings[0].title.includes('Toyota'), 'Title should include Toyota');
  assert(listings[0].listing_url.includes('leboncoin.fr'), 'URL should be normalized');
  assert(listings[0].year === 2024, 'Year should be 2024');
  assert(listings[0].mileage === 5000, 'Mileage should be 5000');
}) && allPassed;

// Test 3: Bilbasen parsing
allPassed = await runTest('Bilbasen - Parse 2 listings with context extraction', () => {
  const html = loadFixture('bilbasen-page1.html');
  const listings = coreParseSearchPage(html, 'https://www.bilbasen.dk/brugt/bil?fuel=0&yearfrom=2024&make=toyota&model=yaris%20cross');

  assertEqual(listings.length, 2, 'Should extract 2 listings');
  // DKK prices are converted to EUR at extraction and stored AS EUR (so nothing
  // downstream re-converts). 125000 DKK * 0.134 = 16750 EUR.
  assertEqual(listings[0].currency, 'EUR', 'Currency should be EUR (price already converted)');
  assert(listings[0].price >= 16000 && listings[0].price <= 17500, `First listing price should be ~16750 EUR, got ${listings[0].price}`);
  assert(listings[0].title.includes('Toyota'), 'Title should include Toyota');
  assert(listings[0].listing_url.includes('bilbasen.dk'), 'URL should be normalized');
  assert(listings[0].year === 2024, 'Year should be 2024');
  assert(listings[0].mileage === 15000, 'Mileage should be 15000');
}) && allPassed;

// Test 4: Gaspedaal — adaptateur de production (JSON-LD + flux Next), fixture au format réel.
allPassed = await runTest('Gaspedaal - Parse JSON-LD listings with details', () => {
  const html = loadFixture('gaspedaal-page1.html');
  const listings = coreParseSearchPage(html, 'https://www.gaspedaal.nl/toyota/yaris-cross');

  // 2 voitures à prix réel ; « prix sur demande » (0 €) et la bannière lease (pas une Car) sont écartées.
  assertEqual(listings.length, 2, 'Should keep only the 2 priced cars');
  const [a, b] = listings;
  assertEqual(a.price, 26950, 'Price from JSON-LD offers');
  assertEqual(a.year, 2023, 'Year from productionDate');
  assertEqual(a.mileage, 18450, 'Mileage from mileageFromOdometer');
  assertEqual(a.trim, '1.5 Hybrid Dynamic', 'Trim from Next flux (uitvoering)');
  assertEqual(a.powerDin, 116, 'Power: 85 kW → 116 ch');
  assertEqual(a.listing_url, 'https://api.gaspedaal.nl/redirect/vehicle/203151550', 'Dealer portal preferred');
  assert(Boolean(a.publishedAt), 'Published date matched from the card (id="oc…")');
  assertEqual(b.listing_url, 'https://api.gaspedaal.nl/redirect/vehicle/203151777', 'Falls back to first portal');
  assertEqual(b.price, 24450, 'Second car price');
}) && allPassed;

// Test 5: Deterministic parsing - same input produces same output
allPassed = await runTest('Determinism - Same HTML produces identical results', () => {
  const html = loadFixture('marktplaats-page1.html');
  const url = 'https://www.marktplaats.nl/l/auto-s/q/toyota+yaris+cross/';

  const results1 = coreParseSearchPage(html, url);
  const results2 = coreParseSearchPage(html, url);

  assertEqual(results1.length, results2.length, 'Length should match');

  for (let i = 0; i < results1.length; i++) {
    assertEqual(results1[i].listing_url, results2[i].listing_url, `Listing ${i} URL should match`);
    assertEqual(results1[i].price, results2[i].price, `Listing ${i} price should match`);
    assertEqual(results1[i].title, results2[i].title, `Listing ${i} title should match`);
    assertEqual(results1[i].year, results2[i].year, `Listing ${i} year should match`);
    assertEqual(results1[i].mileage, results2[i].mileage, `Listing ${i} mileage should match`);
  }
}) && allPassed;

// Test 6: Empty HTML returns empty listings
allPassed = await runTest('Empty HTML - Returns empty array', () => {
  const html = '<html><body></body></html>';
  const listings = coreParseSearchPage(html, 'https://www.marktplaats.nl/test');

  assertEqual(listings.length, 0, 'Should return empty array for empty HTML');
}) && allPassed;

// Test 7: Parser selection - correct parser for each domain
allPassed = await runTest('Parser selection - Routes to correct parser by hostname', async () => {
  const { selectParserByHostname } = await import('../../src/lib/study-core/index');

  assertEqual(selectParserByHostname('https://www.marktplaats.nl/test'), 'MARKTPLAATS', 'Should select MARKTPLAATS');
  assertEqual(selectParserByHostname('https://www.leboncoin.fr/test'), 'LEBONCOIN', 'Should select LEBONCOIN');
  assertEqual(selectParserByHostname('https://www.gaspedaal.nl/test'), 'GASPEDAAL', 'Should select GASPEDAAL');
  assertEqual(selectParserByHostname('https://www.bilbasen.dk/test'), 'BILBASEN', 'Should select BILBASEN');
  assertEqual(selectParserByHostname('https://www.unknown.com/test'), 'GENERIC', 'Should select GENERIC for unknown');
}) && allPassed;

console.log('');
console.log('═══════════════════════════════════════════════════');
if (allPassed) {
  console.log('✅ ALL PARSING PARITY TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
console.log('═══════════════════════════════════════════════════');
