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
import { generateInternalRef } from '../src/lib/internalRefGenerator';
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
  const useRawHtml = profile.httpResponseBody === true;
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
  fromCache: boolean;
  fieldsPresent: Record<string, number>; // 0..1 fraction of listings carrying each field
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
const SCRAPE_CACHE = new Map<string, { at: number; result: ScrapeSearchResult }>();
const SCRAPE_CACHE_TTL_MS = 5 * 60 * 1000;
// A full results page that yields 0 listings is a genuine empty search, not a
// parse failure — don't waste Zyte retries on it.
const FULL_PAGE_MIN_BYTES = 100_000;
// Depth: in 'full'/'detailed' mode, page beyond page 1 up to this many
// listings (≈ a study's worth), bounded by a page cap. 'fast' stays page 1.
const MAX_LISTINGS = 100;
const MAX_PAGES = 5;

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
    : 'UNKNOWN';
}

/**
 * Scrape a marketplace URL and parse listings.
 * Exported for the /ingest-url endpoint (discovery scrape) — same fetch,
 * retries, profile escalation and parsing as study execution.
 */
export async function scrapeSearch(url: string, scrapeMode: 'fast' | 'full' | 'detailed'): Promise<ScrapeSearchResult> {
  const marketplace = marketplaceOf(url);
  console.log(`[SCRAPE_ROUTE] marketplace=${marketplace} scrapeMode=${scrapeMode} url=${url.substring(0, 150)}`);

  // Dedup cache — serve a recent identical scrape instead of re-paying Zyte.
  const cached = SCRAPE_CACHE.get(url);
  if (cached && Date.now() - cached.at < SCRAPE_CACHE_TTL_MS) {
    console.log(`[SCRAPE_CACHE] hit (age=${Math.round((Date.now() - cached.at) / 1000)}s) url=${url.slice(0, 120)}`);
    return { ...cached.result, diagnostics: { ...cached.result.diagnostics, fromCache: true } };
  }

  const MAX_RETRIES = scrapeMode === 'fast' ? 1 : 3;
  let lastMode: 'raw' | 'browser' | null = null;
  let lastLen = 0;

  const finalize = (r: Omit<ScrapeSearchResult, 'diagnostics'>, d: Partial<ScrapeDiagnostics>, cache: boolean): ScrapeSearchResult => {
    const result: ScrapeSearchResult = {
      ...r,
      diagnostics: {
        site: marketplace, mode: lastMode, attempts: d.attempts ?? 0, htmlLength: d.htmlLength ?? lastLen,
        listingCount: r.listings.length, totalCount: r.totalCount ?? null,
        blocked: d.blocked ?? false, blockReason: d.blockReason ?? null,
        emptyResults: d.emptyResults ?? false, fromCache: false,
        fieldsPresent: fieldCoverage(r.listings),
      },
    };
    if (cache) SCRAPE_CACHE.set(url, { at: Date.now(), result });
    return result;
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const profileLevel = attempt + 1;
    console.log(`[WORKER_SCRAPER] Fetching ${url} (attempt ${attempt + 1}/${MAX_RETRIES + 1}, profile ${profileLevel})`);

    const { html, mode } = await fetchHtmlWithZyte(url, profileLevel);
    lastMode = mode;

    if (!html) {
      if (attempt === MAX_RETRIES) {
        return finalize({ listings: [], error: 'SCRAPER_FAILED', errorReason: 'Failed to fetch HTML after retries' }, { attempts: attempt + 1, htmlLength: 0 }, false);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    lastLen = html.length;

    const listings = coreParseSearchPage(html, url);
    if (url.includes('marktplaats.nl') && (url.includes('/l/auto-s') || url.includes('/lrp/api/'))) {
      console.log(`[MARKTPLAATS_PARSED] count=${listings.length} attempt=${attempt + 1}`);
    }

    if (listings.length > 0) {
      const totalCount = extractTotalCount(html);
      let all = dedupeListings(listings);

      // Depth: fetch further pages (cheap mode, bounded) when more results
      // exist and we're not in 'fast' mode. Small searches (all results on
      // page 1) never paginate — no wasted requests.
      const moreAvailable = totalCount == null ? all.length >= 15 : totalCount > all.length;
      let pages = 1;
      if (scrapeMode !== 'fast' && moreAvailable && all.length < MAX_LISTINGS) {
        const adapter = findSiteAdapterByDomain(url);
        for (let page = 2; page <= MAX_PAGES && all.length < MAX_LISTINGS; page++) {
          const pageUrl = adapter ? adapter.buildPaginatedUrl(url, page) : url;
          if (pageUrl === url) break; // no pagination scheme for this site
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
      all = all.slice(0, MAX_LISTINGS);
      console.log(`[WORKER_SCRAPER] ✅ Parsed ${all.length} listings (mode=${mode}, pages=${pages})`);
      return finalize({ listings: all, totalCount }, { attempts: attempt + 1, htmlLength: html.length }, true);
    }

    // Blocked? Don't give up on the first block — escalate through the profiles
    // and only report TARGET_BLOCKED once exhausted.
    const blockedCheck = detectBlockedContent(html, false);
    if (blockedCheck.isBlocked) {
      console.warn(`[WORKER_SCRAPER] ⚠️  Blocked: ${blockedCheck.matchedKeyword} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      return finalize({ listings: [], error: 'TARGET_BLOCKED', errorReason: `Blocked: ${blockedCheck.matchedKeyword}` },
        { attempts: attempt + 1, htmlLength: html.length, blocked: true, blockReason: blockedCheck.matchedKeyword }, false);
    }

    // Full page, 0 listings, not blocked → genuine empty search. Return now
    // (no wasted retries) and cache it.
    if (html.length >= FULL_PAGE_MIN_BYTES) {
      console.log(`[WORKER_SCRAPER] 0 listings on a full page (${html.length}b, mode=${mode}) — genuine empty result, no retry`);
      return finalize({ listings: [], totalCount: extractTotalCount(html) }, { attempts: attempt + 1, htmlLength: html.length, emptyResults: true }, true);
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
