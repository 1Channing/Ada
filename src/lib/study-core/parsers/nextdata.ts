/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GENERIC __NEXT_DATA__ STRUCTURED PARSER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE. Many marketplaces (Marktplaats, Bilbasen, AutoScout, Leboncoin) are
 * Next.js apps that server-render their listings into a `__NEXT_DATA__` JSON
 * blob. Rather than scrape fragile HTML cards, we parse that JSON: deep-search
 * the listings array (shape-agnostic, skipping recommendation carousels) and
 * read each field tolerantly — from a direct key OR a Marktplaats-style
 * `attributes: [{key,value}]` array.
 *
 * Field key names differ per site, so extraction tries many candidates and
 * logs the first listing's keys for calibration. Callers fall back to their
 * legacy parser when this yields nothing.
 */

import type { ScrapedListing, Currency } from '../types';

const DKK_TO_EUR = 0.134; // in sync with parsers/shared.ts, business-logic.ts, marketData.ts

function extractNextData(html: string): any | null {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// Branches whose subtree holds OFF-TARGET cars (recommendations, similar,
// sponsored) — never descend into them.
const OFF_TARGET_KEY = /recommend|similar|suggest|sponsor|interlink|\bocs\b|otheradvert|related/i;

// Substrings that signal a car-listing object. A location {name,value} scores 0;
// a real listing (price + mileage + make + model + fuel + year…) scores high.
// Requiring 3+ distinct signals finds listings wherever they're nested (incl.
// Bilbasen's React-Query `dehydratedState`) without matching config/nav arrays.
const LISTING_SIGNALS = [
  'price', 'pricecents', 'priceinfo', 'mileage', 'kilometer', 'make', 'model',
  'fuel', 'year', 'regdate', 'registration', 'brand', 'horsepower', 'transmission',
  'itemid', 'vipurl', 'variant', 'engine',
];

function listingScore(o: any): number {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 0;
  const keys = Object.keys(o).map((k) => k.toLowerCase());
  let hits = 0;
  for (const s of LISTING_SIGNALS) if (keys.some((k) => k.includes(s))) hits++;
  return hits;
}
function looksLikeListing(o: any): boolean {
  return listingScore(o) >= 3;
}

function findListingsArray(root: any): any[] | null {
  let best: any[] | null = null;
  const seen = new Set<any>();
  const stack: any[] = [root];
  let guard = 0;
  while (stack.length && guard < 300_000) {
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

/** Read a value from direct keys (case-insensitive) or an attributes[] array. */
function readField(listing: any, directKeys: string[], attrKeys: string[]): string | null {
  const lower = directKeys.map((k) => k.toLowerCase());
  for (const k of Object.keys(listing)) {
    if (lower.includes(k.toLowerCase())) {
      const v = listing[k];
      if (v == null) continue;
      if (typeof v === 'object') {
        const inner = v.value ?? v.label ?? v.name ?? v.formattedValue ?? v.priceRaw ?? v.amount;
        if (inner != null) return String(inner);
        continue;
      }
      return String(v);
    }
  }
  // Attribute collections come in two shapes:
  //  • ARRAY of {key,value}       — Marktplaats (split across attributes AND
  //    extendedAttributes, so merge them all).
  //  • OBJECT map {key: {…}}      — Bilbasen `properties`
  //    ({ fueltype: {displayTextShort:'El'}, mileage: {…}, … }).
  const sources = [listing.attributes, listing.extendedAttributes, listing.specs, listing.vehicleDetails,
    listing.traits, listing.properties, listing.parameters, listing.details];
  const attrs: Array<{ key: string; value: any }> = [];
  for (const src of sources) {
    if (Array.isArray(src)) {
      for (const a of src) {
        const key = String(a?.key ?? a?.name ?? a?.label ?? a?.type ?? a?.iconName ?? a?.title ?? '');
        const value = a?.value ?? a?.formattedValue ?? a?.formatted ?? a?.data ?? a?.text ?? a?.displayText;
        if (key) attrs.push({ key, value });
      }
    } else if (src && typeof src === 'object') {
      for (const [key, raw] of Object.entries(src)) {
        const value = (raw && typeof raw === 'object')
          ? ((raw as any).displayTextShort ?? (raw as any).displayTextLong ?? (raw as any).value ?? (raw as any).text ?? (raw as any).label)
          : raw;
        attrs.push({ key, value });
      }
    }
  }
  if (attrs.length) {
    const wanted = attrKeys.map((k) => k.toLowerCase());
    // Exact key match wins (avoids e.g. mileage 'km' matching Bilbasen's 'kmt'
    // acceleration field); fall back to substring only if nothing matched exactly.
    for (const pass of ['exact', 'includes'] as const) {
      for (const a of attrs) {
        const key = a.key.toLowerCase();
        if (!key) continue;
        const hit = pass === 'exact' ? wanted.includes(key) : wanted.some((w) => key.includes(w));
        if (hit && a.value != null && String(a.value).trim()) return String(a.value);
      }
    }
  }
  return null;
}

/** Largest array of objects anywhere in the tree — diagnostic for shape discovery. */
function largestObjectArray(root: any): any[] | null {
  let best: any[] | null = null;
  const seen = new Set<any>();
  const stack: any[] = [root];
  let guard = 0;
  while (stack.length && guard < 300_000) {
    guard++;
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      const objs = cur.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).length;
      if (objs >= 2 && (!best || cur.length > best.length)) best = cur;
      for (const v of cur) if (v && typeof v === 'object') stack.push(v);
    } else {
      for (const k in cur) { const v = (cur as any)[k]; if (v && typeof v === 'object') stack.push(v); }
    }
  }
  return best;
}

/**
 * Diagnostic: every object-array in the tree whose first element carries at
 * least one listing signal, ranked by that element's score. When findListings
 * comes up empty (e.g. listings buried in a React-Query `dehydratedState` blob
 * under unexpected key names), this reveals the real shape from one log line.
 */
function candidateArrays(root: any, topN: number): Array<{ len: number; score: number; keys: string }> {
  const found: Array<{ len: number; score: number; keys: string }> = [];
  const seen = new Set<any>();
  const stack: any[] = [root];
  let guard = 0;
  while (stack.length && guard < 300_000) {
    guard++;
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      const first = cur.find((x) => x && typeof x === 'object' && !Array.isArray(x));
      const score = listingScore(first);
      if (score >= 1) found.push({ len: cur.length, score, keys: Object.keys(first).slice(0, 18).join(',') });
      for (const v of cur) if (v && typeof v === 'object') stack.push(v);
    } else {
      for (const k in cur) { const v = (cur as any)[k]; if (v && typeof v === 'object') stack.push(v); }
    }
  }
  return found.sort((a, b) => b.score - a.score || b.len - a.len).slice(0, topN);
}

function toInt(raw: string | null): number | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function toYear(raw: string | null): number | null {
  if (!raw) return null;
  const m = String(raw).match(/(19|20)\d{2}/);
  if (!m) return null;
  const y = parseInt(m[0], 10);
  return y >= 1980 && y <= new Date().getFullYear() + 1 ? y : null;
}
function toHp(raw: string | null): number | null {
  if (!raw) return null;
  const s = String(raw);
  const hp = s.match(/(\d+)\s*(?:hp|pk|ch|cv|ps|hk)\b/i);
  if (hp) return parseInt(hp[1], 10);
  const kw = s.match(/(\d+)\s*kw/i);
  if (kw) return Math.round(parseInt(kw[1], 10) * 1.35962);
  return toInt(raw);
}
function str(v: string | null): string | null {
  const t = (v ?? '').trim();
  return t || null;
}

/**
 * Bilbasen wraps the price in an object whose key names we can't predict
 * (`{formattedValue}`, `{displayValue}`, nested `{price:{amount}}`, …), so
 * instead of guessing, dive into the `price` field and return the first
 * plausible whole-currency amount (500 … 50M — filters out doors/year noise,
 * "199.900 kr" strings included). Scoped to the price field only, so it can't
 * pick up a leasing rate elsewhere in the listing.
 */
function deepFindPrice(v: any, depth = 0): number | null {
  if (v == null || depth > 5) return null;
  if (typeof v === 'number') return v > 500 && v < 50_000_000 ? Math.round(v) : null;
  if (typeof v === 'string') {
    const n = toInt(v);
    return n && n > 500 && n < 50_000_000 ? n : null;
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    for (const k of ['value', 'amount', 'raw', 'rawValue', 'price', 'priceValue', 'number', 'formattedValue', 'displayValue', 'formatted']) {
      if (k in v) { const r = deepFindPrice(v[k], depth + 1); if (r) return r; }
    }
    for (const k of Object.keys(v)) {
      if (/month|lease|leasing|financ|rate|ydelse|udbetaling/i.test(k)) continue;
      const r = deepFindPrice(v[k], depth + 1); if (r) return r;
    }
  }
  return null;
}

export interface NextDataConfig {
  host: string;
  currency: Currency; // native currency of the site (DKK converted to EUR)
  siteLabel: string;
}

export function parseNextDataListings(html: string, cfg: NextDataConfig): ScrapedListing[] {
  const data = extractNextData(html);
  if (!data) return [];

  const pageProps = data?.props?.pageProps ?? {};
  const ads = findListingsArray(pageProps) ?? findListingsArray(data);
  if (!ads || ads.length === 0) {
    console.warn(`[NEXTDATA] ${cfg.siteLabel}: no listings via looksLikeListing. pageProps keys: ${Object.keys(pageProps).join(', ')}`);
    const big = largestObjectArray(data);
    if (big) {
      console.warn(`[NEXTDATA] ${cfg.siteLabel}: largest object-array len=${big.length}; first keys: ${Object.keys(big[0] ?? {}).join(', ')}`);
      try { console.warn(`[NEXTDATA] ${cfg.siteLabel}: that item: ${JSON.stringify(big[0]).slice(0, 900)}`); } catch { /* ignore */ }
    }
    for (const c of candidateArrays(data, 5)) {
      console.warn(`[NEXTDATA] ${cfg.siteLabel}: candidate array len=${c.len} score=${c.score} keys=[${c.keys}]`);
    }
    return [];
  }
  console.log(`[NEXTDATA] ${cfg.siteLabel}: found ${ads.length} listings; keys: ${Object.keys(ads[0] ?? {}).join(', ')}`);
  try {
    const a0: any = ads[0];
    const attrDump = [a0?.attributes, a0?.extendedAttributes, a0?.properties, a0?.details, a0?.parameters, a0?.features]
      .filter(Array.isArray).flat().slice(0, 30)
      .map((a: any) => {
        if (a == null || typeof a !== 'object') return String(a);
        const k = a.key ?? a.name ?? a.label ?? a.type ?? a.iconName ?? a.title ?? '?';
        const v = a.value ?? a.formattedValue ?? a.formatted ?? a.text ?? a.data ?? '?';
        return `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`;
      }).join(' | ');
    console.log(`[NEXTDATA] ${cfg.siteLabel}: attrs → ${attrDump || '(none)'}`);
    // Dump the spec arrays directly (skip the huge `media` array that ate the
    // budget before) so unknown item shapes are visible in one line.
    const specDump = JSON.stringify({
      properties: a0?.properties, details: a0?.details, features: a0?.features,
      price: a0?.price, variant: a0?.variant,
    });
    console.log(`[NEXTDATA] ${cfg.siteLabel}: specs → ${specDump.slice(0, 1500)}`);
  } catch { /* ignore */ }

  const out: ScrapedListing[] = [];
  for (const ad of ads) {
    // Price — direct key, priceInfo.priceCents (cents), attribute, or a deep
    // dive into an opaque `price` object (Bilbasen).
    let priceRaw =
      toInt(readField(ad, ['price', 'priceCents', 'priceRaw', 'amount', 'currentPrice', 'salesPrice', 'consumerPrice'], ['price', 'prijs', 'pris'])) ?? null;
    const cents = ad?.priceInfo?.priceCents ?? ad?.price?.priceCents;
    if (cents != null && Number(cents) > 0) priceRaw = Math.round(Number(cents) / 100);
    if (!priceRaw && ad?.price != null) priceRaw = deepFindPrice(ad.price);
    if (!priceRaw) continue;
    const price = cfg.currency === 'DKK' ? Math.round(priceRaw * DKK_TO_EUR) : priceRaw;

    // URL
    let listingUrl = str(readField(ad, ['url', 'vipUrl', 'seoUrl', 'link', 'href', 'absoluteUrl', 'canonicalUrl', 'uri', 'detailUrl', 'permalink', 'detailPageUrl'], [])) ?? '';
    if (listingUrl.startsWith('/')) listingUrl = cfg.host + listingUrl;
    if (!listingUrl) continue;

    const make = str(readField(ad, ['make', 'brand', 'makeName', 'manufacturer'], ['merk', 'make', 'brand', 'mærke', 'maerke']));
    const model = str(readField(ad, ['model', 'modelName'], ['model']));
    const version = str(readField(ad, ['version', 'trim', 'variant', 'modelVariant', 'equipmentLevel', 'modelVersionInput'], ['uitvoering', 'version', 'variant', 'udstyrsvariant']));
    const title = str(readField(ad, ['title', 'subject', 'name', 'heading', 'subtitle', 'headline'], []))
      ?? ([make, model, version].filter(Boolean).join(' ') || 'Listing');

    const year = toYear(readField(ad, ['year', 'constructionYear', 'registrationYear', 'modelYear', 'firstRegistration', 'regDate'], ['firstregistrationdate', 'registration', 'constructionYear', 'bouwjaar', 'year', 'årgang', 'aargang']));
    const mileage = toInt(readField(ad, ['mileage', 'mileageInKm', 'km', 'odometer', 'kilometers'], ['mileage', 'kilometerstand', 'km', 'kilometer']));
    const fuel = str(readField(ad, ['fuel', 'fuelType', 'fuelCategory'], ['fuel', 'brandstof', 'brændstof', 'braendstof', 'fueltype']));
    const gearbox = str(readField(ad, ['transmission', 'gearbox', 'transmissionType'], ['transmission', 'transmissie', 'gearbox', 'gear', 'geartype']));
    const powerDin = toHp(readField(ad, ['power', 'horsePower', 'hp', 'powerHp', 'enginePower', 'rawPowerInKw'], ['vermogen', 'power', 'horsepower', 'hestekræfter', 'hk', 'effekt']));

    out.push({
      title: title.slice(0, 200),
      price,
      currency: 'EUR',
      mileage,
      year,
      trim: version,
      listing_url: listingUrl,
      description: (str(readField(ad, ['description', 'teaser', 'body'], [])) ?? '').slice(0, 300),
      price_type: 'one-off',
      brand: make,
      fuel,
      gearbox,
      powerDin,
      doors: null,
      seats: null,
      color: str(readField(ad, ['color', 'colour', 'exteriorColor', 'bodyColor'], ['kleur', 'color', 'farve'])),
      vehicleType: str(readField(ad, ['bodyType', 'body', 'category', 'carType'], ['carrosserie', 'bodytype', 'karrosseri'])),
    });
  }

  console.log(`[NEXTDATA] ${cfg.siteLabel}: extracted ${out.length} priced listings`);
  return out;
}
