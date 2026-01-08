/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GASPEDAAL PURE PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE DETERMINISTIC PARSER - NO I/O, NO SIDE EFFECTS
 * Single source of truth for Gaspedaal parsing logic.
 */

import type { ScrapedListing } from '../types';
import { extractEuroPrice, extractYear, extractMileage } from './shared';

/**
 * Parse Gaspedaal search results HTML into listings
 *
 * @param html - Raw HTML from Gaspedaal search page
 * @param url - Source URL for normalization
 * @returns Array of scraped listings
 */
export function parseListings(html: string, url: string): ScrapedListing[] {
  let listings: ScrapedListing[] = [];

  // Strategy 1: Try HTML card extraction
  listings = parseHtmlCards(html);

  // Strategy 2: Try JSON extraction if no cards found
  if (listings.length === 0) {
    listings = parseJsonListings(html);
  }

  // Strategy 3: Try anchor-based fallback if still no listings
  if (listings.length === 0) {
    listings = parseAnchors(html);
  }

  return listings;
}

/**
 * Parse Gaspedaal listings from HTML cards
 */
function parseHtmlCards(html: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  const listingPatterns = [
    /<article[^>]*class="[^"]*(?:listing|car|vehicle|ad|item)[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]*class="[^"]*(?:listing|car-card|vehicle-item|auto-item)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
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

  for (const card of cards) {
    const textContent = card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Extract URL
    const listingUrl = extractUrl(card);
    if (!listingUrl) continue;

    // Skip category/filter links
    const urlLower = listingUrl.toLowerCase();
    if (urlLower.includes('zoek') || urlLower.includes('filter') ||
        urlLower.includes('category') || urlLower.includes('tot-') ||
        urlLower.match(/autos?-tot-\d+/)) {
      continue;
    }

    const price = extractEuroPrice(textContent);
    if (!price) continue;

    const title = extractTitleFromHtml(card) || 'Untitled';
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
 * Parse Gaspedaal listings from embedded JSON
 */
function parseJsonListings(html: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  try {
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
              for (const item of listingsArray) {
                const price = item.price || item.askingPrice || item.priceAmount;
                const urlValue = item.url || item.link || item.href || item.detailUrl;

                if (price && urlValue) {
                  let normalizedUrl = urlValue;
                  if (urlValue.startsWith('/')) {
                    normalizedUrl = `https://www.gaspedaal.nl${urlValue}`;
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
                  });
                }
              }

              return listings;
            }
          }
        } catch (e) {
          continue;
        }
      }
    }
  } catch (error) {
    // Silent failure
  }

  return listings;
}

/**
 * Parse Gaspedaal listings from anchor tags (fallback)
 */
function parseAnchors(html: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches = Array.from(html.matchAll(anchorRegex));

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

    if (!isCarListing) continue;

    // Extract data
    const textContent = (href + ' ' + innerHTML).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const price = extractEuroPrice(textContent);
    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);

    // Extract title
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

    if (!price || normalizedUrl.length <= 10) continue;

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
 * Extract URL from HTML card
 */
function extractUrl(html: string): string | null {
  const patterns = [
    /<a[^>]*href=["']([^"']+)["']/i,
    /href=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let href = match[1];
      if (href.startsWith('/')) {
        return `https://www.gaspedaal.nl${href}`;
      }
      if (href.startsWith('http')) {
        return href;
      }
    }
  }
  return null;
}

/**
 * Extract title from HTML
 */
function extractTitleFromHtml(html: string): string | null {
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
