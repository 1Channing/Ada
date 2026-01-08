/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BILBASEN PURE PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE DETERMINISTIC PARSER - NO I/O, NO SIDE EFFECTS
 * Single source of truth for Bilbasen parsing logic.
 */

import type { ScrapedListing } from '../types';
import { extractPrice, extractTitle, extractYear, extractMileage } from './shared';

/**
 * Parse Bilbasen search results HTML into listings
 *
 * Uses context-window extraction: finds anchors with /brugt/bil/,
 * then extracts price/year/mileage from surrounding ±2000 chars.
 *
 * @param html - Raw HTML from Bilbasen search page
 * @param url - Source URL for normalization
 * @returns Array of scraped listings
 */
export function parseListings(html: string, url: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  const anchorRegex = /<a\s+[^>]*href=["']([^"']*\/brugt\/bil\/[^"']*)["'][^>]*>/gi;
  const anchorMatches = Array.from(html.matchAll(anchorRegex));

  if (anchorMatches.length === 0) return listings;

  const processedUrls = new Set<string>();

  for (const anchorMatch of anchorMatches) {
    const anchorTag = anchorMatch[0];
    const href = anchorMatch[1];

    if (href.startsWith('#') || href.startsWith('javascript:')) continue;

    let listingUrl = href;
    if (href.startsWith('/')) {
      listingUrl = `https://www.bilbasen.dk${href}`;
    }

    if (processedUrls.has(listingUrl)) continue;
    processedUrls.add(listingUrl);

    // Extract context around anchor (±2000 chars)
    const anchorIndex = html.indexOf(anchorTag);
    if (anchorIndex === -1) continue;

    const contextStart = Math.max(0, anchorIndex - 2000);
    const contextEnd = Math.min(html.length, anchorIndex + 2000);
    const cardHtml = html.substring(contextStart, contextEnd);

    // Skip related listings sections
    if (cardHtml.includes('RelatedListings_')) continue;

    const textContent = cardHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const price = extractPrice(textContent);

    if (!price) continue;

    const title = extractTitle(cardHtml) || textContent.substring(0, 100).trim();
    const year = extractYear(textContent);
    const mileage = extractMileage(textContent);

    listings.push({
      title,
      price,
      currency: 'DKK',
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
