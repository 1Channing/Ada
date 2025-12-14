import { supabase } from '../lib/supabase';
import {
  SCRAPER_SEARCH,
  SCRAPER_DETAIL,
  filterListingsByStudy,
  computeTargetMarketStats,
  toEur,
} from '../lib/scraperClient';
import { analyzeListingsBatch } from '../lib/aiAnalysis';
import type { StudyRunProgressEvent, StudyStage, StudyRunStatus } from '../store/studyRunsStore';
import { persistStudyRunLogsSafe } from './studyRunLogs';

/**
 * Applies trim/finition filter to Leboncoin URL.
 * Injects &text=<trim> parameter before &kst=k if present, or at the end.
 *
 * @example
 * applyTrimLeboncoin('...&kst=k', 'GR') → '...&text=GR&kst=k'
 */
function applyTrimLeboncoin(url: string, trim?: string): string {
  if (!trim) return url;
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
 * Applies trim/finition filter to Marktplaats URL.
 * Injects q:<trim>| prefix before existing hash filters.
 *
 * @example
 * applyTrimMarktplaats('...#f:10882|...', 'gr') → '...#q:gr|f:10882|...'
 */
function applyTrimMarktplaats(url: string, trim?: string): string {
  if (!trim) return url;
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
 * Applies trim/finition filter to Bilbasen URL.
 * Injects free=<trim> query parameter.
 *
 * @example
 * applyTrimBilbasen('...?includeengroscvr=true', 'gr') → '...?free=gr&includeengroscvr=true'
 */
function applyTrimBilbasen(url: string, trim?: string): string {
  if (!trim) return url;
  const encoded = encodeURIComponent(trim);

  if (url.includes('free=')) {
    return url.replace(/free=[^&]*/, `free=${encoded}`);
  }

  const hasQuery = url.includes('?');
  const sep = hasQuery ? '&' : '?';
  return url + `${sep}free=${encoded}`;
}

function isZyteWebsiteBan(error: unknown): boolean {
  if (!error) return false;

  const anyErr = error as any;
  const body = anyErr.responseBody || anyErr.body || anyErr.message || '';

  if (typeof body === 'string') {
    return (
      body.includes('/download/website-ban') ||
      body.toLowerCase().includes('website ban')
    );
  }

  return false;
}

export interface StudyV2 {
  id: string;
  brand: string;
  model: string;
  year: number;
  max_mileage: number;
  country_target: string;
  market_target_url: string;
  country_source: string;
  market_source_url: string;
  trim_text?: string | null;
  trim_text_target?: string | null;
  trim_text_source?: string | null;
}

export interface RunStudyParams {
  study: StudyV2;
  runId: string;
  threshold: number;
  scrapeMode?: 'fast' | 'full';
}

type ProgressCallback = (event: StudyRunProgressEvent) => void;

const runningStudyKeys = new Set<string>();

/**
 * Creates a deterministic key for duplicate detection based on study parameters.
 * This ensures the SAME STUDY (same brand, model, year, markets) can never run
 * twice in parallel, regardless of batch run ID or database ID.
 *
 * Key format: "BRAND_MODEL_YEAR_TARGET_SOURCE"
 * Example: "TOYOTA_YARISCROSS_2023_NL_FR"
 */
export function createStudyKey(study: StudyV2): string {
  return `${study.brand}_${study.model}_${study.year}_${study.country_target}_${study.country_source}`.toUpperCase();
}

function emitProgress(
  studyRunId: string,
  studyCode: string,
  stage: StudyStage,
  label: string,
  message: string,
  onProgress?: ProgressCallback,
  level?: 'info' | 'warning' | 'error',
) {
  const event: StudyRunProgressEvent = {
    id: studyRunId,
    studyCode,
    label,
    message,
    stage,
    timestamp: Date.now(),
    level,
  };

  if (onProgress) {
    onProgress(event);
  }
}

export async function runStudyInBackground(
  studyRunId: string,
  params: RunStudyParams,
  onProgress?: ProgressCallback,
  isRetry = false,
): Promise<{ status: 'NULL' | 'OPPORTUNITIES' | 'TARGET_BLOCKED' }> {
  const { study, runId, threshold, scrapeMode = 'full' } = params;
  const studyKey = createStudyKey(study);
  const studyCode = `${study.brand}_${study.model}_${study.year}_${study.country_source}_${study.country_target}`;

  let status: StudyRunStatus | undefined;
  let errorMessage: string | undefined;
  let lastStage: StudyStage | undefined;

  console.log(`[MODE] ${scrapeMode.toUpperCase()} mode selected for ${studyCode}`);

  if (runningStudyKeys.has(studyKey)) {
    console.warn('[STUDY_RUNNER] ⛔ DUPLICATE DETECTED: Study already running, skipping duplicate start:', studyKey);
    return { status: 'NULL' };
  }

  console.log(`[STUDY_RUNNER] 🔒 Locking study for execution:`, studyKey);
  runningStudyKeys.add(studyKey);

  const trimTarget =
    (study.trim_text_target !== null && study.trim_text_target !== undefined)
      ? (study.trim_text_target.trim() || undefined)
      : (study.trim_text?.trim() || undefined);

  const trimSource =
    (study.trim_text_source !== null && study.trim_text_source !== undefined)
      ? (study.trim_text_source.trim() || undefined)
      : (study.trim_text?.trim() || undefined);

  if (trimTarget) {
    console.log(`[STUDY_RUNNER] 🎯 Target trim applied: "${trimTarget}" for ${studyCode}`);
  }
  if (trimSource) {
    console.log(`[STUDY_RUNNER] 🎯 Source trim applied: "${trimSource}" for ${studyCode}`);
  }

  let targetUrl = study.market_target_url;
  let sourceUrl = study.market_source_url;

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
    console.log(`[RUN] Processing study: ${study.id}`);

    lastStage = 'scraping_target';
    emitProgress(
      studyRunId,
      studyCode,
      lastStage,
      'Scraping target market',
      `Fetching ${study.country_target} listings for ${studyCode}...`,
      onProgress,
    );
    const targetResult = await SCRAPER_SEARCH(targetUrl, scrapeMode);

    if (targetResult.error === 'SCRAPER_FAILED') {
      if (!isRetry) {
        console.warn('[STUDY_RUNNER] Zyte failed — retrying entire study once...');
        await new Promise(r => setTimeout(r, 1000));
        return await runStudyInBackground(studyRunId, params, onProgress, true);
      } else {
        console.error('[STUDY_RUNNER] Zyte failed on retry — marking as SCRAPER_ERROR');
        status = 'SCRAPER_ERROR';
        errorMessage = 'Zyte scraper failed after retry';

        lastStage = 'saving_results';
        emitProgress(
          studyRunId,
          studyCode,
          lastStage,
          'Scraper failed',
          'Zyte scraper unreachable after retry',
          onProgress,
          'error',
        );

        const { error } = await supabase
          .from('study_run_results')
          .insert([{
            run_id: runId,
            study_id: study.id,
            status: 'NULL',
            target_market_price: null,
            best_source_price: null,
            price_difference: null,
            target_stats: null,
            target_error_reason: 'Zyte scraper failed after retry',
          }]);

        if (error) throw error;

        emitProgress(
          studyRunId,
          studyCode,
          'done',
          'Completed',
          'Study completed (scraper error)',
          onProgress,
        );

        return { status: 'NULL' };
      }
    }

    if (targetResult.blockedByProvider) {
      console.error(`[RUN] Target market blocked by provider: ${targetResult.blockReason}`);

      status = 'TARGET_BLOCKED';
      errorMessage = targetResult.blockReason || 'Target market blocked by provider';

      lastStage = 'saving_results';
      emitProgress(
        studyRunId,
        studyCode,
        lastStage,
        'Saving blocked result',
        'Target market blocked by provider',
        onProgress,
        'error',
      );

      const { error } = await supabase
        .from('study_run_results')
        .insert([{
          run_id: runId,
          study_id: study.id,
          status: 'TARGET_BLOCKED',
          target_market_price: null,
          best_source_price: null,
          price_difference: null,
          target_stats: null,
          target_error_reason: targetResult.blockReason,
        }]);

      if (error) throw error;

      emitProgress(
        studyRunId,
        studyCode,
        'done',
        'Completed',
        'Study completed (target blocked)',
        onProgress,
      );

      return { status: 'TARGET_BLOCKED' };
    }

    const targetListings = targetResult.listings;
    const filteredTargetListings = filterListingsByStudy(targetListings, study);

    if (filteredTargetListings.length === 0) {
      console.log(`[RUN] No valid target listings found`);
      status = 'NO_TARGET_RESULTS';
      errorMessage = 'No valid target listings found';

      lastStage = 'saving_results';
      emitProgress(
        studyRunId,
        studyCode,
        lastStage,
        'No target results',
        errorMessage,
        onProgress,
        'warning',
      );

      return { status: 'NULL' };
    }

    lastStage = 'computing_target_stats';
    emitProgress(
      studyRunId,
      studyCode,
      lastStage,
      'Computing target stats',
      'Analyzing target market prices...',
      onProgress,
    );
    const targetStats = computeTargetMarketStats(filteredTargetListings);
    const targetMarketPriceEur = targetStats.median_price;

    console.log(`[RUN] Target market median price: ${targetMarketPriceEur.toFixed(0)} EUR`);

    lastStage = 'scraping_source';
    emitProgress(
      studyRunId,
      studyCode,
      lastStage,
      'Scraping source market',
      `Fetching ${study.country_source} listings for ${studyCode}...`,
      onProgress,
    );
    const sourceResult = await SCRAPER_SEARCH(sourceUrl, scrapeMode);

    if (sourceResult.error === 'SCRAPER_FAILED') {
      if (!isRetry) {
        console.warn('[STUDY_RUNNER] Zyte failed on source — retrying entire study once...');
        await new Promise(r => setTimeout(r, 1000));
        return await runStudyInBackground(studyRunId, params, onProgress, true);
      } else {
        console.error('[STUDY_RUNNER] Zyte failed on source retry — marking as SCRAPER_ERROR');
        status = 'SCRAPER_ERROR';
        errorMessage = 'Zyte scraper failed on source after retry';

        lastStage = 'saving_results';
        emitProgress(
          studyRunId,
          studyCode,
          lastStage,
          'Scraper failed',
          'Zyte scraper unreachable on source after retry',
          onProgress,
          'error',
        );

        const { error } = await supabase
          .from('study_run_results')
          .insert([{
            run_id: runId,
            study_id: study.id,
            status: 'NULL',
            target_market_price: targetMarketPriceEur,
            best_source_price: null,
            price_difference: null,
            target_stats: targetStats,
            target_error_reason: 'Zyte scraper failed on source after retry',
          }]);

        if (error) throw error;

        emitProgress(
          studyRunId,
          studyCode,
          'done',
          'Completed',
          'Study completed (scraper error on source)',
          onProgress,
        );

        return { status: 'NULL' };
      }
    }

    const sourceListings = sourceResult.listings;
    const filteredSourceListings = filterListingsByStudy(sourceListings, study);

    lastStage = 'evaluating_price';
    emitProgress(
      studyRunId,
      studyCode,
      lastStage,
      'Evaluating price difference',
      'Comparing source vs target prices...',
      onProgress,
    );

    if (filteredSourceListings.length === 0) {
      console.log(`[RUN] No valid source listings found`);

      status = 'NO_SOURCE_RESULTS';
      errorMessage = 'No valid source listings found';

      lastStage = 'saving_results';
      emitProgress(
        studyRunId,
        studyCode,
        lastStage,
        'Saving results',
        'No source listings found',
        onProgress,
        'warning',
      );

      console.log(`[RUN] 💾 Persisting NULL result for study ${studyCode} (no source listings found)`);

      const { error } = await supabase
        .from('study_run_results')
        .insert([{
          run_id: runId,
          study_id: study.id,
          status: 'NULL',
          target_market_price: targetMarketPriceEur,
          best_source_price: null,
          price_difference: null,
          target_stats: targetStats,
        }]);

      if (error) throw error;

      console.log(`[RUN] ✅ Successfully persisted NULL result for study ${studyCode}`);

      emitProgress(
        studyRunId,
        studyCode,
        'done',
        'Completed',
        'Study completed (no source listings)',
        onProgress,
      );

      return { status: 'NULL' };
    }

    const sourcePricesEur = filteredSourceListings
      .map(l => toEur(l.price, l.currency))
      .sort((a, b) => a - b);
    const bestSourcePriceEur = sourcePricesEur[0];
    const priceDifferenceEur = targetMarketPriceEur - bestSourcePriceEur;

    console.log(`[RUN] Best source price: ${bestSourcePriceEur.toFixed(0)} EUR, difference: ${priceDifferenceEur.toFixed(0)} EUR`);

    if (priceDifferenceEur < threshold) {
      console.log(`[RUN] Price difference ${priceDifferenceEur.toFixed(0)} EUR below ${threshold} EUR threshold → NULL result`);

      status = 'SUCCESS';

      lastStage = 'saving_results';
      emitProgress(
        studyRunId,
        studyCode,
        lastStage,
        'Saving results',
        `Price difference ${priceDifferenceEur.toFixed(0)}€ below threshold`,
        onProgress,
      );

      console.log(`[RUN] 💾 Persisting NULL result for study ${studyCode} (price diff ${priceDifferenceEur.toFixed(0)}€ below threshold)`);

      const { error } = await supabase
        .from('study_run_results')
        .insert([{
          run_id: runId,
          study_id: study.id,
          status: 'NULL',
          target_market_price: targetMarketPriceEur,
          best_source_price: bestSourcePriceEur,
          price_difference: priceDifferenceEur,
          target_stats: targetStats,
        }]);

      if (error) throw error;

      console.log(`[RUN] ✅ Successfully persisted NULL result for study ${studyCode}`);

      emitProgress(
        studyRunId,
        studyCode,
        'done',
        'Completed',
        'Study completed (below threshold)',
        onProgress,
      );

      return { status: 'NULL' };
    }

    console.log(`[OPPORTUNITY DETECTED] 💰 Price difference ${priceDifferenceEur.toFixed(0)} EUR >= ${threshold} EUR threshold for study ${study.id}`);
    console.log(`[OPPORTUNITY DETECTED] Target median: ${targetMarketPriceEur.toFixed(0)} EUR, Best source: ${bestSourcePriceEur.toFixed(0)} EUR`);

    const MAX_INTERESTING_LISTINGS = 5;
    const maxInterestingPriceEur = targetMarketPriceEur - threshold;

    const interestingListings = filteredSourceListings
      .filter(l => {
        const priceEur = toEur(l.price, l.currency);
        return priceEur <= maxInterestingPriceEur;
      })
      .sort((a, b) => toEur(a.price, a.currency) - toEur(b.price, b.currency))
      .slice(0, MAX_INTERESTING_LISTINGS);

    console.log(`[OPPORTUNITY DETECTED] Found ${interestingListings.length} interesting listings (below target median - ${threshold} EUR)`);
    console.log(`[OPPORTUNITY DETECTED] Fetching detailed information for listings...`);

    lastStage = 'fetching_details';
    emitProgress(
      studyRunId,
      studyCode,
      lastStage,
      'Fetching detailed listings',
      `Fetching details for ${interestingListings.length} listings...`,
      onProgress,
    );
    const detailedListings = await SCRAPER_DETAIL(interestingListings);

    console.log(`[OPPORTUNITY DETECTED] Running AI analysis on ${detailedListings.length} listings...`);
    lastStage = 'ai_analysis';
    emitProgress(
      studyRunId,
      studyCode,
      lastStage,
      'Running AI analysis',
      `Analyzing ${detailedListings.length} listings for defects...`,
      onProgress,
    );
    const analyzedListings = await analyzeListingsBatch(detailedListings);

    const nonDamagedIndices: number[] = [];
    let damagedCount = 0;

    analyzedListings.forEach((analyzed, index) => {
      if (analyzed.is_damaged) {
        damagedCount++;
      } else {
        nonDamagedIndices.push(index);
      }
    });

    console.log(`[AI_FILTER] Removed ${damagedCount} damaged listings from interesting results`);
    console.log(`[AI_FILTER] Final interesting listings count: ${nonDamagedIndices.length}`);

    lastStage = 'saving_results';
    emitProgress(
      studyRunId,
      studyCode,
      lastStage,
      'Saving results',
      `Storing ${nonDamagedIndices.length} opportunities...`,
      onProgress,
    );

    console.log(`[RUN] 💾 Persisting result for study ${studyCode} with ${nonDamagedIndices.length} opportunities to database...`);

    const { data: resultData, error: resultError } = await supabase
      .from('study_run_results')
      .insert([{
        run_id: runId,
        study_id: study.id,
        status: 'OPPORTUNITIES',
        target_market_price: targetMarketPriceEur,
        best_source_price: bestSourcePriceEur,
        price_difference: priceDifferenceEur,
        target_stats: {
          ...targetStats,
          targetMarketUrl: targetUrl,
          sourceMarketUrl: sourceUrl,
          targetMarketMedianEur: targetMarketPriceEur,
        },
      }])
      .select()
      .single();

    if (resultError) throw resultError;
    console.log(`[OPPORTUNITY DETECTED] ✅ Stored OPPORTUNITIES result with ID: ${resultData.id}`);
    console.log(`[RUN] ✅ Successfully persisted result for study ${studyCode} - now visible in Results UI`);

    const listingsToStore = nonDamagedIndices.map(index => {
      const listing = detailedListings[index];
      const analyzed = analyzedListings[index];
      const imageCount = (listing.car_image_urls || []).length;

      console.log(`[RUN] Saving listing with ${imageCount} car images for URL: ${listing.listing_url}`);

      return {
        run_result_id: resultData.id,
        listing_url: listing.listing_url,
        title: listing.title,
        price: listing.price,
        mileage: listing.mileage,
        year: listing.year,
        trim: listing.trim,
        is_damaged: analyzed.is_damaged,
        defects_summary: analyzed.defects_summary,
        maintenance_summary: analyzed.maintenance_summary,
        options_summary: analyzed.options_summary,
        entretien: analyzed.entretien || '',
        options: analyzed.options || [],
        full_description: listing.full_description,
        car_image_urls: listing.car_image_urls || [],
        status: 'NEW',
      };
    });

    if (listingsToStore.length > 0) {
      const { error: listingsError } = await supabase
        .from('study_source_listings')
        .insert(listingsToStore);

      if (listingsError) throw listingsError;

      const totalImages = listingsToStore.reduce((sum, l) => sum + (l.car_image_urls?.length || 0), 0);
      console.log(`[RUN] ✅ Stored ${listingsToStore.length} non-damaged source listings with ${totalImages} total images`);
    } else {
      console.log(`[RUN] No non-damaged listings to store`);
    }

    status = 'SUCCESS';

    emitProgress(
      studyRunId,
      studyCode,
      'done',
      'Completed',
      `Study completed with ${nonDamagedIndices.length} opportunities`,
      onProgress,
    );

    return { status: 'OPPORTUNITIES' };
  } catch (error) {
    console.error(`[STUDY_RUNNER] Error processing study ${study.id}:`, error);

    if (isZyteWebsiteBan(error)) {
      if (lastStage === 'scraping_source' || study.country_source === 'FR') {
        status = 'SOURCE_BLOCKED';
        errorMessage = 'Zyte website-ban error on source marketplace (Leboncoin)';
      } else if (lastStage === 'scraping_target' || study.country_target === 'NL') {
        status = 'TARGET_BLOCKED';
        errorMessage = 'Zyte website-ban error on target marketplace';
      } else {
        status = 'SCRAPER_ERROR';
        errorMessage = 'Zyte website-ban error';
      }
    } else if (!status) {
      status = 'SCRAPER_ERROR';
      errorMessage = (error as Error)?.message || 'Unknown scraper error';
    }

    emitProgress(
      studyRunId,
      studyCode,
      'error',
      'Error',
      errorMessage || `Error: ${(error as Error).message}`,
      onProgress,
      'error',
    );

    throw error;
  } finally {
    const finalStatus: StudyRunStatus = status ?? 'UNKNOWN_ERROR';

    await persistStudyRunLogsSafe(
      studyRunId,
      finalStatus,
      lastStage,
      errorMessage
    );

    console.log(`[STUDY_RUNNER] 🔓 Unlocking study:`, studyKey);
    runningStudyKeys.delete(studyKey);
  }
}
