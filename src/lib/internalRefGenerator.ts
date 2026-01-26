/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INTERNAL REFERENCE GENERATOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Generates deterministic internal references for listings to prevent duplicates
 * in the negotiations system.
 *
 * STRATEGY:
 * 1. PRIMARY: Extract marketplace + listing ID from URL
 * 2. FALLBACK: Hash the full URL using simple hash function (browser-compatible)
 *
 * PROPERTIES:
 * - Deterministic: Same URL → Same internal_ref
 * - Collision-resistant: Uses marketplace listing ID (unique per marketplace)
 * - Browser-compatible: Uses simple hash function, no Node.js dependencies
 */

/**
 * Extract marketplace identifier from URL
 */
function extractMarketplace(url: string): string {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    if (domain.includes('marktplaats')) return 'marktplaats';
    if (domain.includes('leboncoin')) return 'leboncoin';
    if (domain.includes('bilbasen')) return 'bilbasen';
    if (domain.includes('gaspedaal')) return 'gaspedaal';
    return 'unknown';
  } catch {
    // Fallback if URL parsing fails
    if (url.includes('marktplaats')) return 'marktplaats';
    if (url.includes('leboncoin')) return 'leboncoin';
    if (url.includes('bilbasen')) return 'bilbasen';
    if (url.includes('gaspedaal')) return 'gaspedaal';
    return 'unknown';
  }
}

/**
 * Extract listing ID from marketplace URL
 */
function extractListingId(url: string, marketplace: string): string | null {
  try {
    // Marktplaats: /a/12345 or /a/m12345
    if (marketplace === 'marktplaats') {
      const match = url.match(/\/a\/m?(\d+)/);
      return match ? match[1] : null;
    }

    // Leboncoin: /ad/voitures/<id> OR /<id>.htm
    if (marketplace === 'leboncoin') {
      const match = url.match(/\/ad\/voitures\/(\d+)(?:\/|$)|\/(\d+)\.htm(?:\/|$)/);
      const id = match ? (match[1] || match[2]) : null;
      return id;
    }

    // Bilbasen: ?id=12345 or /id-12345
    if (marketplace === 'bilbasen') {
      const match = url.match(/(?:\?|&)id=(\d+)|\/id-(\d+)/);
      return match ? (match[1] || match[2]) : null;
    }

    // Gaspedaal: /details/12345/
    if (marketplace === 'gaspedaal') {
      const match = url.match(/\/details\/(\d+)/);
      return match ? match[1] : null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Generate deterministic hash of URL using simple hash algorithm (browser-compatible)
 * Uses djb2 algorithm - fast, deterministic, good distribution
 */
function hashUrl(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) + hash) + url.charCodeAt(i); // hash * 33 + char
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to positive hex string
  return Math.abs(hash).toString(36).padStart(8, '0').substring(0, 16);
}

/**
 * Generate deterministic internal reference for a listing
 *
 * @param listing - Listing object with listing_url
 * @returns Internal reference string (e.g., "marktplaats_12345" or "leboncoin_a1b2c3d4e5f6")
 */
export function generateInternalRef(listing: {
  listing_url: string;
}): string {
  const marketplace = extractMarketplace(listing.listing_url);
  const listingId = extractListingId(listing.listing_url, marketplace);

  if (listingId) {
    // Primary: marketplace + listing ID
    return `${marketplace}_${listingId}`;
  }

  // Fallback: marketplace + URL hash
  const urlHash = hashUrl(listing.listing_url);
  return `${marketplace}_${urlHash}`;
}
