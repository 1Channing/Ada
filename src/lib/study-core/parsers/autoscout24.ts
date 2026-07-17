/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTOSCOUT24 PURE PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE DETERMINISTIC PARSER - NO I/O, NO SIDE EFFECTS.
 *
 * AutoScout24 (pan-European, one Next.js app per country TLD) embeds its
 * search results in a __NEXT_DATA__ JSON blob, like Leboncoin. Each listing
 * carries a `vehicle` object, a `tracking` object and a `vehicleDetails`
 * array of human strings ("35.200 km", "05/2023", "110 kW (150 hp)").
 *
 * The exact key names have not been verified against a live sample yet
 * (autoscout24.* sits behind Cloudflare, unreachable from the design
 * environment), so this parser is deliberately tolerant: it tries several
 * shapes per field and logs FOUND vs EXPECTED keys so the first real scrape
 * self-reports what to calibrate. All AS24 markets we cover are Eurozone →
 * currency is always EUR.
 */

import type { ScrapedListing } from '../types';

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function toInt(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function yearFrom(raw: unknown): number | null {
  if (raw == null) return null;
  const m = String(raw).match(/(19|20)\d{2}/);
  if (!m) return null;
  const y = parseInt(m[0], 10);
  return y >= 1990 && y <= new Date().getFullYear() + 1 ? y : null;
}

/** "110 kW (150 hp)" / "150 PS" / 150 → DIN horsepower. Falls back to kW×1.36. */
function extractHp(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw);
  const hp = s.match(/(\d+)\s*(?:hp|ch|pk|cv|ps)\b/i);
  if (hp) return parseInt(hp[1], 10);
  const kw = s.match(/(\d+)\s*kw/i);
  if (kw) return Math.round(parseInt(kw[1], 10) * 1.35962);
  return toInt(raw);
}

// AutoScout24 sometimes exposes the fuel as its URL code (B/D/E/2/3/L/C) in the
// listing JSON rather than a word. Translate to a human label so downstream
// canonicalisation reads it right (code "2" = petrol-hybrid, not "unknown").
const AS24_FUEL_LABEL: Record<string, string> = {
  B: 'Essence', D: 'Diesel', E: 'Électrique',
  '2': 'Hybride essence/électrique', '3': 'Hybride diesel/électrique',
  L: 'GPL', C: 'GNV',
};
function normFuel(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  return AS24_FUEL_LABEL[s.trim().toUpperCase()] ?? s;
}

// Does this object look like a car listing? (has an id-ish key AND a price/
// vehicle-ish key). Used by the deep search below.
function looksLikeListing(o: any): boolean {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const hasId = 'id' in o || 'guid' in o || 'url' in o;
  const hasVehicleish = 'price' in o || 'prices' in o || 'priceInfo' in o || 'vehicle' in o || 'tracking' in o;
  return hasId && hasVehicleish;
}

// Keys whose subtree holds OFF-TARGET cars (recommendations, similar-vehicle
// carousels, sponsored/interlinking blocks). The deep search must never descend
// into these — grabbing them pollutes a study with cars the user didn't search.
const OFF_TARGET_KEY = /recommend|similar|suggest|sponsor|interlink|\bocs\b/i;

// Last-resort: find the largest array of listing-like objects in the tree,
// skipping off-target branches. Only used when no explicit results path exists.
function findListingsArray(root: any): any[] | null {
  let best: any[] | null = null;
  const seen = new Set<any>();
  const stack: any[] = [root];
  let guard = 0;
  while (stack.length && guard < 200_000) {
    guard++;
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      const hits = cur.filter(looksLikeListing).length;
      if (hits > 0 && hits >= Math.floor(cur.length / 2) && (!best || cur.length > best.length)) best = cur;
      for (const v of cur) if (v && typeof v === 'object') stack.push(v);
    } else {
      for (const k in cur) {
        if (OFF_TARGET_KEY.test(k)) continue;
        const v = (cur as any)[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  return best;
}

function detailRows(listing: any): any[] {
  const d = listing?.vehicleDetails ?? listing?.details ?? [];
  return Array.isArray(d) ? d : [];
}
/** Find a vehicleDetails row whose icon name matches any hint. */
function detailByIcon(rows: any[], icons: string[]): string | null {
  for (const it of rows) {
    const icon = String(it?.iconName ?? it?.icon ?? '').toLowerCase();
    if (icons.some((k) => icon.includes(k))) {
      const v = it?.data ?? it?.value ?? it?.label;
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return null;
}

export function parseListings(html: string, url: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    console.warn('[AUTOSCOUT] ⚠️ No __NEXT_DATA__ script found');
    return listings;
  }

  let data: any;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    console.error('[AUTOSCOUT] ❌ __NEXT_DATA__ JSON parse error:', e instanceof Error ? e.message : String(e));
    return listings;
  }

  const pageProps = data?.props?.pageProps ?? {};

  // `pageProps.listings` is the AUTHORITATIVE search-result set. An empty array
  // means 0 results (e.g. no 2021 Ignis in DE) — we return empty and must NOT
  // fall back to recommendation / similar-vehicle carousels, which would
  // pollute the study with off-target cars.
  let ads: any[] = [];
  let source = '';
  if (Array.isArray(pageProps.listings)) {
    ads = pageProps.listings;
    source = 'pageProps.listings';
  } else {
    // 'listings' key absent → try other explicit result paths, then a guarded
    // tree scan (which skips off-target branches).
    const explicit: [string, any][] = [
      ['searchResults.listings', pageProps.searchResults?.listings],
      ['data.listings', pageProps.data?.listings],
      ['listingsData.listings', pageProps.listingsData?.listings],
      ['results', pageProps.results],
    ];
    for (const [name, p] of explicit) {
      if (Array.isArray(p)) { ads = p; source = name; break; }
    }
    if (ads.length === 0 && source === '') {
      const found = findListingsArray(pageProps);
      if (found) { ads = found; source = 'deep-search'; }
    }
  }

  if (ads.length === 0) {
    console.log(`[AUTOSCOUT] 0 search results (source=${source || 'none'}) — recommendations ignored. pageProps keys:`, Object.keys(pageProps).join(', '));
    return listings;
  }

  console.log(`[AUTOSCOUT] found ${ads.length} listings via ${source}; first keys:`, Object.keys(ads[0] ?? {}).join(', '));

  const host = (() => { try { return new URL(url).origin; } catch { return 'https://www.autoscout24.com'; } })();

  for (const ad of ads) {
    const tr = ad?.tracking ?? {};
    const ve = ad?.vehicle ?? {};
    const rows = detailRows(ad);

    const price = toInt(
      ad?.price?.priceFormatted ?? ad?.price?.public?.priceRaw ?? ad?.price?.raw ??
      ad?.prices?.public?.priceRaw ?? ad?.prices?.[0]?.priceRaw ?? ad?.prices?.[0]?.amount ??
      ad?.priceInfo?.priceRaw ?? tr?.price ?? ad?.priceRaw,
    );
    if (!price) continue;

    let listingUrl: string = str(ad?.url) ?? str(ad?.link) ?? (ad?.id ? `/offers/${ad.id}` : '') ?? '';
    if (listingUrl.startsWith('/')) listingUrl = host + listingUrl;
    if (!listingUrl) continue;

    const make = str(ve?.make) ?? str(tr?.make);
    const model = str(ve?.model) ?? str(tr?.model);
    const version = str(ve?.modelVersionInput) ?? str(ve?.modelVersion) ?? str(ad?.subtitle);

    const mileage = toInt(tr?.mileage ?? detailByIcon(rows, ['mileage', 'km']) ?? ad?.mileage);
    const year = yearFrom(
      tr?.firstRegistration ?? ve?.firstRegistrationDate ?? detailByIcon(rows, ['calendar', 'registration']) ?? ad?.firstRegistrationDate,
    );
    const fuel = normFuel(ve?.fuelCategory ?? ve?.fuelType ?? tr?.fuelType ?? detailByIcon(rows, ['gas', 'fuel', 'petrol']));
    const gearbox = str(ve?.transmissionType) ?? str(tr?.gearBox) ?? detailByIcon(rows, ['transmission', 'gear']);
    const powerDin = extractHp(tr?.powerHp ?? tr?.rawPowerInKw ?? detailByIcon(rows, ['engine', 'speed', 'power']));
    const bodyType = str(ve?.bodyType) ?? str(tr?.bodyType);

    listings.push({
      title: [make, model, version].filter(Boolean).join(' ') || (str(ad?.title) ?? 'Autoscout24 listing'),
      price,
      currency: 'EUR',
      mileage,
      year,
      trim: version,
      listing_url: listingUrl,
      description: (str(ad?.teaser) ?? str(ad?.description) ?? '').slice(0, 500),
      price_type: 'one-off',
      brand: make,
      fuel,
      gearbox,
      powerDin,
      doors: toInt(detailByIcon(rows, ['door'])),
      seats: toInt(detailByIcon(rows, ['seat'])),
      color: null,
      vehicleType: bodyType,
    });
  }

  if (listings.length === 0 && html.length > 100_000) {
    console.warn('[AUTOSCOUT] ⚠️ parser_failed_on_html — htmlLength=' + html.length + ' but 0 listings extracted');
  }
  console.log(`[AUTOSCOUT] ✅ Parsed ${listings.length} listings`);
  return listings;
}
