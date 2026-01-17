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

    // Try multiple possible paths where Leboncoin might store listings
    const possiblePaths = [
      data?.props?.pageProps?.searchData?.ads,
      data?.props?.pageProps?.ads,
      data?.props?.pageProps?.listings,
      data?.props?.pageProps?.searchData?.results,
      data?.props?.pageProps?.results,
      data?.props?.pageProps?.data?.ads,
      data?.props?.pageProps?.data?.listings,
      data?.props?.pageProps?.initialData?.ads,
      data?.props?.ads,
      data?.ads,
    ];

    let adsArray: any[] = [];
    let foundPath = '';

    for (let i = 0; i < possiblePaths.length; i++) {
      const path = possiblePaths[i];
      if (Array.isArray(path) && path.length > 0) {
        adsArray = path;
        foundPath = `possiblePaths[${i}]`;
        console.log(`[LEBONCOIN] ✅ Found ${path.length} listings at ${foundPath}`);
        break;
      }
    }

    if (adsArray.length === 0) {
      console.warn('[LEBONCOIN] ⚠️ No ads array found in known paths');
      console.warn('[LEBONCOIN] Available top-level keys:', Object.keys(data || {}).join(', '));
      if (data?.props) {
        console.warn('[LEBONCOIN] data.props keys:', Object.keys(data.props).join(', '));
        if (data.props.pageProps) {
          console.warn('[LEBONCOIN] data.props.pageProps keys:', Object.keys(data.props.pageProps).join(', '));
        }
      }
      return listings;
    }

    console.log(`[LEBONCOIN] Processing ${adsArray.length} listings from ${foundPath}`);

    for (const ad of adsArray) {
      // Try multiple price paths
      const priceValue = ad.price?.[0] || ad.price || ad.amount || ad.value;
      const price = typeof priceValue === 'number' ? priceValue :
                   typeof priceValue === 'string' ? parseInt(priceValue.replace(/\D/g, ''), 10) :
                   priceValue?.value ? parseInt(String(priceValue.value).replace(/\D/g, ''), 10) : null;

      // Try multiple URL paths
      let listingUrl = ad.url || ad.link || ad.href || ad.uri;
      if (listingUrl && listingUrl.startsWith('/')) {
        listingUrl = `https://www.leboncoin.fr${listingUrl}`;
      }

      if (!price || !listingUrl) continue;

      // Try multiple attribute paths
      const attributes = ad.attributes || ad.attrs || ad.properties || {};

      // Year extraction with multiple fallbacks
      let year = null;
      const yearCandidates = [
        attributes.regdate,
        attributes.year,
        attributes.registration_date,
        attributes.first_registration,
        ad.year,
        ad.regdate,
      ];
      for (const candidate of yearCandidates) {
        if (candidate) {
          const parsed = typeof candidate === 'number' ? candidate : parseInt(String(candidate), 10);
          if (parsed >= 1900 && parsed <= new Date().getFullYear() + 1) {
            year = parsed;
            break;
          }
        }
      }

      // Mileage extraction with multiple fallbacks
      let mileage = null;
      const mileageCandidates = [
        attributes.mileage,
        attributes.kilometrage,
        attributes.km,
        ad.mileage,
        ad.kilometrage,
      ];
      for (const candidate of mileageCandidates) {
        if (candidate != null) {
          const parsed = typeof candidate === 'number' ? candidate : parseInt(String(candidate).replace(/\D/g, ''), 10);
          if (parsed > 0) {
            mileage = parsed;
            break;
          }
        }
      }

      listings.push({
        title: ad.subject || ad.title || ad.name || 'Untitled',
        price,
        currency: 'EUR',
        mileage,
        year,
        trim: null,
        listing_url: listingUrl,
        description: ad.body || ad.description || ad.text || '',
        price_type: 'one-off',
      });
    }
  } catch (error) {
    console.error('[LEBONCOIN] ❌ Error parsing __NEXT_DATA__:', error instanceof Error ? error.message : String(error));
    // Return empty array on error
  }

  console.log(`[LEBONCOIN] ✅ Successfully parsed ${listings.length} listings`);
  return listings;
}
