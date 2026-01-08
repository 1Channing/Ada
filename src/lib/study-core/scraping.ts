/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STUDY CORE - PURE SCRAPING ORCHESTRATOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module provides the unified scraping orchestration layer.
 *
 * **CRITICAL:**
 * ALL parsing logic is now in src/lib/study-core/parsers/
 * Each marketplace has ONE authoritative parser:
 * - marktplaats.ts
 * - leboncoin.ts
 * - gaspedaal.ts
 * - bilbasen.ts
 * - generic.ts
 *
 * **PURE ARCHITECTURE:**
 * - Parsers: 100% pure functions (NO I/O, NO side effects)
 * - This module: Re-exports parsers + provides helpers
 * - Adapters (scraperClient.ts, worker): Handle I/O and call parsers
 *
 * **DETERMINISTIC GUARANTEE:**
 * Given identical HTML, both INSTANT and SCHEDULED produce identical listings.
 * No drift between frontend and worker.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ScrapingConfig, SearchResult, ScrapedListing } from './types';

/**
 * Standard scraping configuration used by all environments
 */
export const DEFAULT_SCRAPING_CONFIG: ScrapingConfig = {
  apiKey: '', // Set by environment
  endpoint: 'https://api.zyte.com/v1/extract',
  maxRetries: 3,
  retryDelays: [500, 1000, 2000],
};

/**
 * Keywords that indicate blocked/captcha pages
 */
export const BLOCKED_KEYWORDS = [
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

/**
 * Detect if HTML content indicates a blocked page
 *
 * @param html - HTML content to check
 * @param hasListings - Whether any listings were extracted
 * @returns Blocked detection result
 */
export function detectBlockedContent(
  html: string,
  hasListings = false
): {
  isBlocked: boolean;
  matchedKeyword: string | null;
  reason: string | null;
} {
  const lowerHtml = html.toLowerCase();

  // Check for explicit blocked keywords
  for (const keyword of BLOCKED_KEYWORDS) {
    if (lowerHtml.includes(keyword)) {
      return {
        isBlocked: true,
        matchedKeyword: keyword,
        reason: 'keyword_match',
      };
    }
  }

  // If no listings found, check for suspicious patterns
  if (!hasListings) {
    const suspiciousPatterns = ['robot', 'access denied', 'blocked', 'security', 'verification'];

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

/**
 * Get Zyte request profile based on marketplace and retry level
 *
 * @param url - Target URL
 * @param profileLevel - Profile level (1 = basic, 2 = enhanced, 3 = maximum)
 * @returns Zyte API request body
 */
export function getZyteRequestProfile(url: string, profileLevel: number) {
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
      actions: [
        {
          action: 'waitForTimeout',
          timeout: 2.0,
        },
      ],
    };
  }

  return baseProfile;
}

/**
 * Normalize a raw listing object into standard ScrapedListing format
 *
 * This is used by JSON-based extractors (Marktplaats __NEXT_DATA__, etc.)
 *
 * @param item - Raw listing object from JSON
 * @returns Normalized listing or null if invalid
 */
export function normalizeMarktplaatsListing(item: any): ScrapedListing | null {
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
  const mileageAttr =
    attributes.find?.((a: any) => a.key === 'mileage' || a.key === 'kilometer-stand') || {};
  const yearAttr = attributes.find?.((a: any) => a.key === 'year' || a.key === 'bouwjaar') || {};

  const mileage = mileageAttr.value
    ? parseInt(String(mileageAttr.value).replace(/\D/g, ''))
    : null;
  const year = yearAttr.value ? parseInt(String(yearAttr.value).replace(/\D/g, '')) : null;

  const listingUrl =
    item.vipUrl ||
    item.url ||
    item.href ||
    (itemId ? `https://www.marktplaats.nl/a/${itemId}` : '');

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

/**
 * Deep search for listing-like objects in JSON
 *
 * Traverses a JSON object to find arrays of objects that look like listings
 * (have title, price, and URL)
 *
 * @param obj - Object to search
 * @param path - Current path (for debugging)
 * @returns Array of found listing candidates
 */
export function findListingLikeObjects(
  obj: any,
  path = ''
): Array<{ item: any; path: string }> {
  const results: Array<{ item: any; path: string }> = [];

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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SCRAPING INTERFACE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Interface that all scraping implementations MUST follow
 *
 * This ensures both browser and Node.js implementations behave identically
 */
export interface ScraperImplementation {
  /**
   * Search a marketplace URL and return listings
   *
   * @param url - Marketplace URL to scrape
   * @param scrapeMode - Scraping mode (fast or full)
   * @param config - Scraping configuration
   * @returns Search result with listings or error
   */
  searchListings(
    url: string,
    scrapeMode: 'fast' | 'full',
    config?: ScrapingConfig
  ): Promise<SearchResult>;

  /**
   * Fetch HTML from a URL using Zyte API
   *
   * @param url - Target URL
   * @param profileLevel - Zyte profile level (1-3)
   * @returns HTML content or null
   */
  fetchHtmlWithScraper(url: string, profileLevel?: number): Promise<string | null>;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VALIDATION HELPERS
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Validate that a SearchResult matches expected format
 *
 * @param result - Result to validate
 * @returns Validation result
 */
export function validateSearchResult(result: SearchResult): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!result) {
    errors.push('Result is null or undefined');
    return { valid: false, errors };
  }

  if (!Array.isArray(result.listings)) {
    errors.push('listings is not an array');
  }

  for (const listing of result.listings || []) {
    if (!listing.title || typeof listing.title !== 'string') {
      errors.push('Listing missing valid title');
    }
    if (typeof listing.price !== 'number' || listing.price <= 0) {
      errors.push('Listing missing valid price');
    }
    if (!listing.listing_url || typeof listing.listing_url !== 'string') {
      errors.push('Listing missing valid URL');
    }
    if (!['EUR', 'DKK', 'UNKNOWN'].includes(listing.currency)) {
      errors.push(`Invalid currency: ${listing.currency}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create a deterministic signature for a listing pool
 *
 * Used to verify that instant and scheduled produce the same listings
 *
 * @param listings - Listings to hash
 * @returns Deterministic signature string
 */
export function hashListingPool(listings: ScrapedListing[]): string {
  const sortedListings = [...listings].sort((a, b) => {
    if (a.listing_url !== b.listing_url) {
      return a.listing_url.localeCompare(b.listing_url);
    }
    return a.price - b.price;
  });

  const signature = sortedListings.map(l => ({
    url: l.listing_url,
    price: Math.round(l.price * 100) / 100,
    title: l.title.substring(0, 50),
  }));

  return JSON.stringify(signature);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PURE PARSER EXPORTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Re-export the pure parsing functions from parsers module.
 * These are the SINGLE SOURCE OF TRUTH for all parsing logic.
 */

export {
  coreParseSearchPage,
  selectParserByHostname,
  buildPaginatedUrl,
  detectTotalPages,
  normalizeListingUrl,
  type MarketplaceParser,
} from './parsers';
