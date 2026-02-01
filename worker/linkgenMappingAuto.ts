/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LINKGEN MAPPING AUTO - CRAWL MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Crawls marketplace listings to discover URL patterns and extract minimal data.
 * Implements diversity-driven sampling to avoid repetitive data.
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

function extractListingUrls(html: string, marketplace: string): string[] {
  const urls: string[] = [];

  if (marketplace === 'MARKTPLAATS') {
    const hrefPattern = /href=["'](\/(?:a|v)\/[^"']+)["']/gi;
    const matches = Array.from(html.matchAll(hrefPattern));

    for (const match of matches) {
      const href = match[1];
      if (href.includes('/a/') || href.includes('/v/')) {
        const fullUrl = href.startsWith('http') ? href : `https://www.marktplaats.nl${href}`;
        urls.push(fullUrl);
      }
    }
  }

  return [...new Set(urls)];
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
      console.log(`[LINKGEN_AUTO] Step ${stepsDone + 1}/${steps}: Fetching ${url.substring(0, 80)}...`);

      const html = await fetchHtmlWithZyte(url);

      if (!html) {
        throw new Error('Failed to fetch HTML');
      }

      const listings = marketplace === 'MARKTPLAATS' ? parseMarktplaatsListings(html, url) : [];

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

      const internalRef = generateInternalRef({ listing_url: url });

      if (visitedRefs.has(internalRef)) {
        dedupedSamples++;
        stepsDone++;
        continue;
      }

      visitedRefs.add(internalRef);

      const extracted = extractBrandModel(listing.title || '');
      const brand = extracted.brand;
      const model = extracted.model;

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
      } else {
        dedupedSamples++;
      }

      const mappingCandidate = extractMappingFromUrl(url, marketplace);
      if (mappingCandidate.brandId || mappingCandidate.modelSlug) {
        const candidateKey = `${marketplace}:${mappingCandidate.brand || ''}:${mappingCandidate.model || ''}:${mappingCandidate.brandId || ''}:${mappingCandidate.modelSlug || ''}`;
        mappingCandidatesMap.set(candidateKey, mappingCandidate);
      }

      const discoveredUrls = extractListingUrls(html, marketplace);

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
        if (currentCount >= 3 && diversityScore < 997) {
          skippedDiversity++;
          continue;
        }

        urlQueue.push({
          url: newUrl,
          discoveredFrom: url,
          score: diversityScore,
        });
      }

      stepsDone++;

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
      console.error(`[LINKGEN_AUTO] Error on step ${stepsDone + 1}:`, lastError);

      stepsDone++;

      await supabase
        .from('linkgen_mapping_runs')
        .update({
          errors_count: errorsCount,
          last_error: lastError,
          steps_done: stepsDone,
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

  const finalStatus = urlQueue.length === 0 && stepsDone < steps ? 'completed' : 'completed';

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
    })
    .eq('id', runId);

  console.log(`[LINKGEN_AUTO] Crawl completed: runId=${runId}, steps=${stepsDone}, samples=${insertedSamples}, errors=${errorsCount}`);
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
