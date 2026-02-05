/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LINKGEN MAPPING AUTO - CRAWL MODULE (CHAINED CRAWLER)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Crawls marketplace listings to discover URL patterns and extract minimal data.
 * Implements diversity-driven sampling and chained discovery from both listing
 * and list pages.
 *
 * KEY PRINCIPLES:
 * - stepsDone = successful mapping samples only (not fetches, not pages)
 * - List pages = discovery only (never create mapping, never increment stepsDone)
 * - Listing pages with no data = skip storage entirely (no null-only samples)
 * - Diversity filter (threshold = 10) applies only to listing URLs, not list pages
 * - Crawl continues until queue exhausted OR max_steps reached
 *
 * CONSTRAINTS:
 * - Read-only imports of existing parsers (no modification)
 * - Fully isolated from study execution pipeline
 * - No HTML stored in database (only small structured JSON)
 * - Strict 100-step limit (or until URL queue exhausted)
 * - Async execution (non-blocking)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseListings as parseMarktplaatsListings } from '../src/lib/study-core/parsers/marktplaats';
import { generateInternalRef } from '../src/lib/internalRefGenerator';

const ZYTE_API_KEY = process.env.ZYTE_API_KEY || '';
const ZYTE_ENDPOINT = 'https://api.zyte.com/v1/extract';

// Debug flag for HTML diagnostics (Railway env: LINKGEN_DEBUG_HTML=true)
const LINKGEN_DEBUG_HTML = process.env.LINKGEN_DEBUG_HTML === 'true';

interface CrawlParams {
  runId: string;
  marketplace: string;
  seedListingUrl: string;
  steps: number;
  supabase: SupabaseClient;
}

interface URLCandidate {
  url: string;
  discoveredFrom: string;
  score: number;
}

interface BrandModelCount {
  [key: string]: number;
}

interface MappingCandidate {
  brand: string | null;
  model: string | null;
  brandId: string | null;
  modelSlug: string | null;
  sourceUrl: string;
}

async function fetchHtmlWithZyte(url: string): Promise<string | null> {
  if (!ZYTE_API_KEY) {
    console.error('[LINKGEN_AUTO] ZYTE_API_KEY not configured');
    return null;
  }

  const requestBody: any = {
    url,
    browserHtml: true,
  };

  if (url.includes('marktplaats.nl')) {
    requestBody.geolocation = 'NL';
    requestBody.javascript = true;
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
      console.error(`[LINKGEN_AUTO] Zyte API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as { browserHtml?: string };
    return data.browserHtml || null;
  } catch (error) {
    console.error('[LINKGEN_AUTO] Fetch error:', error);
    return null;
  }
}

function normalizeMarktplaatsUrl(url: string, baseUrl: string): string | null {
  try {
    let absoluteUrl: string;

    if (url.startsWith('http://') || url.startsWith('https://')) {
      absoluteUrl = url;
    } else if (url.startsWith('//')) {
      absoluteUrl = 'https:' + url;
    } else if (url.startsWith('/')) {
      absoluteUrl = baseUrl + url;
    } else {
      return null;
    }

    const parsed = new URL(absoluteUrl);

    if (parsed.protocol !== 'https:') {
      parsed.protocol = 'https:';
    }

    if (parsed.hostname === 'marktplaats.nl') {
      parsed.hostname = 'www.marktplaats.nl';
    }

    parsed.hash = '';

    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'source', 'fbclid', 'gclid'];
    trackingParams.forEach(param => parsed.searchParams.delete(param));

    return parsed.toString();
  } catch (error) {
    return null;
  }
}

function isValidMarktplaatsListingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'https:') {
      return false;
    }

    const validHosts = ['marktplaats.nl', 'www.marktplaats.nl'];
    if (!validHosts.includes(parsed.hostname)) {
      return false;
    }

    const invalidSchemes = ['javascript:', 'mailto:', 'tel:', 'data:'];
    if (invalidSchemes.some(scheme => url.toLowerCase().startsWith(scheme))) {
      return false;
    }

    const path = parsed.pathname;

    const validPatterns = [
      /^\/v\/.+\/a\d+$/,
      /^\/v\/.+\/m\d+(-[a-z0-9-]+)?$/,
      /^\/a\/m?\d+$/,
      /^\/m\/\d+$/,
    ];

    if (!validPatterns.some(pattern => pattern.test(path))) {
      return false;
    }

    const invalidPaths = ['/l/', '/q/', '/help', '/account', '/veilig', '/ads', '/widget'];
    if (invalidPaths.some(invalid => path.includes(invalid))) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

function isMarktplaatsListPage(url: string): boolean {
  try {
    const parsed = new URL(url);

    const validHosts = ['marktplaats.nl', 'www.marktplaats.nl'];
    if (!validHosts.includes(parsed.hostname)) {
      return false;
    }

    const path = parsed.pathname;

    const listPagePatterns = [
      /^\/l\//,
      /^\/q\//,
      /^\/aanbod\//,
    ];

    return listPagePatterns.some(pattern => pattern.test(path));
  } catch (error) {
    return false;
  }
}

function detectPageType(
  url: string,
  html: string,
  parsedListings: any[],
  marketplace: string
): 'listing' | 'list' | 'unknown' {
  if (marketplace === 'MARKTPLAATS') {
    if (isMarktplaatsListPage(url)) {
      return 'list';
    }

    if (isValidMarktplaatsListingUrl(url)) {
      return 'listing';
    }

    if (parsedListings.length > 5) {
      return 'list';
    }

    if (parsedListings.length === 1) {
      return 'listing';
    }

    return 'unknown';
  }

  return 'unknown';
}

function extractListingUrls(html: string, marketplace: string, baseUrl: string): { urls: string[], externalLinksSkipped: number, nonListingLinksSkipped: number } {
  const urls: string[] = [];
  let externalLinksSkipped = 0;
  let nonListingLinksSkipped = 0;

  if (marketplace === 'MARKTPLAATS') {
    const hrefPattern = /href=["']([^"']+)["']/gi;
    const matches = Array.from(html.matchAll(hrefPattern));

    console.log(`[LINKGEN_MAP] Found ${matches.length} total hrefs in HTML`);

    for (const match of matches) {
      const href = match[1];

      const normalized = normalizeMarktplaatsUrl(href, baseUrl);
      if (!normalized) {
        continue;
      }

      try {
        const parsedNormalized = new URL(normalized);
        const validHosts = ['marktplaats.nl', 'www.marktplaats.nl'];

        if (!validHosts.includes(parsedNormalized.hostname)) {
          externalLinksSkipped++;
          continue;
        }
      } catch (error) {
        continue;
      }

      if (!isValidMarktplaatsListingUrl(normalized)) {
        nonListingLinksSkipped++;
        continue;
      }

      urls.push(normalized);
    }

    const uniqueUrls = [...new Set(urls)];
    console.log(`[LINKGEN_MAP] Valid listing URLs kept: ${uniqueUrls.length}`);
    console.log(`[LINKGEN_MAP] External URLs rejected: ${externalLinksSkipped}`);
    console.log(`[LINKGEN_MAP] Non-listing Marktplaats URLs rejected: ${nonListingLinksSkipped}`);

    return { urls: uniqueUrls, externalLinksSkipped, nonListingLinksSkipped };
  }

  return { urls: [...new Set(urls)], externalLinksSkipped: 0, nonListingLinksSkipped: 0 };
}

function extractBrandModel(text: string): { brand: string | null; model: string | null } {
  const brandPatterns = [
    /\b(Mercedes-Benz|BMW|Audi|Volkswagen|Tesla|Porsche|Volvo|Toyota|Honda|Ford|Renault|Peugeot|Citro[eë]n|Opel|Nissan|Mazda|Hyundai|Kia|Skoda|SEAT)\b/i,
  ];

  let brand: string | null = null;
  for (const pattern of brandPatterns) {
    const match = text.match(pattern);
    if (match) {
      brand = match[1];
      break;
    }
  }

  return { brand, model: null };
}

/**
 * Parse single listing from Marktplaats HTML using __NEXT_DATA__ structured fields.
 *
 * CRITICAL RULES:
 * 1. Brand/model extracted from structured fields ONLY (listing.make, listing.model, attributes array)
 * 2. Title stored for debugging ONLY - NEVER parsed
 * 3. Returns null if structural validation fails (no id, no price, no attributes)
 *
 * @param html Raw HTML from Marktplaats listing page
 * @returns Parsed listing data or null if structurally invalid
 */
function parseSingleMarktplaatsListing(html: string): {
  brand: string | null;
  model: string | null;
  year: number | null;
  mileage: number | null;
  price: number | null;
  fuel: string | null;
  title: string | null;
  listingId: string | null;
} | null {
  try {
    // Extract __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
    if (!nextDataMatch) {
      if (LINKGEN_DEBUG_HTML) {
        console.warn('[LINKGEN_AUTO] No __NEXT_DATA__ found in HTML');
        console.warn('[LINKGEN_DEBUG] __NEXT_DATA__ missing. Likely consent/captcha/alt rendering. See signals above.');
      } else {
        console.warn('[LINKGEN_AUTO] No __NEXT_DATA__ found in HTML (enable LINKGEN_DEBUG_HTML=true for details)');
      }
      return null;
    }

    const nextData = JSON.parse(nextDataMatch[1]);
    const listing = nextData?.props?.pageProps?.listing;

    // STRUCTURAL VALIDATION - Two-stage gate (Stage 2)
    // MUST have all three stable signals:
    const hasId = listing?.id !== undefined && listing?.id !== null;
    const hasPrice = (listing?.priceInfo?.priceCents !== undefined && listing?.priceInfo?.priceCents !== null) ||
                     (listing?.price !== undefined && listing?.price !== null);
    const hasAttributes = Array.isArray(listing?.attributes);

    if (!hasId || !hasPrice || !hasAttributes) {
      console.warn('[LINKGEN_AUTO] Structural validation failed - missing required signals (id, price, or attributes)');
      return null;
    }

    // Extract brand/model from STRUCTURED FIELDS ONLY
    const attributes = listing.attributes || [];

    const brand = listing.make ||
                  attributes.find((a: any) => a.key === 'make' || a.key === 'merk')?.value ||
                  null;

    const model = listing.model ||
                  attributes.find((a: any) => a.key === 'model')?.value ||
                  null;

    // Extract other fields from attributes array
    const yearAttr = attributes.find((a: any) => a.key === 'year' || a.key === 'bouwjaar');
    const year = yearAttr?.value ? parseInt(yearAttr.value, 10) : null;

    const mileageAttr = attributes.find((a: any) => a.key === 'mileage' || a.key === 'kilometerstand');
    const mileage = mileageAttr?.value ? parseInt(String(mileageAttr.value).replace(/\D/g, ''), 10) : null;

    const fuelAttr = attributes.find((a: any) => a.key === 'fuel' || a.key === 'brandstof');
    const fuel = fuelAttr?.value || null;

    // Extract price from structured fields
    const price = listing.priceInfo?.priceCents
                  ? listing.priceInfo.priceCents / 100
                  : (listing.price || null);

    // Store title for DEBUG ONLY (never parsed)
    const title = listing.title || null;

    const listingId = listing.id;

    return {
      brand,
      model,
      year,
      mileage,
      price,
      fuel,
      title,
      listingId,
    };
  } catch (error) {
    console.error('[LINKGEN_AUTO] Error parsing single listing:', error);
    return null;
  }
}

/**
 * Analyze HTML for debugging __NEXT_DATA__ extraction issues
 * SAFE: Only logs small previews and metrics, never full HTML
 * BOUNDED: Script regex runs on max 300k chars
 * SANITIZED: Masks base64/UUID-like tokens in preview
 */
function debugAnalyzeHtml(url: string, html: string): void {
  const htmlLength = html?.length || 0;

  // EDIT 2: Sanitize 200-char preview (mask base64-like tokens and UUIDs)
  let first200 = html.slice(0, 200).replace(/\n/g, ' ').replace(/\s+/g, ' ');
  // Mask base64-like sequences (80+ alphanumeric chars)
  first200 = first200.replace(/[A-Za-z0-9+/=]{80,}/g, '[BASE64]');
  // Mask UUID patterns
  first200 = first200.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[UUID]');

  // Check for __NEXT_DATA__ presence
  const hasNextData = html.includes('id="__NEXT_DATA__"') || html.includes('__NEXT_DATA__');
  const hasJsonLd = html.includes('application/ld+json');

  // Check for captcha/blocking signals (bounded to first 5k chars)
  const captchaPattern = /captcha|cloudflare|attention required|verify you are human/i;
  const hasCaptchaSignals = captchaPattern.test(html.slice(0, 5000));

  // Check for consent/cookie walls (bounded to first 5k chars)
  const consentPattern = /cookie|consent|CMP|privacy settings|cookie-banner/i;
  const hasConsentSignals = consentPattern.test(html.slice(0, 5000));

  // EDIT 1: Bound script-tag regex to first 300k chars max
  const htmlForScriptScan = html.slice(0, 300000);
  const scriptStats: Array<{id: string; type: string; len: number}> = [];
  const scriptPattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  let scannedCount = 0;
  const MAX_SCRIPTS_TO_SCAN = 10;

  while ((scriptMatch = scriptPattern.exec(htmlForScriptScan)) !== null && scannedCount < MAX_SCRIPTS_TO_SCAN) {
    scannedCount++;
    const attrs = scriptMatch[1];
    const content = scriptMatch[2];

    const idMatch = attrs.match(/id=["']([^"']+)["']/);
    const typeMatch = attrs.match(/type=["']([^"']+)["']/);

    const id = idMatch ? idMatch[1] : 'no-id';
    const type = typeMatch ? typeMatch[1] : 'text/javascript';
    const len = content.length;

    scriptStats.push({ id, type, len });
  }

  // FIX 1: Avoid global regex state issues - simpler boolean logic
  const hasMoreScripts = scannedCount === MAX_SCRIPTS_TO_SCAN;

  // Sort by length and take top 5
  scriptStats.sort((a, b) => b.len - a.len);
  const topScripts = scriptStats.slice(0, 5);

  console.log('[LINKGEN_DEBUG] ═══════════════════════════════════════════════════════════');
  console.log(`[LINKGEN_DEBUG] URL: ${url}`);
  console.log(`[LINKGEN_DEBUG] HTML Length: ${htmlLength}`);
  console.log(`[LINKGEN_DEBUG] First 200 chars (sanitized): "${first200}"`);
  console.log(`[LINKGEN_DEBUG] Has __NEXT_DATA__: ${hasNextData}`);
  console.log(`[LINKGEN_DEBUG] Has JSON-LD: ${hasJsonLd}`);
  console.log(`[LINKGEN_DEBUG] Has Captcha Signals: ${hasCaptchaSignals}`);
  console.log(`[LINKGEN_DEBUG] Has Consent Signals: ${hasConsentSignals}`);
  console.log(`[LINKGEN_DEBUG] Scripts scanned: ${scannedCount} (hasMore: ${hasMoreScripts}, scanLimit: ${MAX_SCRIPTS_TO_SCAN})`);
  console.log(`[LINKGEN_DEBUG] Top 5 Scripts by size:`);
  topScripts.forEach((s, i) => {
    console.log(`[LINKGEN_DEBUG]   ${i+1}. id="${s.id}" type="${s.type}" length=${s.len}`);
  });
  console.log('[LINKGEN_DEBUG] ═══════════════════════════════════════════════════════════');
}

/**
 * Deep inspection of JSON-LD structured data for debugging
 * SAFE: Only logs structure analysis, never full content
 * BOUNDED: Limited script scanning to prevent performance issues
 */
function debugInspectJsonLd(url: string, html: string): void {
  console.log('[LINKGEN_DEBUG] ENTER debugInspectJsonLd');

  // Extract all JSON-LD script tags (bounded to first 500k chars)
  const htmlForJsonLdScan = html.slice(0, 500000);
  const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const jsonLdBlocks: any[] = [];
  let jsonLdMatch;
  let scannedJsonLdCount = 0;
  const MAX_JSONLD_TO_SCAN = 10;

  while ((jsonLdMatch = jsonLdPattern.exec(htmlForJsonLdScan)) !== null && scannedJsonLdCount < MAX_JSONLD_TO_SCAN) {
    scannedJsonLdCount++;
    const content = jsonLdMatch[1].trim();

    try {
      const parsed = JSON.parse(content);
      jsonLdBlocks.push(parsed);
    } catch (error) {
      console.log(`[LINKGEN_DEBUG] JSON-LD block ${scannedJsonLdCount} parse error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('[LINKGEN_DEBUG] JSON-LD DEEP INSPECTION');
  console.log(`[LINKGEN_DEBUG] URL: ${url}`);
  console.log(`[LINKGEN_DEBUG] JSON-LD blocks found: ${jsonLdBlocks.length}`);

  jsonLdBlocks.forEach((block, index) => {
    console.log(`[LINKGEN_DEBUG] ─────────────────────────────────────────────────────`);
    console.log(`[LINKGEN_DEBUG] Block ${index + 1}:`);

    // Check if block is an object with @graph
    if (block && typeof block === 'object' && !Array.isArray(block) && Array.isArray(block['@graph'])) {
      const graph = block['@graph'];
      console.log(`[LINKGEN_DEBUG]   Type: Object with @graph (array length: ${graph.length})`);

      if (graph.length > 0 && graph[0] && typeof graph[0] === 'object') {
        const keys = Object.keys(graph[0]).slice(0, 10);
        console.log(`[LINKGEN_DEBUG]   @graph[0] keys (first 10): ${keys.join(', ')}`);
      }
    }
    // Check if block is a top-level array
    else if (Array.isArray(block)) {
      console.log(`[LINKGEN_DEBUG]   Type: Top-level array (length: ${block.length})`);

      // Find first non-null, non-array item
      let firstValidItem = null;
      for (const item of block) {
        if (item !== null && !Array.isArray(item) && typeof item === 'object') {
          firstValidItem = item;
          break;
        }
      }

      if (firstValidItem) {
        const keys = Object.keys(firstValidItem);
        console.log(`[LINKGEN_DEBUG]   First valid item keys: ${keys.join(', ')}`);
      } else {
        console.log(`[LINKGEN_DEBUG]   No valid items found (all null or arrays)`);
      }

      // Additionally search for first item with @type
      const firstItemWithType = block.find((item: any) =>
        item && typeof item === 'object' && !Array.isArray(item) && item['@type']
      );

      if (firstItemWithType) {
        const typeKeys = Object.keys(firstItemWithType);
        console.log(`[LINKGEN_DEBUG]   First item with @type keys: ${typeKeys.join(', ')}`);
        console.log(`[LINKGEN_DEBUG]   @type value: ${firstItemWithType['@type']}`);
      }
    }
    // Regular object (no @graph)
    else if (block && typeof block === 'object') {
      const keys = Object.keys(block);
      console.log(`[LINKGEN_DEBUG]   Type: Object`);
      console.log(`[LINKGEN_DEBUG]   Keys: ${keys.join(', ')}`);

      if (block['@type']) {
        console.log(`[LINKGEN_DEBUG]   @type value: ${block['@type']}`);
      }
    } else {
      console.log(`[LINKGEN_DEBUG]   Type: ${typeof block}`);
    }
  });

  console.log(`[LINKGEN_DEBUG] ─────────────────────────────────────────────────────`);
  console.log('[LINKGEN_DEBUG] EXIT debugInspectJsonLd');
}

function extractMappingFromUrl(url: string, marketplace: string): MappingCandidate {
  const result: MappingCandidate = {
    brand: null,
    model: null,
    brandId: null,
    modelSlug: null,
    sourceUrl: url,
  };

  if (marketplace === 'MARKTPLAATS') {
    const urlLower = url.toLowerCase();

    const brandIdMatch = url.match(/\/l\/auto-s\/([^/]+)\//);
    if (brandIdMatch) {
      result.brandId = brandIdMatch[1];
    }

    const modelSlugMatch = url.match(/\/([a-z0-9-]+)\/a\/\d+/);
    if (modelSlugMatch) {
      result.modelSlug = modelSlugMatch[1];
    }
  }

  return result;
}

function calculateDiversityScore(
  brandModelCounts: BrandModelCount,
  brand: string | null,
  model: string | null
): number {
  if (!brand) return 1000;

  const key = `${brand}:${model || 'unknown'}`;
  const count = brandModelCounts[key] || 0;

  return 1000 - count;
}

export async function executeMappingCrawl(params: CrawlParams): Promise<void> {
  const { runId, marketplace, seedListingUrl, steps, supabase } = params;

  console.log(`[LINKGEN_AUTO] Starting crawl: runId=${runId}, marketplace=${marketplace}, steps=${steps}`);

  // Relaxed seed validation: accept both listing URLs and list page URLs
  const isListingUrl = isValidMarktplaatsListingUrl(seedListingUrl);
  const isListPageUrl = isMarktplaatsListPage(seedListingUrl);

  if (!isListingUrl && !isListPageUrl) {
    const errorMsg = `Invalid seed URL (neither listing nor list page): ${seedListingUrl}`;
    console.error(`[LINKGEN_AUTO] ${errorMsg}`);
    await supabase
      .from('linkgen_mapping_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        last_error: errorMsg,
      })
      .eq('id', runId);
    return;
  }

  const seedType = isListingUrl ? 'listing' : 'list';
  console.log(`[LINKGEN_AUTO] Seed URL type: ${seedType}`);

  const urlQueue: URLCandidate[] = [];
  const visitedUrls = new Set<string>();
  const visitedRefs = new Set<string>();
  const brandModelCounts: BrandModelCount = {};
  const mappingCandidatesMap = new Map<string, MappingCandidate>();

  let stepsDone = 0;
  let insertedSamples = 0;
  let dedupedSamples = 0;
  let skippedDiversity = 0;
  let errorsCount = 0;
  let lastError: string | null = null;
  let externalLinksSkipped = 0;
  let nonListingLinksSkipped = 0;
  let urlsDiscovered = 0;
  let listPagesVisited = 0;
  let listingsWithNoData = 0;
  let debugHtmlPrinted = 0; // Limit debug output to first listing page only

  urlQueue.push({
    url: seedListingUrl,
    discoveredFrom: 'seed',
    score: 1000,
  });

  const MAX_QUEUE_SIZE = 5000;

  while (stepsDone < steps && urlQueue.length > 0) {
    urlQueue.sort((a, b) => b.score - a.score);
    const candidate = urlQueue.shift();

    if (!candidate) break;

    const { url, discoveredFrom } = candidate;

    if (visitedUrls.has(url)) {
      dedupedSamples++;
      continue;
    }

    visitedUrls.add(url);

    try {
      console.log(`[LINKGEN_AUTO] Fetching (${stepsDone} samples so far): ${url.substring(0, 80)}...`);

      const html = await fetchHtmlWithZyte(url);

      if (!html) {
        throw new Error('Failed to fetch HTML');
      }

      // DEBUG: Analyze HTML for first listing page if debug enabled
      if (LINKGEN_DEBUG_HTML && debugHtmlPrinted < 1 && isValidMarktplaatsListingUrl(url)) {
        debugAnalyzeHtml(url, html);
        debugInspectJsonLd(url, html);
        debugHtmlPrinted++;
      }

      const listings = marketplace === 'MARKTPLAATS' ? parseMarktplaatsListings(html, url) : [];
      const pageType = detectPageType(url, html, listings, marketplace);

      console.log(`[LINKGEN_AUTO] Detected page type: ${pageType}`);

      // SECTION 3: Conditional Mapping Storage
      if (pageType === 'list') {
        // List pages: discovery only, no mapping, no stepsDone increment
        listPagesVisited++;
        console.log(`[LINKGEN_AUTO] List page detected - skipping mapping extraction`);
        if (LINKGEN_DEBUG_HTML && debugHtmlPrinted < 10) {
          console.log(`[LINKGEN_DEBUG] List page fetched: length=${html.length}`);
        }

        // Discover URLs and continue
        const baseUrl = new URL(url).origin;
        const extractionResult = extractListingUrls(html, marketplace, baseUrl);
        const discoveredUrls = extractionResult.urls;
        externalLinksSkipped += extractionResult.externalLinksSkipped;
        nonListingLinksSkipped += extractionResult.nonListingLinksSkipped;
        urlsDiscovered += discoveredUrls.length;

        console.log(`[LINKGEN_AUTO] List page discovered ${discoveredUrls.length} listing URLs`);

        for (const newUrl of discoveredUrls) {
          if (visitedUrls.has(newUrl)) continue;
          if (urlQueue.length >= MAX_QUEUE_SIZE) break;

          const newExtracted = extractBrandModel(newUrl);
          const diversityScore = calculateDiversityScore(
            brandModelCounts,
            newExtracted.brand,
            newExtracted.model
          );

          urlQueue.push({
            url: newUrl,
            discoveredFrom: url,
            score: diversityScore,
          });
        }

        // List pages do NOT increment stepsDone
        continue;

      } else if (pageType === 'listing') {
        // Listing pages: extract using __NEXT_DATA__ structured fields
        const extracted = parseSingleMarktplaatsListing(html);

        // If structural validation failed → treat as unknown (discovery only)
        if (!extracted) {
          console.warn('[LINKGEN_AUTO] Listing URL but invalid structure - treating as unknown');
          listingsWithNoData++;

          // Discovery only (no mapping, no stepsDone increment)
          const baseUrl = new URL(url).origin;
          const extractionResult = extractListingUrls(html, marketplace, baseUrl);
          const discoveredUrls = extractionResult.urls;
          externalLinksSkipped += extractionResult.externalLinksSkipped;
          nonListingLinksSkipped += extractionResult.nonListingLinksSkipped;
          urlsDiscovered += discoveredUrls.length;

          for (const newUrl of discoveredUrls) {
            if (visitedUrls.has(newUrl)) continue;
            if (urlQueue.length >= MAX_QUEUE_SIZE) break;

            const newExtracted = extractBrandModel(newUrl);
            const diversityScore = calculateDiversityScore(
              brandModelCounts,
              newExtracted.brand,
              newExtracted.model
            );

            urlQueue.push({
              url: newUrl,
              discoveredFrom: url,
              score: diversityScore,
            });
          }

          // No stepsDone increment for invalid listings
          continue;
        }

        // Valid listing with structural signals → proceed with storage
        const { brand, model, year, mileage, price, fuel, title, listingId } = extracted;

        // Apply storage gate (existing logic)
        const hasData = brand !== null || year !== null || mileage !== null || price !== null;

        if (!hasData) {
          console.warn(`[LINKGEN_AUTO] Listing page with no extractable data - skipping storage: ${url.substring(0, 80)}`);
          listingsWithNoData++;

          // Still discover URLs from this page
          const baseUrl = new URL(url).origin;
          const extractionResult = extractListingUrls(html, marketplace, baseUrl);
          const discoveredUrls = extractionResult.urls;
          externalLinksSkipped += extractionResult.externalLinksSkipped;
          nonListingLinksSkipped += extractionResult.nonListingLinksSkipped;
          urlsDiscovered += discoveredUrls.length;

          for (const newUrl of discoveredUrls) {
            if (visitedUrls.has(newUrl)) continue;
            if (urlQueue.length >= MAX_QUEUE_SIZE) break;

            const newExtracted = extractBrandModel(newUrl);
            const diversityScore = calculateDiversityScore(
              brandModelCounts,
              newExtracted.brand,
              newExtracted.model
            );

            const currentCount = brandModelCounts[`${newExtracted.brand || 'unknown'}:${newExtracted.model || 'unknown'}`] || 0;
            if (currentCount >= 10 && diversityScore < 990) {
              skippedDiversity++;
              continue;
            }

            urlQueue.push({
              url: newUrl,
              discoveredFrom: url,
              score: diversityScore,
            });
          }

          // No data = no stepsDone increment
          continue;
        }

        // Has data, proceed with storage
        const internalRef = generateInternalRef({ listing_url: url });

        if (visitedRefs.has(internalRef)) {
          dedupedSamples++;
          continue;
        }

        visitedRefs.add(internalRef);

        const priceEur = price ? Math.round(price) : null;

        const rawSnapshot = {
          listingId,
          title,
          brand,
          model,
          price,
          year,
          mileage,
          fuel,
        };

        const { error: insertError } = await supabase
          .from('linkgen_mapping_samples')
          .insert({
            run_id: runId,
            marketplace,
            listing_url: url,
            internal_ref: internalRef,
            brand,
            model,
            year,
            mileage,
            price_eur: priceEur,
            currency: 'EUR',
            discovered_from_url: discoveredFrom === 'seed' ? null : discoveredFrom,
            step_index: stepsDone,
            raw: rawSnapshot,
          });

        if (insertError && !insertError.message.includes('duplicate')) {
          console.error('[LINKGEN_AUTO] Insert error:', insertError);
        } else if (!insertError) {
          insertedSamples++;

          const key = `${brand || 'unknown'}:${model || 'unknown'}`;
          brandModelCounts[key] = (brandModelCounts[key] || 0) + 1;

          // stepsDone only increments on successful insert
          stepsDone++;
        } else {
          dedupedSamples++;
          // Duplicate = no stepsDone increment
          continue;
        }

        const mappingCandidate = extractMappingFromUrl(url, marketplace);
        if (mappingCandidate.brandId || mappingCandidate.modelSlug) {
          const candidateKey = `${marketplace}:${mappingCandidate.brand || ''}:${mappingCandidate.model || ''}:${mappingCandidate.brandId || ''}:${mappingCandidate.modelSlug || ''}`;
          mappingCandidatesMap.set(candidateKey, mappingCandidate);
        }

        const baseUrl = new URL(url).origin;
        const extractionResult = extractListingUrls(html, marketplace, baseUrl);
        const discoveredUrls = extractionResult.urls;
        externalLinksSkipped += extractionResult.externalLinksSkipped;
        nonListingLinksSkipped += extractionResult.nonListingLinksSkipped;
        urlsDiscovered += discoveredUrls.length;

        for (const newUrl of discoveredUrls) {
          if (visitedUrls.has(newUrl)) continue;
          if (urlQueue.length >= MAX_QUEUE_SIZE) break;

          const newExtracted = extractBrandModel(newUrl);
          const diversityScore = calculateDiversityScore(
            brandModelCounts,
            newExtracted.brand,
            newExtracted.model
          );

          const currentCount = brandModelCounts[`${newExtracted.brand || 'unknown'}:${newExtracted.model || 'unknown'}`] || 0;
          if (currentCount >= 10 && diversityScore < 990) {
            skippedDiversity++;
            continue;
          }

          urlQueue.push({
            url: newUrl,
            discoveredFrom: url,
            score: diversityScore,
          });
        }

      } else {
        // Unknown page type
        console.warn(`[LINKGEN_AUTO] Unknown page type: ${url.substring(0, 80)}`);
        errorsCount++;
        lastError = `Unknown page type for URL: ${url}`;

        // Still try to discover URLs
        const baseUrl = new URL(url).origin;
        const extractionResult = extractListingUrls(html, marketplace, baseUrl);
        const discoveredUrls = extractionResult.urls;
        externalLinksSkipped += extractionResult.externalLinksSkipped;
        nonListingLinksSkipped += extractionResult.nonListingLinksSkipped;
        urlsDiscovered += discoveredUrls.length;

        for (const newUrl of discoveredUrls) {
          if (visitedUrls.has(newUrl)) continue;
          if (urlQueue.length >= MAX_QUEUE_SIZE) break;

          const newExtracted = extractBrandModel(newUrl);
          const diversityScore = calculateDiversityScore(
            brandModelCounts,
            newExtracted.brand,
            newExtracted.model
          );

          urlQueue.push({
            url: newUrl,
            discoveredFrom: url,
            score: diversityScore,
          });
        }

        // Unknown pages do NOT increment stepsDone
        continue;
      }

      if (stepsDone % 10 === 0 || stepsDone === steps) {
        await supabase
          .from('linkgen_mapping_runs')
          .update({
            steps_done: stepsDone,
            inserted_samples: insertedSamples,
            deduped_samples: dedupedSamples,
            skipped_diversity: skippedDiversity,
            errors_count: errorsCount,
          })
          .eq('id', runId);
      }

    } catch (error) {
      errorsCount++;
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`[LINKGEN_AUTO] Error fetching URL:`, lastError);

      // Errors do NOT increment stepsDone (no mapping was created)

      await supabase
        .from('linkgen_mapping_runs')
        .update({
          errors_count: errorsCount,
          last_error: lastError,
        })
        .eq('id', runId);
    }
  }

  for (const candidate of mappingCandidatesMap.values()) {
    try {
      const { data: existing } = await supabase
        .from('linkgen_mapping_candidates')
        .select('id, occurrences')
        .eq('marketplace', marketplace)
        .eq('brand', candidate.brand || '')
        .eq('model', candidate.model || '')
        .eq('brand_id', candidate.brandId || '')
        .eq('model_slug', candidate.modelSlug || '')
        .maybeSingle();

      if (existing) {
        await supabase
          .from('linkgen_mapping_candidates')
          .update({
            occurrences: existing.occurrences + 1,
            last_seen_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('linkgen_mapping_candidates')
          .insert({
            marketplace,
            brand: candidate.brand,
            model: candidate.model,
            brand_id: candidate.brandId,
            model_slug: candidate.modelSlug,
            source_url: candidate.sourceUrl,
            occurrences: 1,
          });
      }
    } catch (error) {
      console.error('[LINKGEN_AUTO] Candidate insert error:', error);
    }
  }

  // Determine stop reason
  const stopReason = urlQueue.length === 0 ? 'queue_exhausted' : 'max_steps_reached';
  const finalStatus = 'completed';

  await supabase
    .from('linkgen_mapping_runs')
    .update({
      status: finalStatus,
      finished_at: new Date().toISOString(),
      steps_done: stepsDone,
      inserted_samples: insertedSamples,
      deduped_samples: dedupedSamples,
      skipped_diversity: skippedDiversity,
      errors_count: errorsCount,
      last_error: lastError,
      stop_reason: stopReason,
    })
    .eq('id', runId);

  console.log(`[LINKGEN_AUTO] ═══════════════════════════════════════════════════════════════`);
  console.log(`[LINKGEN_AUTO] Crawl completed: runId=${runId}`);
  console.log(`[LINKGEN_AUTO]   Stop reason: ${stopReason}`);
  console.log(`[LINKGEN_AUTO]   Mapping samples: ${stepsDone} (inserted: ${insertedSamples}, deduped: ${dedupedSamples})`);
  console.log(`[LINKGEN_AUTO]   List pages visited: ${listPagesVisited}`);
  console.log(`[LINKGEN_AUTO]   Listings with no data: ${listingsWithNoData}`);
  console.log(`[LINKGEN_AUTO]   Diversity filtered: ${skippedDiversity}`);
  console.log(`[LINKGEN_AUTO]   Errors: ${errorsCount}`);
  console.log(`[LINKGEN_AUTO]   URLs discovered: ${urlsDiscovered}`);
  console.log(`[LINKGEN_AUTO]   External URLs skipped: ${externalLinksSkipped}`);
  console.log(`[LINKGEN_AUTO]   Non-listing URLs skipped: ${nonListingLinksSkipped}`);
  console.log(`[LINKGEN_AUTO] ═══════════════════════════════════════════════════════════════`);
}

export async function getMappingStats(runId: string, supabase: SupabaseClient): Promise<any> {
  const { data: run, error: runError } = await supabase
    .from('linkgen_mapping_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runError || !run) {
    throw new Error('Run not found');
  }

  const { data: samples } = await supabase
    .from('linkgen_mapping_samples')
    .select('listing_url, brand, model, price_eur, year, mileage, step_index')
    .eq('run_id', runId)
    .order('step_index', { ascending: false })
    .limit(20);

  const { data: brandModelCounts } = await supabase
    .from('linkgen_mapping_samples')
    .select('brand, model')
    .eq('run_id', runId);

  const countsMap: Record<string, number> = {};
  if (brandModelCounts) {
    for (const item of brandModelCounts) {
      const key = `${item.brand || 'unknown'}:${item.model || 'unknown'}`;
      countsMap[key] = (countsMap[key] || 0) + 1;
    }
  }

  const topBrandModels = Object.entries(countsMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key, count]) => {
      const [brand, model] = key.split(':');
      return { brand, model, count };
    });

  const { data: candidates } = await supabase
    .from('linkgen_mapping_candidates')
    .select('*')
    .eq('marketplace', run.marketplace)
    .order('occurrences', { ascending: false })
    .limit(50);

  const { count: totalVisited } = await supabase
    .from('linkgen_mapping_samples')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', runId);

  return {
    run: {
      id: run.id,
      marketplace: run.marketplace,
      seedListingUrl: run.seed_listing_url,
      status: run.status,
      targetSteps: run.target_steps,
      stepsDone: run.steps_done,
      insertedSamples: run.inserted_samples,
      dedupedSamples: run.deduped_samples,
      skippedDiversity: run.skipped_diversity,
      errorsCount: run.errors_count,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      lastError: run.last_error,
    },
    lastSamples: samples || [],
    topBrandModels,
    mappingCandidates: candidates || [],
    totalVisited: totalVisited || 0,
  };
}
