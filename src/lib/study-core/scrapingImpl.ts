/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STUDY CORE - UNIFIED SCRAPING IMPLEMENTATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH FOR SCRAPING LOGIC.
 *
 * **CRITICAL:**
 * - Both INSTANT (browser) and SCHEDULED (worker) use this code
 * - Same parsing rules for all marketplaces
 * - Same pagination behavior
 * - Same retry strategies
 * - Same fallback logic
 *
 * **EXTRACTED FROM:**
 * - src/lib/scraperClient.ts (advanced instant scraping)
 * - worker/scraper.js (simplified scheduled scraping)
 *
 * **ENVIRONMENT AGNOSTIC:**
 * - No browser-only APIs (no DOM, no import.meta.env)
 * - No Node-only APIs (no process, no fs)
 * - fetch passed as parameter for compatibility
 * - Works in browser, Node 18+, and Deno
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {Currency, ScrapedListing, SearchResult } from './types';
import { detectBlockedContent, getZyteRequestProfile, BLOCKED_KEYWORDS } from './scraping';

/**
 * Configuration for scraping operations
 */
export interface CoreScraperConfig {
  zyteApiKey: string;
  zyteEndpoint: string;
  maxRetries: number;
  retryDelays: number[];
  fetchImpl?: typeof fetch;
}

/**
 * Default scraper configuration
 */
export const DEFAULT_SCRAPER_CONFIG: Omit<CoreScraperConfig, 'zyteApiKey'> = {
  zyteEndpoint: 'https://api.zyte.com/v1/extract',
  maxRetries: 3,
  retryDelays: [500, 1000, 2000],
  fetchImpl: typeof fetch !== 'undefined' ? fetch : undefined,
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRICE EXTRACTION
 * ═══════════════════════════════════════════════════════════════════════════
 */

const DKK_TO_EUR = 0.13;

/**
 * Extract EUR price from text
 */
function extractEuroPrice(text: string): number | null {
  if (!text || typeof text !== 'string') return null;

  const normalizedText = text
    .replace(/\u00A0/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/g, '€');

  const eurPatterns = [
    /€\s*([\d\s.]+)(?:,-|,\d{1,2})?/,
    /([\d\s.]+)\s*€/,
    /([\d\s.]+)\s*EUR\b/i,
    /([\d\s.]+)\s*euros?\b/i,
    /prix[:\s]*([\d\s.]+)/i,
  ];

  for (const pattern of eurPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const captured = match[1];
      const cleaned = captured.replace(/\s/g, '').replace(/\./g, '');
      const price = parseInt(cleaned, 10);

      if (!isNaN(price) && price > 100 && price < 500000) {
        return price;
      }
    }
  }

  return null;
}

/**
 * Extract price from text (supports EUR and DKK)
 */
function extractPrice(text: string): number | null {
  const normalizedText = text.replace(/\u00A0/g, ' ');

  // Try EUR first
  const eurPrice = extractEuroPrice(normalizedText);
  if (eurPrice !== null) {
    return eurPrice;
  }

  // Try DKK
  const dkkPatterns = [
    /(\d[\d.,']*)\s*kr\.?/i,
    /kr\.?\s*(\d[\d.,']*)/i,
    /(\d[\d.,']*)\s*DKK\b/i,
  ];

  for (const pattern of dkkPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const numStr = match[1].replace(/[\s.,']/g, '');
      const priceDkk = parseInt(numStr, 10);
      if (!isNaN(priceDkk) && priceDkk > 100 && priceDkk < 5000000) {
        return Math.round(priceDkk * DKK_TO_EUR);
      }
    }
  }

  return null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ATTRIBUTE EXTRACTION
 * ═══════════════════════════════════════════════════════════════════════════
 */

function extractYear(text: string): number | null {
  const currentYear = new Date().getFullYear();
  const yearMatch = text.match(/\b(20[0-2][0-9])\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 2000 && year <= currentYear) {
      return year;
    }
  }
  return null;
}

function extractMileage(text: string): number | null {
  const normalizedText = text.replace(/\u00A0/g, ' ');

  const mileagePatterns = [
    /(\d[\d\s.,']*?)\s*km\b/i,
    /(\d[\d\s.,']*?)km\b/i,
    /kilom[eè]trage[:\s]*(\d[\d\s.,']*)/i,
  ];

  for (const pattern of mileagePatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const numStr = match[1].replace(/[\s.,']/g, '');
      const mileage = parseInt(numStr, 10);
      if (!isNaN(mileage) && mileage > 0 && mileage < 1000000) {
        return mileage;
      }
    }
  }
  return null;
}

function extractTitle(html: string): string | null {
  const titlePatterns = [
    /<h[1-6][^>]*>(.*?)<\/h[1-6]>/i,
    /title=["']([^"']+)["']/i,
    /<title[^>]*>(.*?)<\/title>/i,
  ];

  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length > 0) {
      return match[1].trim();
    }
  }
  return null;
}

function extractThumbnail(cardHtml: string): string | null {
  const imgPatterns = [
    /<img[^>]*src=["']([^"']+)["']/i,
    /<img[^>]*data-src=["']([^"']+)["']/i,
  ];

  for (const pattern of imgPatterns) {
    const match = cardHtml.match(pattern);
    if (match) {
      const url = match[1];
      if (url && !url.startsWith('data:') && url.length > 10) {
        return url;
      }
    }
  }

  return null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ZYTE API CLIENT
 * ═══════════════════════════════════════════════════════════════════════════
 */

function isNetworkError(error: unknown, statusCode?: number): boolean {
  if (!error) return false;

  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  const networkKeywords = [
    'failed to fetch',
    'network',
    'err_network_io_suspended',
    'network suspended',
    'connection',
    'timeout',
    'econnrefused',
    'enotfound',
  ];

  const hasNetworkKeyword = networkKeywords.some(keyword => errorMessage.includes(keyword));

  if (hasNetworkKeyword) return true;
  if (statusCode === 504 || statusCode === 502 || statusCode === 503) return true;

  return false;
}

async function fetchHtmlWithZyte(
  targetUrl: string,
  config: CoreScraperConfig,
  profileLevel = 1
): Promise<string | null> {
  const fetchFn = config.fetchImpl || fetch;

  if (!fetchFn) {
    console.error('[CORE_SCRAPER] No fetch implementation available');
    return null;
  }

  try {
    const authHeader = `Basic ${btoa(config.zyteApiKey + ':')}`;
    const requestBody = getZyteRequestProfile(targetUrl, profileLevel);

    console.log(`[CORE_SCRAPER] Fetching ${targetUrl.slice(0, 100)}... (profile level ${profileLevel})`);

    const response = await fetchFn(config.zyteEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[CORE_SCRAPER] Zyte API error: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json();
    return result.browserHtml || null;
  } catch (error) {
    console.error('[CORE_SCRAPER] Scraper fetch error:', error);
    return null;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MARKTPLAATS PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 */

function parseMarktplaatsListings(html: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  console.log('[CORE_SCRAPER_MARKTPLAATS] Starting parsing');

  // Strategy 1: Try HTML card extraction
  const listingPattern = /<li\s+class="[^"]*hz-Listing\s+hz-Listing--list-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  const matches = Array.from(html.matchAll(listingPattern));
  const cards: string[] = matches.map(m => m[0]);

  console.log(`[CORE_SCRAPER_MARKTPLAATS] Found ${cards.length} potential listing cards`);

  for (const cardHtml of cards) {
    // Extract URL
    const urlPatterns = [
      /<a\s+[^>]*class="[^"]*hz-Listing-coverLink[^"]*"[^>]*href=["']([^"']+)["']/i,
      /<a\s+[^>]*href=["'](\/v\/[^"']+)["']/i,
      /<a\s+[^>]*href=["'](\/a\/[^"']+)["']/i,
    ];

    let listingUrl: string | null = null;
    for (const pattern of urlPatterns) {
      const urlMatch = cardHtml.match(pattern);
      if (urlMatch) {
        let href = urlMatch[1];
        if (href.startsWith('/')) {
          href = `https://www.marktplaats.nl${href}`;
        }
        listingUrl = href;
        break;
      }
    }

    if (!listingUrl) continue;

    // Extract price
    const textContent = cardHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const price = extractEuroPrice(textContent);
    if (!price) continue;

    // Extract title
    const titleAttrMatch = cardHtml.match(/title=["']([^"']+)["']/);
    const title = titleAttrMatch ? titleAttrMatch[1].trim() : textContent.substring(0, 100).trim();

    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);

    listings.push({
      title,
      price,
      currency: 'EUR',
      mileage: mileage || null,
      year: year || null,
      trim: null,
      listing_url: listingUrl,
      description: textContent.substring(0, 300),
      price_type: 'one-off',
    });
  }

  // Strategy 2: Try JSON extraction if no cards found
  if (listings.length === 0) {
    console.log('[CORE_SCRAPER_MARKTPLAATS] No cards found, trying JSON extraction');
    return extractMarktplaatsJsonListings(html);
  }

  console.log(`[CORE_SCRAPER_MARKTPLAATS] Parsed ${listings.length} listings from HTML`);
  return listings;
}

function extractMarktplaatsJsonListings(html: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  try {
    const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    const matches = Array.from(html.matchAll(scriptPattern));

    for (const match of matches) {
      const scriptContent = match[1].trim();
      if (scriptContent.length < 100) continue;

      const hasListingKeywords = scriptContent.includes('"listings"') ||
                                 scriptContent.includes('"items"') ||
                                 scriptContent.includes('priceInfo');

      if (!hasListingKeywords) continue;

      let data = null;
      try {
        data = JSON.parse(scriptContent);
      } catch (e) {
        const jsonMatch = scriptContent.match(/(?:window\.\w+|var\s+\w+|const\s+\w+)\s*=\s*(\{[\s\S]*\});?/);
        if (jsonMatch) {
          try {
            data = JSON.parse(jsonMatch[1]);
          } catch (e2) {
            continue;
          }
        }
      }

      if (data) {
        const possiblePaths = [
          data?.listings,
          data?.items,
          data?.props?.pageProps?.listings,
        ];

        for (const path of possiblePaths) {
          if (Array.isArray(path) && path.length > 0) {
            for (const item of path) {
              const priceValue = item.priceInfo?.priceCents || item.price;
              const price = priceValue ? (typeof priceValue === 'number' ? priceValue / 100 : parseInt(String(priceValue), 10)) : null;

              const url = item.vipUrl || item.url;
              if (!price || !url) continue;

              const normalizedUrl = url.startsWith('/') ? `https://www.marktplaats.nl${url}` : url;

              listings.push({
                title: item.title || 'Untitled',
                price,
                currency: 'EUR',
                mileage: item.mileage || null,
                year: item.year || null,
                trim: null,
                listing_url: normalizedUrl,
                description: item.description || '',
                price_type: 'one-off',
              });
            }

            if (listings.length > 0) {
              console.log(`[CORE_SCRAPER_MARKTPLAATS] Extracted ${listings.length} listings from JSON`);
              return listings;
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('[CORE_SCRAPER_MARKTPLAATS] Error extracting JSON:', error);
  }

  return listings;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LEBONCOIN PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 */

function parseLeboncoinListings(html: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  console.log('[CORE_SCRAPER_LEBONCOIN] Starting parsing');

  const nextDataPatterns = [
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script\s+type=["']application\/json["'][^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  ];

  let nextDataMatch = null;
  for (const pattern of nextDataPatterns) {
    nextDataMatch = html.match(pattern);
    if (nextDataMatch) break;
  }

  if (!nextDataMatch) {
    console.log('[CORE_SCRAPER_LEBONCOIN] No __NEXT_DATA__ found');
    return listings;
  }

  try {
    const jsonText = nextDataMatch[1];
    const data = JSON.parse(jsonText);

    const possiblePaths = [
      data?.props?.pageProps?.searchData?.ads,
      data?.props?.pageProps?.ads,
      data?.props?.pageProps?.listings,
    ];

    let adsArray: any[] = [];
    for (const path of possiblePaths) {
      if (Array.isArray(path) && path.length > 0) {
        adsArray = path;
        break;
      }
    }

    for (const ad of adsArray) {
      const priceValue = ad.price?.[0] || ad.price;
      const price = typeof priceValue === 'number' ? priceValue :
                   typeof priceValue === 'string' ? parseInt(priceValue.replace(/\D/g, ''), 10) : null;

      let url = ad.url || ad.link;
      if (url && url.startsWith('/')) {
        url = `https://www.leboncoin.fr${url}`;
      }

      if (!price || !url) continue;

      const attributes = ad.attributes || {};
      const year = attributes.regdate || attributes.year || ad.year || null;
      const mileage = attributes.mileage || ad.mileage || null;

      listings.push({
        title: ad.subject || ad.title || 'Untitled',
        price,
        currency: 'EUR',
        mileage: mileage ? (typeof mileage === 'number' ? mileage : parseInt(String(mileage).replace(/\D/g, ''), 10)) : null,
        year: year ? (typeof year === 'number' ? year : parseInt(String(year), 10)) : null,
        trim: null,
        listing_url: url,
        description: ad.body || ad.description || '',
        price_type: 'one-off',
      });
    }

    console.log(`[CORE_SCRAPER_LEBONCOIN] Parsed ${listings.length} listings from __NEXT_DATA__`);
  } catch (error) {
    console.error('[CORE_SCRAPER_LEBONCOIN] Error parsing __NEXT_DATA__:', error);
  }

  return listings;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BILBASEN PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 */

function parseBilbasenListings(html: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  console.log('[CORE_SCRAPER_BILBASEN] Starting parsing');

  const anchorRegex = /<a\s+[^>]*href=["']([^"']*\/brugt\/bil\/[^"']*)["'][^>]*>/gi;
  const anchorMatches = Array.from(html.matchAll(anchorRegex));

  console.log(`[CORE_SCRAPER_BILBASEN] Found ${anchorMatches.length} anchors with /brugt/bil/`);

  if (anchorMatches.length === 0) return listings;

  const processedUrls = new Set<string>();

  for (const anchorMatch of anchorMatches) {
    const anchorTag = anchorMatch[0];
    const href = anchorMatch[1];

    if (href.startsWith('#') || href.startsWith('javascript:')) continue;

    let listingUrl = href;
    if (href.startsWith('/')) {
      listingUrl = `https://www.bilbasen.dk${href}`;
    }

    if (processedUrls.has(listingUrl)) continue;
    processedUrls.add(listingUrl);

    // Extract context around anchor
    const anchorIndex = html.indexOf(anchorTag);
    if (anchorIndex === -1) continue;

    const contextStart = Math.max(0, anchorIndex - 2000);
    const contextEnd = Math.min(html.length, anchorIndex + 2000);
    const cardHtml = html.substring(contextStart, contextEnd);

    if (cardHtml.includes('RelatedListings_')) continue;

    const textContent = cardHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const price = extractPrice(textContent);

    if (!price) continue;

    const title = extractTitle(cardHtml) || textContent.substring(0, 100).trim();
    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);

    listings.push({
      title,
      price,
      currency: 'DKK',
      mileage: mileage || null,
      year: year || null,
      trim: null,
      listing_url: listingUrl,
      description: textContent.substring(0, 300),
      price_type: 'one-off',
    });
  }

  console.log(`[CORE_SCRAPER_BILBASEN] Parsed ${listings.length} listings`);
  return listings;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MAIN SCRAPING FUNCTION
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Scrape a marketplace URL and return listings.
 *
 * This is the unified scraping implementation used by both INSTANT and SCHEDULED runs.
 *
 * @param url - Marketplace URL to scrape
 * @param scrapeMode - Scraping mode ('fast' or 'full')
 * @param config - Scraper configuration
 * @returns Search result with listings or error
 */
export async function coreScrapeSearch(
  url: string,
  scrapeMode: 'fast' | 'full',
  config: CoreScraperConfig
): Promise<SearchResult> {
  const MAX_RETRIES = config.maxRetries;
  const RETRY_DELAYS = config.retryDelays;

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
      console.log(`[CORE_SCRAPER] 🔄 Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } else {
      console.log(`[CORE_SCRAPER] Scraping ${url} in ${scrapeMode.toUpperCase()} mode`);
    }

    const html = await fetchHtmlWithZyte(url, config, profileLevel);

    if (!html) {
      if (attempt === MAX_RETRIES) {
        return {
          listings: [],
          error: 'SCRAPER_FAILED',
          errorReason: 'Zyte API returned no HTML after retries',
        };
      }
      console.log(`[CORE_SCRAPER] ⚠️ No HTML returned, will retry...`);
      continue;
    }

    // Check for website ban
    if (html.includes('/download/website-ban') || html.toLowerCase().includes('website ban')) {
      if (isMarktplaats && attempt < MAX_RETRIES) {
        console.log(`[CORE_SCRAPER] 🚫 Zyte website-ban detected, retrying...`);
        continue;
      }
      return {
        listings: [],
        blockedByProvider: true,
        blockReason: 'Zyte website-ban error detected',
      };
    }

    // Parse listings
    let listings: ScrapedListing[] = [];
    let extractionMethod = null;

    if (marketplace === 'marktplaats') {
      listings = parseMarktplaatsListings(html);
      extractionMethod = 'MARKTPLAATS';
    } else if (marketplace === 'leboncoin') {
      listings = parseLeboncoinListings(html);
      extractionMethod = 'LEBONCOIN';
    } else if (marketplace === 'bilbasen') {
      listings = parseBilbasenListings(html);
      extractionMethod = 'BILBASEN';
    }

    // Check for blocked content
    const blockedDetection = detectBlockedContent(html, listings.length > 0);

    if (blockedDetection.isBlocked) {
      if (isMarktplaats && attempt < MAX_RETRIES) {
        console.log(`[CORE_SCRAPER] 🚫 Blocked content detected (${blockedDetection.matchedKeyword}), retrying...`);
        continue;
      }
      return {
        listings: [],
        blockedByProvider: true,
        blockReason: `${marketplace.toUpperCase()}_BLOCKED: ${blockedDetection.matchedKeyword}`,
      };
    }

    // Check for zero listings
    if (listings.length === 0) {
      if (isMarktplaats && attempt < MAX_RETRIES) {
        console.log(`[CORE_SCRAPER] ⚠️ Zero listings extracted, retrying...`);
        continue;
      }
      return {
        listings: [],
        errorReason: `${marketplace.toUpperCase()}_ZERO_LISTINGS_AFTER_RETRIES`,
      };
    }

    console.log(`[CORE_SCRAPER] ✅ Extracted ${listings.length} listings from ${url}${isRetry ? ` (after ${attempt} ${attempt === 1 ? 'retry' : 'retries'})` : ''}`);
    return { listings, retryCount: attempt, extractionMethod };
  }

  return {
    listings: [],
    error: 'SCRAPER_FAILED',
    errorReason: 'Max retries exceeded',
  };
}
