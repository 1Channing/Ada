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
} from '../src/lib/study-core/index.js';

const ZYTE_API_KEY = process.env.ZYTE_API_KEY || '';
const ZYTE_ENDPOINT = 'https://api.zyte.com/v1/extract';

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

    const data = await response.json();
    return data.browserHtml || null;
  } catch (error) {
    console.error('[WORKER_SCRAPER] Fetch error:', error);
    return null;
  }
}

/**
 * Scrape a marketplace URL and parse listings
 */
async function scrapeSearch(url: string, scrapeMode: 'fast' | 'full'): Promise<{
  listings: ScrapedListing[];
  error?: string;
  errorReason?: string;
}> {
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
 */
function applyTrimMarktplaats(url: string, trim: string): string {
  if (url.includes('?')) {
    return `${url}&query=${encodeURIComponent(trim)}`;
  }
  return `${url}?query=${encodeURIComponent(trim)}`;
}

/**
 * Apply trim filter to Leboncoin URL
 */
function applyTrimLeboncoin(url: string, trim: string): string {
  if (url.includes('?')) {
    return `${url}&text=${encodeURIComponent(trim)}`;
  }
  return `${url}?text=${encodeURIComponent(trim)}`;
}

/**
 * Apply trim filter to Bilbasen URL
 */
function applyTrimBilbasen(url: string, trim: string): string {
  if (url.includes('?')) {
    return `${url}&includetext=${encodeURIComponent(trim)}`;
  }
  return `${url}?includetext=${encodeURIComponent(trim)}`;
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
  scrapeMode: 'fast' | 'full';
  supabase: SupabaseClient;
  scheduledJobId?: string;
}): Promise<{
  status: string;
  nullCount: number;
  opportunitiesCount: number;
}> {
  console.log(`[WORKER] Processing study ${study.id} in ${scrapeMode.toUpperCase()} mode`);

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
      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: targetResult.errorReason || 'Unknown error',
      }]);

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
      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        source_error_reason: sourceResult.errorReason || 'Unknown error',
      }]);

      return {
        status: sourceResult.error,
        nullCount: 1,
        opportunitiesCount: 0,
      };
    }

    // Apply unified business logic (PURE functions)
    const studyCriteria: StudyCriteria = {
      brand: study.brand,
      model: study.model,
      priceFloor: 2000,
    };

    const filteredTarget = filterListingsByStudy(targetResult.listings, studyCriteria);
    const filteredSource = filterListingsByStudy(sourceResult.listings, studyCriteria);

    if (filteredTarget.length === 0) {
      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: 'No listings after filtering',
      }]);

      return {
        status: 'NULL',
        nullCount: 1,
        opportunitiesCount: 0,
      };
    }

    const targetStats = computeTargetMarketStats(filteredTarget);
    const opportunityResult = detectOpportunity(filteredTarget, filteredSource, threshold, 5);

    const status = opportunityResult.hasOpportunity ? 'OPPORTUNITY' : 'NULL';

    await supabase.from('study_run_results').insert([{
      run_id: runId,
      study_id: study.id,
      status,
      target_market_price: targetStats.median,
      best_source_price: opportunityResult.bestSourcePrice,
      price_difference: opportunityResult.priceDifference,
      target_stats: {
        count: targetStats.count,
        median: targetStats.median,
        min: targetStats.min_price,
        max: targetStats.max_price,
      },
      interesting_listings: opportunityResult.interestingListings,
    }]);

    return {
      status,
      nullCount: status === 'NULL' ? 1 : 0,
      opportunitiesCount: status === 'OPPORTUNITY' ? 1 : 0,
    };
  } catch (error: any) {
    console.error(`[WORKER] Error executing study ${study.id}:`, error);

    await supabase.from('study_run_results').insert([{
      run_id: runId,
      study_id: study.id,
      status: 'NULL',
      target_market_price: null,
      best_source_price: null,
      price_difference: null,
      target_stats: null,
      target_error_reason: `Execution error: ${error.message}`,
    }]);

    return {
      status: 'ERROR',
      nullCount: 1,
      opportunitiesCount: 0,
    };
  }
}
