/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LINKGEN URL SAMPLE COLLECTOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Collects sample listings from marketplaces for link generator analysis.
 *
 * FEATURES:
 * - Early termination: stops as soon as target_count is reached
 * - Diversity enforcement: max 3 samples per (brand, model) per run
 * - Deduplication: upserts on internal_ref with ignoreDuplicates
 * - Best-effort parsing: keeps null for unknown brand/model/year/fuel/mileage
 * - Retry logic: only for transient errors (429, 5xx)
 * - No artificial delays: runs as fast as possible
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { coreParseSearchPage } from '../src/lib/study-core/index';
import { generateInternalRef } from '../src/lib/internalRefGenerator';

const ZYTE_API_KEY = process.env.ZYTE_API_KEY || '';
const ZYTE_ENDPOINT = 'https://api.zyte.com/v1/extract';

interface CollectSamplesParams {
  marketplace: string;
  targetCount: number;
  maxPages: number;
  seedUrl?: string;
  supabase: SupabaseClient;
}

interface CollectSamplesResult {
  samplesCollected: number;
  samplesInserted: number;
  duplicatesSkipped: number;
  diversityLimited: number;
}

/**
 * Fetch HTML from Zyte API with retry logic for transient errors only
 */
async function fetchHtml(url: string, maxRetries = 3): Promise<string | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(ZYTE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
        },
        body: JSON.stringify({
          url,
          browserHtml: true,
        }),
      });

      const statusCode = response.status;

      // Only retry on transient errors (429, 5xx)
      if (!response.ok) {
        const shouldRetry = statusCode === 429 || (statusCode >= 500 && statusCode < 600);

        if (shouldRetry && attempt < maxRetries - 1) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`[LINKGEN] Retry after ${delay}ms (status ${statusCode})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.error(`[LINKGEN] HTTP error ${statusCode}, giving up`);
        return null;
      }

      const data = await response.json() as { browserHtml?: string };
      return data.browserHtml || null;

    } catch (error) {
      // Network errors: retry
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[LINKGEN] Network error, retry after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      console.error(`[LINKGEN] Fatal network error:`, error);
      return null;
    }
  }

  return null;
}

/**
 * Build paginated URL for Marktplaats
 */
function buildPaginatedUrl(baseUrl: string, pageNumber: number): string {
  if (pageNumber <= 1) return baseUrl;

  try {
    const urlObj = new URL(baseUrl);
    urlObj.searchParams.set('page', String(pageNumber));
    return urlObj.toString();
  } catch {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}page=${pageNumber}`;
  }
}

/**
 * Best-effort extraction of brand from listing
 */
function extractBrand(listing: { title: string; description?: string }): string | null {
  const text = `${listing.title} ${listing.description || ''}`.toLowerCase();

  // Common brands
  const brands = [
    'volkswagen', 'vw', 'mercedes', 'mercedes-benz', 'bmw', 'audi', 'ford', 'opel',
    'renault', 'peugeot', 'citroen', 'toyota', 'honda', 'nissan', 'mazda', 'hyundai',
    'kia', 'volvo', 'seat', 'skoda', 'fiat', 'alfa romeo', 'mini', 'porsche', 'tesla',
  ];

  for (const brand of brands) {
    if (text.includes(brand)) {
      return brand;
    }
  }

  // Try to extract from title (first word after common prefixes)
  const titleMatch = listing.title.match(/^(?:occasion\s+)?(\w+)/i);
  if (titleMatch) {
    return titleMatch[1].toLowerCase();
  }

  return null;
}

/**
 * Best-effort extraction of model from listing
 */
function extractModel(listing: { title: string; description?: string }): string | null {
  // Try to extract from title (second/third word)
  const words = listing.title.split(/\s+/).filter(w => w.length > 2);
  if (words.length >= 2) {
    // Skip brand, take next word as model
    return words[1].toLowerCase();
  }

  return null;
}

/**
 * Best-effort extraction of fuel type from listing
 */
function extractFuel(listing: { title: string; description?: string }): string | null {
  const text = `${listing.title} ${listing.description || ''}`.toLowerCase();

  if (text.includes('diesel')) return 'diesel';
  if (text.includes('benzine') || text.includes('petrol')) return 'benzine';
  if (text.includes('hybrid')) return 'hybrid';
  if (text.includes('electric') || text.includes('elektrisch')) return 'electric';
  if (text.includes('lpg')) return 'lpg';

  return null;
}

/**
 * Collect sample listings from a marketplace
 */
export async function collectLinkgenSamples(
  params: CollectSamplesParams
): Promise<CollectSamplesResult> {
  const { marketplace, targetCount, maxPages, seedUrl, supabase } = params;

  console.log(`[LINKGEN] Starting collection: target=${targetCount}, maxPages=${maxPages}`);

  // Default seed URL for Marktplaats (general car search)
  const baseUrl = seedUrl || 'https://www.marktplaats.nl/l/auto-s/';

  const allSamples: any[] = [];
  const brandModelCounts = new Map<string, number>(); // Track diversity
  let diversityLimited = 0;

  for (let page = 1; page <= maxPages; page++) {
    // Early termination: stop if target reached
    if (allSamples.length >= targetCount) {
      console.log(`[LINKGEN] Target count reached (${targetCount}), stopping early`);
      break;
    }

    const url = buildPaginatedUrl(baseUrl, page);
    console.log(`[LINKGEN] Fetching page ${page}: ${url.substring(0, 100)}...`);

    const html = await fetchHtml(url);
    if (!html) {
      console.error(`[LINKGEN] Failed to fetch page ${page}, stopping`);
      break;
    }

    // Parse using existing parser
    const listings = coreParseSearchPage(html, url);
    console.log(`[LINKGEN] Page ${page}: parsed ${listings.length} listings`);

    if (listings.length === 0) {
      console.log(`[LINKGEN] No listings found on page ${page}, stopping`);
      break;
    }

    // Process each listing
    for (const listing of listings) {
      // Early termination check
      if (allSamples.length >= targetCount) {
        break;
      }

      // Best-effort field extraction
      const brand = extractBrand(listing);
      const model = extractModel(listing);
      const fuel = extractFuel(listing);

      // Diversity rule: max 3 per (brand, model) when both are known
      if (brand && model) {
        const key = `${brand}:${model}`;
        const count = brandModelCounts.get(key) || 0;

        if (count >= 3) {
          diversityLimited++;
          continue; // Skip this listing
        }

        brandModelCounts.set(key, count + 1);
      }

      // Generate internal_ref
      const internalRef = generateInternalRef({ listing_url: listing.listing_url });

      // Prepare sample record
      const sample = {
        marketplace: 'MARKTPLAATS',
        listing_url: listing.listing_url,
        internal_ref: internalRef,
        brand,
        model,
        year: listing.year,
        fuel,
        mileage: listing.mileage,
        country: 'NL',
        source_seed: seedUrl || null,
        raw: {
          title: listing.title,
          price: listing.price,
          currency: listing.currency,
        },
        scraped_at: new Date().toISOString(),
      };

      allSamples.push(sample);
    }
  }

  console.log(`[LINKGEN] Collection phase complete: ${allSamples.length} samples to insert`);

  // Insert samples with deduplication
  let samplesInserted = 0;
  let duplicatesSkipped = 0;

  if (allSamples.length > 0) {
    const { data, error } = await supabase
      .from('linkgen_url_samples')
      .upsert(allSamples, {
        onConflict: 'internal_ref',
        ignoreDuplicates: true,
      })
      .select('id');

    if (error) {
      console.error('[LINKGEN] Database error:', error);
      throw new Error(`Failed to insert samples: ${error.message}`);
    }

    samplesInserted = data?.length || 0;
    duplicatesSkipped = allSamples.length - samplesInserted;

    console.log(`[LINKGEN] Database insert: ${samplesInserted} new, ${duplicatesSkipped} duplicates`);
  }

  return {
    samplesCollected: allSamples.length,
    samplesInserted,
    duplicatesSkipped,
    diversityLimited,
  };
}
