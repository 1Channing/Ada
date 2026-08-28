/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LEBONCOIN PURE PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE DETERMINISTIC PARSER - NO I/O, NO SIDE EFFECTS
 * Single source of truth for Leboncoin parsing logic.
 */

import type { ScrapedListing } from '../types';
import { parsePublishedAt } from './shared';

/**
 * Read one attribute from a Leboncoin ad, tolerant of both shapes seen in
 * __NEXT_DATA__: an array of `{ key, value, value_label }` objects, or a
 * keyed object. Returns the raw value plus the human label when present.
 */
function readAttr(
  attributes: any,
  keys: string[]
): { value: any; label: string | null } | null {
  if (!attributes) return null;

  if (Array.isArray(attributes)) {
    for (const k of keys) {
      const found = attributes.find((a: any) => a && (a.key === k || a.key_label === k));
      if (found) {
        return {
          value: found.value ?? found.value_label ?? null,
          label: found.value_label ?? (found.value != null ? String(found.value) : null),
        };
      }
    }
    return null;
  }

  for (const k of keys) {
    const v = (attributes as Record<string, any>)[k];
    if (v != null) {
      if (typeof v === 'object') {
        return { value: v.value ?? v.value_label ?? null, label: v.value_label ?? null };
      }
      return { value: v, label: String(v) };
    }
  }
  return null;
}

function attrNumber(attributes: any, keys: string[]): number | null {
  const a = readAttr(attributes, keys);
  if (!a || a.value == null) return null;
  const n = typeof a.value === 'number' ? a.value : parseInt(String(a.value).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function attrLabel(attributes: any, keys: string[]): string | null {
  const a = readAttr(attributes, keys);
  if (!a) return null;
  const label = a.label ?? (a.value != null ? String(a.value) : null);
  return label && label.trim() ? label.trim() : null;
}

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
      // total = ce que le SERVEUR annonce : 0 → vraie recherche vide ; > 0 →
      // page servie sans son tableau (soft-block) ; absent → forme inconnue.
      const total = data?.props?.pageProps?.searchData?.total;
      console.warn(`[LEBONCOIN] ⚠️ No ads array found in known paths (searchData.total=${total ?? 'absent'}) ${url.slice(0, 110)}`);
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

      // Normalize the array shape [{key,value,value_label}] to a keyed lookup
      // so the legacy year/mileage accessors below work regardless of shape.
      // (readAttr below already tolerates both forms for the newer fields.)
      const attrMap: Record<string, any> = Array.isArray(attributes)
        ? Object.fromEntries(
            attributes
              .filter((a: any) => a && a.key)
              .map((a: any) => [a.key, a.value ?? a.value_label])
          )
        : attributes;

      // Year extraction with multiple fallbacks
      let year = null;
      const yearCandidates = [
        attrMap.regdate,
        attrMap.year,
        attrMap.registration_date,
        attrMap.first_registration,
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
        attrMap.mileage,
        attrMap.kilometrage,
        attrMap.km,
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

      // Secondary structured attributes (enum fields keep the human label)
      const brandLabel = attrLabel(attributes, ['brand', 'u_car_brand', 'make']);
      const fuelLabel = attrLabel(attributes, ['fuel', 'energie', 'carburant', 'energy']);
      const trimLabel = attrLabel(attributes, ['version', 'finition', 'trim', 'model_variant', 'u_car_version']);
      const gearbox = attrLabel(attributes, ['gearbox', 'boite_vitesse', 'transmission']);
      const powerDin = attrNumber(attributes, ['horse_power_din', 'horsepower_din', 'puissance_din', 'horse_power']);
      const doors = attrNumber(attributes, ['doors', 'nb_doors', 'number_of_doors']);
      const seats = attrNumber(attributes, ['seats', 'nb_seats', 'number_of_seats']);
      const color = attrLabel(attributes, ['vehicle_color', 'color', 'couleur']);
      const vehicleType = attrLabel(attributes, ['vehicle_type', 'vehicule_type', 'body_type', 'carrosserie']);

      listings.push({
        title: ad.subject || ad.title || ad.name || 'Untitled',
        price,
        currency: 'EUR',
        mileage,
        year,
        // Mise en ligne déclarée par l'annonce (« Publié il y a X » du site —
        // sonde 28/08) : first_publication_date prime, index_date en repli
        // (remontée en tête de liste au ré-index). Fail-open via normaliseur.
        publishedAt: parsePublishedAt(ad.first_publication_date ?? ad.index_date ?? ad.publication_date),
        trim: trimLabel,
        listing_url: listingUrl,
        description: ad.body || ad.description || ad.text || '',
        price_type: 'one-off',
        brand: brandLabel,
        fuel: fuelLabel,
        gearbox,
        powerDin,
        doors,
        seats,
        color,
        vehicleType,
      });
    }
  } catch (error) {
    console.error('[LEBONCOIN] ❌ Error parsing __NEXT_DATA__:', error instanceof Error ? error.message : String(error));
    // Return empty array on error
  }

  console.log(`[LEBONCOIN] ✅ Successfully parsed ${listings.length} listings`);
  return listings;
}
