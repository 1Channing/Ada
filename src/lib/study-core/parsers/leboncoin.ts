/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LEBONCOIN PURE PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE DETERMINISTIC PARSER - NO I/O, NO SIDE EFFECTS
 * Single source of truth for Leboncoin parsing logic.
 */

import type { ScrapedListing } from '../types';

/**
 * Parse Leboncoin search results HTML into listings
 *
 * Leboncoin uses __NEXT_DATA__ JSON embedded in the page
 *
 * @param html - Raw HTML from Leboncoin search page
 * @param url - Source URL for normalization
 * @returns Array of scraped listings
 */
export function parseListings(html: string, url: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

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

      let listingUrl = ad.url || ad.link;
      if (listingUrl && listingUrl.startsWith('/')) {
        listingUrl = `https://www.leboncoin.fr${listingUrl}`;
      }

      if (!price || !listingUrl) continue;

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
        listing_url: listingUrl,
        description: ad.body || ad.description || '',
        price_type: 'one-off',
      });
    }
  } catch (error) {
    // Silent failure - return empty array
  }

  return listings;
}
