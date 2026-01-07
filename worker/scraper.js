/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WORKER SCRAPER - NODE.JS ENVIRONMENT (MIGRATING TO STUDY-CORE)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **UNIFIED PIPELINE MIGRATION:**
 * This file is being migrated to use the shared study-core module to ensure
 * identical results with instant (browser) execution.
 *
 * **CURRENT STATUS:**
 * - ✅ Business logic functions (lines 592-845) delegate to study-core
 * - ⚠️  Scraping logic (lines 1-590) still uses local implementation
 * - ⚠️  Should be converted to TypeScript for better integration
 *
 * **BUSINESS LOGIC (UNIFIED via study-core):**
 * - toEur() - Currency conversion
 * - matchesBrandModel() - Brand/model matching
 * - shouldFilterListing() - First-pass filtering
 * - filterListingsByStudy() - Study-specific filtering
 * - computeTargetMarketStats() - Median calculation (top 6 cheapest)
 *
 * **SCRAPING LOGIC (Environment-specific):**
 * - fetchHtmlWithScraper() - Zyte API calls
 * - parseMarktplaatsListings() - JSON/HTML parsing
 * - parseLeboncoinListings() - __NEXT_DATA__ parsing
 * - parseBilbasenListings() - HTML parsing
 *
 * **TODO:**
 * - [ ] Convert to TypeScript (worker/scraper.ts)
 * - [ ] Import study-core directly instead of duplicating
 * - [ ] Use tsx or compile TS→JS for Node.js compatibility
 *
 * **FEATURE FLAG:**
 * Set USE_SHARED_CORE=true in .env to enable unified pipeline
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Import study-core business logic (when USE_SHARED_CORE=true)
// For now, keep synchronized copies below until full TypeScript migration
const USE_SHARED_CORE = process.env.USE_SHARED_CORE === 'true';

const ZYTE_API_KEY = process.env.ZYTE_API_KEY || '';
const ZYTE_ENDPOINT = 'https://api.zyte.com/v1/extract';

const FX_RATES = {
  EUR: 1,
  DKK: 0.13,
  UNKNOWN: 1,
};

const BLOCKED_KEYWORDS = [
  'captcha',
  'recaptcha',
  'hcaptcha',
  'access denied',
  'blocked',
  'bot detection',
  'unusual traffic',
  'not a robot',
  'security check',
  'verify you are human',
  'cloudflare',
];

export function toEur(price, currency) {
  return price * (FX_RATES[currency] ?? 1);
}

function detectBlockedContent(html, hasListings = false) {
  const lowerHtml = html.toLowerCase();

  for (const keyword of BLOCKED_KEYWORDS) {
    if (lowerHtml.includes(keyword)) {
      return {
        isBlocked: true,
        matchedKeyword: keyword,
        reason: 'keyword_match',
      };
    }
  }

  if (!hasListings) {
    const suspiciousPatterns = [
      'robot', 'access denied', 'blocked', 'security', 'verification'
    ];

    for (const pattern of suspiciousPatterns) {
      if (lowerHtml.includes(pattern) && html.length < 50000) {
        return {
          isBlocked: true,
          matchedKeyword: pattern,
          reason: 'no_listings_with_suspicious_content',
        };
      }
    }
  }

  return { isBlocked: false, matchedKeyword: null, reason: null };
}

function extractDiagnostics(html, marketplace, retryCount = 0, profileLevel = 1, extractionMethod = null) {
  const blockedDetection = detectBlockedContent(html);

  const htmlSnippet = html.slice(0, 800)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '[SCRIPT]')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '[STYLE]');

  const hasNextData = html.includes('id="__NEXT_DATA__"');

  return {
    marketplace,
    htmlLength: html.length,
    htmlSnippet,
    hasNextData,
    detectedBlocked: blockedDetection.isBlocked,
    matchedKeyword: blockedDetection.matchedKeyword,
    blockReason: blockedDetection.reason,
    retryCount,
    profileLevel,
    extractionMethod,
  };
}

function getZyteRequestProfile(profileLevel, url) {
  const isMarktplaats = url.includes('marktplaats.nl');

  const baseProfile = {
    url,
    browserHtml: true,
  };

  if (profileLevel === 1) {
    return baseProfile;
  }

  if (profileLevel === 2 && isMarktplaats) {
    return {
      ...baseProfile,
      geolocation: 'NL',
      javascript: true,
    };
  }

  if (profileLevel === 3 && isMarktplaats) {
    return {
      ...baseProfile,
      geolocation: 'NL',
      javascript: true,
      actions: [{
        action: 'waitForTimeout',
        timeout: 2.0,
      }],
    };
  }

  return baseProfile;
}

async function fetchHtmlWithScraper(targetUrl, profileLevel = 1) {
  if (!ZYTE_API_KEY) {
    console.error('[WORKER] Missing ZYTE_API_KEY environment variable');
    return { html: null, statusCode: null };
  }

  try {
    const authHeader = `Basic ${Buffer.from(ZYTE_API_KEY + ':').toString('base64')}`;
    const requestBody = getZyteRequestProfile(profileLevel, targetUrl);

    console.log(`[WORKER] Fetching ${targetUrl.slice(0, 100)}... (profile level ${profileLevel})`);

    const response = await fetch(ZYTE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const statusCode = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WORKER] Zyte API error: ${statusCode} - ${errorText}`);
      return { html: null, statusCode };
    }

    const result = await response.json();
    return { html: result.browserHtml || null, statusCode };
  } catch (error) {
    console.error('[WORKER] Scraper fetch error:', error);
    return { html: null, statusCode: null };
  }
}

function findListingLikeObjects(obj, path = '') {
  const results = [];

  if (!obj || typeof obj !== 'object') return results;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (item && typeof item === 'object') {
        const hasUrl = item.vipUrl || item.url || item.href || item.link || item.itemId || item.id;
        const hasTitle = item.title || item.subject || item.description || item.name;
        const hasPrice = item.priceInfo || item.price || item.priceCents || item.amount;

        if (hasUrl && hasTitle && hasPrice) {
          results.push({ item, path: `${path}[${i}]` });
        }

        results.push(...findListingLikeObjects(item, `${path}[${i}]`));
      }
    }
  } else {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        results.push(...findListingLikeObjects(obj[key], path ? `${path}.${key}` : key));
      }
    }
  }

  return results;
}

function normalizeMarktplaatsListing(item) {
  const itemId = item.itemId || item.id || item.vipUrl?.split('/').pop() || '';
  const title = item.title || item.subject || item.description || item.name || '';

  const priceInfo = item.priceInfo || item.price || {};
  let priceValue = 0;

  if (priceInfo.priceCents) {
    priceValue = priceInfo.priceCents / 100;
  } else if (typeof priceInfo === 'number') {
    priceValue = priceInfo;
  } else if (priceInfo.price) {
    priceValue = priceInfo.price;
  } else if (priceInfo.amount) {
    priceValue = priceInfo.amount;
  } else if (item.priceCents) {
    priceValue = item.priceCents / 100;
  } else if (typeof item.price === 'number') {
    priceValue = item.price;
  }

  if (!title || !priceValue || priceValue <= 0) return null;

  const attributes = item.attributes || [];
  const mileageAttr = attributes.find?.(a => a.key === 'mileage' || a.key === 'kilometer-stand') || {};
  const yearAttr = attributes.find?.(a => a.key === 'year' || a.key === 'bouwjaar') || {};

  const mileage = mileageAttr.value ? parseInt(String(mileageAttr.value).replace(/\D/g, '')) : null;
  const year = yearAttr.value ? parseInt(String(yearAttr.value).replace(/\D/g, '')) : null;

  const listingUrl = item.vipUrl || item.url || item.href || (itemId ? `https://www.marktplaats.nl/a/${itemId}` : '');

  return {
    title: title.trim(),
    price: priceValue,
    currency: 'EUR',
    mileage,
    year,
    trim: null,
    listing_url: listingUrl,
    description: item.description || '',
    price_type: 'one-off',
  };
}

function parseMarktplaatsListingsFromAllJson(html) {
  const listings = [];
  let foundMethod = null;

  const scriptPattern = /<script[^>]*>(.*?)<\/script>/gs;
  const scripts = [];
  let match;

  while ((match = scriptPattern.exec(html)) !== null) {
    scripts.push({ content: match[1], isNextData: match[0].includes('__NEXT_DATA__') });
  }

  console.log(`[WORKER] Found ${scripts.length} script tags in Marktplaats HTML`);

  for (const script of scripts) {
    if (!script.content || script.content.length < 10) continue;

    try {
      const jsonData = JSON.parse(script.content);
      const candidates = findListingLikeObjects(jsonData);

      if (candidates.length > 0) {
        console.log(`[WORKER] Found ${candidates.length} listing candidates in ${script.isNextData ? '__NEXT_DATA__' : 'other JSON'}`);

        for (const candidate of candidates) {
          const normalized = normalizeMarktplaatsListing(candidate.item);
          if (normalized) {
            listings.push(normalized);
          }
        }

        if (listings.length > 0 && !foundMethod) {
          foundMethod = script.isNextData ? 'NEXT_DATA' : 'OTHER_JSON';
        }

        if (listings.length > 0) break;
      }
    } catch (e) {
    }
  }

  if (listings.length > 0) {
    console.log(`[WORKER] Successfully parsed ${listings.length} listings from ${foundMethod}`);
    return { listings, method: foundMethod };
  }

  return { listings: [], method: null };
}

function parseMarktplaatsListingsFromNextData(html) {
  const listings = [];

  const nextDataMatch = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/.exec(html);
  if (!nextDataMatch) {
    console.log('[WORKER] No __NEXT_DATA__ found in Marktplaats HTML');
    return null;
  }

  try {
    const nextData = JSON.parse(nextDataMatch[1]);

    const searchResults = nextData?.props?.pageProps?.searchResults?.listings ||
                         nextData?.props?.pageProps?.initialState?.listings?.listings ||
                         nextData?.props?.pageProps?.listings ||
                         [];

    console.log(`[WORKER] __NEXT_DATA__ found, attempting to parse ${searchResults.length} items`);

    for (const item of searchResults) {
      if (!item) continue;

      const itemId = item.itemId || item.id || item.vipUrl?.split('/').pop();
      const title = item.title || item.description || '';

      const priceInfo = item.priceInfo || item.price || {};
      const priceValue = priceInfo.priceCents ? priceInfo.priceCents / 100 :
                        (priceInfo.price || priceInfo.amount || 0);

      if (!title || !priceValue || priceValue <= 0) continue;

      const attributes = item.attributes || {};
      const mileageAttr = attributes.find?.(a => a.key === 'mileage' || a.key === 'kilometer-stand') || {};
      const yearAttr = attributes.find?.(a => a.key === 'year' || a.key === 'bouwjaar') || {};

      const mileage = mileageAttr.value ? parseInt(String(mileageAttr.value).replace(/\D/g, '')) : null;
      const year = yearAttr.value ? parseInt(String(yearAttr.value).replace(/\D/g, '')) : null;

      const listingUrl = item.vipUrl || (itemId ? `https://www.marktplaats.nl/a/${itemId}` : '');

      listings.push({
        title: title.trim(),
        price: priceValue,
        currency: 'EUR',
        mileage,
        year,
        trim: null,
        listing_url: listingUrl,
        description: item.description || '',
        price_type: 'one-off',
      });
    }

    console.log(`[WORKER] Successfully parsed ${listings.length} listings from __NEXT_DATA__`);
  } catch (error) {
    console.error('[WORKER] Error parsing Marktplaats __NEXT_DATA__:', error.message);
    return null;
  }

  return listings;
}

function parseMarktplaatsListingsFromHtml(html) {
  const listings = [];
  console.log('[WORKER] Falling back to HTML parsing for Marktplaats');

  const listingPattern = /<article[^>]*data-item-id="(\d+)"[^>]*>([\s\S]*?)<\/article>/g;

  let match;
  while ((match = listingPattern.exec(html)) !== null) {
    const itemId = match[1];
    const articleHtml = match[2];

    const titleMatch = /<h3[^>]*>(.*?)<\/h3>/.exec(articleHtml);
    const priceMatch = /€\s*([\d.,]+)/.exec(articleHtml);
    const mileageMatch = /([\d.,]+)\s*km/.exec(articleHtml);
    const yearMatch = /(\d{4})/.exec(articleHtml);

    if (titleMatch && priceMatch) {
      const price = parseFloat(priceMatch[1].replace(/[.,]/g, ''));
      const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/[.,]/g, '')) : null;
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      listings.push({
        title: titleMatch[1].trim(),
        price,
        currency: 'EUR',
        mileage,
        year,
        trim: null,
        listing_url: `https://www.marktplaats.nl/a/${itemId}`,
        description: '',
        price_type: 'one-off',
      });
    }
  }

  console.log(`[WORKER] HTML fallback extracted ${listings.length} listings`);
  return listings;
}

function parseMarktplaatsListings(html) {
  const jsonResult = parseMarktplaatsListingsFromAllJson(html);

  if (jsonResult.listings.length > 0) {
    console.log(`[WORKER] Using extraction method: ${jsonResult.method}`);
    return { listings: jsonResult.listings, method: jsonResult.method };
  }

  console.log('[WORKER] JSON methods failed, trying HTML fallback');
  const htmlListings = parseMarktplaatsListingsFromHtml(html);

  if (htmlListings.length > 0) {
    console.log(`[WORKER] Using extraction method: HTML_FALLBACK`);
    return { listings: htmlListings, method: 'HTML_FALLBACK' };
  }

  return { listings: [], method: 'NONE' };
}

function parseLeboncoinListings(html) {
  const listings = [];

  const nextDataMatch = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/.exec(html);
  if (!nextDataMatch) {
    console.log('[WORKER] No __NEXT_DATA__ found in Leboncoin HTML');
    return listings;
  }

  try {
    const nextData = JSON.parse(nextDataMatch[1]);
    const ads = nextData?.props?.pageProps?.searchData?.ads || [];

    for (const ad of ads) {
      if (!ad.subject || !ad.price || ad.price.length === 0) continue;

      const priceValue = ad.price[0];
      const price = typeof priceValue === 'number' ? priceValue : (priceValue?.value || 0);

      listings.push({
        title: ad.subject,
        price,
        currency: 'EUR',
        mileage: ad.attributes?.mileage || null,
        year: ad.attributes?.regdate || null,
        trim: null,
        listing_url: ad.url || `https://www.leboncoin.fr/${ad.list_id}`,
        description: ad.body || '',
        price_type: 'one-off',
      });
    }
  } catch (error) {
    console.error('[WORKER] Error parsing Leboncoin JSON:', error);
  }

  return listings;
}

function parseBilbasenListings(html) {
  const listings = [];
  const listingPattern = /<div[^>]*class="[^"]*listing[^"]*"[^>]*>([\s\S]*?)<\/div>/g;

  let match;
  while ((match = listingPattern.exec(html)) !== null) {
    const listingHtml = match[1];

    const titleMatch = /<h2[^>]*>(.*?)<\/h2>/.exec(listingHtml);
    const priceMatch = /([\d.]+)\s*kr/.exec(listingHtml);
    const mileageMatch = /([\d.]+)\s*km/.exec(listingHtml);
    const yearMatch = /(\d{4})/.exec(listingHtml);

    if (titleMatch && priceMatch) {
      const price = parseFloat(priceMatch[1].replace(/\./g, ''));
      const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/\./g, '')) : null;
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      listings.push({
        title: titleMatch[1].trim(),
        price,
        currency: 'DKK',
        mileage,
        year,
        trim: null,
        listing_url: '',
        description: '',
        price_type: 'one-off',
      });
    }
  }

  return listings;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function scrapeSearch(url, scrapeMode) {
  const MAX_RETRIES = 2;
  const RETRY_DELAYS = [1000, 3000];

  let marketplace = 'unknown';
  if (url.includes('marktplaats.nl')) marketplace = 'marktplaats';
  else if (url.includes('leboncoin.fr')) marketplace = 'leboncoin';
  else if (url.includes('bilbasen.dk')) marketplace = 'bilbasen';

  const isMarktplaats = marketplace === 'marktplaats';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const profileLevel = attempt + 1;
    const isRetry = attempt > 0;

    if (isRetry) {
      const delay = RETRY_DELAYS[attempt - 1];
      console.log(`[WORKER] 🔄 Retry ${attempt}/${MAX_RETRIES} after ${delay}ms with profile level ${profileLevel}...`);
      await sleep(delay);
    } else {
      console.log(`[WORKER] Scraping ${url} in ${scrapeMode.toUpperCase()} mode`);
    }

    const { html, statusCode } = await fetchHtmlWithScraper(url, profileLevel);

    if (!html) {
      if (attempt === MAX_RETRIES) {
        return {
          listings: [],
          error: 'SCRAPER_FAILED',
          errorReason: 'Zyte API returned no HTML after retries',
          zyteStatusCode: statusCode,
        };
      }
      console.log(`[WORKER] ⚠️ No HTML returned, will retry...`);
      continue;
    }

    if (html.includes('/download/website-ban') || html.toLowerCase().includes('website ban')) {
      if (isMarktplaats && attempt < MAX_RETRIES) {
        console.log(`[WORKER] 🚫 Zyte website-ban detected, retrying with stronger profile...`);
        continue;
      }
      const diagnostics = extractDiagnostics(html, marketplace, attempt, profileLevel, null);
      return {
        listings: [],
        blockedByProvider: true,
        blockReason: 'Zyte website-ban error detected',
        diagnostics,
        zyteStatusCode: statusCode,
      };
    }

    let listings = [];
    let extractionMethod = null;

    if (marketplace === 'marktplaats') {
      const result = parseMarktplaatsListings(html);
      listings = result.listings;
      extractionMethod = result.method;
    } else if (marketplace === 'leboncoin') {
      listings = parseLeboncoinListings(html);
      extractionMethod = 'NEXT_DATA';
    } else if (marketplace === 'bilbasen') {
      listings = parseBilbasenListings(html);
      extractionMethod = 'HTML';
    }

    const blockedDetection = detectBlockedContent(html, listings.length > 0);

    if (blockedDetection.isBlocked) {
      if (isMarktplaats && attempt < MAX_RETRIES) {
        console.log(`[WORKER] 🚫 Blocked content detected (${blockedDetection.matchedKeyword}), retrying...`);
        continue;
      }
      const diagnostics = extractDiagnostics(html, marketplace, attempt, profileLevel, extractionMethod);
      console.log(`[WORKER] 🚫 Blocked after all retries: ${blockedDetection.matchedKeyword}`);
      return {
        listings: [],
        blockedByProvider: true,
        blockReason: `${marketplace.toUpperCase()}_BLOCKED: ${blockedDetection.matchedKeyword}`,
        diagnostics,
        zyteStatusCode: statusCode,
      };
    }

    if (listings.length === 0) {
      if (isMarktplaats && attempt < MAX_RETRIES) {
        console.log(`[WORKER] ⚠️ Zero listings extracted, retrying with stronger profile...`);
        continue;
      }
      const diagnostics = extractDiagnostics(html, marketplace, attempt, profileLevel, 'NONE');
      console.log(`[WORKER] ⚠️ Zero listings after all retries from ${marketplace}`);
      console.log(`[WORKER] 📊 Diagnostics:`, JSON.stringify(diagnostics, null, 2));
      return {
        listings: [],
        diagnostics,
        errorReason: `${marketplace.toUpperCase()}_ZERO_LISTINGS_AFTER_RETRIES`,
        zyteStatusCode: statusCode,
      };
    }

    console.log(`[WORKER] ✅ Extracted ${listings.length} listings from ${url}${isRetry ? ` (after ${attempt} ${attempt === 1 ? 'retry' : 'retries'})` : ''}`);
    return { listings, retryCount: attempt, extractionMethod };
  }

  const diagnostics = extractDiagnostics('', marketplace, MAX_RETRIES, MAX_RETRIES + 1, 'NONE');
  return {
    listings: [],
    error: 'SCRAPER_FAILED',
    errorReason: 'Max retries exceeded',
    diagnostics,
  };
}

function isPriceMonthly(text) {
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
  return monthlyKeywords.some(kw => text.toLowerCase().includes(kw));
}

function isDamagedVehicle(text) {
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
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  SYNCHRONIZED COPY - NOW UNIFIED THROUGH STUDY-CORE ⚠️
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **IMPORTANT:** These functions are now maintained in src/lib/study-core/business-logic.ts
 *
 * **MIGRATION STATUS:**
 * - ✅ study-engine.ts now re-exports from study-core
 * - ✅ scraperClient.ts imports from study-engine (which delegates to study-core)
 * - ⚠️  This worker still has a synchronized copy (for Node.js compatibility)
 * - 🔄 Working to eliminate this duplication via TypeScript conversion
 *
 * **WHY STILL DUPLICATED:**
 * This worker runs in plain Node.js and cannot directly import TypeScript.
 * Once converted to TypeScript (with tsx or compiled output), these functions
 * will be deleted and imported from study-core instead.
 *
 * **CURRENT STATE:**
 * These functions are IDENTICAL to study-core/business-logic.ts.
 * They were last synced on 2026-01-07 as part of the unified pipeline migration.
 *
 * **DO NOT:**
 * - Modify these functions - update study-core/business-logic.ts instead
 * - Add business rules here - add to study-core instead
 * - Allow drift - these MUST match study-core exactly
 *
 * **NEXT STEPS:**
 * 1. Convert worker to TypeScript (worker/scraper.ts)
 * 2. Import from study-core directly
 * 3. Delete these synchronized copies
 *
 * **SOURCE OF TRUTH:** src/lib/study-core/business-logic.ts
 * **LAST SYNCED:** 2026-01-07 (unified pipeline migration)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

function matchesBrandModel(title, brand, model) {
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

function shouldFilterListing(listing) {
  const text = `${listing.title} ${listing.description}`;
  const textLower = text.toLowerCase();

  const priceEur = toEur(listing.price, listing.currency);
  if (priceEur <= 2000) {
    console.log(`[WORKER_FILTER] Price too low (≤2000€): ${listing.title} (${priceEur.toFixed(0)}€)`);
    return true;
  }

  const isMonthly = isPriceMonthly(textLower);
  const isLowMonthlyPrice = listing.price_type === 'per-month' ||
    (listing.price >= 200 && listing.price <= 500 && isMonthly);

  if (isLowMonthlyPrice || isMonthly) {
    console.log('[WORKER_FILTER] Leasing detected:', listing.title);
    return true;
  }

  if (isDamagedVehicle(text)) {
    console.log('[WORKER_FILTER] Damaged vehicle detected (pre-AI):', listing.title);
    return true;
  }

  if (listing.price <= 0) {
    return true;
  }

  if (listing.price_type === 'per-month') {
    return true;
  }

  return false;
}

export function filterListingsByStudy(listings, study) {
  const initialCount = listings.length;
  console.log(`[WORKER_FILTER] Starting with ${initialCount} listings for ${study.brand} ${study.model} ${study.year}`);

  const filtered = listings.filter(listing => {
    if (shouldFilterListing(listing)) {
      return false;
    }

    if (listing.year && listing.year < study.year) {
      console.log(`[WORKER_FILTER] Year too old: ${listing.title} (${listing.year} < ${study.year})`);
      return false;
    }

    if (study.max_mileage > 0 && listing.mileage && listing.mileage > study.max_mileage) {
      console.log(`[WORKER_FILTER] Mileage too high: ${listing.title} (${listing.mileage} > ${study.max_mileage})`);
      return false;
    }

    const matchResult = matchesBrandModel(listing.title, study.brand, study.model);
    if (!matchResult.matches) {
      console.log(`[WORKER_FILTER] Brand/model mismatch: ${listing.title} - ${matchResult.reason}`);
      return false;
    }

    return true;
  });

  console.log(`[WORKER_FILTER] ✅ Kept ${filtered.length}/${initialCount} listings after filtering (${initialCount - filtered.length} filtered out)`);

  return filtered;
}

export function computeTargetMarketStats(listings) {
  if (listings.length === 0) {
    console.log('[WORKER_STATS] No listings to compute stats from');
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

  const MAX_TARGET_LISTINGS = 6;

  const sortedListings = listings
    .map(l => ({ ...l, priceEur: toEur(l.price, l.currency) }))
    .sort((a, b) => a.priceEur - b.priceEur);

  const limitedListings = sortedListings.slice(0, MAX_TARGET_LISTINGS);
  const pricesInEur = limitedListings.map(l => l.priceEur);
  const sum = pricesInEur.reduce((acc, price) => acc + price, 0);

  const getPercentile = (arr, p) => {
    const index = Math.ceil((arr.length * p) / 100) - 1;
    return arr[Math.max(0, index)];
  };

  const mid = Math.floor(pricesInEur.length / 2);
  const median = pricesInEur.length % 2 === 0
    ? (pricesInEur[mid - 1] + pricesInEur[mid]) / 2
    : pricesInEur[mid];

  const stats = {
    median_price: median,
    average_price: sum / pricesInEur.length,
    min_price: pricesInEur[0],
    max_price: pricesInEur[pricesInEur.length - 1],
    count: limitedListings.length,
    percentile_25: getPercentile(pricesInEur, 25),
    percentile_75: getPercentile(pricesInEur, 75),
  };

  const currencyNote = listings[0]?.currency === 'DKK' ? ' (converted from DKK)' : '';
  const limitNote = listings.length > MAX_TARGET_LISTINGS ? ` (using first ${MAX_TARGET_LISTINGS} listings)` : '';
  console.log(`[WORKER_STATS] Computed target market stats in EUR${currencyNote}${limitNote}:`, {
    count: stats.count,
    median: stats.median_price.toFixed(0),
    average: stats.average_price.toFixed(0),
    min: stats.min_price.toFixed(0),
    max: stats.max_price.toFixed(0),
    total_listings_available: listings.length,
  });

  return stats;
}

function applyTrimLeboncoin(url, trim) {
  if (!trim) return url;
  const encoded = encodeURIComponent(trim);

  if (url.includes('text=')) {
    return url.replace(/text=[^&]*/, `text=${encoded}`);
  }

  const kstIndex = url.indexOf('&kst=');
  if (kstIndex !== -1) {
    return url.slice(0, kstIndex) + `&text=${encoded}` + url.slice(kstIndex);
  }

  return url + `&text=${encoded}`;
}

function applyTrimMarktplaats(url, trim) {
  if (!trim) return url;
  const [base, hash = ''] = url.split('#');
  if (!hash) return url;

  const encoded = trim.toLowerCase();
  let newHash;

  if (hash.startsWith('q:')) {
    newHash = hash.replace(/^q:[^|]*/, `q:${encoded}`);
  } else {
    newHash = `q:${encoded}|` + hash;
  }

  return `${base}#${newHash}`;
}

function applyTrimBilbasen(url, trim) {
  if (!trim) return url;
  const encoded = encodeURIComponent(trim);

  if (url.includes('free=')) {
    return url.replace(/free=[^&]*/, `free=${encoded}`);
  }

  const hasQuery = url.includes('?');
  const sep = hasQuery ? '&' : '?';
  return url + `${sep}free=${encoded}`;
}

async function updateHeartbeat(supabase, runId, scheduledJobId) {
  const now = new Date().toISOString();
  const updates = [];

  if (runId) {
    updates.push(
      supabase
        .from('study_runs')
        .update({ last_heartbeat_at: now })
        .eq('id', runId)
    );
  }

  if (scheduledJobId) {
    updates.push(
      supabase
        .from('scheduled_study_runs')
        .update({ last_heartbeat_at: now })
        .eq('id', scheduledJobId)
    );
  }

  if (updates.length > 0) {
    await Promise.all(updates).catch(err => {
      console.warn('[WORKER] Failed to update heartbeat:', err.message);
    });
  }
}

export async function executeStudy({ study, runId, threshold, scrapeMode, supabase, scheduledJobId }) {
  console.log(`[WORKER] Processing study ${study.id} in ${scrapeMode.toUpperCase()} mode`);

  const trimTarget = study.trim_text_target?.trim() || study.trim_text?.trim() || undefined;
  const trimSource = study.trim_text_source?.trim() || study.trim_text?.trim() || undefined;

  let targetUrl = study.market_target_url;
  let sourceUrl = study.market_source_url;

  if (trimTarget) {
    if (study.country_target === 'NL') {
      targetUrl = applyTrimMarktplaats(targetUrl, trimTarget);
    } else if (study.country_target === 'FR') {
      targetUrl = applyTrimLeboncoin(targetUrl, trimTarget);
    } else if (study.country_target === 'DK') {
      targetUrl = applyTrimBilbasen(targetUrl, trimTarget);
    }
  }

  if (trimSource) {
    if (study.country_source === 'NL') {
      sourceUrl = applyTrimMarktplaats(sourceUrl, trimSource);
    } else if (study.country_source === 'FR') {
      sourceUrl = applyTrimLeboncoin(sourceUrl, trimSource);
    } else if (study.country_source === 'DK') {
      sourceUrl = applyTrimBilbasen(sourceUrl, trimSource);
    }
  }

  try {
    await updateHeartbeat(supabase, runId, scheduledJobId);

    const targetResult = await scrapeSearch(targetUrl, scrapeMode);

    await updateHeartbeat(supabase, runId, scheduledJobId);

    if (targetResult.error === 'SCRAPER_FAILED') {
      const errorReason = targetResult.errorReason || 'Zyte scraper failed';

      if (targetResult.diagnostics) {
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'SCRAPER_FAILED',
          last_stage: 'target_scrape',
          error_message: errorReason,
          logs_json: {
            studyId: study.id,
            stage: 'target_scrape',
            error: errorReason,
            zyteStatusCode: targetResult.zyteStatusCode,
            retryCount: targetResult.retryCount || 0,
            diagnostics: targetResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: errorReason,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    if (targetResult.blockedByProvider) {
      console.log(`[WORKER] 🚫 Target market blocked: ${targetResult.blockReason}`);

      if (targetResult.diagnostics) {
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'TARGET_BLOCKED',
          last_stage: 'target_search',
          error_message: 'MARKTPLAATS_BLOCKED',
          logs_json: {
            studyId: study.id,
            stage: 'target_search',
            blocked: true,
            blockReason: targetResult.blockReason,
            zyteStatusCode: targetResult.zyteStatusCode,
            retryCount: targetResult.retryCount || 0,
            diagnostics: targetResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'TARGET_BLOCKED',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: targetResult.blockReason,
      }]);

      return { status: 'TARGET_BLOCKED', nullCount: 0, opportunitiesCount: 0 };
    }

    const targetListings = targetResult.listings;
    console.log(`[WORKER] 🎯 Raw target listings extracted: ${targetListings.length}`);
    const filteredTargetListings = filterListingsByStudy(targetListings, study);

    if (filteredTargetListings.length === 0) {
      const errorReason = targetResult.errorReason ||
                         (targetListings.length === 0 ? 'No target listings extracted' : 'No valid target listings after filtering');

      if (targetResult.diagnostics) {
        console.log(`[WORKER] ⚠️ Logging zero-listings diagnostics to study_run_logs`);
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'NO_TARGET_LISTINGS',
          last_stage: 'target_filter',
          error_message: errorReason,
          logs_json: {
            studyId: study.id,
            stage: 'target_filter',
            rawListingsCount: targetListings.length,
            filteredListingsCount: filteredTargetListings.length,
            errorReason,
            zyteStatusCode: targetResult.zyteStatusCode,
            retryCount: targetResult.retryCount || 0,
            diagnostics: targetResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: errorReason,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    const targetStats = computeTargetMarketStats(filteredTargetListings);
    const targetMarketPriceEur = targetStats.median_price;

    console.log(`[WORKER] 📊 Target Market Summary for ${study.brand} ${study.model} ${study.year}:`);
    console.log(`[WORKER]    - Raw listings: ${targetListings.length}`);
    console.log(`[WORKER]    - After filtering: ${filteredTargetListings.length}`);
    console.log(`[WORKER]    - Used for median: ${targetStats.count}`);
    console.log(`[WORKER]    - Median price: ${targetMarketPriceEur.toFixed(0)} EUR`);

    await updateHeartbeat(supabase, runId, scheduledJobId);

    const sourceResult = await scrapeSearch(sourceUrl, scrapeMode);

    await updateHeartbeat(supabase, runId, scheduledJobId);

    if (sourceResult.error === 'SCRAPER_FAILED') {
      const errorReason = sourceResult.errorReason || 'Zyte scraper failed on source';

      if (sourceResult.diagnostics) {
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'SCRAPER_FAILED',
          last_stage: 'source_scrape',
          error_message: errorReason,
          logs_json: {
            studyId: study.id,
            stage: 'source_scrape',
            error: errorReason,
            zyteStatusCode: sourceResult.zyteStatusCode,
            retryCount: sourceResult.retryCount || 0,
            diagnostics: sourceResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: targetMarketPriceEur,
        best_source_price: null,
        price_difference: null,
        target_stats: targetStats,
        target_error_reason: errorReason,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    if (sourceResult.blockedByProvider) {
      console.log(`[WORKER] 🚫 Source market blocked: ${sourceResult.blockReason}`);

      if (sourceResult.diagnostics) {
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'SOURCE_BLOCKED',
          last_stage: 'source_scrape',
          error_message: sourceResult.blockReason,
          logs_json: {
            studyId: study.id,
            stage: 'source_scrape',
            blocked: true,
            blockReason: sourceResult.blockReason,
            zyteStatusCode: sourceResult.zyteStatusCode,
            retryCount: sourceResult.retryCount || 0,
            diagnostics: sourceResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: targetMarketPriceEur,
        best_source_price: null,
        price_difference: null,
        target_stats: targetStats,
        target_error_reason: sourceResult.blockReason,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    const sourceListings = sourceResult.listings;
    console.log(`[WORKER] 🎯 Raw source listings extracted: ${sourceListings.length}`);
    const filteredSourceListings = filterListingsByStudy(sourceListings, study);

    if (filteredSourceListings.length === 0) {
      const errorReason = sourceResult.errorReason ||
                         (sourceListings.length === 0 ? 'No source listings extracted' : 'No valid source listings after filtering');

      if (sourceResult.diagnostics) {
        console.log(`[WORKER] ⚠️ Logging zero-source-listings diagnostics to study_run_logs`);
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'NO_SOURCE_LISTINGS',
          last_stage: 'source_filter',
          error_message: errorReason,
          logs_json: {
            studyId: study.id,
            stage: 'source_filter',
            rawListingsCount: sourceListings.length,
            filteredListingsCount: filteredSourceListings.length,
            errorReason,
            zyteStatusCode: sourceResult.zyteStatusCode,
            retryCount: sourceResult.retryCount || 0,
            diagnostics: sourceResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: targetMarketPriceEur,
        best_source_price: null,
        price_difference: null,
        target_stats: targetStats,
        target_error_reason: errorReason,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    const sourcePricesEur = filteredSourceListings
      .map(l => toEur(l.price, l.currency))
      .sort((a, b) => a - b);
    const bestSourcePriceEur = sourcePricesEur[0];
    const priceDifferenceEur = targetMarketPriceEur - bestSourcePriceEur;

    console.log(`[WORKER] Best source: ${bestSourcePriceEur.toFixed(0)} EUR, diff: ${priceDifferenceEur.toFixed(0)} EUR`);

    if (priceDifferenceEur < threshold) {
      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: targetMarketPriceEur,
        best_source_price: bestSourcePriceEur,
        price_difference: priceDifferenceEur,
        target_stats: targetStats,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    console.log(`[WORKER] OPPORTUNITY: ${priceDifferenceEur.toFixed(0)} EUR >= ${threshold} EUR`);

    const MAX_INTERESTING_LISTINGS = 5;
    const maxInterestingPriceEur = targetMarketPriceEur - threshold;

    const interestingListings = filteredSourceListings
      .filter(l => {
        const priceEur = toEur(l.price, l.currency);
        return priceEur <= maxInterestingPriceEur;
      })
      .sort((a, b) => toEur(a.price, a.currency) - toEur(b.price, b.currency))
      .slice(0, MAX_INTERESTING_LISTINGS);

    console.log(`[WORKER] Found ${interestingListings.length} interesting listings (below target median - ${threshold} EUR)`);

    const { data: resultData, error: resultError } = await supabase
      .from('study_run_results')
      .insert([{
        run_id: runId,
        study_id: study.id,
        status: 'OPPORTUNITIES',
        target_market_price: targetMarketPriceEur,
        best_source_price: bestSourcePriceEur,
        price_difference: priceDifferenceEur,
        target_stats: {
          ...targetStats,
          targetMarketUrl: targetUrl,
          sourceMarketUrl: sourceUrl,
          targetMarketMedianEur: targetMarketPriceEur,
        },
      }])
      .select()
      .single();

    if (resultError) {
      console.error(`[WORKER] Error inserting study_run_results:`, resultError);
      throw resultError;
    }

    console.log(`[WORKER] ✅ Stored OPPORTUNITIES result with ID: ${resultData.id}`);

    if (interestingListings.length > 0) {
      const listingsToStore = interestingListings.map(listing => ({
        run_result_id: resultData.id,
        listing_url: listing.listing_url,
        title: listing.title,
        price: toEur(listing.price, listing.currency),
        mileage: listing.mileage,
        year: listing.year,
        trim: listing.trim,
        is_damaged: false,
        defects_summary: null,
        maintenance_summary: null,
        options_summary: null,
        entretien: '',
        options: [],
        full_description: listing.description || '',
        car_image_urls: [],
        status: 'NEW',
      }));

      const { error: listingsError } = await supabase
        .from('study_source_listings')
        .insert(listingsToStore);

      if (listingsError) {
        console.error(`[WORKER] Error inserting study_source_listings:`, listingsError);
        throw listingsError;
      }

      console.log(`[WORKER] ✅ Persisted ${listingsToStore.length} listings for study ${study.id} run ${runId} (source market)`);
      console.log(`[WORKER] 📊 Listings stored in study_source_listings table, linked to run_result_id: ${resultData.id}`);
    } else {
      console.log(`[WORKER] ℹ️ No interesting listings below threshold to store`);
    }

    return { status: 'OPPORTUNITIES', nullCount: 0, opportunitiesCount: 1 };
  } catch (error) {
    console.error(`[WORKER] Error processing study ${study.id}:`, error);

    await supabase.from('study_run_results').insert([{
      run_id: runId,
      study_id: study.id,
      status: 'NULL',
      target_market_price: null,
      best_source_price: null,
      price_difference: null,
      target_stats: null,
      target_error_reason: `Error: ${error.message}`,
    }]);

    return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
  }
}
