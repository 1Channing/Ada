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
  const candidatePaths = [
    pageProps.listings,
    pageProps.searchResults?.listings,
    pageProps.initialState?.listings,
    pageProps.listingsData?.listings,
    pageProps.data?.listings,
    pageProps.results,
  ];
  let ads: any[] = [];
  for (const p of candidatePaths) {
    if (Array.isArray(p) && p.length > 0) { ads = p; break; }
  }
  if (ads.length === 0) {
    console.warn('[AUTOSCOUT] ⚠️ No listings array found. pageProps keys:', Object.keys(pageProps).join(', '));
    return listings;
  }

  // Calibration aid (see BACKLOG parser-diagnostics): report the first ad's keys.
  console.log('[AUTOSCOUT] first listing keys:', Object.keys(ads[0] ?? {}).join(', '));

  const host = (() => { try { return new URL(url).origin; } catch { return 'https://www.autoscout24.com'; } })();

  for (const ad of ads) {
    const tr = ad?.tracking ?? {};
    const ve = ad?.vehicle ?? {};
    const rows = detailRows(ad);

    const price = toInt(
      ad?.price?.priceFormatted ?? ad?.price?.public?.priceRaw ?? ad?.price?.raw ?? tr?.price ?? ad?.priceRaw,
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
    const fuel = str(ve?.fuelCategory) ?? str(ve?.fuelType) ?? str(tr?.fuelType) ?? detailByIcon(rows, ['gas', 'fuel', 'petrol']);
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
