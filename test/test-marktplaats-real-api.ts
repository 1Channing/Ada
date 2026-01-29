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

// Test URL: Volkswagen Tiguan eHybrid (f:10882), max 70000km, from 2020, sorted by price
const TEST_URL = 'https://www.marktplaats.nl/l/auto-s/#q:volkswagen+tiguan|f:10882|mileageTo:70001|constructionYearFrom:2020|sortBy:PRICE|sortOrder:INCREASING';

interface MarktplaatsFilters {
  query?: string;
  categoryId?: string;
  mileageTo?: number;
  constructionYearFrom?: number;
  sortBy?: string;
  sortOrder?: string;
  [key: string]: string | number | undefined;
}

function parseMarktplaatsHash(url: string): MarktplaatsFilters {
  const filters: MarktplaatsFilters = {};

  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) return filters;

  const hash = url.substring(hashIndex + 1);
  const parts = hash.split('|');

  for (const part of parts) {
    const colonIndex = part.indexOf(':');
    if (colonIndex === -1) continue;

    const key = part.substring(0, colonIndex);
    const value = part.substring(colonIndex + 1);

    switch (key) {
      case 'q':
        filters.query = value.replace(/\+/g, ' ');
        break;
      case 'f':
        filters.categoryId = value;
        break;
      case 'mileageTo':
        filters.mileageTo = parseInt(value, 10);
        break;
      case 'constructionYearFrom':
        filters.constructionYearFrom = parseInt(value, 10);
        break;
      case 'sortBy':
        filters.sortBy = value;
        break;
      case 'sortOrder':
        filters.sortOrder = value;
        break;
      default:
        filters[key] = value;
    }
  }

  return filters;
}

function buildMarktplaatsApiUrl(filters: MarktplaatsFilters, page: number): string {
  const params = new URLSearchParams();

  if (filters.query) {
    params.set('query', filters.query);
    params.set('searchInTitleAndDescription', 'true');
  }

  if (filters.categoryId) {
    params.set('l1CategoryId', '91');
    params.append('attributesById[]', filters.categoryId);
  }

  if (filters.mileageTo) {
    params.append('attributeRanges[]', `mileage:null:${filters.mileageTo}`);
  }

  if (filters.constructionYearFrom) {
    params.append('attributeRanges[]', `constructionYear:${filters.constructionYearFrom}:null`);
  }

  if (filters.sortBy) {
    params.set('sortBy', filters.sortBy);
    if (filters.sortOrder) {
      params.set('sortOrder', filters.sortOrder);
    }
  }

  params.set('offset', String((page - 1) * 30));
  params.set('limit', '30');
  params.set('viewOptions', 'list-view');

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
  console.log('🧪 MARKTPLAATS REAL API TEST');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log();
  console.log('Test URL:', TEST_URL);
  console.log();

  const filters = parseMarktplaatsHash(TEST_URL);
  console.log('📋 Parsed Filters:');
  console.log('   Query:', filters.query);
  console.log('   Category/Variant ID:', filters.categoryId);
  console.log('   Max Mileage:', filters.mileageTo);
  console.log('   Min Year:', filters.constructionYearFrom);
  console.log('   Sort By:', filters.sortBy);
  console.log('   Sort Order:', filters.sortOrder);
  console.log();

  const apiUrl = buildMarktplaatsApiUrl(filters, 1);
  console.log('🔗 Resolved API URL:');
  console.log('   ', apiUrl);
  console.log();

  console.log('📡 Fetching from API...');
  const response = await fetch(apiUrl, {
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

    console.log(`${i + 1}. ${item.title}`);
    console.log(`   Price: €${price}`);
    console.log(`   Year: ${year || 'N/A'}`);
    console.log(`   Mileage: ${mileage || 'N/A'} km`);
    console.log(`   HP: ${hp || 'N/A'}`);
    console.log();
  }

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('✅ VALIDATION CHECKS');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log();

  const yearChecks = top6.map((item, idx) => {
    const year = parseInt(item.attributes?.find((a: any) => a.key === 'constructionYear')?.value || '0', 10);
    const pass = year >= 2020;
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

  console.log('Year Checks (must be ≥ 2020):');
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
