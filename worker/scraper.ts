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
import { generateInternalRef } from '../src/lib/internalRefGenerator';

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
async function fetchHtmlWithZyte(url: string, profileLevel: number): Promise<string | null> {
  if (!ZYTE_API_KEY) {
    console.error('[WORKER_SCRAPER] ZYTE_API_KEY not configured');
    return null;
  }

  const requestBody: any = {
    url,
    browserHtml: true,
  };

  if (profileLevel >= 2 && url.includes('marktplaats.nl')) {
    requestBody.geolocation = 'NL';
    requestBody.javascript = true;
  }

  if (profileLevel >= 3 && url.includes('marktplaats.nl')) {
    requestBody.actions = [{ action: 'waitForTimeout', timeout: 2.0 }];
  }

  // STEP 1 DIAGNOSTIC: Log fetch target for Marktplaats (search URLs only)
  if (url.includes('marktplaats.nl') && (url.includes('/l/auto-s/') || url.includes('/lrp/api/'))) {
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
      return null;
    }

    const data = await response.json() as { browserHtml?: string };

    // STEP 1 DIAGNOSTIC: Log response for Marktplaats (search URLs only)
    if (url.includes('marktplaats.nl') && (url.includes('/l/auto-s/') || url.includes('/lrp/api/'))) {
      const contentType = response.headers.get('content-type') || 'unknown';
      const raw = (data.browserHtml ?? '').trim();
      const preview = raw.substring(0, 80).replace(/\s+/g, ' ');

      const bodyKind =
        raw.startsWith('<') ? 'HTML' :
        raw.startsWith('{') || raw.startsWith('[') ? 'JSON' :
        raw ? 'UNKNOWN' : 'EMPTY';

      console.log(
        `[MARKTPLAATS_RUNTIME] status=${response.status} content_type=${contentType} body_kind=${bodyKind} preview="${preview}"`
      );
    }

    return data.browserHtml || null;
  } catch (error) {
    console.error('[WORKER_SCRAPER] Fetch error:', error);
    return null;
  }
}

/**
 * Scrape detail page for enriched listing data
 */
async function scrapeDetailPage(listingUrl: string): Promise<DetailPageData | null> {
  console.log(`[DETAIL_SCRAPE] Fetching listing detail ${listingUrl}`);

  const html = await fetchHtmlWithZyte(listingUrl, 1);

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
 * Scrape a marketplace URL and parse listings
 */
async function scrapeSearch(url: string, scrapeMode: 'fast' | 'full' | 'detailed'): Promise<{
  listings: ScrapedListing[];
  error?: string;
  errorReason?: string;
}> {
  // DIAGNOSTIC: Log routing decision for each marketplace
  const marketplace =
    url.includes('marktplaats.nl') ? 'MARKTPLAATS' :
    url.includes('leboncoin.fr') ? 'LEBONCOIN' :
    url.includes('bilbasen.dk') ? 'BILBASEN' :
    url.includes('gaspedaal.nl') ? 'GASPEDAAL' :
    'UNKNOWN';
  console.log(`[SCRAPE_ROUTE] marketplace=${marketplace} scrapeMode=${scrapeMode} url=${url.substring(0, 150)}`);

  const MAX_RETRIES = scrapeMode === 'fast' ? 1 : 3;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const profileLevel = attempt + 1;

    console.log(`[WORKER_SCRAPER] Fetching ${url} (attempt ${attempt + 1}/${MAX_RETRIES + 1}, profile ${profileLevel})`);

    const html = await fetchHtmlWithZyte(url, profileLevel);

    if (!html) {
      if (attempt === MAX_RETRIES) {
        return {
          listings: [],
          error: 'SCRAPER_FAILED',
          errorReason: 'Failed to fetch HTML after retries',
        };
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }

    // Parse using PURE parser (deterministic)
    const listings = coreParseSearchPage(html, url);

    // DIAGNOSTIC: Log parsing result for Marktplaats (search URLs only)
    if (url.includes('marktplaats.nl') && (url.includes('/l/auto-s/') || url.includes('/lrp/api/'))) {
      console.log(`[MARKTPLAATS_PARSED] count=${listings.length} attempt=${attempt + 1}`);
    }

    if (listings.length > 0) {
      console.log(`[WORKER_SCRAPER] ✅ Parsed ${listings.length} listings`);
      return { listings };
    }

    // Check for blocked content
    const blockedCheck = detectBlockedContent(html, false);
    if (blockedCheck.isBlocked) {
      console.warn(`[WORKER_SCRAPER] ⚠️  Blocked: ${blockedCheck.matchedKeyword}`);
      return {
        listings: [],
        error: 'TARGET_BLOCKED',
        errorReason: `Blocked: ${blockedCheck.matchedKeyword}`,
      };
    }

    // If no listings and not blocked, retry
    if (attempt < MAX_RETRIES) {
      console.log(`[WORKER_SCRAPER] No listings found, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  return {
    listings: [],
    error: 'NO_LISTINGS',
    errorReason: 'No listings found after retries',
  };
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

  const encoded = trim.toLowerCase();
  let newHash: string;

  if (hash.startsWith('q:')) {
    newHash = hash.replace(/^q:[^|]*/, `q:${encoded}`);
  } else {
    newHash = `q:${encoded}|` + hash;
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

  const trimTarget = study.trim_text_target?.trim() || study.trim_text?.trim() || undefined;
  const trimSource = study.trim_text_source?.trim() || study.trim_text?.trim() || undefined;

  let targetUrl = study.market_target_url;
  let sourceUrl = study.market_source_url;

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

  try {
    await updateHeartbeat(supabase, runId, scheduledJobId);

    // Scrape target market
    const targetResult = await scrapeSearch(targetUrl, scrapeMode);

    if (targetResult.error) {
      const { error: insertError } = await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: targetResult.errorReason || 'Unknown error',
      }]);

      if (insertError) {
        console.error(`[DATABASE_ERROR] Failed to insert NULL result for ${study.id}:`, insertError);
        throw new Error(`Database insert failed: ${insertError.message}`);
      }

      return {
        status: targetResult.error,
        nullCount: 1,
        opportunitiesCount: 0,
      };
    }

    await updateHeartbeat(supabase, runId, scheduledJobId);

    // Scrape source market
    const sourceResult = await scrapeSearch(sourceUrl, scrapeMode);

    if (sourceResult.error) {
      const { error: insertError } = await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: sourceResult.errorReason || 'Unknown error',
      }]);

      if (insertError) {
        console.error(`[DATABASE_ERROR] Failed to insert NULL result for ${study.id}:`, insertError);
        throw new Error(`Database insert failed: ${insertError.message}`);
      }

      return {
        status: sourceResult.error,
        nullCount: 1,
        opportunitiesCount: 0,
      };
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

    const filteredTarget = filterListingsByStudy(targetResult.listings, targetCriteria);
    const filteredSource = filterListingsByStudy(sourceResult.listings, sourceCriteria);

    if (filteredTarget.length === 0) {
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

      return {
        status: 'NULL',
        nullCount: 1,
        opportunitiesCount: 0,
      };
    }

    const targetStats = computeTargetMarketStats(filteredTarget);
    const opportunityResult = detectOpportunity(filteredTarget, filteredSource, threshold, 5);

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

    console.log(`[WORKER] Study ${study.id} result: ${status} (diff: ${opportunityResult.priceDifference.toFixed(0)}€)`);
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

    return {
      status,
      nullCount: status === 'NULL' ? 1 : 0,
      opportunitiesCount: status === 'OPPORTUNITIES' ? 1 : 0,
    };
  } catch (error: any) {
    console.error(`[WORKER] Error executing study ${study.id}:`, error);

    const { error: insertError } = await supabase.from('study_run_results').insert([{
      run_id: runId,
      study_id: study.id,
      status: 'NULL',
      target_market_price: null,
      best_source_price: null,
      price_difference: null,
      target_stats: null,
      target_error_reason: `Execution error: ${error.message}`,
    }]);

    if (insertError) {
      console.error(`[DATABASE_ERROR] Failed to insert error result for ${study.id}:`, insertError);
      throw new Error(`Database insert failed after execution error: ${insertError.message}`);
    }

    return {
      status: 'ERROR',
      nullCount: 1,
      opportunitiesCount: 0,
    };
  }
}
