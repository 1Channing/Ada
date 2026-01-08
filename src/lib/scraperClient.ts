/**
 * Scraper Client Module
 *
 * Real implementation using Zyte Web Scraping API to fetch marketplace listings.
 *
 * PAGINATION SUPPORT:
 * - Marktplaats: Scrapes up to 10 pages, detects pages via /p/<n>/ patterns with defensive fallback
 * - Leboncoin: Scrapes up to 20 pages, detects via __NEXT_DATA__ or iterative mode
 * - Other domains: Single-page scraping only
 *
 * Safety controls: Early stop after 2 consecutive empty pages, 300-900ms delay between requests.
 *
 * CRASH-SAFE PERSISTENCE:
 * - Page-level progress saved incrementally to study_scrape_pages table
 * - Analytics only - does NOT affect scoring, ranking, or opportunities
 * - Enables recovery and data engine usage
 *
 * NON-REGRESSION GUARANTEE:
 * Pagination ONLY increases candidate pool size. It does NOT modify:
 * - Median price calculation
 * - Opportunity detection logic
 * - Ranking/scoring algorithms
 * - Buy/sell decision thresholds
 * - Source/target comparison logic
 */

import { supabase } from './supabase';
import {
  toEur as toEurEngine,
  shouldFilterListing as shouldFilterListingEngine,
  filterListingsByStudy as filterListingsByStudyEngine,
  computeTargetMarketStats as computeTargetMarketStatsEngine,
  matchesBrandModel as matchesBrandModelEngine,
  executeStudyAnalysis,
  type MarketStats,
} from './study-engine';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SCRAPER CLIENT - BROWSER ENVIRONMENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module handles scraping in the browser environment.
 *
 * **UNIFIED PIPELINE:**
 * - Business logic: Delegates to study-core via study-engine.ts
 * - Scraping logic: Remains here (browser-specific HTML parsing)
 *
 * **WHAT IS SHARED:**
 * - Filtering rules (toEur, shouldFilterListing, filterListingsByStudy)
 * - Statistics computation (computeTargetMarketStats)
 * - Opportunity detection (executeStudyAnalysis)
 *
 * **WHAT IS ENVIRONMENT-SPECIFIC:**
 * - fetchHtmlWithScraper() - Browser fetch API
 * - parseMarktplaatsListings() - DOM-compatible parsing
 * - parseLeboncoinListings() - Browser JSON parsing
 * - UI-specific features (thumbnails, progress callbacks)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ZYTE_API_KEY =
  (import.meta.env.VITE_ZYTE_API_KEY as string | undefined) ||
  (import.meta.env.ZYTE_API_KEY as string | undefined) ||
  '';

const ZYTE_ENDPOINT = 'https://api.zyte.com/v1/extract';

const MAX_PAGES_MARKTPLAATS = 10;
const MAX_PAGES_LEBONCOIN = 20;
const PAGINATION_DELAY_MIN_MS = 300;
const PAGINATION_DELAY_MAX_MS = 900;

export type Currency = 'EUR' | 'DKK' | 'UNKNOWN';

export interface ScrapedListing {
  title: string;
  price: number;
  currency: Currency;
  mileage: number | null;
  year: number | null;
  trim: string | null;
  listing_url: string;
  description: string;
  price_type: 'one-off' | 'per-month' | 'unknown';
  thumbnailUrl: string | null;
}

export interface DetailedListing extends ScrapedListing {
  full_description: string;
  technical_info: string | null;
  options: string[];
  car_image_urls: string[];
}

export interface SearchResult {
  listings: ScrapedListing[];
  blockedByProvider?: boolean;
  blockReason?: string;
  error?: 'SCRAPER_FAILED';
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * DELEGATED TO STUDY ENGINE - DO NOT MODIFY
 * ════════════════════════════════════════════════════════════════════════════
 * This function delegates to the Study Execution Engine (study-engine.ts).
 * ALL business logic modifications MUST be made in study-engine.ts.
 */
export function toEur(price: number, currency: Currency): number {
  return toEurEngine(price, currency);
}

let zyteKeyWarningShown = false;

/**
 * Fetches HTML from a URL using Zyte Web Scraping API.
 */
function isNetworkError(error: unknown, statusCode?: number, responseBody?: string): boolean {
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
  if (responseBody && responseBody.toLowerCase().includes('network')) return true;

  return false;
}

async function fetchHtmlWithScraper(targetUrl: string): Promise<string | null> {
  if (!targetUrl) {
    console.error('[SCRAPER] Missing targetUrl');
    return null;
  }

  if (!ZYTE_API_KEY) {
    if (!zyteKeyWarningShown) {
      console.error('[SCRAPER] Missing Zyte API key. Please set VITE_ZYTE_API_KEY or ZYTE_API_KEY in your .env file.');
      zyteKeyWarningShown = true;
    }
    return null;
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [500, 1000, 2000];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        const delay = RETRY_DELAYS[attempt - 2];
        console.log(`[SCRAPER] Retry attempt ${attempt}/${MAX_RETRIES} after ${delay}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      console.log('[SCRAPER] Using Zyte API key:', ZYTE_API_KEY ? 'present' : 'missing');
      console.log('[SCRAPER] Calling Zyte /v1/extract for target URL:', targetUrl.slice(0, 200));

      const authHeader = `Basic ${btoa(ZYTE_API_KEY + ':')}`;
      console.log('[SCRAPER] Using Basic auth (API key as username, empty password)');

      const requestBody = {
        url: targetUrl,
        browserHtml: true,
      };

      console.log('[SCRAPER] Request body:', JSON.stringify(requestBody, null, 2));

      const response = await fetch(ZYTE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(requestBody),
      });

      const text = await response.text();

      if (!response.ok) {
        if (isNetworkError(null, response.status, text)) {
          console.warn(`[SCRAPER] Network error (HTTP ${response.status}) on attempt ${attempt}/${MAX_RETRIES}`);
          if (attempt < MAX_RETRIES) continue;
        }

        console.error('[SCRAPER] Zyte HTTP error:', {
          status: response.status,
          statusText: response.statusText,
          requestBody: JSON.stringify(requestBody),
          responseBody: text,
        });
        return null;
      }

      let data: any;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('[SCRAPER] Failed to parse Zyte JSON response', e);
        return null;
      }

      const html: string =
        data.browserHtml ??
        data.httpResponseBody ??
        data.html ??
        '';

      if (!html) {
        console.warn('[SCRAPER] Zyte response has no HTML fields', {
          keys: Object.keys(data),
        });
        return null;
      }

      if (html.length < 100) {
        console.warn('[SCRAPER] Zyte returned very short HTML', {
          length: html.length,
          snippet: html.slice(0, 300),
        });
      } else {
        console.log('[SCRAPER] Zyte fetched bytes:', html.length);
      }

      return html;
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn(`[SCRAPER] Network error on attempt ${attempt}/${MAX_RETRIES}:`, error instanceof Error ? error.message : String(error));
        if (attempt < MAX_RETRIES) continue;
      }

      console.error('[SCRAPER] Zyte network/error', error);
      if (error instanceof Error) {
        console.error('[SCRAPER] Error message:', error.message);
        console.error('[SCRAPER] Error stack:', error.stack);
      }

      if (attempt < MAX_RETRIES) continue;
      break;
    }
  }

  console.error('[SCRAPER] Zyte unreachable, all retries failed');
  return null;
}

const DKK_TO_EUR = 0.134;
let priceParseFailures = 0;
const MAX_PRICE_PARSE_LOGS = 5;

/**
 * Universal Euro price extractor.
 * Handles formats: € 24.650,-, €24 650, 24.650 EUR, €24.650,00, €24 650,-
 * Returns null if not parsable. Never throws.
 */
export function extractEuroPrice(text: string): number | null {
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
        const snippet = text.substring(0, 80);
        console.log(`[PRICE] Extracted price: ${price} EUR from snippet: "${snippet}"`);
        return price;
      }
    }
  }

  return null;
}

/**
 * Converts DKK to EUR.
 */
export function convertDkkToEur(dkk: number): number {
  const eur = Math.round(dkk * DKK_TO_EUR);
  console.log(`[PRICE] Parsed DKK price ${dkk} → ${eur} EUR`);
  return eur;
}

/**
 * Extracts price from text and converts to EUR.
 * Supports EUR and DKK currencies.
 */
function extractPrice(text: string): number | null {
  const normalizedText = text.replace(/\u00A0/g, ' ');

  const eurPrice = extractEuroPrice(normalizedText);
  if (eurPrice !== null) {
    return eurPrice;
  }

  const dkkPatterns = [
    /(\d[\d\s.,']+)\s*kr\.?/i,
    /kr\.?\s*(\d[\d\s.,']+)/i,
    /(\d[\d\s.,']+)\s*DKK\b/i,
  ];

  for (const pattern of dkkPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const numStr = match[1].replace(/[\s.,']/g, '');
      const priceDkk = parseInt(numStr, 10);
      if (!isNaN(priceDkk) && priceDkk > 100 && priceDkk < 5000000) {
        return convertDkkToEur(priceDkk);
      }
    }
  }

  if (priceParseFailures < MAX_PRICE_PARSE_LOGS) {
    const snippet = text.substring(0, 150);
    console.log('[SCRAPER_PARSE] Failed to extract price from card snippet:', snippet);
    priceParseFailures++;
  }

  return null;
}

/**
 * Extracts thumbnail URL from card HTML.
 * Tries img[src] and img[data-src].
 */
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
 * Token-based brand/model matching.
 * Splits model into tokens and checks if all tokens are present in title.
 */
/**
 * ════════════════════════════════════════════════════════════════════════════
 * DELEGATED TO STUDY ENGINE - DO NOT MODIFY
 * ════════════════════════════════════════════════════════════════════════════
 * This function delegates to the Study Execution Engine (study-engine.ts).
 * ALL brand/model matching logic MUST be in study-engine.ts.
 */
export function matchesBrandModel(
  title: string,
  brand: string,
  model: string
): { matches: boolean; reason: string } {
  return matchesBrandModelEngine(title, brand, model);
}

/**
 * Extracts year from text (4-digit number 2000-current year).
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

/**
 * Extracts mileage from text (kilometers).
 */
function extractMileage(text: string): number | null {
  // Replace non-breaking spaces with regular spaces
  const normalizedText = text.replace(/\u00A0/g, ' ');

  const mileagePatterns = [
    /(\d[\d\s.,']*?)\s*km\b/i,
    /(\d[\d\s.,']*?)km\b/i,  // No space before km
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

/**
 * Detects if price is monthly (leasing indicator).
 */
function isPriceMonthly(text: string): boolean {
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

/**
 * Detects damaged vehicles (multi-language).
 * Returns true if the listing contains damage-related keywords.
 */
export function isDamagedVehicle(text: string): boolean {
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
 * Detects currency from URL and text content.
 */
function detectCurrency(url: string, text: string): Currency {
  const urlLower = url.toLowerCase();
  const textLower = text.toLowerCase();

  if (urlLower.includes('.dk') || urlLower.includes('bilbasen') || textLower.includes(' kr')) {
    return 'DKK';
  }

  return 'EUR';
}

let skippedCardsCount = 0;
const MAX_SKIPPED_CARD_LOGS = 5;
let debugSnippetShown = false;
let loggedHtmlDebugOnce = false;
let anchorDebugLogged = false;

/**
 * Logs first 30 anchors for debugging on Leboncoin and Gaspedaal.
 */
function debugAnchors(html: string, hostname: string): void {
  if (anchorDebugLogged) return;

  if (!hostname.includes('leboncoin.fr') && !hostname.includes('gaspedaal.nl')) {
    return;
  }

  anchorDebugLogged = true;

  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches = Array.from(html.matchAll(anchorRegex)).slice(0, 30);

  console.log(`[SCRAPER_ANCHOR_DEBUG] Found ${matches.length} anchors to inspect for domain: ${hostname}`);

  matches.forEach((match, index) => {
    const href = match[1];
    const innerHTML = match[2];
    const textSnippet = innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 80);

    console.log('[SCRAPER_ANCHOR]', {
      domain: hostname,
      index,
      href: href.substring(0, 100),
      textSnippet,
    });
  });
}

/**
 * Parses HTML to extract listing cards from search results page.
 */
function parseSearchResultsHtml(html: string, searchUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  // Reset per-run counters
  priceParseFailures = 0;
  skippedCardsCount = 0;
  debugSnippetShown = false;
  anchorDebugLogged = false;

  // Extract hostname for domain-aware debugging
  let hostname = 'unknown';
  try {
    hostname = new URL(searchUrl).hostname;
  } catch (e) {
    console.warn('[SCRAPER_PARSE] Could not parse hostname from searchUrl:', searchUrl);
  }

  const isLeboncoin = hostname.includes('leboncoin.fr');
  const isGaspedaal = hostname.includes('gaspedaal.nl');

  // Debug anchors for these specific domains
  if (isLeboncoin || isGaspedaal) {
    debugAnchors(html, hostname);
  }

  // Try standard card extraction first
  const listingPatterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]*class="[^"]*listing[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<li[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    /<div[^>]*class="[^"]*ad[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];

  let cards: string[] = [];
  for (const pattern of listingPatterns) {
    const matches = html.matchAll(pattern);
    const found = Array.from(matches).map(m => m[0]);
    if (found.length > cards.length) {
      cards = found;
    }
  }

  console.log(`[SCRAPER] Found ${cards.length} potential listing cards using standard patterns`);

  // Process standard cards if found
  for (const card of cards) {
    const textContent = card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    const title = extractTitle(card);
    const price = extractPrice(textContent);
    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);
    const listingUrl = extractListingUrl(card, searchUrl);
    const description = textContent.substring(0, 300);
    const priceType = isPriceMonthly(textContent) ? 'per-month' : 'one-off';
    const currency = detectCurrency(searchUrl, textContent);

    const hasPrice = price !== null;
    const hasUrl = listingUrl !== null;

    if (!hasPrice || !hasUrl) {
      if (skippedCardsCount < MAX_SKIPPED_CARD_LOGS) {
        console.log('[SCRAPER_PARSE] Skipping card: missing price and/or url', {
          hasPrice,
          hasUrl,
          domain: hostname,
        });
        skippedCardsCount++;
      }
      continue;
    }

    const thumbnailUrl = extractThumbnail(card);

    listings.push({
      title: title || 'Untitled',
      price,
      currency,
      mileage: mileage || null,
      year: year || null,
      trim: null,
      listing_url: listingUrl,
      description,
      price_type: priceType,
      thumbnailUrl,
    });
  }

  // Leboncoin: Use anchor-based fallback if we got 0 listings
  if (isLeboncoin && listings.length === 0) {
    console.log('[SCRAPER] Using Leboncoin anchor-based fallback');
    const leboncoinListings = extractLeboncoinListingsFromAnchors(html, searchUrl);
    listings.push(...leboncoinListings);
    console.log('[SCRAPER_LEBONCOIN] Parsed anchors:', {
      keptListings: leboncoinListings.length,
    });
  }

  // Gaspedaal: Use anchor-based fallback if we got 0 listings
  if (isGaspedaal && listings.length === 0) {
    console.log('[SCRAPER] Using Gaspedaal anchor-based fallback');
    const gaspedaalListings = extractGaspedaalListingsFromAnchors(html, searchUrl);
    listings.push(...gaspedaalListings);
    console.log('[SCRAPER_GASPEDAAL] Parsed anchors:', {
      keptListings: gaspedaalListings.length,
    });
  }

  // Debug: If we extracted 0 listings but had cards, show first card snippet
  if (listings.length === 0 && cards.length > 0 && !debugSnippetShown) {
    const firstCard = cards[0];
    console.log('[SCRAPER_DEBUG] First card HTML snippet for domain', hostname, ':', firstCard.slice(0, 1000));
    debugSnippetShown = true;
  }

  // Extra debug: if no listings extracted at all, show HTML snippet
  if (!loggedHtmlDebugOnce && listings.length === 0) {
    loggedHtmlDebugOnce = true;
    const snippet = html.slice(0, 2000);
    console.log('[SCRAPER_DEBUG] No listings extracted. First 2000 chars of HTML:', snippet);
  }

  return listings;
}

/**
 * Extracts Leboncoin listings from anchor tags.
 */
function extractLeboncoinListingsFromAnchors(html: string, searchUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches = Array.from(html.matchAll(anchorRegex));

  let skipped = 0;
  let totalAnchors = 0;

  for (const match of matches) {
    const href = match[1];
    const innerHTML = match[2];
    const anchorBlock = match[0];

    // Skip non-car-listing anchors
    if (href.startsWith('#') || href.startsWith('javascript:') ||
        href.match(/\.(jpg|jpeg|png|gif|css|js)$/i)) {
      continue;
    }

    // Check if this looks like a car listing
    const isCarListing =
      href.includes('/voitures/') ||
      href.includes('category=2') ||
      href.includes('ad=') ||
      href.includes('annonce');

    if (!isCarListing) {
      continue;
    }

    totalAnchors++;

    // Extract data from anchor block
    const textContent = (href + ' ' + innerHTML).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const price = extractPrice(textContent);
    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);

    // Extract title from innerHTML
    let title = innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (title.length > 100) {
      title = title.substring(0, 100);
    }
    if (!title || title.length < 3) {
      title = 'Untitled';
    }

    // Normalize URL
    let normalizedUrl = href;
    if (href.startsWith('/')) {
      normalizedUrl = `https://www.leboncoin.fr${href}`;
    } else if (!href.startsWith('http')) {
      normalizedUrl = `https://www.leboncoin.fr/${href}`;
    }

    const hasPrice = price !== null;
    const hasUrl = normalizedUrl.length > 10;

    if (!hasPrice || !hasUrl) {
      if (skipped < MAX_SKIPPED_CARD_LOGS) {
        console.log('[SCRAPER_PARSE] Skipping leboncoin anchor (missing price or url)', {
          hasPrice,
          hasUrl,
          href: href.substring(0, 80),
        });
        skipped++;
      }
      continue;
    }

    const priceType = isPriceMonthly(textContent) ? 'per-month' : 'one-off';
    const currency = detectCurrency(searchUrl, textContent);
    const thumbnailUrl = extractThumbnail(anchorBlock);

    listings.push({
      title,
      price,
      currency,
      mileage: mileage || null,
      year: year || null,
      trim: null,
      listing_url: normalizedUrl,
      description: textContent.substring(0, 300),
      price_type: priceType,
      thumbnailUrl,
    });
  }

  console.log(`[SCRAPER_LEBONCOIN] Total car anchors inspected: ${totalAnchors}, kept: ${listings.length}`);

  return listings;
}

/**
 * Extracts Gaspedaal listings from anchor tags.
 */
function extractGaspedaalListingsFromAnchors(html: string, searchUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches = Array.from(html.matchAll(anchorRegex));

  let skipped = 0;
  let totalAnchors = 0;

  for (const match of matches) {
    const href = match[1];
    const innerHTML = match[2];
    const anchorBlock = match[0];

    // Skip non-car-listing anchors
    if (href.startsWith('#') || href.startsWith('javascript:') ||
        href.match(/\.(jpg|jpeg|png|gif|css|js)$/i)) {
      continue;
    }

    // Check if this looks like a car listing
    const isCarListing =
      href.includes('gaspedaal.nl') ||
      href.includes('/auto/') ||
      href.includes('/autos/') ||
      (href.startsWith('/') && !href.includes('/search') && !href.includes('/footer'));

    if (!isCarListing) {
      continue;
    }

    totalAnchors++;

    // Extract data from anchor block
    const textContent = (href + ' ' + innerHTML).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const price = extractPrice(textContent);
    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);

    // Extract title from innerHTML
    let title = innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (title.length > 100) {
      title = title.substring(0, 100);
    }
    if (!title || title.length < 3) {
      title = 'Untitled';
    }

    // Normalize URL
    let normalizedUrl = href;
    if (href.startsWith('/')) {
      normalizedUrl = `https://www.gaspedaal.nl${href}`;
    } else if (!href.startsWith('http')) {
      normalizedUrl = `https://www.gaspedaal.nl/${href}`;
    }

    const hasPrice = price !== null;
    const hasUrl = normalizedUrl.length > 10;

    if (!hasPrice || !hasUrl) {
      if (skipped < MAX_SKIPPED_CARD_LOGS) {
        console.log('[SCRAPER_PARSE] Skipping gaspedaal anchor (missing price or url)', {
          hasPrice,
          hasUrl,
          href: href.substring(0, 80),
        });
        skipped++;
      }
      continue;
    }

    const priceType = isPriceMonthly(textContent) ? 'per-month' : 'one-off';
    const currency = detectCurrency(searchUrl, textContent);
    const thumbnailUrl = extractThumbnail(anchorBlock);

    listings.push({
      title,
      price,
      currency,
      mileage: mileage || null,
      year: year || null,
      trim: null,
      listing_url: normalizedUrl,
      description: textContent.substring(0, 300),
      price_type: priceType,
      thumbnailUrl,
    });
  }

  console.log(`[SCRAPER_GASPEDAAL] Total car anchors inspected: ${totalAnchors}, kept: ${listings.length}`);

  return listings;
}

/**
 * Extracts title from card HTML.
 */
function extractTitle(cardHtml: string): string | null {
  const titlePatterns = [
    /<h[1-6][^>]*>(.*?)<\/h[1-6]>/i,
    /<a[^>]*title="([^"]+)"/i,
    /<span[^>]*class="[^"]*title[^"]*"[^>]*>(.*?)<\/span>/i,
  ];

  for (const pattern of titlePatterns) {
    const match = cardHtml.match(pattern);
    if (match) {
      const title = match[1].replace(/<[^>]+>/g, '').trim();
      if (title.length > 5) {
        return title;
      }
    }
  }
  return null;
}

/**
 * Extracts listing URL from card HTML.
 */
function extractListingUrl(cardHtml: string, baseUrl: string): string | null {
  const urlPattern = /<a[^>]*href="([^"]+)"/i;
  const match = cardHtml.match(urlPattern);

  if (match) {
    let url = match[1];

    if (url.startsWith('/')) {
      const baseUrlObj = new URL(baseUrl);
      url = `${baseUrlObj.protocol}//${baseUrlObj.host}${url}`;
    } else if (!url.startsWith('http')) {
      return null;
    }

    return url;
  }

  return null;
}

/**
 * Extracts car image URLs from Leboncoin detail page.
 * Only takes images from the main gallery, ignores ads and site UI.
 */
function extractLeboncoinCarImages(html: string): string[] {
  const imageUrls: string[] = [];

  try {
    const nextDataPatterns = [
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i,
      /<script\s+type=["']application\/json["'][^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    ];

    let nextDataMatch = null;
    for (const pattern of nextDataPatterns) {
      nextDataMatch = html.match(pattern);
      if (nextDataMatch) {
        break;
      }
    }

    if (nextDataMatch) {
      const jsonText = nextDataMatch[1];
      const data = JSON.parse(jsonText);

      console.log('[IMAGE_EXTRACT_DEBUG] Found __NEXT_DATA__, top-level keys:', Object.keys(data).join(', '));

      if (data.props) {
        console.log('[IMAGE_EXTRACT_DEBUG] data.props keys:', Object.keys(data.props).join(', '));
        if (data.props.pageProps) {
          console.log('[IMAGE_EXTRACT_DEBUG] data.props.pageProps keys:', Object.keys(data.props.pageProps).join(', '));
        }
      }

      console.log('[IMAGE_EXTRACT_DEBUG] Checking known image paths...');

      const possibleImagePaths = [
        data?.props?.pageProps?.ad?.images,
        data?.props?.pageProps?.adView?.images,
        data?.props?.pageProps?.listing?.images,
        data?.props?.initialState?.ad?.images,
        data?.props?.pageProps?.ad?.body?.images,
        data?.props?.pageProps?.adData?.images,
        data?.props?.pageProps?.data?.ad?.images,
        data?.props?.pageProps?.ad?.images_thumbs,
        data?.props?.pageProps?.ad?.pictures,
      ];

      for (let pathIndex = 0; pathIndex < possibleImagePaths.length; pathIndex++) {
        const images = possibleImagePaths[pathIndex];
        if (Array.isArray(images) && images.length > 0) {
          console.log(`[IMAGE_EXTRACT_DEBUG] Found images array at path index ${pathIndex}, length: ${images.length}`);
          console.log(`[IMAGE_EXTRACT_DEBUG] First image structure:`, JSON.stringify(images[0]).slice(0, 200));

          for (const img of images.slice(0, 10)) {
            let url: string | null = null;

            if (typeof img === 'string') {
              url = img;
            } else if (typeof img === 'object' && img !== null) {
              url = img?.urls?.xlarge ||
                    img?.urls?.large ||
                    img?.urls?.medium ||
                    img?.urls?.small ||
                    img?.urls?.thumb ||
                    img?.url ||
                    img?.href ||
                    img?.src ||
                    img?.thumb_url;
            }

            if (typeof url === 'string' &&
                url.startsWith('http') &&
                !url.includes('logo') &&
                !url.includes('ad-banner') &&
                !url.includes('favicon')) {
              imageUrls.push(url);
            }
          }

          if (imageUrls.length > 0) {
            console.log(`[IMAGE_EXTRACT_DEBUG] Extracted ${imageUrls.length} images from known paths, first URL: ${imageUrls[0].slice(0, 80)}...`);
            break;
          }
        }
      }

      if (imageUrls.length === 0) {
        console.log('[IMAGE_EXTRACT_DEBUG] No images found in known paths, performing comprehensive deep search...');
        const foundImages = findImagesInObject(data, 0, 8, '', []);
        if (foundImages.length > 0) {
          console.log(`[IMAGE_EXTRACT_DEBUG] Deep search found ${foundImages.length} potential images`);
          imageUrls.push(...foundImages.slice(0, 10));
        } else {
          console.warn('[IMAGE_EXTRACT_DEBUG] Deep search found NO images - the data structure may have changed significantly');
        }
      }
    } else {
      console.warn('[IMAGE_EXTRACT] No __NEXT_DATA__ found in HTML');
    }
  } catch (error) {
    console.warn('[IMAGE_EXTRACT] Error extracting Leboncoin images:', error);
  }

  if (imageUrls.length > 0) {
    console.log(`[IMAGE_EXTRACT] ✅ Extracted ${imageUrls.length} Leboncoin car images, first URL: ${imageUrls[0].slice(0, 100)}...`);
  } else {
    console.warn(`[IMAGE_EXTRACT] ⚠️ Extracted 0 Leboncoin car images - no images found`);
  }

  return imageUrls;
}

function findImagesInObject(
  obj: any,
  depth = 0,
  maxDepth = 8,
  path = '',
  allImages: string[] = []
): string[] {
  if (depth > maxDepth) return allImages;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];

      if (typeof item === 'string' && item.startsWith('http')) {
        if (
          (item.includes('leboncoin') || item.includes('img')) &&
          !item.includes('logo') &&
          !item.includes('favicon') &&
          !item.includes('ad-banner')
        ) {
          if (!allImages.includes(item)) {
            console.log(`[IMAGE_EXTRACT_DEBUG] Found image URL in array at ${path}[${i}]: ${item.slice(0, 80)}...`);
            allImages.push(item);
          }
        }
      } else if (typeof item === 'object' && item !== null) {
        if (item.urls) {
          const url =
            item.urls.xlarge ||
            item.urls.large ||
            item.urls.medium ||
            item.urls.small ||
            item.urls.thumb;
          if (typeof url === 'string' && url.startsWith('http')) {
            if (!allImages.includes(url)) {
              console.log(`[IMAGE_EXTRACT_DEBUG] Found image in object.urls at ${path}[${i}]: ${url.slice(0, 80)}...`);
              allImages.push(url);
            }
          }
        } else if (item.url || item.src || item.href) {
          const url = item.url || item.src || item.href;
          if (
            typeof url === 'string' &&
            url.startsWith('http') &&
            !url.includes('logo') &&
            !url.includes('favicon')
          ) {
            if (!allImages.includes(url)) {
              console.log(`[IMAGE_EXTRACT_DEBUG] Found image in object at ${path}[${i}]: ${url.slice(0, 80)}...`);
              allImages.push(url);
            }
          }
        }

        findImagesInObject(item, depth + 1, maxDepth, `${path}[${i}]`, allImages);
      }
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key of Object.keys(obj)) {
      const newPath = path ? `${path}.${key}` : key;

      const value = obj[key];

      if (
        (key.toLowerCase().includes('image') ||
          key.toLowerCase().includes('picture') ||
          key.toLowerCase().includes('photo') ||
          key.toLowerCase().includes('media') ||
          key === 'urls') &&
        value
      ) {
        if (typeof value === 'string' && value.startsWith('http')) {
          if (!allImages.includes(value)) {
            console.log(`[IMAGE_EXTRACT_DEBUG] Found image URL at ${newPath}: ${value.slice(0, 80)}...`);
            allImages.push(value);
          }
        } else if (Array.isArray(value) || typeof value === 'object') {
          findImagesInObject(value, depth + 1, maxDepth, newPath, allImages);
        }
      } else {
        findImagesInObject(value, depth + 1, maxDepth, newPath, allImages);
      }
    }
  }

  return allImages;
}

/**
 * Extracts car image URLs from Marktplaats detail page.
 * Only takes images from the main gallery, ignores ads and site UI.
 */
function extractMarktplaatsCarImages(html: string): string[] {
  const imageUrls: string[] = [];

  try {
    const imgPattern = /<img[^>]*src=["']([^"']+)["'][^>]*alt=["'][^"']*foto[^"']*["']/gi;
    const matches = Array.from(html.matchAll(imgPattern));

    for (const match of matches.slice(0, 8)) {
      const url = match[1];
      if (url && url.startsWith('http') && !url.includes('logo') && !url.includes('banner') && !url.includes('sponsored')) {
        imageUrls.push(url);
      }
    }

    if (imageUrls.length === 0) {
      const genericImgPattern = /<img[^>]*src=["']([^"']+)["']/gi;
      const genericMatches = Array.from(html.matchAll(genericImgPattern));

      for (const match of genericMatches) {
        const url = match[1];
        if (url && url.startsWith('http') &&
            !url.includes('logo') &&
            !url.includes('banner') &&
            !url.includes('icon') &&
            !url.includes('avatar') &&
            !url.includes('sponsored') &&
            url.includes('marktplaats') &&
            (url.includes('/img/') || url.includes('/image/')) &&
            imageUrls.length < 8) {
          imageUrls.push(url);
        }
      }
    }
  } catch (error) {
    console.warn('[IMAGE_EXTRACT] Error extracting Marktplaats images:', error);
  }

  console.log(`[IMAGE_EXTRACT] Extracted ${imageUrls.length} Marktplaats car images`);
  return imageUrls;
}

/**
 * Extracts car image URLs from Bilbasen detail page.
 * Only takes images from the main gallery, ignores ads and site UI.
 */
function extractBilbasenCarImages(html: string): string[] {
  const imageUrls: string[] = [];

  try {
    const imgPattern = /<img[^>]*src=["']([^"']+)["'][^>]*class=["'][^"']*(?:gallery|listing|vehicle)[^"']*["']/gi;
    const matches = Array.from(html.matchAll(imgPattern));

    for (const match of matches.slice(0, 8)) {
      const url = match[1];
      if (url && url.startsWith('http') && !url.includes('logo') && !url.includes('banner')) {
        imageUrls.push(url);
      }
    }

    if (imageUrls.length === 0) {
      const genericImgPattern = /<img[^>]*src=["']([^"']+)["']/gi;
      const genericMatches = Array.from(html.matchAll(genericImgPattern));

      for (const match of genericMatches) {
        const url = match[1];
        if (url && url.startsWith('http') &&
            !url.includes('logo') &&
            !url.includes('banner') &&
            !url.includes('icon') &&
            url.includes('bilbasen') &&
            imageUrls.length < 8) {
          imageUrls.push(url);
        }
      }
    }
  } catch (error) {
    console.warn('[IMAGE_EXTRACT] Error extracting Bilbasen images:', error);
  }

  console.log(`[IMAGE_EXTRACT] Extracted ${imageUrls.length} Bilbasen car images`);
  return imageUrls;
}

/**
 * Extracts car image URLs from a detail page based on the marketplace.
 */
function extractCarImages(html: string, listingUrl: string): string[] {
  if (listingUrl.includes('leboncoin.fr')) {
    return extractLeboncoinCarImages(html);
  } else if (listingUrl.includes('marktplaats.nl')) {
    return extractMarktplaatsCarImages(html);
  } else if (listingUrl.includes('bilbasen.dk')) {
    return extractBilbasenCarImages(html);
  }

  return [];
}

/**
 * Parses HTML from a detail page to extract full listing information.
 */
function parseDetailPageHtml(
  html: string,
  listingUrl: string,
  originalListing?: ScrapedListing
): Partial<DetailedListing> {
  const textContent = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                          .replace(/<[^>]+>/g, ' ')
                          .replace(/\s+/g, ' ');

  const descriptionPatterns = [
    /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<p[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    /<section[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
  ];

  let fullDescription = textContent.substring(0, 2000);

  for (const pattern of descriptionPatterns) {
    const match = html.match(pattern);
    if (match) {
      fullDescription = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      break;
    }
  }

  const title = extractTitle(html) || 'Unknown listing';
  let price = 0;

  if (listingUrl.includes('leboncoin.fr')) {
    const leboncoinPrice = extractLeboncoinDetailPrice(html, listingUrl);
    if (leboncoinPrice && leboncoinPrice > 0) {
      price = leboncoinPrice;
    } else if (originalListing && originalListing.price > 0) {
      price = originalListing.price;
      console.log(`[DETAIL_PRICE_DEBUG] Failed to extract price from detail page, keeping original listing price for URL: ${listingUrl}`);
    } else {
      price = extractPrice(textContent) || 0;
    }
  } else {
    price = extractPrice(textContent) || (originalListing?.price || 0);
  }

  const year = extractYear(textContent);
  const mileage = extractMileage(textContent);
  const priceType = isPriceMonthly(textContent) ? 'per-month' : 'one-off';
  const currency = detectCurrency(listingUrl, textContent);

  const options: string[] = [];
  const optionKeywords = [
    'navigation', 'gps', 'leather', 'cuir', 'sunroof', 'toit', 'camera', 'caméra',
    'parking', 'cruise', 'bluetooth', 'heated', 'chauffants', 'xenon', 'led'
  ];

  for (const keyword of optionKeywords) {
    if (textContent.toLowerCase().includes(keyword)) {
      options.push(keyword);
    }
  }

  const car_image_urls = extractCarImages(html, listingUrl);

  return {
    title,
    price,
    currency,
    mileage,
    year,
    trim: null,
    listing_url: listingUrl,
    description: fullDescription.substring(0, 300),
    price_type: priceType,
    full_description: fullDescription,
    technical_info: null,
    options,
    car_image_urls,
  };
}

/**
 * Extracts price from Leboncoin detail page __NEXT_DATA__ JSON.
 */
function extractLeboncoinDetailPrice(html: string, listingUrl: string): number | null {
  try {
    const nextDataPatterns = [
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i,
      /<script\s+type=["']application\/json["'][^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    ];

    let nextDataMatch = null;
    for (const pattern of nextDataPatterns) {
      nextDataMatch = html.match(pattern);
      if (nextDataMatch) {
        break;
      }
    }

    if (!nextDataMatch) {
      return null;
    }

    const jsonText = nextDataMatch[1];
    const data = JSON.parse(jsonText);

    const possiblePaths = [
      data?.props?.pageProps?.ad?.price?.[0],
      data?.props?.pageProps?.adView?.price?.[0],
      data?.props?.pageProps?.listing?.price?.[0],
      data?.props?.initialState?.ad?.price?.[0],
    ];

    for (const priceValue of possiblePaths) {
      if (typeof priceValue === 'number' && priceValue > 0) {
        console.log(`[DETAIL_PRICE] Parsed Leboncoin detail price from __NEXT_DATA__: ${priceValue} EUR for URL: ${listingUrl}`);
        return priceValue;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Parses Gaspedaal listings using domain-specific selectors.
 */
function parseGaspedaalListings(html: string, searchUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  console.log('[SCRAPER_GASPEDAAL] Starting Gaspedaal-specific parsing');

  // Gaspedaal typically has listings in <article> or <div> with specific classes
  // Look for patterns like: class="listing", "car-item", "vehicle-card", etc.
  const listingPatterns = [
    // Try to find article tags with listing-related classes
    /<article[^>]*class="[^"]*(?:listing|car|vehicle|ad|item)[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
    // Try div with listing classes
    /<div[^>]*class="[^"]*(?:listing|car-card|vehicle-item|auto-item)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    // Try li elements in a list
    /<li[^>]*class="[^"]*(?:listing|car|vehicle|result)[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
  ];

  let cards: string[] = [];
  for (const pattern of listingPatterns) {
    const matches = html.matchAll(pattern);
    const found = Array.from(matches).map(m => m[0]);
    if (found.length > cards.length) {
      cards = found;
    }
  }

  console.log(`[SCRAPER_GASPEDAAL] Found ${cards.length} potential listing cards using patterns`);

  // If no cards found, try to extract from script tags with JSON data
  if (cards.length === 0) {
    console.log('[SCRAPER_GASPEDAAL] No cards found with patterns, trying JSON extraction');
    const jsonListings = extractGaspedaalJsonListings(html, searchUrl);
    if (jsonListings.length > 0) {
      console.log(`[SCRAPER_GASPEDAAL] Extracted ${jsonListings.length} listings from JSON`);
      return jsonListings;
    }
  }

  let skipped = 0;
  const MAX_LOGS = 5;

  for (const card of cards) {
    const textContent = card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Extract URL first - must be present
    const listingUrl = extractListingUrl(card, searchUrl);
    if (!listingUrl) {
      if (skipped < MAX_LOGS) {
        console.log('[SCRAPER_GASPEDAAL] Skipping card: no URL found');
        skipped++;
      }
      continue;
    }

    // Skip if URL looks like a category/filter link
    const urlLower = listingUrl.toLowerCase();
    if (urlLower.includes('zoek') || urlLower.includes('filter') ||
        urlLower.includes('category') || urlLower.includes('tot-') ||
        urlLower.match(/autos?-tot-\d+/)) {
      if (skipped < MAX_LOGS) {
        console.log('[SCRAPER_GASPEDAAL] Skipping category/filter link:', listingUrl.substring(0, 80));
        skipped++;
      }
      continue;
    }

    const price = extractPrice(textContent);
    if (!price) {
      if (skipped < MAX_LOGS) {
        console.log('[SCRAPER_GASPEDAAL] Skipping card: no price found in', textContent.substring(0, 100));
        skipped++;
      }
      continue;
    }

    const title = extractTitle(card) || 'Untitled';
    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);
    const priceType = isPriceMonthly(textContent) ? 'per-month' : 'one-off';
    const currency = detectCurrency(searchUrl, textContent);
    const thumbnailUrl = extractThumbnail(card);

    listings.push({
      title,
      price,
      currency,
      mileage: mileage || null,
      year: year || null,
      trim: null,
      listing_url: listingUrl,
      description: textContent.substring(0, 300),
      price_type: priceType,
      thumbnailUrl,
    });
  }

  console.log(`[SCRAPER_GASPEDAAL] Parsed ${cards.length} cards, kept ${listings.length} listings, skipped ${skipped}`);

  return listings;
}

/**
 * Extracts Gaspedaal listings from embedded JSON data.
 */
function extractGaspedaalJsonListings(html: string, searchUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  try {
    // Look for JSON data in script tags
    const scriptPatterns = [
      /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
      /<script[^>]*>([\s\S]*?window\.__INITIAL_STATE__[\s\S]*?)<\/script>/gi,
    ];

    for (const pattern of scriptPatterns) {
      const matches = html.matchAll(pattern);
      for (const match of matches) {
        try {
          const jsonText = match[1];
          const data = JSON.parse(jsonText);

          // Try to find listings array in various possible paths
          const possiblePaths = [
            data?.props?.pageProps?.listings,
            data?.props?.pageProps?.results,
            data?.props?.pageProps?.data?.listings,
            data?.listings,
            data?.results,
            data?.data?.listings,
          ];

          for (const listingsArray of possiblePaths) {
            if (Array.isArray(listingsArray) && listingsArray.length > 0) {
              console.log(`[SCRAPER_GASPEDAAL] Found ${listingsArray.length} listings in JSON`);

              for (const item of listingsArray) {
                const price = item.price || item.askingPrice || item.priceAmount;
                const url = item.url || item.link || item.href || item.detailUrl;

                if (price && url) {
                  let normalizedUrl = url;
                  if (url.startsWith('/')) {
                    normalizedUrl = `https://www.gaspedaal.nl${url}`;
                  }

                  listings.push({
                    title: item.title || item.name || item.description || 'Untitled',
                    price: typeof price === 'number' ? price : parseInt(String(price).replace(/\D/g, ''), 10),
                    currency: 'EUR',
                    mileage: item.mileage || item.mileageKm || item.kilometers || null,
                    year: item.year || item.modelYear || item.registrationYear || null,
                    trim: item.trim || null,
                    listing_url: normalizedUrl,
                    description: item.description || item.summary || '',
                    price_type: 'one-off',
                    thumbnailUrl: item.image || item.thumbnail || item.imageUrl || null,
                  });
                }
              }

              return listings;
            }
          }
        } catch (e) {
          // Continue to next script tag
          continue;
        }
      }
    }
  } catch (error) {
    console.warn('[SCRAPER_GASPEDAAL] Error extracting JSON listings:', error);
  }

  return listings;
}

/**
 * Parses Leboncoin listings from __NEXT_DATA__ or embedded JSON.
 */
function parseLeboncoinListings(html: string, searchUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  console.log('[SCRAPER_LEBONCOIN] Starting Leboncoin-specific parsing');

  // Try multiple patterns to find __NEXT_DATA__ or similar JSON
  const nextDataPatterns = [
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script\s+type=["']application\/json["'][^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  ];

  let nextDataMatch = null;
  for (const pattern of nextDataPatterns) {
    nextDataMatch = html.match(pattern);
    if (nextDataMatch) {
      console.log('[SCRAPER_LEBONCOIN] Found __NEXT_DATA__ with pattern');
      break;
    }
  }

  if (!nextDataMatch) {
    console.log('[SCRAPER_LEBONCOIN] No __NEXT_DATA__ found, trying alternative JSON sources');
    return extractLeboncoinAlternativeJson(html, searchUrl);
  }

  try {
    const jsonText = nextDataMatch[1];
    const data = JSON.parse(jsonText);

    console.log('[SCRAPER_LEBONCOIN] Successfully parsed __NEXT_DATA__');

    // Navigate through the Next.js data structure to find listings
    // Common paths in Leboncoin's structure:
    const possiblePaths = [
      data?.props?.pageProps?.searchData?.ads,
      data?.props?.pageProps?.ads,
      data?.props?.pageProps?.listings,
      data?.props?.initialState?.search?.results,
      data?.props?.pageProps?.data?.ads,
      data?.props?.pageProps?.initialData?.ads,
    ];

    let adsArray: any[] = [];

    for (const path of possiblePaths) {
      if (Array.isArray(path) && path.length > 0) {
        adsArray = path;
        console.log(`[SCRAPER_LEBONCOIN] Found ${adsArray.length} ads in __NEXT_DATA__ at known path`);
        break;
      }
    }

    if (adsArray.length === 0) {
      console.log('[SCRAPER_LEBONCOIN] No ads array found in known paths, trying deep search');
      adsArray = findAdsInObject(data);
      if (adsArray.length > 0) {
        console.log(`[SCRAPER_LEBONCOIN] Deep search found ${adsArray.length} ads`);
      }
    }

    let skipped = 0;
    const MAX_LOGS = 5;

    for (const ad of adsArray) {
      try {
        // Extract price
        const priceValue = ad.price?.[0] || ad.price || ad.priceValue || ad.amount;
        const price = typeof priceValue === 'number' ? priceValue :
                     typeof priceValue === 'string' ? parseInt(priceValue.replace(/\D/g, ''), 10) : null;

        // Extract URL
        let url = ad.url || ad.link || ad.href || ad.urlPath || ad.slug;
        if (url && url.startsWith('/')) {
          url = `https://www.leboncoin.fr${url}`;
        }

        if (!price || !url) {
          if (skipped < MAX_LOGS) {
            console.log('[SCRAPER_LEBONCOIN] Skipping ad: missing price or url', {
              hasPrice: !!price,
              hasUrl: !!url,
              title: ad.subject || ad.title
            });
            skipped++;
          }
          continue;
        }

        // Extract vehicle attributes
        const attributes = ad.attributes || ad.vehicleAttributes || {};
        const year = attributes.regdate || attributes.year || ad.year || null;
        const mileage = attributes.mileage || attributes.mileageKm || ad.mileage || null;
        const thumbnailUrl = ad.images?.[0]?.urls?.small || ad.images?.[0] || ad.image || ad.thumbnail || null;

        listings.push({
          title: ad.subject || ad.title || ad.name || 'Untitled',
          price,
          currency: 'EUR',
          mileage: mileage ? (typeof mileage === 'number' ? mileage : parseInt(String(mileage).replace(/\D/g, ''), 10)) : null,
          year: year ? (typeof year === 'number' ? year : parseInt(String(year), 10)) : null,
          trim: attributes.trim || null,
          listing_url: url,
          description: ad.body || ad.description || '',
          price_type: 'one-off',
          thumbnailUrl,
        });
      } catch (err) {
        console.warn('[SCRAPER_LEBONCOIN] Error parsing individual ad:', err);
        continue;
      }
    }

    console.log(`[SCRAPER_LEBONCOIN] Parsed ${adsArray.length} ads from JSON, kept ${listings.length} listings`);

  } catch (error) {
    console.error('[SCRAPER_LEBONCOIN] Error parsing __NEXT_DATA__:', error);
  }

  return listings;
}

/**
 * Deep search for ads array in Leboncoin JSON object.
 */
function findAdsInObject(obj: any, depth = 0, maxDepth = 10): any[] {
  if (depth > maxDepth) return [];

  if (Array.isArray(obj)) {
    // Check if this looks like an ads array
    if (obj.length > 0 && obj[0]?.subject && obj[0]?.price) {
      return obj;
    }
  }

  if (typeof obj === 'object' && obj !== null) {
    for (const key of Object.keys(obj)) {
      if (key === 'ads' || key === 'listings' || key === 'results') {
        if (Array.isArray(obj[key]) && obj[key].length > 0) {
          return obj[key];
        }
      }

      const result = findAdsInObject(obj[key], depth + 1, maxDepth);
      if (result.length > 0) {
        return result;
      }
    }
  }

  return [];
}

/**
 * Alternative JSON extraction for Leboncoin.
 */
function extractLeboncoinAlternativeJson(html: string, searchUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  console.log('[SCRAPER_LEBONCOIN] Searching for alternative JSON sources');

  try {
    // Look for any script tags (including those without type="application/json")
    const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    const matches = Array.from(html.matchAll(scriptPattern));

    console.log(`[SCRAPER_LEBONCOIN] Found ${matches.length} script tags to inspect`);

    let scriptsWithAds = 0;

    for (const match of matches) {
      try {
        const scriptContent = match[1].trim();

        // Skip empty or very short scripts
        if (scriptContent.length < 100) continue;

        // Look for scripts that might contain ads data
        // Check if script contains JSON-like structures with ad-related keywords
        const hasAdKeywords = scriptContent.includes('"ads"') ||
                             scriptContent.includes('"listings"') ||
                             scriptContent.includes('"subject"') ||
                             scriptContent.includes('"price"') ||
                             scriptContent.includes('adList');

        if (!hasAdKeywords) continue;

        scriptsWithAds++;

        // Try to parse as JSON
        let data = null;
        try {
          data = JSON.parse(scriptContent);
        } catch (e) {
          // Not valid JSON, try to extract JSON from variable assignments
          // Pattern: window.__DATA__ = {...}; or var data = {...};
          const jsonMatch = scriptContent.match(/(?:window\.\w+|var\s+\w+|const\s+\w+)\s*=\s*(\{[\s\S]*\});?/);
          if (jsonMatch) {
            try {
              data = JSON.parse(jsonMatch[1]);
            } catch (e2) {
              continue;
            }
          } else {
            continue;
          }
        }

        if (data) {
          const adsArray = findAdsInObject(data);

          if (adsArray.length > 0) {
            console.log(`[SCRAPER_LEBONCOIN] Found ${adsArray.length} ads in alternative JSON (script ${scriptsWithAds})`);

            for (const ad of adsArray) {
              const priceValue = ad.price?.[0] || ad.price || ad.priceValue;
              const price = typeof priceValue === 'number' ? priceValue :
                           typeof priceValue === 'string' ? parseInt(priceValue.replace(/\D/g, ''), 10) : null;

              let url = ad.url || ad.link || ad.href || ad.urlPath;
              if (url && url.startsWith('/')) {
                url = `https://www.leboncoin.fr${url}`;
              }

              if (price && url) {
                const attributes = ad.attributes || {};
                const thumbnailUrl = ad.images?.[0]?.urls?.small || ad.images?.[0] || ad.image || null;
                listings.push({
                  title: ad.subject || ad.title || 'Untitled',
                  price,
                  currency: 'EUR',
                  mileage: attributes.mileage || ad.mileage || null,
                  year: attributes.regdate || ad.year || null,
                  trim: null,
                  listing_url: url,
                  description: ad.body || ad.description || '',
                  price_type: 'one-off',
                  thumbnailUrl,
                });
              }
            }

            if (listings.length > 0) {
              console.log(`[SCRAPER_LEBONCOIN] Extracted ${listings.length} listings from alternative JSON`);
              return listings;
            }
          }
        }
      } catch (e) {
        continue;
      }
    }

    console.log(`[SCRAPER_LEBONCOIN] Inspected ${scriptsWithAds} scripts with ad keywords, found 0 listings`);

  } catch (error) {
    console.warn('[SCRAPER_LEBONCOIN] Error in alternative JSON extraction:', error);
  }

  console.log('[SCRAPER_LEBONCOIN] No listings found in alternative JSON sources');
  return listings;
}

/**
 * Extracts price from Marktplaats-specific formats like "€ 19.950,-" or "€ 7.500,-"
 */
function extractMarktplaatsPrice(cardHtml: string): number | null {
  const textContent = cardHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/g, '€')
    .replace(/\s+/g, ' ')
    .trim();

  const price = extractEuroPrice(textContent);

  if (!price) {
    const snippet = textContent.substring(0, 150);
    console.log(`[PRICE_DEBUG] Failed to extract price from Marktplaats snippet: "${snippet}"`);
  }

  return price;
}

/**
 * Parses Marktplaats listings using domain-specific selectors.
 */
function parseMarktplaatsListings(html: string, searchUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  console.log('[SCRAPER_MARKTPLAATS] Starting Marktplaats-specific parsing');

  // Marktplaats uses <li class="hz-Listing hz-Listing--list-item-cars"> for listing containers
  // Use a more specific pattern to avoid matching nested child elements
  const listingPattern = /<li\s+class="[^"]*hz-Listing\s+hz-Listing--list-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;

  const matches = Array.from(html.matchAll(listingPattern));
  const cards: string[] = matches.map(m => m[0]);

  console.log(`[SCRAPER_MARKTPLAATS] Found ${cards.length} potential listing cards (li.hz-Listing--list-item-*)`);

  // Debug: Log first card HTML for inspection
  if (cards.length > 0) {
    const firstCard = cards[0];
    const truncatedCard = firstCard.length > 1500 ? firstCard.substring(0, 1500) + '...[TRUNCATED]' : firstCard;
    console.log('[SCRAPER_MARKTPLAATS_DEBUG] First card HTML:', truncatedCard);
  }

  // If no cards found with patterns, try JSON extraction
  if (cards.length === 0) {
    console.log('[SCRAPER_MARKTPLAATS] No cards found, trying JSON extraction');
    const jsonListings = extractMarktplaatsJsonListings(html, searchUrl);
    if (jsonListings.length > 0) {
      console.log(`[SCRAPER_MARKTPLAATS] Extracted ${jsonListings.length} listings from JSON`);
      return jsonListings;
    }
  }

  let skipped = 0;
  const MAX_LOGS = 5;

  for (let i = 0; i < cards.length; i++) {
    const cardHtml = cards[i];

    // Extract URL - look for hz-Listing-coverLink anchor
    let listingUrl: string | null = null;

    // Try multiple patterns for the main listing link
    const urlPatterns = [
      // Pattern 1: anchor with hz-Listing-coverLink class
      /<a\s+[^>]*class="[^"]*hz-Listing-coverLink[^"]*"[^>]*href=["']([^"']+)["']/i,
      /<a\s+[^>]*href=["']([^"']+)["'][^>]*class="[^"]*hz-Listing-coverLink[^"]*"/i,
      // Pattern 2: any anchor with /v/ or /a/ in href (Marktplaats listing URLs)
      /<a\s+[^>]*href=["'](\/v\/[^"']+)["']/i,
      /<a\s+[^>]*href=["'](\/a\/[^"']+)["']/i,
      /<a\s+[^>]*href=["'](\/m\/[^"']+)["']/i,
      // Pattern 3: any anchor tag
      /<a\s+[^>]*href=["']([^"']+)["']/i,
    ];

    for (const pattern of urlPatterns) {
      const urlMatch = cardHtml.match(pattern);
      if (urlMatch) {
        let href = urlMatch[1];

        if (href.startsWith('#') || href.startsWith('javascript:')) {
          continue;
        }

        // Normalize URL
        if (href.startsWith('/')) {
          href = `https://www.marktplaats.nl${href}`;
        } else if (!href.startsWith('http')) {
          href = `https://www.marktplaats.nl/${href}`;
        }

        listingUrl = href;
        console.log(`[URL] Parsed listing URL: ${href}`);
        break;
      }
    }

    if (!listingUrl) {
      if (skipped < MAX_LOGS) {
        const cardSnippet = cardHtml.length > 300 ? cardHtml.substring(0, 300) + '...' : cardHtml;
        console.log('[SCRAPER_MARKTPLAATS] Skipping card: no URL found');
        console.log('[SCRAPER_MARKTPLAATS_DEBUG] Card snippet:', cardSnippet);
        skipped++;
      }
      continue;
    }

    // Extract price using Marktplaats-specific extractor from the full card HTML
    const price = extractMarktplaatsPrice(cardHtml);

    if (!price) {
      if (skipped < MAX_LOGS) {
        console.log('[SCRAPER_MARKTPLAATS] Skipping card: no price found');
        skipped++;
      }
      continue;
    }

    // Extract text content for other fields
    const textContent = cardHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Extract title - try multiple methods
    let title = 'Untitled';

    // Method 1: title attribute on anchor
    const titleAttrMatch = cardHtml.match(/title=["']([^"']+)["']/);
    if (titleAttrMatch) {
      title = titleAttrMatch[1].trim();
    } else {
      // Method 2: text content of the card
      const cleanText = textContent.trim();
      if (cleanText.length > 5) {
        // Take first 100 chars as title
        title = cleanText.substring(0, 100).trim();
      }
    }

    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);
    const priceType = isPriceMonthly(textContent) ? 'per-month' : 'one-off';
    const thumbnailUrl = extractThumbnail(cardHtml);

    listings.push({
      title,
      price,
      currency: 'EUR',
      mileage: mileage || null,
      year: year || null,
      trim: null,
      listing_url: listingUrl,
      description: textContent.substring(0, 300),
      price_type: priceType,
      thumbnailUrl,
    });
  }

  console.log(`[SCRAPER_MARKTPLAATS] Parsed ${cards.length} cards, kept ${listings.length} listings, skipped ${skipped}`);

  return listings;
}

/**
 * Extracts Marktplaats listings from embedded JSON data.
 */
function extractMarktplaatsJsonListings(html: string, searchUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  try {
    // Look for JSON in script tags
    const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    const matches = Array.from(html.matchAll(scriptPattern));

    console.log(`[SCRAPER_MARKTPLAATS] Inspecting ${matches.length} script tags for JSON`);

    for (const match of matches) {
      try {
        const scriptContent = match[1].trim();

        // Skip short scripts
        if (scriptContent.length < 100) continue;

        // Look for ad-related keywords
        const hasListingKeywords = scriptContent.includes('"listings"') ||
                                   scriptContent.includes('"items"') ||
                                   scriptContent.includes('"results"') ||
                                   scriptContent.includes('priceInfo');

        if (!hasListingKeywords) continue;

        // Try to parse as JSON
        let data = null;
        try {
          data = JSON.parse(scriptContent);
        } catch (e) {
          // Try to extract JSON from variable assignments
          const jsonMatch = scriptContent.match(/(?:window\.\w+|var\s+\w+|const\s+\w+)\s*=\s*(\{[\s\S]*\});?/);
          if (jsonMatch) {
            try {
              data = JSON.parse(jsonMatch[1]);
            } catch (e2) {
              continue;
            }
          } else {
            continue;
          }
        }

        if (data) {
          // Try to find listings array in various paths
          const possiblePaths = [
            data?.listings,
            data?.items,
            data?.results,
            data?.data?.listings,
            data?.props?.pageProps?.listings,
          ];

          for (const path of possiblePaths) {
            if (Array.isArray(path) && path.length > 0) {
              console.log(`[SCRAPER_MARKTPLAATS] Found ${path.length} items in JSON`);

              for (const item of path) {
                const priceValue = item.priceInfo?.priceCents || item.price || item.priceAmount;
                const price = priceValue ? (typeof priceValue === 'number' ? priceValue / 100 : parseInt(String(priceValue).replace(/\D/g, ''), 10)) : null;

                const url = item.vipUrl || item.url || item.link || item.href;
                if (!price || !url) continue;

                let normalizedUrl = url;
                if (url.startsWith('/')) {
                  normalizedUrl = `https://www.marktplaats.nl${url}`;
                }

                listings.push({
                  title: item.title || item.description || 'Untitled',
                  price,
                  currency: 'EUR',
                  mileage: item.mileage || item.mileageKm || null,
                  year: item.year || item.modelYear || null,
                  trim: null,
                  listing_url: normalizedUrl,
                  description: item.description || '',
                  price_type: 'one-off',
                  thumbnailUrl: item.imageUrl || item.image || item.thumbnail || null,
                });
              }

              if (listings.length > 0) {
                console.log(`[SCRAPER_MARKTPLAATS] Extracted ${listings.length} listings from JSON`);
                return listings;
              }
            }
          }
        }
      } catch (e) {
        continue;
      }
    }
  } catch (error) {
    console.warn('[SCRAPER_MARKTPLAATS] Error extracting JSON listings:', error);
  }

  return listings;
}

/**
 * Parses Bilbasen listings using domain-specific selectors.
 * Strategy: Find anchors with /brugt/bil/ and extract large context window (±2000 chars) around each.
 */
function parseBilbasenListings(html: string, searchUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  console.log('[SCRAPER_BILBASEN] Starting Bilbasen-specific parsing');

  // Find all anchors with /brugt/bil/ in href (these are the car listing links)
  const anchorRegex = /<a\s+[^>]*href=["']([^"']*\/brugt\/bil\/[^"']*)["'][^>]*>/gi;
  const anchorMatches = Array.from(html.matchAll(anchorRegex));

  console.log(`[SCRAPER_BILBASEN] Found ${anchorMatches.length} anchors with /brugt/bil/ links`);

  if (anchorMatches.length === 0) {
    console.log('[SCRAPER_BILBASEN] No /brugt/bil/ anchors found, page may not contain listings');
    return listings;
  }

  const processedUrls = new Set<string>();
  let skipped = 0;
  const MAX_LOGS = 5;

  // For each anchor, extract large context window around it
  for (const anchorMatch of anchorMatches) {
    const anchorTag = anchorMatch[0];
    const href = anchorMatch[1];

    // Skip javascript: and # links
    if (href.startsWith('#') || href.startsWith('javascript:')) {
      continue;
    }

    // Normalize URL
    let listingUrl = href;
    if (href.startsWith('/')) {
      listingUrl = `https://www.bilbasen.dk${href}`;
    } else if (!href.startsWith('http')) {
      listingUrl = `https://www.bilbasen.dk/${href}`;
    }

    // Skip duplicates (same URL might appear multiple times)
    if (processedUrls.has(listingUrl)) {
      continue;
    }
    processedUrls.add(listingUrl);

    // Find position of this anchor in HTML
    const anchorIndex = html.indexOf(anchorTag);
    if (anchorIndex === -1) continue;

    // Extract large context window: ±2000 chars around anchor
    const contextStart = Math.max(0, anchorIndex - 2000);
    const contextEnd = Math.min(html.length, anchorIndex + 2000);
    const cardHtml = html.substring(contextStart, contextEnd);

    // Skip if this is a RelatedListings block (ads/banners)
    if (cardHtml.includes('RelatedListings_') ||
        cardHtml.includes('Mere fra vores sælgere') ||
        cardHtml.includes('Annoncering')) {
      continue;
    }

    // Extract data from the context HTML
    const textContent = cardHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const price = extractPrice(textContent);

    if (!price) {
      if (skipped < MAX_LOGS) {
        console.log('[SCRAPER_BILBASEN] Skipping: no price found', {
          url: listingUrl.substring(0, 80),
          textSnippet: textContent.substring(0, 150)
        });
        skipped++;
      }
      continue;
    }

    // Extract title
    let title = extractTitle(cardHtml) || 'Untitled';

    // If no title found, try to extract from text content
    if (title === 'Untitled' || title.length < 5) {
      const cleanText = textContent.trim();
      if (cleanText.length > 5) {
        // Look for car model patterns
        const titleMatch = cleanText.match(/(Audi|BMW|Mercedes|VW|Volvo|Tesla|Porsche|[A-Z][a-z]+)\s+[A-Za-z0-9\s-]+/i);
        if (titleMatch) {
          title = titleMatch[0].substring(0, 100).trim();
        } else {
          title = cleanText.substring(0, 100).trim();
        }
      }
    }

    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);
    const priceType = isPriceMonthly(textContent) ? 'per-month' : 'one-off';
    const thumbnailUrl = extractThumbnail(cardHtml);

    const listing = {
      title,
      price,
      currency: 'DKK' as Currency,
      mileage: mileage || null,
      year: year || null,
      trim: null,
      listing_url: listingUrl,
      description: textContent.substring(0, 300),
      price_type: priceType,
      thumbnailUrl,
    };

    listings.push(listing);

    // Debug log for first few successful listings
    if (listings.length <= 3) {
      console.log('[SCRAPER_BILBASEN] Parsed listing', {
        title: listing.title.substring(0, 60),
        price: listing.price,
        listing_url: listing.listing_url.substring(0, 80),
      });
    }
  }

  console.log(`[SCRAPER_BILBASEN] Detected ${anchorMatches.length} anchors, kept ${listings.length} listings with both URL and price, skipped ${skipped}`);

  // Show first context HTML for debugging if we got 0 listings
  if (listings.length === 0 && anchorMatches.length > 0) {
    const firstAnchor = anchorMatches[0];
    const firstAnchorTag = firstAnchor[0];
    const firstAnchorIndex = html.indexOf(firstAnchorTag);
    const contextStart = Math.max(0, firstAnchorIndex - 2000);
    const contextEnd = Math.min(html.length, firstAnchorIndex + 2000);
    const firstContext = html.substring(contextStart, contextEnd);
    const truncated = firstContext.length > 1000 ? firstContext.substring(0, 1000) + '...[TRUNCATED]' : firstContext;
    console.log('[SCRAPER_BILBASEN_DEBUG] First context HTML (±2000 chars):', truncated);
  }

  return listings;
}

/**
 * Parser type enum for explicit routing.
 */
type ParserType = 'MARKTPLAATS' | 'LEBONCOIN' | 'GASPEDAAL' | 'BILBASEN' | 'GENERIC';

/**
 * Strictly determines which parser to use based on URL hostname.
 * This function is deterministic and ensures no ambiguity.
 *
 * CRITICAL: Each hostname maps to exactly ONE parser. No fallbacks, no heuristics.
 */
function selectParserByHostname(url: string): { parser: ParserType; hostname: string } {
  let hostname: string;

  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch (e) {
    console.error('[PARSER_SELECTION] ❌ Invalid URL, cannot parse hostname:', url);
    return { parser: 'GENERIC', hostname: 'invalid' };
  }

  // Strict hostname matching - order matters (most specific first)
  if (hostname === 'www.marktplaats.nl' || hostname === 'marktplaats.nl') {
    console.log(`[PARSER_SELECTION] ✅ Hostname "${hostname}" → MARKTPLAATS parser`);
    return { parser: 'MARKTPLAATS', hostname };
  }

  if (hostname === 'www.leboncoin.fr' || hostname === 'leboncoin.fr') {
    console.log(`[PARSER_SELECTION] ✅ Hostname "${hostname}" → LEBONCOIN parser`);
    return { parser: 'LEBONCOIN', hostname };
  }

  if (hostname === 'www.gaspedaal.nl' || hostname === 'gaspedaal.nl') {
    console.log(`[PARSER_SELECTION] ✅ Hostname "${hostname}" → GASPEDAAL parser`);
    return { parser: 'GASPEDAAL', hostname };
  }

  if (hostname === 'www.bilbasen.dk' || hostname === 'bilbasen.dk') {
    console.log(`[PARSER_SELECTION] ✅ Hostname "${hostname}" → BILBASEN parser`);
    return { parser: 'BILBASEN', hostname };
  }

  // Fallback to generic parser
  console.log(`[PARSER_SELECTION] ⚠️ Unknown hostname "${hostname}" → GENERIC parser`);
  return { parser: 'GENERIC', hostname };
}

/**
 * Validates that parser selection is correct (anti-contamination guard).
 */
function validateParserSelection(url: string, parser: ParserType): void {
  const hostname = new URL(url).hostname.toLowerCase();

  const violations: string[] = [];

  if (parser === 'MARKTPLAATS' && !hostname.includes('marktplaats.nl')) {
    violations.push(`⛔ MARKTPLAATS parser used for non-Marktplaats URL: ${hostname}`);
  }

  if (parser === 'LEBONCOIN' && !hostname.includes('leboncoin.fr')) {
    violations.push(`⛔ LEBONCOIN parser used for non-Leboncoin URL: ${hostname}`);
  }

  if (parser === 'GASPEDAAL' && !hostname.includes('gaspedaal.nl')) {
    violations.push(`⛔ GASPEDAAL parser used for non-Gaspedaal URL: ${hostname}`);
  }

  if (parser === 'BILBASEN' && !hostname.includes('bilbasen.dk')) {
    violations.push(`⛔ BILBASEN parser used for non-Bilbasen URL: ${hostname}`);
  }

  if (violations.length > 0) {
    console.error('[PARSER_VALIDATION] ❌❌❌ PARSER CONTAMINATION DETECTED ❌❌❌');
    violations.forEach(v => console.error(`[PARSER_VALIDATION] ${v}`));
    throw new Error(`Parser contamination detected: ${violations.join(', ')}`);
  }
}

async function delayWithJitter(): Promise<void> {
  const delay = PAGINATION_DELAY_MIN_MS + Math.random() * (PAGINATION_DELAY_MAX_MS - PAGINATION_DELAY_MIN_MS);
  await new Promise(resolve => setTimeout(resolve, delay));
}

function normalizeListingUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.search = '';
    urlObj.hash = '';
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * Persists page-level scraping progress to study_scrape_pages via Edge Function.
 *
 * CRITICAL: This is analytics-only persistence. It must NEVER affect:
 * - Median price calculation
 * - Opportunity detection logic
 * - Ranking/scoring algorithms
 * - Buy/sell decision thresholds
 * - Source/target comparison logic
 *
 * Uses server-side Edge Function with service role to bypass RLS.
 * Failures are logged but never block pagination.
 */
async function persistPageProgress(
  sessionId: string,
  domain: string,
  baseUrl: string,
  pageNumber: number,
  fetchedUrl: string,
  extractedCount: number,
  newUniqueCount: number
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      console.warn('[PERSIST] No auth session, skipping persistence (non-blocking)');
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const apiUrl = `${supabaseUrl}/functions/v1/persist_scrape_page`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        scrape_session_id: sessionId,
        domain,
        base_url: baseUrl,
        page_number: pageNumber,
        fetched_url: fetchedUrl,
        extracted_count: extractedCount,
        new_unique_count: newUniqueCount,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.warn('[PERSIST] Failed to persist page progress (non-blocking):', response.status, errorData);
    }
  } catch (error) {
    console.warn('[PERSIST] Failed to persist page progress (non-blocking):', error instanceof Error ? error.message : 'Unknown error');
  }
}

type PaginationMode = 'known' | 'iterative';

interface PaginationStrategy {
  mode: PaginationMode;
  totalPages: number;
}

function detectTotalPages(parser: ParserType, html: string, searchUrl: string): PaginationStrategy {
  if (parser === 'MARKTPLAATS') {
    const pageMatches = html.matchAll(/\/p\/(\d+)\//g);
    const pageNumbers = Array.from(pageMatches).map(m => parseInt(m[1], 10)).filter(n => !isNaN(n));
    if (pageNumbers.length === 0) {
      console.log('[PAGINATION] Marktplaats: No /p/<n>/ patterns detected, entering iterative mode');
      return { mode: 'iterative', totalPages: MAX_PAGES_MARKTPLAATS };
    }
    const detected = Math.max(...pageNumbers);
    console.log('[PAGINATION] Marktplaats: Detected totalPages from patterns:', detected);
    return { mode: 'known', totalPages: detected };
  }

  if (parser === 'LEBONCOIN') {
    const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const totalPages = data?.props?.pageProps?.searchData?.totalPages;
        if (typeof totalPages === 'number' && totalPages > 0) {
          console.log('[PAGINATION] Leboncoin: Detected totalPages from __NEXT_DATA__:', totalPages);
          return { mode: 'known', totalPages };
        }
      } catch (e) {
        console.log('[PAGINATION] Leboncoin: Failed to parse __NEXT_DATA__');
      }
    }
    console.log('[PAGINATION] Leboncoin: __NEXT_DATA__ not available, entering iterative mode');
    return { mode: 'iterative', totalPages: MAX_PAGES_LEBONCOIN };
  }

  return { mode: 'known', totalPages: 1 };
}

function buildPaginatedUrl(parser: ParserType, baseUrl: string, pageNumber: number): string {
  if (parser === 'MARKTPLAATS') {
    const urlObj = new URL(baseUrl);
    const pathParts = urlObj.pathname.split('/').filter(p => p);
    const pIndex = pathParts.findIndex(p => p === 'p');
    if (pIndex !== -1) {
      pathParts.splice(pIndex, 2);
    }
    pathParts.push('p', pageNumber.toString());
    urlObj.pathname = '/' + pathParts.join('/') + '/';
    return urlObj.toString();
  }

  if (parser === 'LEBONCOIN') {
    const urlObj = new URL(baseUrl);
    urlObj.searchParams.set('page', pageNumber.toString());
    return urlObj.toString();
  }

  return baseUrl;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UNIFIED SCRAPER ADAPTER (Feature Flag Controlled)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Check if shared core scraping is enabled via feature flag
 */
function isSharedCoreScrapingEnabled(): boolean {
  return (
    import.meta.env.VITE_USE_SHARED_CORE === 'true' ||
    import.meta.env.USE_SHARED_CORE === 'true'
  );
}

/**
 * Scrape using unified study-core implementation
 */
async function scrapeWithUnifiedCore(
  url: string,
  scrapeMode: 'fast' | 'full'
): Promise<SearchResult> {
  console.log('[SCRAPER_UNIFIED] Using unified pure parser pipeline');

  // Import pure parser function
  const { coreParseSearchPage } = await import('./study-core');

  // Fetch HTML (I/O - environment-specific)
  const html = await fetchHtmlWithZyte(url, 1);
  if (!html) {
    return { listings: [], error: 'Failed to fetch HTML' };
  }

  // Parse HTML (PURE - deterministic)
  const listings = coreParseSearchPage(html, url);

  // If no listings found in fast mode, try one retry
  if (listings.length === 0 && scrapeMode === 'fast') {
    const retryHtml = await fetchHtmlWithZyte(url, 2);
    if (retryHtml) {
      const retryListings = coreParseSearchPage(retryHtml, url);
      if (retryListings.length > 0) {
        return { listings: retryListings };
      }
    }
  }

  // If still no listings, check for blocked content
  if (listings.length === 0) {
    const { detectBlockedContent } = await import('./study-core');
    const blockedCheck = detectBlockedContent(html, false);
    if (blockedCheck.isBlocked) {
      return {
        listings: [],
        error: `Blocked: ${blockedCheck.matchedKeyword}`,
      };
    }
  }

  return { listings };
}

/**
 * Scrapes a marketplace URL and returns a list of listings.
 *
 * @param url - The marketplace search URL to scrape
 * @param scrapeMode - 'fast' (page 1 only) or 'full' (all pages with pagination)
 *
 * **UNIFIED PIPELINE:**
 * - When USE_SHARED_CORE=true: Uses study-core/scrapingImpl.ts (unified scraper)
 * - When USE_SHARED_CORE=false: Uses legacy browser-specific implementation
 *
 * FAST MODE CONFIGURATION:
 * - Currently: Fetches only page 1 per search query
 * - To adjust: Modify the early return condition below (line ~2470)
 * - Example: Change to fetch first 3 pages by replacing the early return with a modified pagination loop
 *
 * FULL MODE BEHAVIOR:
 * - Fetches all pages up to MAX_PAGES_MARKTPLAATS or MAX_PAGES_LEBONCOIN
 * - To adjust full mode limits: Modify MAX_PAGES_* constants at top of file
 */
export async function SCRAPER_SEARCH(url: string, scrapeMode: 'fast' | 'full' = 'full'): Promise<SearchResult> {
  // Feature flag: Use unified scraper if enabled
  if (isSharedCoreScrapingEnabled()) {
    console.log('[SCRAPER] 🔀 Unified pipeline enabled (USE_SHARED_CORE=true)');
    return await scrapeWithUnifiedCore(url, scrapeMode);
  }

  console.log('[SCRAPER] 🔙 Using legacy browser scraper (USE_SHARED_CORE=false)');
  // Legacy implementation continues below...
  console.log(`[SCRAPER_SEARCH] Starting search for URL (${scrapeMode.toUpperCase()} mode):`, url);

  const html = await fetchHtmlWithScraper(url);

  if (html === null) {
    console.error('[SCRAPER_SEARCH] Failed to fetch HTML after retries, returning SCRAPER_FAILED');
    return { listings: [], error: 'SCRAPER_FAILED' };
  }

  const { parser, hostname } = selectParserByHostname(url);

  if (parser === 'BILBASEN') {
    const htmlSnippet = html.slice(0, 500).toLowerCase();
    const isBadEndpoint = htmlSnippet.includes('request failed (bad_endpoint)');
    const isRobotsTxtBlock = htmlSnippet.includes('robots.txt') && htmlSnippet.includes('not available');
    const isBlockedMessage = htmlSnippet.includes('blocked') || htmlSnippet.includes('access denied');

    if (isBadEndpoint || isRobotsTxtBlock || isBlockedMessage) {
      console.error('[SCRAPER] Bilbasen blocked by scraping provider for URL:', url);
      return {
        listings: [],
        blockedByProvider: true,
        blockReason: 'Bilbasen blocked by scraping provider. The site may restrict automated access.',
      };
    }
  }

  function parsePageHtml(pageHtml: string, pageUrl: string): ScrapedListing[] {
    switch (parser) {
      case 'MARKTPLAATS':
        validateParserSelection(pageUrl, 'MARKTPLAATS');
        return parseMarktplaatsListings(pageHtml, pageUrl);
      case 'LEBONCOIN':
        validateParserSelection(pageUrl, 'LEBONCOIN');
        return parseLeboncoinListings(pageHtml, pageUrl);
      case 'GASPEDAAL':
        validateParserSelection(pageUrl, 'GASPEDAAL');
        return parseGaspedaalListings(pageHtml, pageUrl);
      case 'BILBASEN':
        validateParserSelection(pageUrl, 'BILBASEN');
        return parseBilbasenListings(pageHtml, pageUrl);
      case 'GENERIC':
        return parseSearchResultsHtml(pageHtml, pageUrl);
      default:
        return parseSearchResultsHtml(pageHtml, pageUrl);
    }
  }

  console.log(`[SCRAPER_SEARCH] 🌐 Executing ${parser} parser for:`, hostname);
  const page1Listings = parsePageHtml(html, url);
  console.log(`[SCRAPER_SEARCH] Page 1: extracted ${page1Listings.length} listings`);

  if (parser !== 'MARKTPLAATS' && parser !== 'LEBONCOIN') {
    return { listings: page1Listings };
  }

  if (scrapeMode === 'fast') {
    console.log('[MODE_FAST] Stopping after page 1 (MVP mode - minimal Zyte usage)');
    return { listings: page1Listings };
  }

  const scrapeSessionId = `${parser.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const strategy = detectTotalPages(parser, html, url);
  const maxPages = parser === 'MARKTPLAATS' ? MAX_PAGES_MARKTPLAATS : MAX_PAGES_LEBONCOIN;
  const totalPages = Math.min(strategy.totalPages, maxPages);

  console.log(`[PAGINATION] Mode=${strategy.mode}, detectedPages=${strategy.totalPages}, cappedTo=${totalPages}`);

  await persistPageProgress(scrapeSessionId, parser, url, 1, url, page1Listings.length, page1Listings.length);

  if (totalPages <= 1 && strategy.mode === 'known') {
    return { listings: page1Listings };
  }

  const seenUrls = new Set<string>();
  const allListings: ScrapedListing[] = [];

  for (const listing of page1Listings) {
    const normalized = normalizeListingUrl(listing.listing_url);
    seenUrls.add(normalized);
    allListings.push(listing);
  }

  let consecutiveEmptyPages = 0;

  for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
    const pageUrl = buildPaginatedUrl(parser, url, pageNum);
    console.log(`[PAGINATION] Fetching page ${pageNum}/${totalPages}: ${pageUrl}`);

    await delayWithJitter();

    const pageHtml = await fetchHtmlWithScraper(pageUrl);
    if (!pageHtml) {
      console.warn(`[PAGINATION] Failed to fetch page ${pageNum}, skipping`);
      consecutiveEmptyPages++;
      if (consecutiveEmptyPages >= 2) {
        console.log(`[PAGINATION] Early stop triggered after ${consecutiveEmptyPages} failed pages`);
        break;
      }
      continue;
    }

    const pageListings = parsePageHtml(pageHtml, pageUrl);
    let newUnique = 0;

    for (const listing of pageListings) {
      const normalized = normalizeListingUrl(listing.listing_url);
      if (!seenUrls.has(normalized)) {
        seenUrls.add(normalized);
        allListings.push(listing);
        newUnique++;
      }
    }

    await persistPageProgress(scrapeSessionId, parser, url, pageNum, pageUrl, pageListings.length, newUnique);

    console.log(`[PAGINATION] Page ${pageNum}: extracted ${pageListings.length} listings, newUnique ${newUnique}`);

    if (newUnique === 0) {
      consecutiveEmptyPages++;
      if (consecutiveEmptyPages >= 2) {
        console.log(`[PAGINATION] Early stop triggered after ${consecutiveEmptyPages} empty pages`);
        break;
      }
    } else {
      consecutiveEmptyPages = 0;
    }
  }

  console.log(`[SCRAPER_SEARCH] ✅ Total extracted ${allListings.length} unique listings (session: ${scrapeSessionId})`);

  return { listings: allListings };
}

/**
 * Scrapes detailed information for specific listing URLs.
 */
export async function SCRAPER_DETAIL(
  listings: ScrapedListing[]
): Promise<DetailedListing[]> {
  console.log('[SCRAPER_DETAIL] Fetching details for', listings.length, 'listings');

  const detailedListings: DetailedListing[] = [];

  for (const listing of listings) {
    const html = await fetchHtmlWithScraper(listing.listing_url);

    if (!html) {
      console.warn(`[SCRAPER_DETAIL] Failed to fetch ${listing.listing_url}, skipping`);
      continue;
    }

    const parsed = parseDetailPageHtml(html, listing.listing_url, listing);

    detailedListings.push({
      title: parsed.title || listing.title || 'Unknown',
      price: parsed.price || listing.price || 0,
      currency: parsed.currency || listing.currency || 'EUR',
      mileage: parsed.mileage || listing.mileage || null,
      year: parsed.year || listing.year || null,
      trim: parsed.trim || listing.trim || null,
      listing_url: listing.listing_url,
      description: parsed.description || listing.description || '',
      price_type: parsed.price_type || listing.price_type || 'unknown',
      full_description: parsed.full_description || '',
      technical_info: parsed.technical_info || null,
      options: parsed.options || [],
      car_image_urls: parsed.car_image_urls || [],
      thumbnailUrl: listing.thumbnailUrl,
    });
  }

  console.log(`[SCRAPER_DETAIL] Successfully fetched details for ${detailedListings.length}/${listings.length} listings`);

  return detailedListings;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * DELEGATED TO STUDY ENGINE - DO NOT MODIFY
 * ════════════════════════════════════════════════════════════════════════════
 * This function delegates to the Study Execution Engine (study-engine.ts).
 * ALL filtering logic modifications MUST be made in study-engine.ts.
 */
export function shouldFilterListing(listing: ScrapedListing): boolean {
  const result = shouldFilterListingEngine(listing);

  // Preserve logging for debugging (engine doesn't log)
  if (result) {
    const priceEur = toEur(listing.price, listing.currency);
    if (priceEur <= 2000) {
      console.log(`[FILTER] Price too low (≤2000€): ${listing.title} (${priceEur.toFixed(0)}€)`);
    } else if (listing.price_type === 'per-month') {
      console.log('[FILTER] Leasing detected:', listing.title);
    } else {
      console.log('[FILTER] Filtered:', listing.title);
    }
  }

  return result;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * DELEGATED TO STUDY ENGINE - DO NOT MODIFY
 * ════════════════════════════════════════════════════════════════════════════
 * This function delegates to the Study Execution Engine (study-engine.ts).
 * ALL filtering logic modifications MUST be made in study-engine.ts.
 */
export function filterListingsByStudy(
  listings: ScrapedListing[],
  study: { brand: string; model: string; year: number; max_mileage: number }
): ScrapedListing[] {
  const initialCount = listings.length;
  console.log(`[INSTANT_FILTER] Starting with ${initialCount} listings for ${study.brand} ${study.model} ${study.year}`);

  // Delegate to engine
  const filtered = filterListingsByStudyEngine(listings, study);

  console.log(`[INSTANT_FILTER] ✅ Kept ${filtered.length}/${initialCount} listings after filtering (${initialCount - filtered.length} filtered out)`);

  return filtered;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * DELEGATED TO STUDY ENGINE - DO NOT MODIFY
 * ════════════════════════════════════════════════════════════════════════════
 * This function delegates to the Study Execution Engine (study-engine.ts).
 * ALL pricing/stats logic modifications MUST be made in study-engine.ts.
 */
export function computeTargetMarketStats(listings: ScrapedListing[]): MarketStats {
  // Delegate to engine
  const stats = computeTargetMarketStatsEngine(listings);

  // Preserve logging for debugging (engine doesn't log)
  if (stats.count > 0) {
    const currencyNote = listings[0]?.currency === 'DKK' ? ' (converted from DKK)' : '';
    const limitNote = listings.length > 6 ? ` (using first 6 listings)` : '';
    console.log(`[INSTANT_STATS] Computed target market stats in EUR${currencyNote}${limitNote}:`, {
      median: stats.median_price.toFixed(0) + ' EUR',
      average: stats.average_price.toFixed(0) + ' EUR',
      count: stats.count,
      range: `${stats.min_price.toFixed(0)} EUR - ${stats.max_price.toFixed(0)} EUR`
    });
  } else {
    console.log('[INSTANT_STATS] No listings to compute stats from');
  }

  return stats;
}
