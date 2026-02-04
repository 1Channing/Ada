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

      const listings = marketplace === 'MARKTPLAATS' ? parseMarktplaatsListings(html, url) : [];
      const pageType = detectPageType(url, html, listings, marketplace);

      console.log(`[LINKGEN_AUTO] Detected page type: ${pageType}`);

      // SECTION 3: Conditional Mapping Storage
      if (pageType === 'list') {
        // List pages: discovery only, no mapping, no stepsDone increment
        listPagesVisited++;
        console.log(`[LINKGEN_AUTO] List page detected - skipping mapping extraction`);

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
        // Listing pages: extract and conditionally store
        let listing = listings.length > 0 ? listings[0] : null;

        if (!listing) {
          listing = {
            title: 'Unknown',
            price: null,
            currency: 'EUR',
            mileage: null,
            year: null,
            trim: null,
            listing_url: url,
            description: '',
            price_type: 'one-off',
          };
        }

        const extracted = extractBrandModel(listing.title || '');
        const brand = extracted.brand;
        const model = extracted.model;

        // CRITICAL: Only store if there's extractable data
        const hasData = brand !== null || listing.year !== null || listing.mileage !== null || listing.price !== null;

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

        const priceEur = listing.price ? Math.round(listing.price) : null;

        const rawSnapshot = {
          title: listing.title || null,
          price: listing.price || null,
          year: listing.year || null,
          mileage: listing.mileage || null,
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
            year: listing.year,
            mileage: listing.mileage,
            price_eur: priceEur,
            currency: listing.currency || 'EUR',
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
