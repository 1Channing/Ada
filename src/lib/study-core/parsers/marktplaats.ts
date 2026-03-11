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
 * Recursively search an object for arrays that look like listing results
 * Returns first match with the path taken
 *
 * STRONG HEURISTIC:
 * - Must have at least 3 items (avoid false positives)
 * - At least one item must have ALL 3 fields: price-like, title-like, url-like
 */
function findListingsArray(obj: any, maxDepth = 6, currentPath = '', depth = 0): { array: any[], path: string } | null {
  if (depth > maxDepth || obj === null || typeof obj !== 'object') {
    return null;
  }

  // Check if current object is an array that looks like listings
  if (Array.isArray(obj) && obj.length >= 3) {
    // Check if at least one item has ALL 3 required fields
    let hasStrongMatch = false;

    for (const item of obj) {
      if (typeof item === 'object' && item !== null) {
        const hasPriceField = 'price' in item || 'priceInfo' in item || 'priceCents' in item || 'prijsGegevens' in item;
        const hasTitleField = 'title' in item || 'name' in item;
        const hasUrlField = 'url' in item || 'vipUrl' in item || 'link' in item || 'href' in item || 'itemUrl' in item;

        // Must have ALL 3 fields
        if (hasPriceField && hasTitleField && hasUrlField) {
          hasStrongMatch = true;
          break;
        }
      }
    }

    if (hasStrongMatch) {
      return { array: obj, path: currentPath || 'root' };
    }
  }

  // Recursively search object properties
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const newPath = currentPath ? `${currentPath}.${key}` : key;
    const result = findListingsArray(value, maxDepth, newPath, depth + 1);
    if (result) {
      return result;
    }
  }

  return null;
}

/**
 * Parse Marktplaats listings from __NEXT_DATA__ JSON (PRIMARY STRATEGY)
 *
 * Marktplaats uses Next.js which embeds listing data in <script id="__NEXT_DATA__">
 * This is more reliable than DOM parsing as it's not affected by consent overlays.
 */
function parseNextData(html: string): { listings: ScrapedListing[], discoveredPath: string | null } {
  const listings: ScrapedListing[] = [];
  let discoveredPath: string | null = null;

  // Extract __NEXT_DATA__ script tag
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
    return { listings, discoveredPath }; // No __NEXT_DATA__ found
  }

  try {
    const jsonText = nextDataMatch[1];
    const data = JSON.parse(jsonText);

    // Use dynamic discovery to find the listings array
    const result = findListingsArray(data);

    if (!result) {
      return { listings, discoveredPath };
    }

    const adsArray = result.array;
    discoveredPath = result.path;

    // Parse each listing with strong validation
    for (const item of adsArray) {
      // Extract price with strict cents-only division
      let price: number | null = null;

      // Check for explicit cents fields first (divide by 100)
      const priceCents = item.priceInfo?.priceCents || item.priceCents || item.price?.cents;
      if (priceCents != null) {
        price = typeof priceCents === 'number' ? priceCents / 100 : parseInt(String(priceCents), 10) / 100;
      } else {
        // Check for euro fields (NO division)
        const priceEuros = item.priceInfo?.amount || item.price || item.prijsGegevens?.prijs;
        if (priceEuros != null) {
          if (typeof priceEuros === 'number') {
            price = priceEuros;
          } else {
            // Sanitize string: remove non-digits
            const cleaned = String(priceEuros).replace(/\D/g, '');
            price = cleaned ? parseInt(cleaned, 10) : null;
          }
        }
      }

      // Extract URL
      let listingUrl = item.vipUrl || item.url || item.link || item.href || item.itemUrl;
      if (listingUrl && listingUrl.startsWith('/')) {
        listingUrl = `https://www.marktplaats.nl${listingUrl}`;
      }

      // Extract title
      const title = item.title || item.name || item.description || item.advertentie?.titel;

      // STRONG VALIDATION: Must have URL + price + title
      if (!listingUrl || !price || !title || price < 100) {
        continue; // Skip invalid listings
      }

      // Extract year - multiple strategies
      let year: number | null = null;
      const yearCandidates = [
        item.year,
        item.constructionYear,
        item.bouwjaar,
        item.attributes?.find((a: any) =>
          a.key === 'year' ||
          a.key === 'constructionYear' ||
          a.key === 'bouwjaar'
        )?.value,
      ];

      for (const candidate of yearCandidates) {
        if (candidate != null) {
          const parsed = typeof candidate === 'number' ? candidate : parseInt(String(candidate), 10);
          if (parsed >= 1900 && parsed <= new Date().getFullYear() + 1) {
            year = parsed;
            break;
          }
        }
      }

      // Extract mileage - multiple strategies with Dutch keys
      let mileage: number | null = null;
      const mileageCandidates = [
        item.mileage,
        item.kilometerstand,
        item.odometer,
        item.attributes?.find((a: any) =>
          a.key === 'mileage' ||
          a.key === 'kilometerstand' ||
          a.key === 'odometer'
        )?.value,
      ];

      for (const candidate of mileageCandidates) {
        if (candidate != null) {
          const parsed = typeof candidate === 'number' ? candidate : parseInt(String(candidate).replace(/\D/g, ''), 10);
          if (parsed > 0 && parsed < 10000000) { // Sanity check
            mileage = parsed;
            break;
          }
        }
      }

      listings.push({
        title: String(title).substring(0, 200), // Truncate long titles
        price,
        currency: 'EUR',
        mileage,
        year,
        trim: null,
        listing_url: listingUrl,
        description: item.description || item.omschrijving || '',
        price_type: 'one-off',
      });
    }

  } catch (error) {
    // Fail-closed: silent failure, return empty array
  }

  return { listings, discoveredPath };
}

/**
 * Parse Marktplaats search results HTML into listings
 *
 * @param html - Raw HTML from Marktplaats search page
 * @param url - Source URL for normalization
 * @returns Array of scraped listings
 */
export function parseListings(html: string, url: string): ScrapedListing[] {
  let listings: ScrapedListing[] = [];
  let strategy: 'NEXT_DATA' | 'HTML_CARDS' | 'JSON' | 'NONE' = 'NONE';
  let nextDataPath: string | null = null;

  // Strategy 1: Try __NEXT_DATA__ extraction (PRIMARY - most reliable)
  const nextDataResult = parseNextData(html);
  if (nextDataResult.listings.length > 0) {
    listings = nextDataResult.listings;
    strategy = 'NEXT_DATA';
    nextDataPath = nextDataResult.discoveredPath;
  }

  // Strategy 2: Try HTML card extraction (fallback for non-Next.js pages)
  if (listings.length === 0) {
    listings = parseHtmlCards(html);
    if (listings.length > 0) {
      strategy = 'HTML_CARDS';
    }
  }

  // Strategy 3: Try generic JSON extraction (last resort)
  if (listings.length === 0) {
    listings = parseJsonListings(html);
    if (listings.length > 0) {
      strategy = 'JSON';
    }
  }

  // Debug logging - environment gated (NO HTML PREVIEW)
  if (typeof process !== 'undefined' && process.env?.STUDY_DEBUG === 'true') {
    if (listings.length === 0) {
      const hasNextData = html.toLowerCase().includes('__next_data__');
      const hasLdJson = html.toLowerCase().includes('application/ld+json');
      const hasHzListing = html.includes('hz-Listing');
      const htmlLength = html.length;

      console.log(`[STUDY_DEBUG_MARKTPLAATS_ZERO] url=${url} html_length=${htmlLength} has_next_data=${hasNextData} has_ld_json=${hasLdJson} has_hz_listing=${hasHzListing} strategy=all_failed`);
    } else {
      const pathInfo = nextDataPath ? ` path=${nextDataPath}` : '';
      console.log(`[STUDY_DEBUG_MARKTPLAATS] Extracted ${listings.length} listings via strategy=${strategy}${pathInfo}`);
    }
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
