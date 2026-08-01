/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WORKER SCRAPER - TYPESCRIPT (USES PURE PARSERS)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **UNIFIED PIPELINE:**
 * ✅ Parsing: Imports from src/lib/study-core/parsers (PURE functions)
 * ✅ Business Logic: Imports from src/lib/study-core/business-logic (PURE functions)
 * ✅ This file: I/O only (Zyte fetch, Supabase persistence)
 *
 * **NO DUPLICATION:**
 * All parsing and business logic is imported from single source of truth.
 * Worker cannot drift from frontend - both use identical code.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  coreParseSearchPage,
  filterListingsByStudy,
  computeTargetMarketStats,
  detectOpportunity,
  detectBlockedContent,
  type ScrapedListing,
  type StudyCriteria,
} from '../src/lib/study-core/index';
import { parseDetailPage, type DetailPageData } from '../src/lib/study-core/detailParsers';
import { findSiteAdapterByDomain } from '../src/lib/study-core/marketplaces';
import { mpSlugOfLabel } from '../src/lib/study-core/marketplaces/marktplaats';
import { generateInternalRef } from '../src/lib/internalRefGenerator';
import { canonicalizeFuel, refineFuelToken } from '../src/lib/study-core/ingestion';
import { StudyLogger } from './studyLogger';

const ZYTE_API_KEY = process.env.ZYTE_API_KEY || '';
const ZYTE_ENDPOINT = 'https://api.zyte.com/v1/extract';

// DIAGNOSTIC: Worker build tag for production verification
console.log('[WORKER_BUILD_TAG] marktplaats_diag_v1 deployed');

/**
 * Exchange rates for currency conversion
 */
const FX_RATES: Record<string, number> = {
  'EUR': 1.0,
  'DKK': 0.134,  // 1 DKK ≈ 0.134 EUR
  'UNKNOWN': 1.0,
};

/**
 * Convert price to EUR based on currency
 */
function toEur(price: number, currency: string): number {
  return price * (FX_RATES[currency] ?? 1.0);
}

function percentileAsc(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function siteKeyForUrl(url: string): string {
  try { return findSiteAdapterByDomain(new URL(url).hostname)?.key ?? 'unknown'; }
  catch { return 'unknown'; }
}

/**
 * Feed the Market Intelligence tables from a study scrape.
 *
 * Studies persist to study_run_results / study_source_listings, which the
 * Market Intelligence dashboard never reads — so mapped segments showed "0
 * annonces". Each study scrape (target AND source market) now also records a
 * market snapshot + its per-listing observations, so the same segment becomes
 * exploitable in the dashboard. Mirrors
 * src/services/marketData.ts:writeMarketSnapshot but uses the worker's
 * service-role client. Best-effort: a study must never fail because of it.
 */
export async function recordStudyMarketSnapshot(
  supabase: SupabaseClient,
  segment: { site: string; country: string; brand: string; model: string },
  listings: ScrapedListing[],
  sourceUrl: string,
  submittedBy = 'Étude',
): Promise<void> {
  try {
    if (!segment.brand || !segment.model || !segment.country) return;
    // Non-retail guard: "WithoutTax"/engros prices never enter a median.
    const isRetail = (l: ScrapedListing) => !/withouttax|without tax|engros|wholesale|excl/.test(((l as { priceType?: string | null }).priceType ?? '').toLowerCase());
    const priced = listings.filter((l) => typeof l.price === 'number' && l.price > 0 && isRetail(l));
    if (priced.length === 0) return;

    const scrapedAt = new Date().toISOString();
    const pricesEur = priced.map((l) => Math.round(toEur(l.price, l.currency))).sort((a, b) => a - b);
    const avg = Math.round(pricesEur.reduce((s, p) => s + p, 0) / pricesEur.length);

    const { data: snap, error: snapErr } = await supabase
      .from('market_snapshots')
      .insert({
        site: segment.site, country: segment.country,
        brand: segment.brand, model: segment.model, fuel: '', trim: '',
        scraped_at: scrapedAt, listing_count: listings.length, sample_size: priced.length,
        price_min: pricesEur[0],
        price_p25: Math.round(percentileAsc(pricesEur, 0.25)),
        price_median: Math.round(percentileAsc(pricesEur, 0.5)),
        price_p75: Math.round(percentileAsc(pricesEur, 0.75)),
        price_max: pricesEur[pricesEur.length - 1],
        price_avg: avg, currency: 'EUR', source_url: sourceUrl, submitted_by: submittedBy,
      })
      .select('id').single();
    if (snapErr || !snap) {
      console.warn('[WORKER] market snapshot insert failed (non-blocking):', snapErr?.message);
      return;
    }

    const observations = priced.map((l) => ({
      snapshot_id: snap.id, site: segment.site, country: segment.country,
      brand: segment.brand, model: segment.model,
      fuel: refineFuelToken(canonicalizeFuel((l as any).fuel ?? ''), `${l.title ?? ''} ${(l as any).description ?? ''} ${l.trim ?? ''}`) || '',
      trim: (l.trim ?? '').trim(),
      internal_ref: generateInternalRef({ listing_url: l.listing_url }),
      price: Math.round(toEur(l.price, l.currency)),
      year: l.year, mileage: l.mileage, power_din: (l as any).powerDin ?? null,
      gearbox: ((l as any).gearbox ?? '').trim() || null,
      doors: (l as any).doors ?? null,
      seats: (l as any).seats ?? null,
      color: ((l as any).color ?? '').trim() || null,
      seller_type: ((l as any).sellerType ?? '').trim() || null,
      price_type: ((l as any).priceType ?? '').trim() || null,
      listing_url: l.listing_url, title: (l.title ?? '').slice(0, 200),
      currency: 'EUR', scraped_at: scrapedAt,
    }));
    const { error: obsErr } = await supabase.from('market_listing_observations').insert(observations);
    if (obsErr) console.warn('[WORKER] market observations insert failed (non-blocking):', obsErr.message);
    else console.log(`[WORKER] 📈 Market snapshot recorded: ${segment.country} ${segment.brand} ${segment.model} · ${priced.length} annonces`);
  } catch (e: any) {
    console.warn('[WORKER] recordStudyMarketSnapshot failed (non-blocking):', e?.message ?? e);
  }
}

/**
 * Fetch HTML from Zyte API with retries
 */
interface FetchResult { html: string | null; mode: 'raw' | 'browser'; status: number | null; }

async function fetchHtmlWithZyte(url: string, profileLevel: number): Promise<FetchResult> {
  if (!ZYTE_API_KEY) {
    console.error('[WORKER_SCRAPER] ZYTE_API_KEY not configured');
    return { html: null, mode: 'browser', status: null };
  }

  // Per-site anti-bot profile, declared by the site adapter (geolocation, JS
  // rendering, settle waits, and browser-vs-raw mode). Replaces the old
  // hardcoded Marktplaats-only escalation so every site — incl. Cloudflare-
  // protected AutoScout — gets its own profile without touching this function.
  // `profileLevel` maps 1:1 to the adapter's `attempt`.
  const adapter = findSiteAdapterByDomain(url);
  const profile = adapter?.getFetchProfile ? adapter.getFetchProfile(profileLevel) : {};
  // JSON API endpoints (Marktplaats lrp/api) must be fetched raw: a browser
  // render would wrap the JSON body in an HTML shell.
  const useRawHtml = profile.httpResponseBody === true || url.includes('/lrp/api/');
  const mode: 'raw' | 'browser' = useRawHtml ? 'raw' : 'browser';

  const requestBody: any = { url };
  if (useRawHtml) {
    // Zyte's raw-HTML unblocker (no browser). Best against Cloudflare on SSR
    // sites. Browser actions are not applicable here.
    requestBody.httpResponseBody = true;
  } else {
    requestBody.browserHtml = true;
    if (profile.javascript) requestBody.javascript = profile.javascript;
    if (profile.actions && profile.actions.length > 0) requestBody.actions = profile.actions;
  }
  if (profile.geolocation) requestBody.geolocation = profile.geolocation;

  // STEP 1 DIAGNOSTIC: Log fetch target for Marktplaats (search URLs only)
  if (url.includes('marktplaats.nl') && (url.includes('/l/auto-s') || url.includes('/lrp/api/'))) {
    const mode = url.includes('/lrp/api/search') ? 'DIRECT_API' : 'ZYTE_HTML';
    console.log(
      `[MARKTPLAATS_RUNTIME] mode=${mode} url=${url.substring(0, 200)}`
    );
  }

  try {
    const response = await fetch(ZYTE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error(`[WORKER_SCRAPER] Zyte API error: ${response.status}`);
      return { html: null, mode, status: response.status };
    }

    const data = await response.json() as { browserHtml?: string; httpResponseBody?: string };

    // httpResponseBody is base64-encoded bytes; browserHtml is a plain string.
    const html = useRawHtml
      ? (data.httpResponseBody ? Buffer.from(data.httpResponseBody, 'base64').toString('utf-8') : null)
      : (data.browserHtml || null);

    // STRUCTURE DIAGNOSTIC: for any known marketplace, reveal what Zyte returned
    // and WHERE the data lives (which JSON blob / card markup). This is what let
    // us calibrate AutoScout without guessing — now generalised so Marktplaats /
    // Bilbasen (and future sites) self-report their structure on the next scrape.
    const diagSite = marketplaceOf(url);
    if (diagSite !== 'UNKNOWN') {
      const raw = html ?? '';
      const title = (raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').slice(0, 90).replace(/\s+/g, ' ');
      const preview = raw.slice(0, 300).replace(/\s+/g, ' ');
      console.log(
        `[SCRAPE_RUNTIME] site=${diagSite} status=${response.status} mode=${useRawHtml ? 'raw' : 'browser'} len=${raw.length} ` +
        `next_data=${raw.includes('__NEXT_DATA__')} next_f=${raw.includes('__next_f')} ` +
        `ld_json=${raw.includes('application/ld+json')} ` +
        `initial_state=${/window\.__INITIAL|__NUXT__|__APOLLO_STATE__|__PRELOADED_STATE__/.test(raw)} ` +
        `hz_cards=${raw.includes('hz-Listing')} brugt_bil=${raw.includes('/brugt/bil')} ` +
        `cf_challenge=${/just a moment|cf-browser-verification|challenge-platform|cf_chl/i.test(raw)} ` +
        `euro=${(raw.match(/€/g) ?? []).length} kr=${(raw.match(/\bkr\b/gi) ?? []).length} ` +
        `title="${title}" preview="${preview}"`
      );
    }

    // STEP 1 DIAGNOSTIC: Log response for Marktplaats (search URLs only)
    if (url.includes('marktplaats.nl') && (url.includes('/l/auto-s') || url.includes('/lrp/api/'))) {
      const contentType = response.headers.get('content-type') || 'unknown';
      const raw = (html ?? '').trim();
      const preview = raw.substring(0, 80).replace(/\s+/g, ' ');

      const bodyKind =
        raw.startsWith('<') ? 'HTML' :
        raw.startsWith('{') || raw.startsWith('[') ? 'JSON' :
        raw ? 'UNKNOWN' : 'EMPTY';

      console.log(
        `[MARKTPLAATS_RUNTIME] status=${response.status} content_type=${contentType} body_kind=${bodyKind} preview="${preview}"`
      );
    }

    return { html, mode, status: response.status };
  } catch (error) {
    console.error('[WORKER_SCRAPER] Fetch error:', error);
    return { html: null, mode, status: null };
  }
}

/**
 * Scrape detail page for enriched listing data
 */
async function scrapeDetailPage(listingUrl: string): Promise<DetailPageData | null> {
  console.log(`[DETAIL_SCRAPE] Fetching listing detail ${listingUrl}`);

  const { html } = await fetchHtmlWithZyte(listingUrl, 1);

  if (!html) {
    console.warn(`[DETAIL_SCRAPE] Failed to fetch ${listingUrl}`);
    return null;
  }

  const detailData = parseDetailPage(html, listingUrl);

  console.log(
    `[DETAIL_SCRAPE] Extracted options=[${detailData.options.join(', ')}], ` +
    `maintenance=${detailData.maintenance_summary ? 'yes' : 'no'}, defects=${detailData.defects_summary ? 'yes' : 'no'}, ` +
    `images=${detailData.car_image_urls.length}`
  );

  return detailData;
}

/**
 * Extract the total result count the marketplace advertises on the page
 * ("X annonces" / "X advertenties" / "X resultater"). Best-effort — returns
 * null when not found. Powers the market-depth metric (the parsed sample is
 * only page 1, so it undercounts the real depth).
 */
function extractTotalCount(html: string): number | null {
  const text = html.replace(/<[^>]+>/g, ' ');
  const patterns = [
    /([\d][\d\s. ]*)\s*(?:annonces?|résultats?|resultats?)/i,   // FR
    /([\d][\d\s. ]*)\s*(?:advertenties?|resultaten|zoekresultaten)/i, // NL
    /([\d][\d\s. ]*)\s*(?:resultater|biler|annoncer)/i,          // DA
    /([\d][\d\s. ]*)\s*(?:angebote?|ergebnisse?|treffer)/i,
    /([\d][\d\s. ]*)\s*(?:risultati|annunci|offerte?)/i,
    /([\d][\d\s. ]*)\s*(?:resultados?|anuncios?|ofertas?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = parseInt(m[1].replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(n) && n > 0 && n < 5_000_000) return n;
    }
  }
  return null;
}

/** Per-run scrape health report — surfaced in /ingest-url and persisted so we
 *  can see harvest health (mode used, retries, extraction coverage) without
 *  digging through Railway logs. */
export interface ScrapeDiagnostics {
  site: string;
  mode: 'raw' | 'browser' | null;
  attempts: number;
  htmlLength: number;
  listingCount: number;
  totalCount: number | null;
  blocked: boolean;
  blockReason: string | null;
  emptyResults: boolean;     // full page, 0 results (genuine, not an error)
  /** Lecture du marqueur vide EXPLICITE du site (adaptateur) : true = le site
   *  dit lui-même « aucun résultat » (vide prouvé) ; false = marqueur absent
   *  sur une page pleine à 0 annonce (parseur suspect) ; null = site sans
   *  marqueur connu. */
  emptyConfirmed?: boolean | null;
  fromCache: boolean;
  fieldsPresent: Record<string, number>; // 0..1 fraction of listings carrying each field
  /** Verdict déterministe de l'adaptateur : le site a-t-il appliqué le filtre
   *  modèle, ou servi une page plus large en silence ? null = illisible. */
  silentFallback?: { modelApplied: boolean; evidence: string } | null;
  /** Référentiel embarqué moissonné par l'adaptateur (mobile.de : marques
   *  {label,id}) — persisté puis RETIRÉ des diagnostics par l'appelant
   *  (dossiers légers). */
  taxonomyHarvest?: Array<{ field: string; code: string; label: string }> | null;
}

export interface ScrapeSearchResult {
  listings: ScrapedListing[];
  totalCount?: number | null;
  error?: string;
  errorReason?: string;
  diagnostics: ScrapeDiagnostics;
}

// Short-TTL in-memory dedup cache: two contributors ingesting the same URL
// within minutes (or repeated study scans) hit the cache instead of paying
// Zyte again. Lost on restart — fine.
// Sonde taxonomie Bilbasen : un seul dump par boot (voir [BILBASEN_TAXO]).
let bilbasenTaxoProbed = false;
let bilbasenYearProbed = false;
// Sonde taxonomie Marktplaats LRP : un seul dump par boot (voir [MP_LRP_TAXO]).
let mpLrpTaxoProbed = false;

const SCRAPE_CACHE = new Map<string, { at: number; result: ScrapeSearchResult }>();
const SCRAPE_CACHE_TTL_MS = 5 * 60 * 1000;
// A full results page that yields 0 listings is a genuine empty search, not a
// parse failure — don't waste Zyte retries on it.
const FULL_PAGE_MIN_BYTES = 100_000;
// Depth: in 'full'/'detailed' mode, page beyond page 1 up to this many
// listings (≈ a study's worth), bounded by a page cap. 'fast' stays page 1.
const MAX_LISTINGS = 100;
const MAX_PAGES = 5;
const DEEP_MAX_LISTINGS = 300;
const DEEP_MAX_PAGES = 10;

/** Drop duplicate listings (same URL, or same title+price when URL is absent). */
function dedupeListings(list: ScrapedListing[]): ScrapedListing[] {
  const seen = new Set<string>();
  const out: ScrapedListing[] = [];
  for (const l of list) {
    const key = (l.listing_url || `${l.title}|${l.price}`).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

function fieldCoverage(listings: ScrapedListing[]): Record<string, number> {
  const n = listings.length;
  if (n === 0) return {};
  const f = (pred: (l: ScrapedListing) => boolean) => Math.round((listings.filter(pred).length / n) * 100) / 100;
  return {
    price: f((l) => typeof l.price === 'number' && l.price > 0),
    year: f((l) => l.year != null),
    mileage: f((l) => l.mileage != null),
    fuel: f((l) => !!l.fuel),
    brand: f((l) => !!l.brand),
    trim: f((l) => !!l.trim),
    powerDin: f((l) => l.powerDin != null),
    gearbox: f((l) => !!l.gearbox),
  };
}

function marketplaceOf(url: string): string {
  return url.includes('marktplaats.nl') ? 'MARKTPLAATS'
    : url.includes('leboncoin.fr') ? 'LEBONCOIN'
    : url.includes('bilbasen.dk') ? 'BILBASEN'
    : url.includes('gaspedaal.nl') ? 'GASPEDAAL'
    : url.includes('autoscout24.') ? 'AUTOSCOUT'
    : url.includes('mobile.de') ? 'MOBILE_DE'
    : 'UNKNOWN';
}

// ─── Marktplaats server-side search (lrp/api) ────────────────────────────────
// The #hash fragment (q, constructionYear…) NEVER reaches the server: the SSR
// page and its __NEXT_DATA__ (even browser-rendered — hydration doesn't
// rewrite the script tag) is the UNFILTERED brand page. Campaign logs proved
// it: a RAV4-2024 search returned 2017 Aygos. Real filtering lives in the
// internal JSON API the SPA itself calls. We learn the brand's l2CategoryId
// once from its page (cached per process), then page through the API with
// TRUE server params (query = the Variant box, constructionYear, mileage).
// Any doubt (unreadable body, missing category) falls back to the legacy
// HTML path — where the confirmation layer keeps guarding against
// unfiltered samples, exactly as before.

const MARKTPLAATS_L1_CARS = '91'; // "Auto's"
const MP_L2_CACHE = new Map<string, string>();

function parseMarktplaatsHash(url: string): Record<string, string> {
  const h = url.split('#')[1] ?? '';
  const out: Record<string, string> = {};
  for (const seg of h.split('|')) {
    const i = seg.indexOf(':');
    if (i > 0) out[seg.slice(0, i)] = decodeURIComponent(seg.slice(i + 1));
  }
  // Texte libre en CHEMIN /q/…/ (forme native du site, prouvée 27/07) —
  // prioritaire sur un éventuel #q: historique.
  const qm = url.match(/\/q\/([^/#?]+)/);
  if (qm) out['q'] = decodeURIComponent(qm[1]).replace(/\+/g, ' ').trim();
  return out;
}

function marktplaatsBrandSlug(url: string): string | null {
  const m = url.match(/marktplaats\.nl\/l\/auto-s\/([^/#?]+)/);
  return m ? m[1] : null;
}

/** IDs de facette du path `/f/{slug}/{id[+id…]}/` — le vrai filtre modèle du site. */
function marktplaatsFacetIds(url: string): string[] {
  const m = url.match(/\/f\/[^/#?]+\/([0-9+]+)/);
  const ids = m ? m[1].split('+').filter((t) => /^\d+$/.test(t)) : [];
  // Facettes du HASH aussi (#f:13956 ou …|f:13956) : l'interface du site y
  // range les sous-filtres (type d'hybride…). Les ignorer, c'était scraper la
  // FAMILLE au lieu du sous-type — URL humaine Sportage GT Line rechargeable :
  // le site affichait 7 annonces, ADA en remontait 19 (backlog 0ter, 30/07).
  const hashIdx = url.indexOf('#');
  if (hashIdx >= 0) {
    for (const seg of url.slice(hashIdx + 1).split('|')) {
      const f = seg.match(/^f:(\d+(?:\+\d+)*)$/);
      if (f) for (const id of f[1].split('+')) if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** l2CategoryId of the brand page: explicit l2Category, else the dominant listing categoryId. */
function extractMarktplaatsL2(html: string): string | null {
  const m = html.match(/"l2Category"\s*:\s*\{[^{}]*?"id"\s*:\s*(\d+)/);
  if (m) return m[1];
  const counts = new Map<string, number>();
  for (const c of html.matchAll(/"categoryId"\s*:\s*(\d+)/g)) {
    counts.set(c[1], (counts.get(c[1]) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [id, n] of counts) if (n > bestN) { best = id; bestN = n; }
  return bestN >= 3 ? best : null;
}

function buildLrpUrl(l2: string | null, h: Record<string, string>, offset: number, facetIds: string[] = []): string {
  const api = new URL('https://www.marktplaats.nl/lrp/api/search');
  api.searchParams.set('l1CategoryId', MARKTPLAATS_L1_CARS);
  if (l2) api.searchParams.set('l2CategoryId', l2);
  // Facette modèle du path (/f/{slug}/{id}/) — le filtre modèle exact du
  // site ; le q du hash reste alors la FINITION.
  for (const id of facetIds) api.searchParams.append('attributesById[]', id);
  if (h['q']) api.searchParams.set('query', h['q'].replace(/\+/g, ' '));
  const yf = h['constructionYearFrom'];
  const yt = h['constructionYearTo'];
  if (yf || yt) api.searchParams.append('attributeRanges[]', `constructionYear:${yf || '1900'}:${yt || '2100'}`);
  if (h['mileageTo']) api.searchParams.append('attributeRanges[]', `mileage:0:${h['mileageTo']}`);
  api.searchParams.set('sortBy', h['sortBy'] || 'PRICE');
  api.searchParams.set('sortOrder', h['sortOrder'] || 'INCREASING');
  api.searchParams.set('limit', '30');
  api.searchParams.set('offset', String(offset));
  return api.toString();
}

async function scrapeMarktplaatsViaApi(
  url: string,
  maxPages: number,
  maxListings: number
): Promise<ScrapeSearchResult | null> {
  const h = parseMarktplaatsHash(url);
  const facetIds = marktplaatsFacetIds(url);
  const hasFilters = !!(h['q'] || h['constructionYearFrom'] || h['constructionYearTo'] || h['mileageTo'] || facetIds.length > 0);
  if (!hasFilters) return null; // plain brand page — the HTML path serves it fine

  const brandSlug = marktplaatsBrandSlug(url);
  let l2: string | null = brandSlug ? MP_L2_CACHE.get(brandSlug) ?? null : null;
  let attempts = 0;

  if (brandSlug && !l2) {
    // One HTML fetch of the brand page to learn its l2CategoryId.
    const { html } = await fetchHtmlWithZyte(url, 1);
    attempts++;
    l2 = html ? extractMarktplaatsL2(html) : null;
    if (!l2) {
      console.warn('[MARKTPLAATS_LRP] l2CategoryId introuvable sur la page marque — repli HTML');
      return null;
    }
    MP_L2_CACHE.set(brandSlug, l2);
    console.log(`[MARKTPLAATS_LRP] l2CategoryId appris: ${brandSlug} → ${l2}`);
  }

  let all: ScrapedListing[] = [];
  let totalCount: number | null = null;
  let pages = 0;
  let lrpHarvest: Array<{ field: string; code: string; label: string }> | null = null;
  for (let page = 0; page < maxPages && all.length < maxListings; page++) {
    const apiUrl = buildLrpUrl(l2, h, page * 30, facetIds);
    const { html: body } = await fetchHtmlWithZyte(apiUrl, 1);
    attempts++;
    if (!body || !body.trim().startsWith('{')) {
      if (page === 0) {
        console.warn('[MARKTPLAATS_LRP] réponse API illisible — repli HTML');
        return null;
      }
      break;
    }
    if (totalCount == null) {
      const t = body.match(/"totalResultCount"\s*:\s*(\d+)/);
      if (t) totalCount = parseInt(t[1], 10);
    }
    // MOISSON TAXONOMIE LRP (29/07) : les recherches MP passent par cette
    // API JSON, jamais par la page HTML — sonde du 29/07 05:32 : `facets` à
    // la racine, groupes {key, attributeGroup:[{attributeValueKey/Id/Label}]}
    // (même grammaire que le JSON de la page HTML, prouvée sur Toyota). Le
    // groupe key='model' porte la gamme de la marque : moissonnée ici, elle
    // rejoint le dictionnaire via diagnostics.taxonomyHarvest.
    if (page === 0) {
      try {
        const brandSlug = url.match(/\/l\/auto-s\/([a-z0-9-]+)(?:\/|$)/)?.[1] ?? null;
        const facets = (JSON.parse(body) as {
          facets?: Array<{ key?: unknown; attributeGroup?: Array<{ attributeValueKey?: unknown; attributeValueId?: unknown; attributeValueLabel?: unknown }> }>;
        }).facets;
        const grp = facets?.find((f) => f?.key === 'model');
        if (!mpLrpTaxoProbed) {
          mpLrpTaxoProbed = true;
          console.warn(`[MP_LRP_TAXO] facettes: ${(facets ?? []).map((f) => String(f?.key ?? '?')).join(',').slice(0, 180)}`);
          if (grp) console.warn(`[MP_LRP_TAXO] groupe model: ${JSON.stringify(grp.attributeGroup?.slice(0, 3)).slice(0, 300)}`);
        }
        const entries: Array<{ field: string; code: string; label: string }> = [];
        for (const f of facets ?? []) {
          const key = typeof f?.key === 'string' ? f.key.trim() : '';
          if (!key || !Array.isArray(f?.attributeGroup)) continue; // range facets (prix, km…) n'ont pas de groupe
          for (const v of f.attributeGroup) {
            const label = typeof v.attributeValueLabel === 'string' && v.attributeValueLabel.trim()
              ? v.attributeValueLabel.trim()
              : typeof v.attributeValueKey === 'string' ? v.attributeValueKey.trim() : '';
            const id = typeof v.attributeValueId === 'number' ? v.attributeValueId : null;
            if (!label || id == null) continue;
            if (key === 'model') {
              // Gamme de la marque — code scopé marque, consommé par la génération d'URL.
              if (brandSlug) entries.push({ field: 'model_facet', code: `${brandSlug};${mpSlugOfLabel(label)};${id}`, label });
            } else {
              // Toute autre facette énumérée (fuel, hybridType, advertiser, warranty…) :
              // codes globaux du site, même grammaire attributeValueKey/Id/Label.
              const code = typeof v.attributeValueKey === 'string' && v.attributeValueKey.trim()
                ? `${v.attributeValueKey.trim()};${id}` : String(id);
              entries.push({ field: `mp:facet:${key}`, code, label });
            }
          }
        }
        if (entries.length) lrpHarvest = entries;
      } catch { /* moisson silencieuse — jamais bloquante */ }
    }
    const pageListings = coreParseSearchPage(body, url);
    pages++;
    if (pageListings.length === 0) break;
    const before = all.length;
    all = dedupeListings([...all, ...pageListings]);
    if (all.length === before) break;
    if (totalCount != null && all.length >= totalCount) break;
  }

  all = all.slice(0, maxListings);
  if (all.length === 0) {
    if (totalCount === 0) {
      // Genuine empty market — the SERVER applied the filters and says zero.
      console.log('[MARKTPLAATS_LRP] 0 résultat serveur — marché réellement vide');
      const result: ScrapeSearchResult = {
        listings: [], totalCount: 0,
        diagnostics: {
          site: 'MARKTPLAATS', mode: 'raw', attempts, htmlLength: 0, listingCount: 0,
          totalCount: 0, blocked: false, blockReason: null, emptyResults: true,
          fromCache: false, fieldsPresent: {}, taxonomyHarvest: lrpHarvest,
        },
      };
      SCRAPE_CACHE.set(url, { at: Date.now(), result });
      return result;
    }
    console.warn(`[MARKTPLAATS_LRP] 0 annonce parsée (total=${totalCount ?? '?'}) — repli HTML`);
    return null;
  }

  console.log(`[MARKTPLAATS_LRP] ✅ ${all.length} annonces FILTRÉES SERVEUR (total=${totalCount ?? '?'}, pages=${pages}, l2=${l2 ?? '—'})`);
  const result: ScrapeSearchResult = {
    listings: all, totalCount,
    diagnostics: {
      site: 'MARKTPLAATS', mode: 'raw', attempts, htmlLength: 0, listingCount: all.length,
      totalCount, blocked: false, blockReason: null, emptyResults: false,
      fromCache: false, fieldsPresent: fieldCoverage(all), taxonomyHarvest: lrpHarvest,
    },
  };
  SCRAPE_CACHE.set(url, { at: Date.now(), result });
  return result;
}

/**
 * Scrape a marketplace URL and parse listings.
 * Exported for the /ingest-url endpoint (discovery scrape) — same fetch,
 * retries, profile escalation and parsing as study execution.
 */
export async function scrapeSearch(
  url: string,
  scrapeMode: 'fast' | 'full' | 'detailed' | 'deep',
  /** Plafond de pages imposé par l'appelant (études quotidiennes : 3 pages,
   *  tri prix croissant — le bas du marché suffit). */
  opts?: { maxPagesCap?: number },
): Promise<ScrapeSearchResult> {
  const marketplace = marketplaceOf(url);
  console.log(`[SCRAPE_ROUTE] marketplace=${marketplace} scrapeMode=${scrapeMode} url=${url.substring(0, 150)}`);

  // Dedup cache — serve a recent identical scrape instead of re-paying Zyte.
  const cached = SCRAPE_CACHE.get(url);
  if (cached && Date.now() - cached.at < SCRAPE_CACHE_TTL_MS) {
    console.log(`[SCRAPE_CACHE] hit (age=${Math.round((Date.now() - cached.at) / 1000)}s) url=${url.slice(0, 120)}`);
    return { ...cached.result, diagnostics: { ...cached.result.diagnostics, fromCache: true } };
  }

  const MAX_RETRIES = scrapeMode === 'fast' ? 1 : 3;
  // 'deep' pushes pagination further (finition-level data lives beyond the
  // cheapest 100): 10 pages / ~300 listings instead of 5 / 100. Opt-in — it
  // costs up to 2x the Zyte calls of a 'full' scrape.
  const maxPages = Math.min(
    scrapeMode === 'deep' ? DEEP_MAX_PAGES : MAX_PAGES,
    opts?.maxPagesCap ?? Number.POSITIVE_INFINITY,
  );
  const maxListings = scrapeMode === 'deep' ? DEEP_MAX_LISTINGS : MAX_LISTINGS;

  // Filtered Marktplaats searches go through the server-side JSON API (the
  // hash never reaches the server) — falls back to the HTML path on any doubt.
  if (marketplace === 'MARKTPLAATS' && url.includes('#')) {
    try {
      const viaApi = await scrapeMarktplaatsViaApi(url, scrapeMode === 'fast' ? 1 : maxPages, maxListings);
      if (viaApi) return viaApi;
    } catch (e) {
      console.warn('[MARKTPLAATS_LRP] erreur — repli HTML:', e);
    }
  }

  let lastMode: 'raw' | 'browser' | null = null;
  let lastLen = 0;

  const finalize = (r: Omit<ScrapeSearchResult, 'diagnostics'>, d: Partial<ScrapeDiagnostics>, cache: boolean): ScrapeSearchResult => {
    const result: ScrapeSearchResult = {
      ...r,
      diagnostics: {
        site: marketplace, mode: lastMode, attempts: d.attempts ?? 0, htmlLength: d.htmlLength ?? lastLen,
        listingCount: r.listings.length, totalCount: r.totalCount ?? null,
        blocked: d.blocked ?? false, blockReason: d.blockReason ?? null,
        emptyResults: d.emptyResults ?? false, emptyConfirmed: d.emptyConfirmed ?? null, fromCache: false,
        fieldsPresent: fieldCoverage(r.listings),
        silentFallback: d.silentFallback ?? null,
        taxonomyHarvest: d.taxonomyHarvest ?? null,
      },
    };
    if (cache) SCRAPE_CACHE.set(url, { at: Date.now(), result });
    return result;
  };

  // AS24 BE serves the same search under two locale paths (/fr/, /nl/). A
  // Cloudflare error page is cached per-URL, so when one locale is poisoned,
  // flipping to the other on retry dodges the cached block entirely.
  let activeUrl = url;
  let hostSwapped = false;
  // AS24 shares one search engine across its TLDs and the cy= param pins the
  // listing country — autoscout24.fr serves the SAME Dutch search that
  // Cloudflare refuses on .nl. When same-host retries keep hitting the block,
  // jump to a sibling domain (logs: .fr/.de fine while .nl/.it blocked).
  const AS24_SIBLING: Record<string, string> = { nl: 'fr', it: 'fr', es: 'fr', be: 'fr', de: 'fr', fr: 'de' };
  const swapAs24Host = (u: string): string | null => {
    const m = u.match(/https:\/\/www\.autoscout24\.([a-z]{2})\//);
    if (!m) return null;
    const alt = AS24_SIBLING[m[1]];
    if (!alt) return null;
    let out = u.replace(`www.autoscout24.${m[1]}`, `www.autoscout24.${alt}`);
    // .be carries a /fr/ or /nl/ locale prefix the other TLDs reject.
    if (m[1] === 'be') out = out.replace(/(autoscout24\.[a-z]{2})\/(?:fr|nl)\/lst\//, '$1/lst/');
    return out;
  };
  const flipBeLocale = (u: string): string | null => {
    if (u.includes('autoscout24.be/fr/')) return u.replace('autoscout24.be/fr/', 'autoscout24.be/nl/');
    if (u.includes('autoscout24.be/nl/')) return u.replace('autoscout24.be/nl/', 'autoscout24.be/fr/');
    return null;
  };
  // Cloudflare caches its error page per exact URL: retries on the SAME URL
  // returned byte-identical blocks (21670b raw ×2, 29390b browser ×2 on AS24
  // IT). A throwaway query param changes the cache key so each retry gets a
  // fresh edge decision. AS24 ignores unknown params; never persisted — the
  // caller's original `url` is what memory/ingestion record.
  const withNocache = (u: string): string => {
    const nonce = `adanc=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    if (/[?&]adanc=/.test(u)) return u.replace(/([?&])adanc=[^&]*/, `$1${nonce}`);
    return u + (u.includes('?') ? '&' : '?') + nonce;
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const profileLevel = attempt + 1;
    console.log(`[WORKER_SCRAPER] Fetching ${activeUrl} (attempt ${attempt + 1}/${MAX_RETRIES + 1}, profile ${profileLevel})`);

    const { html, mode } = await fetchHtmlWithZyte(activeUrl, profileLevel);
    lastMode = mode;

    if (!html) {
      if (attempt === MAX_RETRIES) {
        return finalize({ listings: [], error: 'SCRAPER_FAILED', errorReason: 'Failed to fetch HTML after retries' }, { attempts: attempt + 1, htmlLength: 0 }, false);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    lastLen = html.length;

    const listings = coreParseSearchPage(html, activeUrl);
    if (url.includes('marktplaats.nl') && (url.includes('/l/auto-s') || url.includes('/lrp/api/'))) {
      console.log(`[MARKTPLAATS_PARSED] count=${listings.length} attempt=${attempt + 1}`);
    }

    if (listings.length > 0) {
      const totalCount = extractTotalCount(html);
      // Le site annonce « 0 offres » mais le parseur a trouvé des cartes :
      // ce sont des RECOMMANDATIONS (« annonces similaires »), pas des
      // résultats — prouvé AS24 27/07 (kwd=GR+SPORT → 0 offres, page pleine
      // de Yaris Cross d'autres finitions). On rend un vide CONFIRMÉ.
      if (totalCount === 0) {
        console.warn(`[WORKER_SCRAPER] ⚠️ total annoncé = 0 mais ${listings.length} carte(s) parsée(s) — recommandations écartées (${url.slice(0, 110)})`);
        return finalize(
          { listings: [], totalCount: 0 },
          { attempts: attempt + 1, htmlLength: html.length, emptyResults: true, emptyConfirmed: true },
          true,
        );
      }
      let all = dedupeListings(listings);

      // Depth: fetch further pages (cheap mode, bounded) when more results
      // exist and we're not in 'fast' mode. Small searches (all results on
      // page 1) never paginate — no wasted requests.
      const moreAvailable = totalCount == null ? all.length >= 15 : totalCount > all.length;
      let pages = 1;
      if (scrapeMode !== 'fast' && moreAvailable && all.length < maxListings) {
        const adapter = findSiteAdapterByDomain(activeUrl);
        for (let page = 2; page <= maxPages && all.length < maxListings; page++) {
          const pageUrl = adapter ? adapter.buildPaginatedUrl(activeUrl, page) : activeUrl;
          if (pageUrl === activeUrl) break; // no pagination scheme for this site
          const { html: pageHtml } = await fetchHtmlWithZyte(pageUrl, 1);
          if (!pageHtml) break;
          const pageListings = coreParseSearchPage(pageHtml, pageUrl);
          if (pageListings.length === 0) break;
          const before = all.length;
          all = dedupeListings([...all, ...pageListings]);
          pages++;
          if (all.length === before) break; // page brought no new unique listings
        }
      }
      all = all.slice(0, maxListings);
      console.log(`[WORKER_SCRAPER] ✅ Parsed ${all.length} listings (mode=${mode}, pages=${pages})`);
      // Verdict déterministe « filtre modèle appliqué ? » depuis la page
      // elle-même — le moteur de campagne s'en sert pour distinguer un vrai
      // échantillon d'une page marque servie en silence (slug inconnu).
      const sfAdapter = findSiteAdapterByDomain(activeUrl);
      const silentFallback = sfAdapter?.detectSilentFallback?.(html) ?? null;
      // SONDE D'OBSERVATION Bilbasen (temporaire, boîte noire 26/07) : le site
      // sert la page MARQUE entière sur slug modèle inconnu, sans aveu connu.
      // Son NEXT_DATA porte un `initialSearchRequest` — on en logge la vraie
      // structure (warn → worker_logs) pour bâtir le détecteur sur preuve.
      if (activeUrl.includes('bilbasen.dk')) {
        try {
          const nd = html.match(/__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/);
          const isr = nd ? JSON.parse(nd[1])?.props?.pageProps?.initialSearchRequest : null;
          if (isr) console.warn(`[BILBASEN_ISR] ${activeUrl.slice(0, 90)} → ${JSON.stringify(isr).slice(0, 350)}`);
          // SONDE ANNÉE (01/08, une fois par boot) : le filtre « 2023 » du site
          // porte l'année-MODÈLE (årgang) mais nos observations sortent 2022
          // (immatriculation) — 36/64 e-tron DK écartées à tort par le filtre
          // année du MI. On photographie les champs année du 1er listing brut
          // pour choisir LE champ qui épouse la sémantique du filtre du site.
          if (nd && !bilbasenYearProbed) {
            const qs2 = JSON.parse(nd[1])?.props?.pageProps?.dehydratedState?.queries as Array<{ state?: { data?: { listings?: unknown[] } } }> | undefined;
            const first = qs2?.map((q) => q?.state?.data?.listings?.[0]).find(Boolean) as Record<string, unknown> | undefined;
            if (first) {
              bilbasenYearProbed = true;
              console.warn(`[BILBASEN_YEAR] keys=${Object.keys(first).join(',').slice(0, 160)}`);
              const yearish = Object.fromEntries(Object.entries(first)
                .filter(([k]) => /year|date|reg|årgang|aargang|properties|details/i.test(k)));
              console.warn(`[BILBASEN_YEAR] champs année: ${JSON.stringify(yearish).slice(0, 170)}`);
              console.warn(`[BILBASEN_YEAR] brut[0..160]: ${JSON.stringify(first).slice(0, 165)}`);
              console.warn(`[BILBASEN_YEAR] brut[160..330]: ${JSON.stringify(first).slice(165, 330)}`);
              console.warn(`[BILBASEN_YEAR] brut[330..500]: ${JSON.stringify(first).slice(330, 500)}`);
            }
          }
          // SONDE TAXONOMIE (28/07, une fois par boot) : où la page embarque-
          // t-elle sa liste de modèles ? On logge les tableaux candidats du
          // NEXT_DATA (chemin, taille, clés, 1er élément) pour bâtir la
          // moisson Bilbasen sur PREUVE — comme MP/AS24, jamais de devinette.
          if (nd && !bilbasenTaxoProbed) {
            bilbasenTaxoProbed = true;
            const found: string[] = [];
            const walk = (o: unknown, path: string, depth: number): void => {
              if (depth > 9 || found.length >= 8) return;
              if (Array.isArray(o)) {
                if (o.length >= 8 && o.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
                  const keys = Object.keys(o[0] as object).slice(0, 6).join(',');
                  if (/name|label|value|slug|id|model/i.test(keys)) {
                    found.push(`${path} len=${o.length} keys={${keys}} ex=${JSON.stringify(o[0]).slice(0, 110)}`);
                  }
                }
                for (const el of o.slice(0, 4)) walk(el, `${path}[]`, depth + 1);
                return;
              }
              if (o && typeof o === 'object') {
                for (const [kk, vv] of Object.entries(o)) walk(vv, `${path}.${kk}`, depth + 1);
              }
            };
            const pp = JSON.parse(nd[1])?.props?.pageProps;
            walk(pp, 'pageProps', 0);
            for (const f of found) console.warn(`[BILBASEN_TAXO] ${f}`);
            if (!found.length) console.warn('[BILBASEN_TAXO] aucun tableau candidat dans pageProps — structure à creuser');
            // Ciblage FILTRE MODÈLE (28/07, 2e passe) : le dump générique a
            // montré filterOptions[].filterOptions {key, optionValues} — on
            // photographie les groupes Make/Model pour bâtir la moisson de
            // gamme complète (pas seulement les modèles affichés).
            const dumpFilters = (o: unknown, depth: number): void => {
              if (depth > 8 || !o || typeof o !== 'object') return;
              if (Array.isArray(o)) { for (const el of o.slice(0, 20)) dumpFilters(el, depth + 1); return; }
              const rec = o as { key?: unknown; optionValues?: unknown };
              if (typeof rec.key === 'string' && /model|make/i.test(rec.key) && Array.isArray(rec.optionValues)) {
                console.warn(`[BILBASEN_TAXO_FILTER] key=${rec.key} n=${rec.optionValues.length} ex=${JSON.stringify(rec.optionValues.slice(0, 3)).slice(0, 300)}`);
              }
              for (const v of Object.values(rec)) dumpFilters(v, depth + 1);
            };
            dumpFilters(pp, 0);
          }
        } catch { /* sonde silencieuse */ }
      }
      if (silentFallback && !silentFallback.modelApplied) {
        console.warn(`[WORKER_SCRAPER] ⚠️ filtre modèle NON appliqué par le site — ${silentFallback.evidence}`);
      }
      const taxonomyHarvest = sfAdapter?.harvestTaxonomy?.(html) ?? null;
      return finalize({ listings: all, totalCount }, { attempts: attempt + 1, htmlLength: html.length, silentFallback, taxonomyHarvest }, true);
    }

    // Blocked? Don't give up on the first block — escalate through the profiles
    // and only report TARGET_BLOCKED once exhausted.
    const blockedCheck = detectBlockedContent(html, false);
    if (blockedCheck.isBlocked) {
      console.warn(`[WORKER_SCRAPER] ⚠️  Blocked: ${blockedCheck.matchedKeyword} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      if (attempt < MAX_RETRIES) {
        const flipped = flipBeLocale(activeUrl);
        if (flipped) activeUrl = flipped;
        // Same-host retry already failed once → jump to a sibling AS24 domain
        // (cy= keeps the listing country; parser identical across TLDs).
        if (attempt >= 1 && !hostSwapped) {
          const sibling = swapAs24Host(activeUrl);
          if (sibling) { activeUrl = sibling; hostSwapped = true; }
        }
        // Cache-buster on EVERY blocked AS24/Bilbasen retry (flip included: BE
        // served byte-identical error pages on both locales, so the flip alone
        // doesn't dodge the cached block; Bilbasen a servi 4× la même coquille
        // sur la même URL le 01/08 — param inconnu prouvé ignoré : adanc=test
        // rendait les 64 résultats).
        if (activeUrl.includes('autoscout24.') || activeUrl.includes('bilbasen.dk')) activeUrl = withNocache(activeUrl);
        if (activeUrl !== url) console.log(`[WORKER_SCRAPER] retry variant: ${activeUrl}`);
        // A CF block that just fired rarely clears within seconds from the
        // same exit — logs showed 4/4 blocked with 2.5-10s pauses. 8/16/24s
        // gives the edge decision (and Zyte's session rotation) room to move;
        // campaigns run unattended, patience is free.
        await new Promise((resolve) => setTimeout(resolve, 8000 * (attempt + 1)));
        continue;
      }
      return finalize({ listings: [], error: 'TARGET_BLOCKED', errorReason: `Blocked: ${blockedCheck.matchedKeyword}` },
        { attempts: attempt + 1, htmlLength: html.length, blocked: true, blockReason: blockedCheck.matchedKeyword }, false);
    }

    // AS24 serves its own not-found template for a bad brand/model slug
    // (data-theme="as24" + noindex + /error-pages/ favicons — e.g. "Wir
    // können die gesuchte Seite nicht finden" on /lst/mercedes/glc). The
    // path itself is wrong, so retrying the same URL can never help: fail
    // fast so the campaign records a taxonomy gap instead of burning the
    // remaining Zyte attempts on a "technical" mystery.
    if (
      activeUrl.includes('autoscout24.') &&
      html.includes('data-theme="as24"') &&
      html.includes('/error-pages/') &&
      html.includes('noindex')
    ) {
      console.warn(`[WORKER_SCRAPER] AS24 not-found template (${html.length}b) — bad path slug, no retry`);
      return finalize(
        { listings: [], error: 'PAGE_NOT_FOUND', errorReason: 'AS24: page introuvable (slug marque/modèle invalide)' },
        { attempts: attempt + 1, htmlLength: html.length }, false
      );
    }

    // Full page, 0 listings, not blocked → genuine empty search. Return now
    // (no wasted retries) and cache it. Where the adapter knows the site's
    // explicit empty-state marker, read it: marker present = empty PROVEN by
    // the site itself; marker absent = the page probably holds listings the
    // parser no longer reads (structure change) — tripwire to worker_logs.
    if (html.length >= FULL_PAGE_MIN_BYTES) {
      const esAdapter = findSiteAdapterByDomain(activeUrl);
      const emptyConfirmed = esAdapter?.detectEmptyState ? esAdapter.detectEmptyState(html) : null;
      if (emptyConfirmed === false) {
        // Le site lui-même DÉMENT le vide (ex. LBC : searchData.total > 0 mais
        // tableau d'annonces absent — soft-block prouvé rafale du 28/07, les
        // études matinales rendaient 0 sur des recherches à 340 annonces).
        // C'est un blocage déguisé, pas un résultat : on RÉESSAIE avec la
        // même patience que les blocages francs avant de rendre le vide.
        console.warn(`[WORKER_SCRAPER] ⚠️ page pleine à 0 annonce SANS vide confirmé par le site (${marketplaceOf(activeUrl)}, ${html.length}b, attempt ${attempt + 1}/${MAX_RETRIES + 1}) — soft-block probable: ${activeUrl.slice(0, 120)}`);
        if (attempt < MAX_RETRIES) {
          // La coquille est servie DEPUIS UN CACHE par URL (Bilbasen 01/08 :
          // 4 tentatives, même squelette) — changer la clé de cache à chaque
          // retry, param inconnu prouvé ignoré par le site.
          if (activeUrl.includes('bilbasen.dk')) {
            activeUrl = withNocache(activeUrl);
            console.log(`[WORKER_SCRAPER] retry variant: ${activeUrl.slice(0, 130)}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 8000 * (attempt + 1)));
          continue;
        }
      }
      console.log(`[WORKER_SCRAPER] 0 listings on a full page (${html.length}b, mode=${mode}) — genuine empty result, no retry`);
      // Le référentiel embarqué (dropdown marques) est présent même sur une
      // page à 0 résultat — moisson identique au chemin succès.
      const taxonomyHarvest = esAdapter?.harvestTaxonomy?.(html) ?? null;
      // Un vide DÉMENTI par le site (soft-block épuisé) ne va jamais au cache :
      // le passage suivant retentera à neuf au lieu d'hériter du poison.
      return finalize({ listings: [], totalCount: extractTotalCount(html) }, { attempts: attempt + 1, htmlLength: html.length, emptyResults: true, emptyConfirmed, taxonomyHarvest }, emptyConfirmed !== false);
    }

    // Small page, no listings, not blocked → retry (likely a soft failure).
    if (attempt < MAX_RETRIES) {
      console.log(`[WORKER_SCRAPER] No listings on a small page (${html.length}b), retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  return finalize({ listings: [], error: 'NO_LISTINGS', errorReason: 'No listings found after retries' }, { attempts: MAX_RETRIES + 1 }, false);
}

/**
 * Update heartbeat timestamp
 */
async function updateHeartbeat(
  supabase: SupabaseClient,
  runId: string,
  scheduledJobId?: string
): Promise<void> {
  const now = new Date().toISOString();

  await supabase
    .from('study_runs')
    .update({ heartbeat_at: now })
    .eq('id', runId);

  if (scheduledJobId) {
    await supabase
      .from('scheduled_study_runs')
      .update({ heartbeat_at: now })
      .eq('id', scheduledJobId);
  }
}

/**
 * Apply trim filter to Marktplaats URL
 * Injects q:<trim>| prefix before existing hash filters
 */
function applyTrimMarktplaats(url: string, trim: string): string {
  const [base, hash = ''] = url.split('#');
  if (!hash) return url;

  const trimEncoded = trim.toLowerCase().replace(/\s+/g, '+');
  let newHash: string;

  if (hash.startsWith('q:')) {
    // Extract existing q value (up to | or end of string)
    const qMatch = hash.match(/^q:([^|]*)/);
    const existingQ = qMatch ? qMatch[1] : '';
    // Normalise both sides to spaces for duplicate check
    const existingNorm = existingQ.replace(/\+/g, ' ').replace(/%20/g, ' ').toLowerCase();
    const trimNorm = trim.toLowerCase().trim();
    // Append only if trim is not already present
    const appendedQ = existingNorm.includes(trimNorm)
      ? existingQ
      : `${existingQ}+${trimEncoded}`;
    newHash = hash.replace(/^q:[^|]*/, `q:${appendedQ}`);
  } else {
    newHash = `q:${trimEncoded}|` + hash;
  }

  return `${base}#${newHash}`;
}

/**
 * Apply trim filter to Leboncoin URL
 * Injects &text=<trim> parameter before &kst=k if present, or at the end
 */
function applyTrimLeboncoin(url: string, trim: string): string {
  const encoded = encodeURIComponent(trim);

  if (url.includes('text=')) {
    return url.replace(/text=[^&]*/, `text=${encoded}`);
  }

  const kstIndex = url.indexOf('&kst=');
  if (kstIndex !== -1) {
    return (
      url.slice(0, kstIndex) +
      `&text=${encoded}` +
      url.slice(kstIndex)
    );
  }

  return url + `&text=${encoded}`;
}

/**
 * Apply trim filter to Bilbasen URL
 * Injects free=<trim> query parameter
 */
function applyTrimBilbasen(url: string, trim: string): string {
  const encoded = encodeURIComponent(trim);

  if (url.includes('free=')) {
    return url.replace(/free=[^&]*/, `free=${encoded}`);
  }

  const hasQuery = url.includes('?');
  const sep = hasQuery ? '&' : '?';
  return url + `${sep}free=${encoded}`;
}

// ─── LOG HELPERS (read-only, no business logic) ──────────────────────────────

function detectMarketplace(country: string): string {
  if (country === 'NL') return 'MARKTPLAATS';
  if (country === 'FR') return 'LEBONCOIN';
  if (country === 'DK') return 'BILBASEN';
  return country ?? 'UNKNOWN';
}

function urlHasTrimHint(url: string, trim: string): boolean {
  if (!trim) return false;
  // Normalise URL: decode %20, + → space, lower-case
  const urlNorm = url.toLowerCase().replace(/%20/g, ' ').replace(/\+/g, ' ').replace(/-/g, ' ');
  const trimNorm = trim.toLowerCase().trim().replace(/\s+/g, ' ');
  return urlNorm.includes(trimNorm);
}

function urlHasYearHint(url: string): boolean {
  return /year|jaar|an|bj|aargang|yearFrom|yearTo|\d{4}/.test(url);
}

function urlHasMileageHint(url: string): boolean {
  return /km|mileage|kilom|mileageMax|kmFrom|kmTo|mileageFrom|kilometrage/.test(url);
}

function buildUrlLog(
  label: 'URL_TARGET' | 'URL_SOURCE',
  originalUrl: string,
  finalUrl: string,
  country: string,
  trim: string | undefined
): string {
  const marketplace = detectMarketplace(country);
  const trimInUrl = trim ? urlHasTrimHint(finalUrl, trim) : false;
  const yearInUrl = urlHasYearHint(finalUrl);
  const mileageInUrl = urlHasMileageHint(finalUrl);
  const urlChanged = originalUrl !== finalUrl;

  const parts = [
    `marketplace=${marketplace}`,
    `country=${country}`,
    urlChanged ? `originalUrl=${originalUrl}` : null,
    `finalUrl=${finalUrl}`,
  ];

  if (trim) parts.push(`trim="${trim}" trimInUrl=${trimInUrl}`);
  parts.push(`yearInUrl=${yearInUrl}`, `mileageInUrl=${mileageInUrl}`);

  return parts.filter(Boolean).join(' ');
}

function buildListingSamples(listings: ScrapedListing[], max = 3): string {
  return listings
    .slice(0, max)
    .map(l => `€${l.price}|${l.year ?? '?'}|${l.mileage != null ? l.mileage + 'km' : '?'}|${(l.title ?? '').substring(0, 80)}`)
    .join(', ');
}

interface FilterDiagnostics {
  passed: number;
  rejected: number;
  byYear: number;
  byMileage: number;
  byTrim: number;
  byBrandModel: number;
  byFirstPass: number;
  examples: string[];
}

function diagnoseFilterRejections(
  listings: ScrapedListing[],
  criteria: StudyCriteria
): FilterDiagnostics {
  let byYear = 0, byMileage = 0, byTrim = 0, byBrandModel = 0, byFirstPass = 0, passed = 0;
  const examples: string[] = [];

  for (const l of listings) {
    const title = (l.title ?? '').substring(0, 60);

    // First-pass: price floor, leasing, damage
    const priceEur = l.price * (l.currency === 'DKK' ? 0.134 : 1);
    if (priceEur <= 2000) { byFirstPass++; continue; }
    const text = `${l.title} ${l.description}`.toLowerCase();
    const isMonthly = ['/mois','per month','/maand','lease','loa','lld','leasing'].some(k => text.includes(k));
    if (isMonthly) { byFirstPass++; continue; }
    const isDamaged = ['accidenté','épave','schade','damaged','salvage','skadet'].some(k => text.includes(k));
    if (isDamaged) { byFirstPass++; continue; }

    // Year
    if (l.year && l.year < criteria.year) {
      byYear++;
      if (examples.length < 3) examples.push(`year: ${l.year} < ${criteria.year} title="${title}"`);
      continue;
    }

    // Mileage
    if (criteria.max_mileage > 0 && l.mileage && l.mileage > criteria.max_mileage) {
      byMileage++;
      if (examples.length < 3) examples.push(`mileage: ${l.mileage}km > ${criteria.max_mileage}km title="${title}"`);
      continue;
    }

    // Brand/model
    const titleLower = (l.title ?? '').toLowerCase();
    const brandOk = titleLower.includes(criteria.brand.toLowerCase());
    const modelTokens = criteria.model.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length > 0);
    const modelOk = modelTokens.every(tok => titleLower.includes(tok));
    if (!brandOk || !modelOk) {
      byBrandModel++;
      if (examples.length < 3) examples.push(`brand_model: title="${title}"`);
      continue;
    }

    // Trim
    if (criteria.trim_text) {
      const trimLower = criteria.trim_text.toLowerCase().trim();
      const searchText = `${l.title} ${l.description}`.toLowerCase();
      const trimTokens = trimLower.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length > 0);
      const trimMatches = trimTokens.every(tok => searchText.includes(tok));
      if (!trimMatches) {
        byTrim++;
        if (examples.length < 3) examples.push(`trim: expected="${criteria.trim_text}" title="${title}"`);
        continue;
      }
    }

    passed++;
  }

  return {
    passed,
    rejected: listings.length - passed,
    byYear, byMileage, byTrim, byBrandModel, byFirstPass,
    examples,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a study run
 */
export async function executeStudy({
  study,
  runId,
  threshold,
  scrapeMode,
  supabase,
  scheduledJobId,
}: {
  study: any;
  runId: string;
  threshold: number;
  scrapeMode: 'fast' | 'full' | 'detailed';
  supabase: SupabaseClient;
  scheduledJobId?: string;
}): Promise<{
  status: string;
  nullCount: number;
  opportunitiesCount: number;
}> {
  console.log(`[WORKER] Processing study ${study.id} in ${scrapeMode.toUpperCase()} mode`);
  console.log(`[DETAIL_SCRAPE] mode=${scrapeMode} detail_enabled=${scrapeMode === 'detailed'}`);

  const logger = new StudyLogger(runId, study.id);

  const trimTarget = study.trim_text_target?.trim() || study.trim_text?.trim() || undefined;
  const trimSource = study.trim_text_source?.trim() || study.trim_text?.trim() || undefined;

  const originalTargetUrl = study.market_target_url;
  const originalSourceUrl = study.market_source_url;
  let targetUrl = originalTargetUrl;
  let sourceUrl = originalSourceUrl;

  // Apply trim filters
  if (trimTarget) {
    if (study.country_target === 'NL') {
      targetUrl = applyTrimMarktplaats(targetUrl, trimTarget);
    } else if (study.country_target === 'FR') {
      targetUrl = applyTrimLeboncoin(targetUrl, trimTarget);
    } else if (study.country_target === 'DK') {
      targetUrl = applyTrimBilbasen(targetUrl, trimTarget);
    }
  }

  if (trimSource) {
    if (study.country_source === 'NL') {
      sourceUrl = applyTrimMarktplaats(sourceUrl, trimSource);
    } else if (study.country_source === 'FR') {
      sourceUrl = applyTrimLeboncoin(sourceUrl, trimSource);
    } else if (study.country_source === 'DK') {
      sourceUrl = applyTrimBilbasen(sourceUrl, trimSource);
    }
  }

  let finalStatus = 'UNKNOWN_ERROR';
  let lastStage = 'START';
  let errorMessage: string | undefined;

  try {
    logger.log('START', 'info', `Starting study ${study.id} mode=${scrapeMode}`);

    // INPUT log: business criteria for the study
    logger.log('INPUT', 'info',
      `brand=${study.brand} model=${study.model} year=${study.year}` +
      (trimTarget ? ` trimTarget="${trimTarget}"` : '') +
      (trimSource && trimSource !== trimTarget ? ` trimSource="${trimSource}"` : '') +
      ` mileageMax=${study.max_mileage || 'none'}` +
      ` source=${study.country_source} target=${study.country_target}` +
      ` threshold=${threshold}€`
    );

    // URL logs: what is actually sent to the scraper
    lastStage = 'URL_TARGET';
    logger.log('URL_TARGET', 'info', buildUrlLog('URL_TARGET', originalTargetUrl, targetUrl, study.country_target, trimTarget));

    lastStage = 'URL_SOURCE';
    logger.log('URL_SOURCE', 'info', buildUrlLog('URL_SOURCE', originalSourceUrl, sourceUrl, study.country_source, trimSource));

    await updateHeartbeat(supabase, runId, scheduledJobId);

    // Scrape target market
    lastStage = 'SCRAPE_TARGET';
    const targetResult = await scrapeSearch(targetUrl, scrapeMode);

    if (targetResult.error) {
      const errReason = targetResult.errorReason || 'Unknown error';
      logger.log('SCRAPE_TARGET', 'error',
        `stage=SCRAPE_TARGET marketplace=${detectMarketplace(study.country_target)}` +
        ` error="${errReason}" url=${targetUrl}`
      );

      const { error: insertError } = await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: errReason,
      }]);

      if (insertError) {
        console.error(`[DATABASE_ERROR] Failed to insert NULL result for ${study.id}:`, insertError);
        throw new Error(`Database insert failed: ${insertError.message}`);
      }

      finalStatus = targetResult.error;
      return { status: targetResult.error, nullCount: 1, opportunitiesCount: 0 };
    }

    logger.log('SCRAPE_TARGET', 'info',
      `marketplace=${detectMarketplace(study.country_target)} raw=${targetResult.listings.length} listings mode=${scrapeMode}`
    );

    // PARSE log: first 3 listings as samples
    if (targetResult.listings.length > 0) {
      logger.log('PARSE_TARGET', 'info',
        `parsed=${targetResult.listings.length} sample=[${buildListingSamples(targetResult.listings)}]`
      );
    } else {
      logger.log('PARSE_TARGET', 'warning', `parsed=0 — no listings found on target market`);
    }

    await updateHeartbeat(supabase, runId, scheduledJobId);

    // Scrape source market
    lastStage = 'SCRAPE_SOURCE';
    const sourceResult = await scrapeSearch(sourceUrl, scrapeMode);

    if (sourceResult.error) {
      const errReason = sourceResult.errorReason || 'Unknown error';
      logger.log('SCRAPE_SOURCE', 'error',
        `stage=SCRAPE_SOURCE marketplace=${detectMarketplace(study.country_source)}` +
        ` error="${errReason}" url=${sourceUrl}`
      );

      const { error: insertError } = await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: errReason,
      }]);

      if (insertError) {
        console.error(`[DATABASE_ERROR] Failed to insert NULL result for ${study.id}:`, insertError);
        throw new Error(`Database insert failed: ${insertError.message}`);
      }

      finalStatus = sourceResult.error;
      return { status: sourceResult.error, nullCount: 1, opportunitiesCount: 0 };
    }

    logger.log('SCRAPE_SOURCE', 'info',
      `marketplace=${detectMarketplace(study.country_source)} raw=${sourceResult.listings.length} listings mode=${scrapeMode}`
    );

    if (sourceResult.listings.length > 0) {
      logger.log('PARSE_SOURCE', 'info',
        `parsed=${sourceResult.listings.length} sample=[${buildListingSamples(sourceResult.listings)}]`
      );
    } else {
      logger.log('PARSE_SOURCE', 'warning', `parsed=0 — no listings found on source market`);
    }

    // Apply unified business logic (PURE functions)
    // NOTE: Trim filtering is now CODE-DRIVEN (not URL-based) as of 2026-01-23
    // CRITICAL: Use separate criteria for target and source (different trim keywords)
    const targetCriteria: StudyCriteria = {
      brand: study.brand,
      model: study.model,
      year: study.year,
      max_mileage: study.max_mileage || 0,
      trim_text: trimTarget || null,
    };

    const sourceCriteria: StudyCriteria = {
      brand: study.brand,
      model: study.model,
      year: study.year,
      max_mileage: study.max_mileage || 0,
      trim_text: trimSource || null,
    };

    // Filter diagnostic (read-only, never affects business result)
    lastStage = 'FILTER_TARGET';
    const targetDiag = diagnoseFilterRejections(targetResult.listings, targetCriteria);
    const filteredTarget = filterListingsByStudy(targetResult.listings, targetCriteria);
    logger.log('FILTER_TARGET', filteredTarget.length === 0 ? 'warning' : 'info',
      `input=${targetResult.listings.length} passed=${filteredTarget.length} rejected=${targetDiag.rejected}` +
      (targetDiag.byTrim > 0 ? ` byTrim=${targetDiag.byTrim}` : '') +
      (targetDiag.byYear > 0 ? ` byYear=${targetDiag.byYear}` : '') +
      (targetDiag.byMileage > 0 ? ` byMileage=${targetDiag.byMileage}` : '') +
      (targetDiag.byBrandModel > 0 ? ` byBrandModel=${targetDiag.byBrandModel}` : '') +
      (targetDiag.byFirstPass > 0 ? ` byFirstPass=${targetDiag.byFirstPass}` : '')
    );
    for (const ex of targetDiag.examples) {
      logger.log('FILTER_TARGET', 'warning', `rejected ${ex}`);
    }

    // Feed Market Intelligence with the target market picture (best-effort).
    await recordStudyMarketSnapshot(supabase, {
      site: siteKeyForUrl(targetUrl),
      country: String(study.country_target ?? '').toUpperCase(),
      brand: String(study.brand ?? '').toUpperCase(),
      model: String(study.model ?? '').toUpperCase(),
    }, filteredTarget, targetUrl);

    lastStage = 'FILTER_SOURCE';
    const sourceDiag = diagnoseFilterRejections(sourceResult.listings, sourceCriteria);
    const filteredSource = filterListingsByStudy(sourceResult.listings, sourceCriteria);
    logger.log('FILTER_SOURCE', filteredSource.length === 0 ? 'warning' : 'info',
      `input=${sourceResult.listings.length} passed=${filteredSource.length} rejected=${sourceDiag.rejected}` +
      (sourceDiag.byTrim > 0 ? ` byTrim=${sourceDiag.byTrim}` : '') +
      (sourceDiag.byYear > 0 ? ` byYear=${sourceDiag.byYear}` : '') +
      (sourceDiag.byMileage > 0 ? ` byMileage=${sourceDiag.byMileage}` : '') +
      (sourceDiag.byBrandModel > 0 ? ` byBrandModel=${sourceDiag.byBrandModel}` : '') +
      (sourceDiag.byFirstPass > 0 ? ` byFirstPass=${sourceDiag.byFirstPass}` : '')
    );
    for (const ex of sourceDiag.examples) {
      logger.log('FILTER_SOURCE', 'warning', `rejected ${ex}`);
    }

    // Feed Market Intelligence with the source market picture (best-effort).
    await recordStudyMarketSnapshot(supabase, {
      site: siteKeyForUrl(sourceUrl),
      country: String(study.country_source ?? '').toUpperCase(),
      brand: String(study.brand ?? '').toUpperCase(),
      model: String(study.model ?? '').toUpperCase(),
    }, filteredSource, sourceUrl);

    if (filteredTarget.length === 0) {
      logger.log('FILTER_TARGET', 'warning', 'No target listings remain after filtering — returning NULL');

      const { error: insertError } = await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: 'No listings after filtering',
      }]);

      if (insertError) {
        console.error(`[DATABASE_ERROR] Failed to insert NULL result for ${study.id}:`, insertError);
        throw new Error(`Database insert failed: ${insertError.message}`);
      }

      finalStatus = 'NULL';
      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    lastStage = 'STATS_TARGET';
    const targetStats = computeTargetMarketStats(filteredTarget);
    const opportunityResult = detectOpportunity(filteredTarget, filteredSource, threshold, 5);

    // STATS_TARGET log
    const top6Prices = filteredTarget
      .slice()
      .sort((a, b) => a.price - b.price)
      .slice(0, 6)
      .map(l => l.price.toFixed(0));
    logger.log('STATS_TARGET', 'info',
      `count=${targetStats.count} median=${targetStats.median_price.toFixed(0)}€` +
      ` avg=${targetStats.average_price.toFixed(0)}€` +
      ` range=${targetStats.min_price.toFixed(0)}-${targetStats.max_price.toFixed(0)}€` +
      ` topPrices=[${top6Prices.join(',')}]`
    );

    // STATS_SOURCE log
    lastStage = 'STATS_SOURCE';
    const top3SourcePrices = filteredSource
      .slice()
      .sort((a, b) => a.price - b.price)
      .slice(0, 3)
      .map(l => l.price.toFixed(0));
    logger.log('STATS_SOURCE', 'info',
      `count=${filteredSource.length} bestPrice=${opportunityResult.bestSourcePrice.toFixed(0)}€` +
      (top3SourcePrices.length > 0 ? ` topPrices=[${top3SourcePrices.join(',')}]` : ' (no source listings)')
    );

    // DIAGNOSTIC: Show top6 prices/titles used for target market stats
    const top6 = filteredTarget
      .sort((a, b) => a.price - b.price)
      .slice(0, 6)
      .map(l => ({ price: l.price, title: l.title?.substring(0, 50) || 'NO_TITLE' }));
    console.log(
      `[TARGET_STATS_NL] study=${study.id} country=${study.country_target} count=${filteredTarget.length} ` +
      `median=${targetStats.median_price.toFixed(0)} top6_prices=[${top6.map(x => x.price.toFixed(0)).join(', ')}] ` +
      `top6_titles=[${top6.map(x => `"${x.title}"`).join(', ')}]`
    );

    const status = opportunityResult.hasOpportunity ? 'OPPORTUNITIES' : 'NULL';

    lastStage = 'RESULT';
    const diff = opportunityResult.priceDifference;
    if (opportunityResult.hasOpportunity) {
      logger.log('RESULT', 'info',
        `status=OPPORTUNITY diff=+${diff.toFixed(0)}€ threshold=${threshold}€` +
        ` targetMedian=${targetStats.median_price.toFixed(0)}€ bestSource=${opportunityResult.bestSourcePrice.toFixed(0)}€`
      );
    } else {
      const reason = filteredSource.length === 0 ? 'no_source_listings' : 'below_threshold';
      logger.log('RESULT', 'info',
        `status=NULL diff=${diff.toFixed(0)}€ threshold=${threshold}€ reason=${reason}` +
        ` targetMedian=${targetStats.median_price.toFixed(0)}€ bestSource=${opportunityResult.bestSourcePrice.toFixed(0)}€`
      );
    }

    console.log(`[WORKER] Study ${study.id} result: ${status} (diff: ${diff.toFixed(0)}€)`);
    console.log(`[WORKER] Target median: ${targetStats.median_price.toFixed(0)}€, Best source: ${opportunityResult.bestSourcePrice.toFixed(0)}€`);

    const { data: insertedResult, error: insertError } = await supabase.from('study_run_results').insert([{
      run_id: runId,
      study_id: study.id,
      status,
      target_market_price: targetStats.median_price,
      best_source_price: opportunityResult.bestSourcePrice,
      price_difference: opportunityResult.priceDifference,
      target_stats: {
        count: targetStats.count,
        median_price: targetStats.median_price,
        average_price: targetStats.average_price,
        min_price: targetStats.min_price,
        max_price: targetStats.max_price,
        percentile_25: targetStats.percentile_25,
        percentile_75: targetStats.percentile_75,
        targetMarketUrl: targetUrl,
        sourceMarketUrl: sourceUrl,
        targetMarketMedianEur: targetStats.median_price,
      },
    }]).select();

    if (insertError) {
      console.error(`[DATABASE_ERROR] Failed to insert ${status} result for ${study.id}:`, insertError);
      console.error(`[DATABASE_ERROR] Insert data:`, {
        run_id: runId,
        study_id: study.id,
        status,
        target_market_price: targetStats.median_price,
        best_source_price: opportunityResult.bestSourcePrice,
        price_difference: opportunityResult.priceDifference,
      });
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    console.log(`[WORKER] ✅ Result persisted to study_run_results (id: ${insertedResult[0]?.id})`);

    if (status === 'OPPORTUNITIES' && opportunityResult.interestingListings.length > 0) {
      console.log(`[WORKER] Persisting ${opportunityResult.interestingListings.length} interesting listings...`);

      const resultId = insertedResult[0].id;

      // Second-pass: scrape detail pages for enriched data (only in DETAILED mode)
      const listingsToInsert = [];
      let detailRequestCount = 0;

      if (scrapeMode === 'fast') {
        console.log(`[DETAIL_SCRAPE] skipped (mode=fast)`);
      }

      for (const listing of opportunityResult.interestingListings) {
        let detailData: DetailPageData | null = null;

        // Only scrape detail pages in DETAILED mode (current behavior)
        if (scrapeMode === 'detailed') {
          detailData = await scrapeDetailPage(listing.listing_url);
          detailRequestCount++;
        }

        listingsToInsert.push({
          run_result_id: resultId,
          listing_url: listing.listing_url,
          title: listing.title,
          price: toEur(listing.price, listing.currency),
          mileage: listing.mileage || detailData?.mileage || null,
          year: listing.year || detailData?.year || null,
          trim: listing.trim || null,
          is_damaged: false,
          defects_summary: detailData?.defects_summary || null,
          maintenance_summary: detailData?.maintenance_summary || null,
          options_summary: null,
          entretien: detailData?.entretien || '',
          options: detailData?.options || [],
          full_description: listing.description || null,
          car_image_urls: detailData?.car_image_urls || [],
          status: 'NEW',
          internal_ref: generateInternalRef({ listing_url: listing.listing_url }),
        });
      }

      console.log(`[DETAIL_SCRAPE] total_detail_requests=${detailRequestCount}`);

      // Fetch existing listings to preserve ownership
      const internalRefs = listingsToInsert.map(l => l.internal_ref);
      const { data: existingListings } = await supabase
        .from('study_source_listings')
        .select('id, internal_ref, assigned_to, status')
        .in('internal_ref', internalRefs);

      const existingMap = new Map(
        (existingListings || []).map(e => [
          e.internal_ref,
          { id: e.id, assigned_to: e.assigned_to, status: e.status }
        ])
      );

      // Merge ownership fields from existing rows
      for (const listing of listingsToInsert) {
        const existingData = existingMap.get(listing.internal_ref);
        if (existingData) {
          (listing as any).assigned_to = existingData.assigned_to;
          (listing as any).status = existingData.status;
        }
      }

      // Upsert listings (update all fields including run data)
      const { data: upsertedListings, error: listingsError } = await supabase
        .from('study_source_listings')
        .upsert(listingsToInsert, {
          onConflict: 'internal_ref',
          ignoreDuplicates: false,
        })
        .select('id, internal_ref');

      if (listingsError) {
        console.error(`[DATABASE_ERROR] Failed to upsert listings for ${study.id}:`, listingsError);
      } else {
        console.log(`[WORKER] ✅ ${listingsToInsert.length} listings upserted (attempted: ${listingsToInsert.length}, existing: ${existingListings?.length || 0})`);

        if (existingListings && existingListings.length > 0) {
          console.log(`[WORKER] Sample reused ref: ${existingListings[0].internal_ref}`);
        }

        // Create mapping rows in join table
        const mappings = (upsertedListings || []).map(listing => ({
          run_result_id: resultId,
          listing_id: listing.id,
        }));

        const { error: mappingError } = await supabase
          .from('study_run_result_listings')
          .insert(mappings)
          .select();

        if (mappingError) {
          console.error(`[DATABASE_ERROR] Failed to insert mappings for ${study.id}:`, mappingError);
        } else {
          console.log(`[WORKER] ✅ ${mappings.length} run-listing mappings created`);
        }
      }
    }

    finalStatus = status;
    return {
      status,
      nullCount: status === 'NULL' ? 1 : 0,
      opportunitiesCount: status === 'OPPORTUNITIES' ? 1 : 0,
    };
  } catch (error: any) {
    console.error(`[WORKER] Error executing study ${study.id}:`, error);
    errorMessage = error?.message ?? String(error);
    const failedUrl = lastStage === 'SCRAPE_TARGET' || lastStage === 'URL_TARGET' ? targetUrl
      : lastStage === 'SCRAPE_SOURCE' || lastStage === 'URL_SOURCE' ? sourceUrl
      : undefined;
    const marketplace = lastStage.includes('TARGET') ? detectMarketplace(study.country_target)
      : lastStage.includes('SOURCE') ? detectMarketplace(study.country_source)
      : 'UNKNOWN';
    lastStage = 'ERROR';
    logger.log('ERROR', 'error',
      `stage=${lastStage} marketplace=${marketplace}` +
      (failedUrl ? ` url=${failedUrl}` : '') +
      ` error="${errorMessage}"`
    );

    const { error: insertError } = await supabase.from('study_run_results').insert([{
      run_id: runId,
      study_id: study.id,
      status: 'NULL',
      target_market_price: null,
      best_source_price: null,
      price_difference: null,
      target_stats: null,
      target_error_reason: `Execution error: ${errorMessage}`,
    }]);

    if (insertError) {
      console.error(`[DATABASE_ERROR] Failed to insert error result for ${study.id}:`, insertError);
    }

    finalStatus = 'UNKNOWN_ERROR';
    return { status: 'ERROR', nullCount: 1, opportunitiesCount: 0 };
  } finally {
    await logger.persist(supabase, finalStatus, lastStage, errorMessage);
  }
}
