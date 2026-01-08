/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GENERIC PURE PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE DETERMINISTIC PARSER - NO I/O, NO SIDE EFFECTS
 * Fallback parser for unknown marketplaces.
 */

import type { ScrapedListing } from '../types';
import { extractEuroPrice, extractYear, extractMileage } from './shared';

/**
 * Generic parser for unknown marketplace URLs
 *
 * Attempts to find listings using common patterns:
 * - Article/div/li tags with listing-related classes
 * - Anchors with plausible car listing URLs
 *
 * @param html - Raw HTML from search page
 * @param url - Source URL for normalization
 * @returns Array of scraped listings
 */
export function parseListings(html: string, url: string): ScrapedListing[] {
  let listings: ScrapedListing[] = [];

  // Strategy 1: Try common HTML patterns
  listings = parseCommonPatterns(html, url);

  // Strategy 2: Try anchor-based extraction if no results
  if (listings.length === 0) {
    listings = parseGenericAnchors(html, url);
  }

  return listings;
}

/**
 * Parse using common HTML patterns
 */
function parseCommonPatterns(html: string, url: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  const listingPatterns = [
    /<article[^>]*class="[^"]*(?:listing|car|vehicle|ad|item)[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]*class="[^"]*(?:listing|car|vehicle|result|item)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
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

  const baseUrl = extractBaseUrl(url);

  for (const card of cards) {
    const textContent = card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Extract URL
    const linkMatch = card.match(/<a[^>]*href=["']([^"']+)["']/i);
    if (!linkMatch) continue;

    let listingUrl = linkMatch[1];
    if (listingUrl.startsWith('/')) {
      listingUrl = `${baseUrl}${listingUrl}`;
    } else if (!listingUrl.startsWith('http')) {
      listingUrl = `${baseUrl}/${listingUrl}`;
    }

    const price = extractEuroPrice(textContent);
    if (!price) continue;

    const titleMatch = card.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : textContent.substring(0, 100).trim();

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

  return listings;
}

/**
 * Parse using generic anchor extraction
 */
function parseGenericAnchors(html: string, url: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches = Array.from(html.matchAll(anchorRegex));
  const baseUrl = extractBaseUrl(url);

  for (const match of matches) {
    const href = match[1];
    const innerHTML = match[2];

    // Skip non-relevant anchors
    if (href.startsWith('#') || href.startsWith('javascript:') ||
        href.match(/\.(jpg|jpeg|png|gif|css|js)$/i) ||
        href.includes('login') || href.includes('register') ||
        href.includes('footer') || href.includes('header')) {
      continue;
    }

    const textContent = (href + ' ' + innerHTML).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const price = extractEuroPrice(textContent);
    if (!price) continue;

    let normalizedUrl = href;
    if (href.startsWith('/')) {
      normalizedUrl = `${baseUrl}${href}`;
    } else if (!href.startsWith('http')) {
      normalizedUrl = `${baseUrl}/${href}`;
    }

    let title = innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title || title.length < 3) {
      title = 'Untitled';
    }
    if (title.length > 100) {
      title = title.substring(0, 100);
    }

    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);

    listings.push({
      title,
      price,
      currency: 'EUR',
      mileage: mileage || null,
      year: year || null,
      trim: null,
      listing_url: normalizedUrl,
      description: textContent.substring(0, 300),
      price_type: 'one-off',
    });
  }

  return listings;
}

/**
 * Extract base URL from full URL
 */
function extractBaseUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.hostname}`;
  } catch {
    // Fallback if URL parsing fails
    const match = url.match(/^(https?:\/\/[^\/]+)/);
    return match ? match[1] : 'https://unknown';
  }
}
