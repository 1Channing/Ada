/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MARKTPLAATS PURE PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE DETERMINISTIC PARSER - NO I/O, NO SIDE EFFECTS
 * Single source of truth for Marktplaats parsing logic.
 */

import type { ScrapedListing } from '../types';
import { extractEuroPrice, extractYear, extractMileage, normalizeUrl } from './shared';

/**
 * Parse Marktplaats search results HTML into listings
 *
 * @param html - Raw HTML from Marktplaats search page
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

  return listings;
}

/**
 * Parse Marktplaats listings from HTML cards
 */
function parseHtmlCards(html: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  const listingPattern = /<li\s+class="[^"]*hz-Listing\s+hz-Listing--list-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  const matches = Array.from(html.matchAll(listingPattern));
  const cards: string[] = matches.map(m => m[0]);

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

  return listings;
}

/**
 * Parse Marktplaats listings from embedded JSON
 */
function parseJsonListings(html: string): ScrapedListing[] {
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
              return listings;
            }
          }
        }
      }
    }
  } catch (error) {
    // Silent failure - return empty array
  }

  return listings;
}
