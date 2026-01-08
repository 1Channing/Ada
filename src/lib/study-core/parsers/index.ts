/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PURE PARSER ORCHESTRATOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Single entry point for all marketplace parsing.
 * Routes to correct parser based on URL hostname.
 * 100% deterministic - NO I/O, NO side effects.
 */

import type { ScrapedListing } from '../types';
import * as marktplaats from './marktplaats';
import * as leboncoin from './leboncoin';
import * as gaspedaal from './gaspedaal';
import * as bilbasen from './bilbasen';
import * as generic from './generic';

export type MarketplaceParser = 'MARKTPLAATS' | 'LEBONCOIN' | 'GASPEDAAL' | 'BILBASEN' | 'GENERIC';

/**
 * Select parser based on URL hostname (deterministic)
 *
 * @param url - Marketplace URL
 * @returns Parser type to use
 */
export function selectParserByHostname(url: string): MarketplaceParser {
  const hostname = extractHostname(url);

  if (hostname === 'www.marktplaats.nl' || hostname === 'marktplaats.nl') {
    return 'MARKTPLAATS';
  }

  if (hostname === 'www.leboncoin.fr' || hostname === 'leboncoin.fr') {
    return 'LEBONCOIN';
  }

  if (hostname === 'www.gaspedaal.nl' || hostname === 'gaspedaal.nl') {
    return 'GASPEDAAL';
  }

  if (hostname === 'www.bilbasen.dk' || hostname === 'bilbasen.dk') {
    return 'BILBASEN';
  }

  return 'GENERIC';
}

/**
 * Parse search page HTML into listings (PURE FUNCTION)
 *
 * This is the single authoritative parsing function.
 * Both INSTANT and SCHEDULED execution must call this.
 *
 * @param html - Raw HTML from marketplace search page
 * @param url - Source URL (for parser selection and normalization)
 * @returns Array of scraped listings
 */
export function coreParseSearchPage(html: string, url: string): ScrapedListing[] {
  const parserType = selectParserByHostname(url);

  switch (parserType) {
    case 'MARKTPLAATS':
      return marktplaats.parseListings(html, url);
    case 'LEBONCOIN':
      return leboncoin.parseListings(html, url);
    case 'GASPEDAAL':
      return gaspedaal.parseListings(html, url);
    case 'BILBASEN':
      return bilbasen.parseListings(html, url);
    case 'GENERIC':
      return generic.parseListings(html, url);
    default:
      return [];
  }
}

/**
 * Extract hostname from URL
 */
function extractHostname(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    // Fallback regex extraction
    const match = url.match(/https?:\/\/([^\/]+)/i);
    return match ? match[1].toLowerCase() : '';
  }
}

/**
 * Build paginated URL (pure function)
 *
 * @param baseUrl - Base search URL
 * @param pageNumber - Page number (1-indexed)
 * @returns Paginated URL
 */
export function buildPaginatedUrl(baseUrl: string, pageNumber: number): string {
  if (pageNumber <= 1) return baseUrl;

  const parserType = selectParserByHostname(baseUrl);

  switch (parserType) {
    case 'MARKTPLAATS':
      // Marktplaats uses ?page=2 format
      return addOrUpdateQueryParam(baseUrl, 'page', String(pageNumber));

    case 'LEBONCOIN':
      // Leboncoin uses ?page=2 format
      return addOrUpdateQueryParam(baseUrl, 'page', String(pageNumber));

    case 'GASPEDAAL':
      // Gaspedaal uses ?page=2 format
      return addOrUpdateQueryParam(baseUrl, 'page', String(pageNumber));

    case 'BILBASEN':
      // Bilbasen uses ?page=2 format
      return addOrUpdateQueryParam(baseUrl, 'page', String(pageNumber));

    default:
      // Generic: try ?page=N
      return addOrUpdateQueryParam(baseUrl, 'page', String(pageNumber));
  }
}

/**
 * Add or update query parameter in URL
 */
function addOrUpdateQueryParam(url: string, key: string, value: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.searchParams.set(key, value);
    return urlObj.toString();
  } catch {
    // Fallback: simple string concatenation
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${key}=${value}`;
  }
}

/**
 * Detect total pages from HTML (heuristic, not guaranteed accurate)
 *
 * @param html - Search page HTML
 * @returns Estimated total pages (or null if cannot detect)
 */
export function detectTotalPages(html: string): number | null {
  // Look for pagination indicators
  const patterns = [
    /page["\s]*[:=]["\s]*(\d+)["\s]*of["\s]*(\d+)/i,
    /\bof\s+(\d+)\s+pages/i,
    /pagination[^>]*>[\s\S]*?(\d+)\s*<\/[^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const pageNum = parseInt(match[match.length - 1], 10);
      if (!isNaN(pageNum) && pageNum > 0 && pageNum < 1000) {
        return pageNum;
      }
    }
  }

  return null;
}

/**
 * Normalize listing URL to absolute form
 *
 * @param url - Potentially relative URL
 * @param baseUrl - Base URL for resolution
 * @returns Absolute URL
 */
export function normalizeListingUrl(url: string, baseUrl: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  try {
    const base = new URL(baseUrl);
    if (url.startsWith('/')) {
      return `${base.protocol}//${base.hostname}${url}`;
    }
    return `${base.protocol}//${base.hostname}/${url}`;
  } catch {
    // Fallback
    const hostname = baseUrl.match(/https?:\/\/([^\/]+)/)?.[0] || 'https://unknown';
    if (url.startsWith('/')) {
      return `${hostname}${url}`;
    }
    return `${hostname}/${url}`;
  }
}
