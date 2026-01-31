/**
 * Test script to validate the corrected Marktplaats API implementation
 *
 * This script tests:
 * 1. Resolved request URL with correct filters
 * 2. Top 6 titles and prices
 * 3. Year/mileage/HP validation
 * 4. Leasing ad exclusion
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Test URL: NEW CAPTURE - Multiple attributesById, exact year match, subcategory
const TEST_URL = 'https://www.marktplaats.nl/lrp/api/search?attributeRanges[]=constructionYear%3A2025%3A2025&attributeRanges[]=mileage%3Anull%3A70001&attributesById[]=10882&attributesById[]=13882&attributesByKey[]=offeredSince%3AAltijd&l1CategoryId=91&l2CategoryId=155&limit=30&offset=0&sortBy=PRICE&sortOrder=INCREASING&viewOptions=list-view';

interface MarktplaatsFilters {
  query?: string;
  l1CategoryId?: string;
  l2CategoryId?: string;
  attributesById?: string[];
  attributesByKey?: string[];
  mileageTo?: number;
  mileageFrom?: number;
  constructionYearFrom?: number;
  constructionYearTo?: number;
  constructionYearExact?: number;
  sortBy?: string;
  sortOrder?: string;
  [key: string]: string | number | string[] | undefined;
}

function parseMarktplaatsApiUrl(url: string): MarktplaatsFilters {
  const filters: MarktplaatsFilters = {};

  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;

    // Parse l1CategoryId
    if (params.has('l1CategoryId')) {
      filters.l1CategoryId = params.get('l1CategoryId')!;
    }

    // Parse l2CategoryId
    if (params.has('l2CategoryId')) {
      filters.l2CategoryId = params.get('l2CategoryId')!;
    }

    // Parse attributesById[] (can be multiple)
    const attributesById = params.getAll('attributesById[]');
    if (attributesById.length > 0) {
      filters.attributesById = attributesById;
    }

    // Parse attributesByKey[] (can be multiple)
    const attributesByKey = params.getAll('attributesByKey[]');
    if (attributesByKey.length > 0) {
      filters.attributesByKey = attributesByKey;
    }

    // Parse attributeRanges[] (can be multiple)
    const ranges = params.getAll('attributeRanges[]');
    for (const range of ranges) {
      const [key, min, max] = range.split(':');

      if (key === 'mileage') {
        if (min !== 'null') filters.mileageFrom = parseInt(min, 10);
        if (max !== 'null') filters.mileageTo = parseInt(max, 10);
      } else if (key === 'constructionYear') {
        if (min !== 'null') filters.constructionYearFrom = parseInt(min, 10);
        if (max !== 'null') filters.constructionYearTo = parseInt(max, 10);
        // Check if exact match (min === max)
        if (min === max && min !== 'null') {
          filters.constructionYearExact = parseInt(min, 10);
        }
      }
    }

    // Parse sorting
    if (params.has('sortBy')) {
      filters.sortBy = params.get('sortBy')!;
    }
    if (params.has('sortOrder')) {
      filters.sortOrder = params.get('sortOrder')!;
    }

  } catch (error) {
    console.error('Failed to parse URL:', error);
  }

  return filters;
}

function buildMarktplaatsApiUrl(filters: MarktplaatsFilters, page: number): string {
  const params = new URLSearchParams();

  // attributeRanges[] (ORDER MATTERS - add first like in capture)
  if (filters.constructionYearExact !== undefined) {
    // Exact year match: constructionYear:2025:2025
    params.append('attributeRanges[]', `constructionYear:${filters.constructionYearExact}:${filters.constructionYearExact}`);
  } else {
    // Range: constructionYear:min:max
    if (filters.constructionYearFrom !== undefined || filters.constructionYearTo !== undefined) {
      const min = filters.constructionYearFrom !== undefined ? filters.constructionYearFrom : 'null';
      const max = filters.constructionYearTo !== undefined ? filters.constructionYearTo : 'null';
      params.append('attributeRanges[]', `constructionYear:${min}:${max}`);
    }
  }

  if (filters.mileageFrom !== undefined || filters.mileageTo !== undefined) {
    const min = filters.mileageFrom !== undefined ? filters.mileageFrom : 'null';
    const max = filters.mileageTo !== undefined ? filters.mileageTo : 'null';
    params.append('attributeRanges[]', `mileage:${min}:${max}`);
  }

  // attributesById[] (can be multiple)
  if (filters.attributesById && filters.attributesById.length > 0) {
    for (const id of filters.attributesById) {
      params.append('attributesById[]', id);
    }
  }

  // attributesByKey[] (can be multiple)
  if (filters.attributesByKey && filters.attributesByKey.length > 0) {
    for (const key of filters.attributesByKey) {
      params.append('attributesByKey[]', key);
    }
  }

  // Category IDs
  if (filters.l1CategoryId) {
    params.append('l1CategoryId', filters.l1CategoryId);
  }
  if (filters.l2CategoryId) {
    params.append('l2CategoryId', filters.l2CategoryId);
  }

  // Pagination
  params.append('limit', '30');
  params.append('offset', String((page - 1) * 30));

  // Sorting
  if (filters.sortBy) {
    params.append('sortBy', filters.sortBy);
  }
  if (filters.sortOrder) {
    params.append('sortOrder', filters.sortOrder);
  }

  // Technical
  params.append('viewOptions', 'list-view');

  return `https://www.marktplaats.nl/lrp/api/search?${params.toString()}`;
}

function isLeaseAd(item: any): boolean {
  if (item.priceInfo?.priceType === 'PER_MONTH') {
    return true;
  }

  const title = (item.title || '').toLowerCase();
  const leasePatterns = [
    'lease',
    'leas',
    'p/mnd',
    'per maand',
    'zakelijke lease',
    'private lease',
    '/maand',
    'per month',
    'operational lease'
  ];

  return leasePatterns.some(pattern => title.includes(pattern));
}

async function testMarktplaatsApi() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('🧪 MARKTPLAATS REAL API TEST - NEW CAPTURE (2026-01-31)');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log();
  console.log('Captured API URL:', TEST_URL);
  console.log();

  const filters = parseMarktplaatsApiUrl(TEST_URL);
  console.log('📋 Parsed Filters:');
  console.log('   l1CategoryId:', filters.l1CategoryId);
  console.log('   l2CategoryId:', filters.l2CategoryId);
  console.log('   attributesById[]:', filters.attributesById);
  console.log('   attributesByKey[]:', filters.attributesByKey);
  console.log('   Construction Year (exact):', filters.constructionYearExact);
  console.log('   Construction Year (from-to):', filters.constructionYearFrom, '-', filters.constructionYearTo);
  console.log('   Mileage (from-to):', filters.mileageFrom, '-', filters.mileageTo);
  console.log('   Sort By:', filters.sortBy);
  console.log('   Sort Order:', filters.sortOrder);
  console.log();

  const rebuiltUrl = buildMarktplaatsApiUrl(filters, 1);
  console.log('🔗 Rebuilt API URL (1:1 mirror):');
  console.log('   ', rebuiltUrl);
  console.log();

  console.log('🔍 URL Parity Check:');
  const originalParams = new URL(TEST_URL).searchParams;
  const rebuiltParams = new URL(rebuiltUrl).searchParams;

  const allKeys = new Set([...originalParams.keys(), ...rebuiltParams.keys()]);
  let allMatch = true;

  for (const key of allKeys) {
    const origValues = originalParams.getAll(key).sort();
    const rebValues = rebuiltParams.getAll(key).sort();
    const match = JSON.stringify(origValues) === JSON.stringify(rebValues);

    if (!match) {
      console.log(`   ❌ ${key}: MISMATCH`);
      console.log(`      Original: [${origValues.join(', ')}]`);
      console.log(`      Rebuilt:  [${rebValues.join(', ')}]`);
      allMatch = false;
    } else {
      console.log(`   ✅ ${key}: [${origValues.join(', ')}]`);
    }
  }
  console.log();

  if (!allMatch) {
    console.log('❌ URL PARITY FAILED - Stopping test');
    return;
  }

  console.log('✅ URL PARITY CHECK PASSED - Proceeding with API fetch');
  console.log();

  console.log('📡 Fetching from API...');
  const response = await fetch(TEST_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.marktplaats.nl/l/auto-s/',
    },
  });

  if (!response.ok) {
    console.error('❌ HTTP Error:', response.status, response.statusText);
    return;
  }

  const data = await response.json();
  const listings = data?.listings || [];

  console.log(`✅ Received ${listings.length} items from API`);
  console.log();

  const validListings = [];
  let excludedCount = 0;

  for (const item of listings) {
    if (isLeaseAd(item)) {
      excludedCount++;
      console.log(`🚫 EXCLUDED lease ad: "${item.title}"`);
      continue;
    }
    validListings.push(item);
  }

  console.log();
  console.log(`📊 Results: ${validListings.length} valid listings, ${excludedCount} lease ads excluded`);
  console.log();

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('🏆 TOP 6 LISTINGS (NON-LEASING, PRICE ASCENDING)');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log();

  const top6 = validListings.slice(0, 6);

  for (let i = 0; i < top6.length; i++) {
    const item = top6[i];
    const price = item.priceInfo?.priceCents ? (item.priceInfo.priceCents / 100) : null;

    const attributes = item.attributes || [];
    const getAttr = (key: string) => {
      const attr = attributes.find((a: any) => a.key === key);
      return attr?.value;
    };

    const extAttributes = item.extendedAttributes || [];
    const getExtAttr = (key: string) => {
      const attr = extAttributes.find((a: any) => a.key === key);
      return attr?.value;
    };

    const year = getAttr('constructionYear');
    const mileage = getAttr('mileage');
    const hp = getExtAttr('engineHorsepower');

    const listingUrl = item.vipUrl ? `https://www.marktplaats.nl${item.vipUrl}` : 'N/A';

    console.log(`${i + 1}. ${item.title}`);
    console.log(`   Price: €${price?.toLocaleString('en-US')}`);
    console.log(`   Year: ${year || 'N/A'}`);
    console.log(`   Mileage: ${mileage || 'N/A'} km`);
    console.log(`   HP: ${hp || 'N/A'}`);
    console.log(`   URL: ${listingUrl}`);
    console.log();
  }

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('✅ VALIDATION CHECKS (EXACT YEAR = 2025, MILEAGE ≤ 70001)');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log();

  const yearChecks = top6.map((item, idx) => {
    const year = parseInt(item.attributes?.find((a: any) => a.key === 'constructionYear')?.value || '0', 10);
    const pass = year === 2025;
    return { idx: idx + 1, year, pass };
  });

  const mileageChecks = top6.map((item, idx) => {
    const mileage = parseInt(item.attributes?.find((a: any) => a.key === 'mileage')?.value || '999999', 10);
    const pass = mileage <= 70001;
    return { idx: idx + 1, mileage, pass };
  });

  const hpChecks = top6.map((item, idx) => {
    const hp = item.extendedAttributes?.find((a: any) => a.key === 'engineHorsepower')?.value || 'N/A';
    return { idx: idx + 1, hp };
  });

  console.log('Year Checks (must be EXACTLY 2025):');
  yearChecks.forEach(check => {
    const status = check.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`   ${check.idx}. ${check.year} → ${status}`);
  });
  console.log();

  console.log('Mileage Checks (must be ≤ 70001 km):');
  mileageChecks.forEach(check => {
    const status = check.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`   ${check.idx}. ${check.mileage} km → ${status}`);
  });
  console.log();

  console.log('HP Extraction:');
  hpChecks.forEach(check => {
    console.log(`   ${check.idx}. ${check.hp}`);
  });
  console.log();

  const allYearsPass = yearChecks.every(c => c.pass);
  const allMileagePass = mileageChecks.every(c => c.pass);

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('📈 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log();
  console.log(`   Total API items: ${listings.length}`);
  console.log(`   Lease ads excluded: ${excludedCount}`);
  console.log(`   Valid listings: ${validListings.length}`);
  console.log();
  console.log(`   Year validation: ${allYearsPass ? '✅ ALL PASS' : '❌ SOME FAILED'}`);
  console.log(`   Mileage validation: ${allMileagePass ? '✅ ALL PASS' : '❌ SOME FAILED'}`);
  console.log();
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

testMarktplaatsApi().catch(console.error);
