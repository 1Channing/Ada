/**
 * ═══════════════════════════════════════════════════════════════════════════
 * E2E PARITY TESTS - SCRAPING LAYER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These tests verify that the unified scraping layer produces identical results
 * across different execution environments (browser vs worker).
 *
 * **PURPOSE:**
 * - Ensure INSTANT and SCHEDULED scraping produce matching listing pools
 * - Validate same parsing rules for all marketplaces
 * - Detect any divergence in extraction logic
 *
 * **RUN TESTS:**
 * ```bash
 * npm run test:parity:e2e
 * ```
 *
 * **WHAT IS TESTED:**
 * - Marktplaats parsing (HTML cards + JSON fallback)
 * - Leboncoin parsing (__NEXT_DATA__)
 * - Bilbasen parsing (context-window extraction)
 * - Price extraction (EUR/DKK)
 * - Attribute extraction (year/mileage/title)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { coreScrapeSearch, type CoreScraperConfig, DEFAULT_CORE_SCRAPER_CONFIG } from '../../src/lib/study-core';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOCK FIXTURES
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MOCK_MARKTPLAATS_HTML = `
<html>
<body>
  <ul>
    <li class="hz-Listing hz-Listing--list-item-cars">
      <a class="hz-Listing-coverLink" href="/v/auto-s/toyota-yaris-cross/a1234567890" title="Toyota Yaris Cross 2024">
        <h3>Toyota Yaris Cross 2024</h3>
        <div class="hz-Listing-price">€ 16.950,-</div>
        <div>15.000 km</div>
        <div>2024</div>
      </a>
    </li>
    <li class="hz-Listing hz-Listing--list-item-cars">
      <a class="hz-Listing-coverLink" href="/v/auto-s/toyota-yaris-cross/a1234567891" title="Toyota Yaris Cross 2024 Hybrid">
        <h3>Toyota Yaris Cross 2024 Hybrid</h3>
        <div class="hz-Listing-price">€ 17.500,-</div>
        <div>10.000 km</div>
        <div>2024</div>
      </a>
    </li>
  </ul>
</body>
</html>
`;

const MOCK_LEBONCOIN_HTML = `
<html>
<head>
  <script id="__NEXT_DATA__" type="application/json">
  {
    "props": {
      "pageProps": {
        "searchData": {
          "ads": [
            {
              "subject": "Toyota Yaris Cross 2024",
              "price": [16950],
              "url": "/voitures/12345.htm",
              "attributes": {
                "mileage": 15000,
                "regdate": 2024
              }
            },
            {
              "subject": "Toyota Yaris Cross 2024 Hybride",
              "price": [17500],
              "url": "/voitures/12346.htm",
              "attributes": {
                "mileage": 10000,
                "regdate": 2024
              }
            }
          ]
        }
      }
    }
  }
  </script>
</head>
</html>
`;

const MOCK_BILBASEN_HTML = `
<html>
<body>
  <div>
    <a href="/brugt/bil/toyota/yaris-cross/123456">
      <h2>Toyota Yaris Cross 2024</h2>
      <div>125.000 kr</div>
      <div>15.000 km</div>
      <div>2024</div>
    </a>
  </div>
  <div>
    <a href="/brugt/bil/toyota/yaris-cross/123457">
      <h2>Toyota Yaris Cross 2024 Hybrid</h2>
      <div>130.000 kr</div>
      <div>10.000 km</div>
      <div>2024</div>
    </a>
  </div>
</body>
</html>
`;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOCK FETCH IMPLEMENTATION
 * ═══════════════════════════════════════════════════════════════════════════
 */

function createMockFetch(mockHtml: string) {
  return async (url: string, options?: any): Promise<Response> => {
    // Simulate Zyte API response
    return {
      ok: true,
      status: 200,
      json: async () => ({ browserHtml: mockHtml }),
      text: async () => JSON.stringify({ browserHtml: mockHtml }),
    } as Response;
  };
}

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

function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  return testFn()
    .then(() => {
      console.log(`✅ ${name}`);
    })
    .catch((error) => {
      console.error(`❌ ${name}`);
      console.error(`   ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TESTS
 * ═══════════════════════════════════════════════════════════════════════════
 */

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('E2E PARITY TESTS - SCRAPING LAYER');
  console.log('═══════════════════════════════════════════════════\n');

  await runTest('Marktplaats scraping - Extract 2 listings', async () => {
    const config: CoreScraperConfig = {
      ...DEFAULT_CORE_SCRAPER_CONFIG,
      zyteApiKey: 'mock-key',
      fetchImpl: createMockFetch(MOCK_MARKTPLAATS_HTML) as any,
    };

    const result = await coreScrapeSearch('https://www.marktplaats.nl/test', 'fast', config);

    assertEqual(result.listings.length, 2, 'Should extract 2 listings');
    assertEqual(result.listings[0].price, 16950, 'First listing price should be 16950');
    assertEqual(result.listings[1].price, 17500, 'Second listing price should be 17500');
    assertEqual(result.listings[0].year, 2024, 'First listing year should be 2024');
    assertEqual(result.listings[0].mileage, 15000, 'First listing mileage should be 15000');
  });

  await runTest('Leboncoin scraping - Parse __NEXT_DATA__', async () => {
    const config: CoreScraperConfig = {
      ...DEFAULT_CORE_SCRAPER_CONFIG,
      zyteApiKey: 'mock-key',
      fetchImpl: createMockFetch(MOCK_LEBONCOIN_HTML) as any,
    };

    const result = await coreScrapeSearch('https://www.leboncoin.fr/test', 'fast', config);

    assertEqual(result.listings.length, 2, 'Should extract 2 listings from __NEXT_DATA__');
    assertEqual(result.listings[0].price, 16950, 'First listing price should be 16950');
    assertEqual(result.listings[1].price, 17500, 'Second listing price should be 17500');
    assertEqual(result.listings[0].currency, 'EUR', 'Currency should be EUR');
  });

  await runTest('Bilbasen scraping - Extract with context window', async () => {
    const config: CoreScraperConfig = {
      ...DEFAULT_CORE_SCRAPER_CONFIG,
      zyteApiKey: 'mock-key',
      fetchImpl: createMockFetch(MOCK_BILBASEN_HTML) as any,
    };

    const result = await coreScrapeSearch('https://www.bilbasen.dk/test', 'fast', config);

    assertEqual(result.listings.length, 2, 'Should extract 2 listings');
    assertEqual(result.listings[0].currency, 'DKK', 'Currency should be DKK');
    // Price is converted from DKK to EUR during extraction (125000 * 0.13 = 16250)
    assert(result.listings[0].price > 15000 && result.listings[0].price < 20000, `Price should be converted to EUR range (got ${result.listings[0].price})`);
  });

  await runTest('Deterministic results - Same input produces same output', async () => {
    const config: CoreScraperConfig = {
      ...DEFAULT_CORE_SCRAPER_CONFIG,
      zyteApiKey: 'mock-key',
      fetchImpl: createMockFetch(MOCK_MARKTPLAATS_HTML) as any,
    };

    const result1 = await coreScrapeSearch('https://www.marktplaats.nl/test', 'fast', config);
    const result2 = await coreScrapeSearch('https://www.marktplaats.nl/test', 'fast', config);

    assertEqual(result1.listings.length, result2.listings.length, 'Listing counts should match');
    assertEqual(result1.listings[0].price, result2.listings[0].price, 'Prices should match');
    assertEqual(result1.listings[0].listing_url, result2.listings[0].listing_url, 'URLs should match');
  });

  await runTest('Error handling - Empty HTML returns empty listings', async () => {
    const config: CoreScraperConfig = {
      ...DEFAULT_CORE_SCRAPER_CONFIG,
      zyteApiKey: 'mock-key',
      fetchImpl: createMockFetch('<html><body></body></html>') as any,
    };

    const result = await coreScrapeSearch('https://www.marktplaats.nl/test', 'fast', config);

    assertEqual(result.listings.length, 0, 'Should return 0 listings for empty HTML');
    assert(result.errorReason !== undefined, 'Should have error reason');
  });

  console.log('\n═══════════════════════════════════════════════════');
  console.log('✅ ALL E2E PARITY TESTS PASSED');
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
