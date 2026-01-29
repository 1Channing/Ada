/**
 * Playwright script to capture the EXACT Marktplaats API request
 * with filters applied (year, mileage, HP, sort by price).
 *
 * This script intercepts ALL XHR/fetch requests and identifies the one
 * that returns the listings JSON by structure.
 */

import { chromium } from 'playwright';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  response?: any;
}

async function captureMarktplaatsRequest() {
  console.log('🚀 Starting Marktplaats API capture...\n');

  const browser = await chromium.launch({
    headless: true, // Run in headless mode for server environment
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  const capturedRequests: CapturedRequest[] = [];

  // Intercept ALL requests
  page.on('request', request => {
    const url = request.url();
    const method = request.method();

    // Only capture JSON requests
    if (method === 'GET' || method === 'POST' || method === 'PUT') {
      const headers = request.headers();
      const postData = request.postData();

      capturedRequests.push({
        url,
        method,
        headers,
        postData
      });
    }
  });

  // Capture responses
  page.on('response', async response => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';

    // Only capture JSON responses
    if (contentType.includes('application/json')) {
      try {
        const body = await response.json();

        // Find the matching request
        const matchingRequest = capturedRequests.find(req => req.url === url && !req.response);
        if (matchingRequest) {
          matchingRequest.response = body;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  });

  // Navigate to Marktplaats with filters
  // Filters: Volkswagen Tiguan, eHybrid variant (f:10882), max 70000km, from 2020, sorted by price ascending
  const testUrl = 'https://www.marktplaats.nl/l/auto-s/#q:volkswagen+tiguan|f:10882|mileageTo:70001|constructionYearFrom:2020|sortBy:PRICE|sortOrder:INCREASING';

  console.log('📍 Navigating to:', testUrl);
  await page.goto(testUrl);

  // Wait for page to load (don't wait for networkidle as Marktplaats has continuous tracking)
  console.log('⏳ Waiting for page to load...');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000); // Wait for listings to load

  console.log('\n✅ Captured', capturedRequests.length, 'requests\n');

  // Identify the listings response by structure
  console.log('🔍 Analyzing responses for listings data...\n');

  let listingsRequest: CapturedRequest | undefined;

  for (const req of capturedRequests) {
    if (!req.response) continue;

    const resp = req.response;

    // Check if response has listings structure
    // Common patterns: listings[], items[], results[] with price/title/attributes
    const hasListings =
      (Array.isArray(resp.listings) && resp.listings.length > 0) ||
      (Array.isArray(resp.items) && resp.items.length > 0) ||
      (Array.isArray(resp.results) && resp.results.length > 0) ||
      (resp.data && Array.isArray(resp.data.listings)) ||
      (resp.data && Array.isArray(resp.data.items));

    if (hasListings) {
      // Check for price/title/attributes structure
      const items = resp.listings || resp.items || resp.results || resp.data?.listings || resp.data?.items || [];

      if (items.length > 0) {
        const firstItem = items[0];
        const hasPriceInfo = firstItem.priceInfo || firstItem.price || firstItem.prijsGegevens;
        const hasTitle = firstItem.title || firstItem.name || firstItem.description;
        const hasAttributes = firstItem.attributes || firstItem.specs || firstItem.kenmerken;

        if (hasPriceInfo || hasTitle || hasAttributes) {
          listingsRequest = req;
          console.log('✨ FOUND LISTINGS REQUEST!');
          console.log('📊 Response has', items.length, 'items');
          break;
        }
      }
    }
  }

  if (!listingsRequest) {
    console.error('❌ Could not find listings request!');
    console.log('\n📋 All captured requests:');
    capturedRequests.forEach((req, i) => {
      console.log(`\n${i + 1}. ${req.method} ${req.url}`);
      if (req.response) {
        console.log('   Response keys:', Object.keys(req.response).join(', '));
      }
    });
    await browser.close();
    return;
  }

  // Output the captured request details
  console.log('\n' + '='.repeat(80));
  console.log('🎯 CAPTURED MARKTPLAATS LISTINGS REQUEST');
  console.log('='.repeat(80));

  console.log('\n📍 Endpoint:');
  console.log('  ', listingsRequest.url);

  console.log('\n🔧 Method:');
  console.log('  ', listingsRequest.method);

  console.log('\n📋 Headers:');
  const relevantHeaders = ['accept', 'content-type', 'user-agent', 'referer', 'origin', 'authorization'];
  relevantHeaders.forEach(header => {
    if (listingsRequest.headers[header]) {
      console.log(`   ${header}: ${listingsRequest.headers[header]}`);
    }
  });

  if (listingsRequest.postData) {
    console.log('\n📦 POST Body:');
    console.log('  ', listingsRequest.postData);
  }

  // Show sample of response
  console.log('\n📊 Sample Response Structure:');
  const resp = listingsRequest.response;
  const items = resp.listings || resp.items || resp.results || resp.data?.listings || resp.data?.items || [];

  console.log('   Total items:', items.length);

  if (items.length > 0) {
    console.log('\n   First 3 items:');
    items.slice(0, 3).forEach((item: any, idx: number) => {
      const title = item.title || item.name || item.description || 'No title';
      const price = item.priceInfo?.priceCents
        ? `€${(item.priceInfo.priceCents / 100).toFixed(0)}`
        : item.price || 'No price';
      const year = item.attributes?.find((a: any) => a.key === 'year' || a.key === 'constructionYear')?.value || 'N/A';
      const mileage = item.attributes?.find((a: any) => a.key === 'mileage' || a.key === 'kilometerstand')?.value || 'N/A';

      console.log(`\n   ${idx + 1}. ${title}`);
      console.log(`      Price: ${price}`);
      console.log(`      Year: ${year}`);
      console.log(`      Mileage: ${mileage}`);
    });
  }

  // Generate minimal reproducible fetch example
  console.log('\n' + '='.repeat(80));
  console.log('🔄 MINIMAL REPRODUCIBLE FETCH');
  console.log('='.repeat(80));

  const fetchCode = generateFetchCode(listingsRequest);
  console.log('\n' + fetchCode);

  console.log('\n' + '='.repeat(80));

  // Save full details to file
  const fs = await import('fs');
  const output = {
    capturedAt: new Date().toISOString(),
    testUrl,
    request: {
      url: listingsRequest.url,
      method: listingsRequest.method,
      headers: listingsRequest.headers,
      postData: listingsRequest.postData
    },
    sampleResponse: {
      totalItems: items.length,
      firstThreeItems: items.slice(0, 3)
    }
  };

  fs.writeFileSync(
    '/tmp/cc-agent/60416899/project/test/marktplaats-api-capture.json',
    JSON.stringify(output, null, 2)
  );

  console.log('\n💾 Full details saved to: test/marktplaats-api-capture.json');

  await browser.close();
}

function generateFetchCode(req: CapturedRequest): string {
  const url = req.url;
  const method = req.method;

  let code = `// Minimal reproducible fetch for Marktplaats listings\n`;
  code += `const response = await fetch('${url}', {\n`;
  code += `  method: '${method}',\n`;
  code += `  headers: {\n`;

  const relevantHeaders = ['accept', 'content-type', 'user-agent', 'referer'];
  relevantHeaders.forEach(header => {
    if (req.headers[header]) {
      code += `    '${header}': '${req.headers[header]}',\n`;
    }
  });

  code += `  }`;

  if (req.postData) {
    code += `,\n  body: ${JSON.stringify(req.postData)}`;
  }

  code += `\n});\n\n`;
  code += `const data = await response.json();\n`;
  code += `console.log('Total listings:', data.listings?.length || data.items?.length);`;

  return code;
}

// Run the capture
captureMarktplaatsRequest().catch(console.error);
