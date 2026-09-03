import { fetchHtmlLite } from './fetchHtmlLite';
import { goldenBlocked } from './goldenGate';
import { generateHypotheses } from './correctionStrategies';
import { validateSite } from './siteValidators/index';
import { getSiteAdapter } from '../study-core/marketplaces';
import { supabase } from '../supabase';
import type {
  SiteKey,
  LinkGenParams,
  LinkGenUrlResult,
  LinkGenValidationResult,
  LinkGenRetryResult,
  LinkGenIssue,
  LinkGenLogEntry,
  ValidationStatus,
  LinkGenDiagnostics,
  MappingMemoryRecord,
  InferredMapping,
  ScoutHypothesis,
} from './types';
import type { SiteValidationResult } from './siteValidators/types';

// ─── listing count extraction ─────────────────────────────────────────────────

const COUNT_PATTERNS: Record<SiteKey, RegExp> = {
  MARKTPLAATS: /(\d[\d\s.]*)\s+advertentie/i,
  LEBONCOIN: /(\d[\d\s]*)\s+annonce/i,
  BILBASEN: /(\d[\d\s.]*)\s+resultat/i,
};

function parseCount(raw: string): number {
  return parseInt(raw.replace(/[^\d]/g, ''), 10) || 0;
}

function extractListingCount(
  html: string,
  site: SiteKey,
  sampleLength: number
): { count: number; method: 'regex' | 'dom' | 'fallback' } {
  const textOnly = html.replace(/<[^>]+>/g, ' ');
  const match = textOnly.match(COUNT_PATTERNS[site]);
  if (match) {
    const count = parseCount(match[1]);
    if (count > 0) return { count, method: 'regex' };
  }

  const domMatches = html.match(
    /<(article|li)[^>]*class="[^"]*(?:listing|Listing|result|Result|item|Item)[^"]*"/g
  );
  if (domMatches && domMatches.length > 0) {
    return { count: domMatches.length, method: 'dom' };
  }

  return { count: sampleLength, method: 'fallback' };
}


// ─── build LinkGenDiagnostics from SiteValidationResult ──────────────────────

function buildDiagnosticsFromSiteResult(
  siteResult: SiteValidationResult
): { diagnostics: LinkGenDiagnostics; extraIssues: LinkGenIssue[] } {
  let actualDomain = '';
  try { actualDomain = new URL(siteResult.url).hostname; } catch { /* empty */ }

  const expectedDomain = getSiteAdapter(siteResult.site).domain;
  const af = siteResult.appliedFilters;

  const diagnostics: LinkGenDiagnostics = {
    expectedDomain,
    actualDomain,
    brandApplied: af.brand,
    modelApplied: af.model,
    trimApplied: af.trim,
    fuelApplied: af.fuel,
    yearApplied: af.year,
    mileageApplied: af.mileage,
    sortApplied: af.sort,
    listingCount: siteResult.listingCount,
    sampleTitles: siteResult.sampleListings.slice(0, 5).map((l) => {
      const parts = [l.title.slice(0, 50)];
      if (l.year) parts.push(String(l.year));
      if (l.mileage) parts.push(`${Math.round(l.mileage / 1000)}k km`);
      if (l.fuel) parts.push(l.fuel);
      if (l.price > 0) parts.push(`€${l.price.toLocaleString('fr-FR')}`);
      return parts.join(' · ');
    }),
    parsedSampleListings: siteResult.sampleListings.slice(0, 5).map((l) => ({
      title: l.title,
      price: l.price,
      year: l.year,
      mileage: l.mileage,
      fuel: l.fuel,
    })),
    parserDetails: siteResult.parserDetails,
  };

  const extraIssues: LinkGenIssue[] = [];
  if (actualDomain && !actualDomain.includes(expectedDomain)) {
    extraIssues.push({ type: 'wrong_domain' });
  }
  if (siteResult.listingCount === 0) {
    extraIssues.push({ type: 'no_listings' });
  }

  return { diagnostics, extraIssues };
}

// ─── zyteKey check ────────────────────────────────────────────────────────────

function getZyteKey(): string {
  return (
    (import.meta.env.VITE_ZYTE_API_KEY as string | undefined) ||
    (import.meta.env.ZYTE_API_KEY as string | undefined) ||
    ''
  );
}

function isFetchBlocker(issues: LinkGenIssue[]): boolean {
  return issues.some((i) => i.type === 'no_zyte_key' || i.type === 'fetch_failed');
}

// ─── core validation (1 fetch) ───────────────────────────────────────────────

export async function validateGeneratedUrl(
  url: string,
  site: SiteKey,
  params: LinkGenParams
): Promise<LinkGenValidationResult> {
  const logs: LinkGenLogEntry[] = [];

  // [SCOUT_START] — always first, even if no Zyte key
  logs.push({
    level: 'SCOUT',
    message: '[SCOUT_START] Scout Check initiated',
    data: { url, site, brand: params.brand, model: params.model },
  });

  if (!getZyteKey()) {
    logs.push({
      level: 'WARNING',
      message: '[SCOUT_FETCH] skipped — no Zyte key configured',
      data: { hint: 'Set VITE_ZYTE_API_KEY in your .env to enable Scout Check' },
    });
    return {
      score: 0,
      isRelevant: false,
      issues: [{ type: 'no_zyte_key' }],
      detectedFilters: { brand: false, model: false, trim: false, fuel: false },
      listingCount: 0,
      listingCountMethod: 'fallback',
      validationStatus: 'not_checked',
      debugLogs: logs,
    };
  }

  logs.push({ level: 'SCOUT', message: '[SCOUT_FETCH] fetching real listings page', data: { url, site } });
  const html = await fetchHtmlLite(url);

  if (!html) {
    logs.push({
      level: 'SCOUT',
      message: '[SCOUT_FETCH] failed — no HTML returned (network error or blocked)',
      data: { url },
    });
    logs.push({ level: 'SCOUT', message: '[SCOUT_DONE] aborted — fetch failure', data: { url, score: 0, status: 'invalid' } });
    return {
      score: 0,
      isRelevant: false,
      issues: [{ type: 'fetch_failed' }],
      detectedFilters: { brand: false, model: false, trim: false, fuel: false },
      listingCount: 0,
      listingCountMethod: 'fallback',
      validationStatus: 'invalid',
      debugLogs: logs,
    };
  }

  const { count: listingCount, method: listingCountMethod } = extractListingCount(html, site, 0);

  logs.push({
    level: 'SCOUT',
    message: '[SCOUT_PARSE] parsing listings from HTML',
    data: { site, listingCount, htmlLength: html.length },
  });

  let siteResult: SiteValidationResult;
  try {
    siteResult = validateSite(site, html, url, params, listingCount);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push({ level: 'SCOUT', message: '[SCOUT_PARSE] parser threw an error', data: { error: msg } });
    logs.push({ level: 'SCOUT', message: '[SCOUT_DONE] aborted — parse error', data: { url, score: 0, status: 'invalid' } });
    return {
      score: 0,
      isRelevant: false,
      issues: [{ type: 'parse_error' }],
      detectedFilters: { brand: false, model: false, trim: false, fuel: false },
      listingCount,
      listingCountMethod,
      validationStatus: 'invalid',
      debugLogs: logs,
    };
  }

  if (!siteResult.evidence.structuredFieldsAvailable) {
    logs.push({
      level: 'SCOUT',
      message: '[SCOUT_PARSE] structured_fields_missing — scoring from title text only',
      data: {
        missingFields: siteResult.evidence.missingFields.join(', '),
        sampleCount: siteResult.sampleListings.length,
      },
    });
  } else {
    logs.push({
      level: 'SCOUT',
      message: '[SCOUT_PARSE] structured fields available',
      data: {
        fieldsUsed: siteResult.evidence.fieldsUsed.join(', '),
        sampleCount: siteResult.sampleListings.length,
      },
    });
  }

  logs.push({
    level: 'SCOUT',
    message: '[SCOUT_SCORE] scoring complete',
    data: {
      score: siteResult.score,
      status: siteResult.status,
      brand: siteResult.appliedFilters.brand,
      model: siteResult.appliedFilters.model,
      year: siteResult.appliedFilters.year,
      mileage: siteResult.appliedFilters.mileage,
      fuel: siteResult.appliedFilters.fuel,
      trim: siteResult.appliedFilters.trim,
      sampleCount: siteResult.sampleListings.length,
      issues: siteResult.issues.map((i) => i.type).join(', ') || 'none',
    },
  });

  const { diagnostics, extraIssues } = buildDiagnosticsFromSiteResult(siteResult);

  // Merge issues (dedup by type)
  const allIssues = [...siteResult.issues];
  const seen = new Set(allIssues.map((i) => i.type));
  for (const ei of extraIssues) {
    if (!seen.has(ei.type)) { allIssues.push(ei); seen.add(ei.type); }
  }

  // If no listings at all → override to invalid (empty market)
  const finalStatus = listingCount === 0 && siteResult.sampleListings.length === 0
    ? 'invalid'
    : siteResult.status;

  logs.push({
    level: 'SCOUT',
    message: '[SCOUT_DONE] validation complete',
    data: {
      url,
      score: siteResult.score,
      status: finalStatus,
      listingCount,
      issueCount: allIssues.length,
    },
  });

  return {
    score: siteResult.score,
    isRelevant: siteResult.score >= 80,
    issues: allIssues,
    detectedFilters: {
      brand: siteResult.appliedFilters.brand,
      model: siteResult.appliedFilters.model,
      trim: siteResult.appliedFilters.trim,
      fuel: siteResult.appliedFilters.fuel,
    },
    listingCount,
    listingCountMethod,
    validationStatus: finalStatus,
    diagnostics,
    debugLogs: logs,
  };
}

// ─── selectBestVerifiedUrl ────────────────────────────────────────────────────

interface BestUrlResult {
  originalUrl: string;
  bestUrl: string;
  scoreBefore: number;
  scoreAfter: number;
  statusBefore: ValidationStatus;
  statusAfter: ValidationStatus;
  correctionReason: string | undefined;
  testedHypotheses: ScoutHypothesis[];
}

function selectBestVerifiedUrl(
  originalUrl: string,
  originalScore: number,
  originalStatus: ValidationStatus,
  testedHypotheses: ScoutHypothesis[]
): BestUrlResult {
  let best = { url: originalUrl, score: originalScore, status: originalStatus, reason: undefined as string | undefined };

  for (const h of testedHypotheses) {
    if (h.score > best.score) {
      best = { url: h.url, score: h.score, status: h.status, reason: h.reason };
    } else if (h.score === best.score && h.url !== best.url) {
      // Prefer URL with more params (more specific)
      const bestParams = (best.url.match(/[?&=#|]/g) ?? []).length;
      const hParams = (h.url.match(/[?&=#|]/g) ?? []).length;
      if (hParams > bestParams) {
        best = { url: h.url, score: h.score, status: h.status, reason: h.reason };
      }
    }
  }

  console.log(`[SCOUT_BEST_URL] original=${originalScore} best=${best.score} url=${best.url}`);

  return {
    originalUrl,
    bestUrl: best.url,
    scoreBefore: originalScore,
    scoreAfter: best.score,
    statusBefore: originalStatus,
    statusAfter: best.status,
    correctionReason: best.reason,
    testedHypotheses,
  };
}

// ─── validateWithRetry — max 3 fetches ───────────────────────────────────────
// Fetch 1: original
// Fetch 2: hypothesis 1 (if original not valid)
// Fetch 3: hypothesis 2 (if hypothesis 1 not valid)
// Stop as soon as score >= 80

export async function validateWithRetry(
  result: LinkGenUrlResult,
  params: LinkGenParams
): Promise<LinkGenRetryResult & { updatedResult: LinkGenUrlResult }> {
  // ── Fetch 1: original ──
  const original = await validateGeneratedUrl(result.url, result.site, params);

  let updatedResult: LinkGenUrlResult = {
    ...result,
    validationStatus: original.validationStatus,
    validationScore: original.score,
    listingCount: original.listingCount,
    listingCountMethod: original.listingCountMethod,
    validationIssues: original.issues,
    diagnostics: original.diagnostics,
    debugLogs: [...result.debugLogs, ...original.debugLogs],
  };

  // If fetch was blocked (no Zyte key or network error), return early — no hypotheses
  if (isFetchBlocker(original.issues)) {
    return { original, updatedResult };
  }

  // Early exit if already valid
  if (original.score >= 80) {
    console.log(`[SCOUT_BEST_URL] original valid (score=${original.score}) — no hypothesis needed`);
    return { original, updatedResult };
  }

  // Generate up to 2 hypotheses (async: includes memory lookup for CSV pending)
  const hypotheses = await generateHypotheses(updatedResult, params);

  if (hypotheses.length === 0) {
    return { original, updatedResult };
  }

  const testedHypotheses: ScoutHypothesis[] = [];

  for (const hyp of hypotheses) {
    console.log(`[SCOUT_CORRECTION] testing hypothesis rank=${hyp.rankInBatch} reason="${hyp.reason}" url=${hyp.url}`);

    // ── Fetch 2 or 3 ──
    const hypResult = await validateGeneratedUrl(hyp.url, result.site, params);

    // If the hypothesis fetch was also blocked, stop hypothesis loop
    if (isFetchBlocker(hypResult.issues)) {
      break;
    }

    const tested: ScoutHypothesis = {
      ...hyp,
      score: hypResult.score,
      status: hypResult.validationStatus,
    };
    testedHypotheses.push(tested);

    // Promote a CSV pending hypothesis to valid if score >= 80
    if (
      hyp.reason === 'csv_pending_mapping_hypothesis' &&
      hyp.memoryRecordId &&
      hypResult.score >= 80 &&
      !(await goldenBlocked(String(result.site)))
    ) {
      const now = new Date().toISOString();
      console.log(`[SCOUT_PROMOTE] pending memory record ${hyp.memoryRecordId} → valid (score=${hypResult.score})`);
      supabase
        .from('linkgen_mapping_memory')
        .update({
          validation_status: 'valid',
          validated_url: hyp.url,
          scout_score: hypResult.score,
          confidence: Math.round(hypResult.score) / 100,
          tested_hypotheses: testedHypotheses as unknown as import('../database.types').Json,
          success_count: 1,
          last_checked_at: now,
          updated_at: now,
        })
        .eq('id', hyp.memoryRecordId)
        .then(({ error }) => {
          if (error) console.warn('[SCOUT_PROMOTE] DB update failed:', error.message);
        });
    } else if (
      hyp.reason === 'csv_pending_mapping_hypothesis' &&
      hyp.memoryRecordId &&
      hypResult.score >= 60
    ) {
      // partial — fetch succeeded, score insufficient for valid
      const now = new Date().toISOString();
      console.log(`[SCOUT_PROMOTE] pending memory record ${hyp.memoryRecordId} → partial (score=${hypResult.score})`);
      supabase
        .from('linkgen_mapping_memory')
        .update({
          validation_status: 'partial',
          scout_score: hypResult.score,
          issues: (hypResult.issues as unknown as import('../database.types').Json) ?? null,
          failure_count: 1,
          last_checked_at: now,
          updated_at: now,
        })
        .eq('id', hyp.memoryRecordId)
        .then(({ error }) => {
          if (error) console.warn('[SCOUT_PROMOTE] DB update failed:', error.message);
        });
    }
    // else: keep pending (fetch failed or score < 60 without clear reason)

    if (hypResult.score >= 80) {
      // This hypothesis is valid — stop early
      break;
    }
  }

  // Select best across original + hypotheses
  const best = selectBestVerifiedUrl(
    result.url,
    original.score,
    original.validationStatus,
    testedHypotheses
  );

  // Find the best hypothesis result (if best differs from original)
  const bestHyp = testedHypotheses.find((h) => h.url === best.bestUrl);

  // Carry trim_removed_for_broader_market issue to top level if best URL changed
  const trimRemovedIssue = best.bestUrl !== result.url &&
    !bestHyp?.reason?.includes('trim') &&
    params.trim
    ? [{ type: 'trim_removed_for_broader_market' as const }]
    : [];

  updatedResult = {
    ...updatedResult,
    testedHypotheses,
    correctedUrl: best.bestUrl !== result.url ? best.bestUrl : undefined,
    correctionReason: best.correctionReason,
    validationAfter: best.bestUrl !== result.url ? best.statusAfter : undefined,
    validationScoreAfter: best.bestUrl !== result.url ? best.scoreAfter : undefined,
    bestVerifiedUrl: best.bestUrl,
    bestVerifiedScore: best.scoreAfter,
    bestVerifiedStatus: best.statusAfter,
    validationIssues: [
      ...(updatedResult.validationIssues ?? []),
      ...trimRemovedIssue,
    ],
    debugLogs: [
      ...updatedResult.debugLogs,
      {
        level: 'SCOUT' as const,
        message: '[SCOUT_BEST_URL] best URL selected after hypothesis testing',
        data: {
          bestUrl: best.bestUrl,
          changedFromOriginal: best.bestUrl !== result.url,
          scoreBefore: best.scoreBefore,
          scoreAfter: best.scoreAfter,
          statusBefore: best.statusBefore,
          statusAfter: best.statusAfter,
          hypothesesTested: testedHypotheses.length,
        },
      },
    ],
  };

  return {
    original,
    corrected: bestHyp ? undefined : undefined,
    correctedUrl: best.bestUrl !== result.url ? best.bestUrl : undefined,
    correctionReason: best.correctionReason,
    updatedResult,
  };
}

export async function validateAllUrls(
  results: LinkGenUrlResult[],
  params: LinkGenParams
): Promise<LinkGenUrlResult[]> {
  return Promise.all(
    results.map(async (r) => {
      const { updatedResult } = await validateWithRetry(r, params);
      return updatedResult;
    })
  );
}

// ─── Scout validation of a learned mapping ───────────────────────────────────
// Max 1 Zyte fetch. No retry. No pagination.
// Only marks valid if score >= 80.
// Marks partial if 60-79.
// Never overwrites a better existing scout_score.
// Never marks invalid / increments failure_count if fetch was blocked (no Zyte key or network).

export async function validateLearnedMapping(
  record: MappingMemoryRecord
): Promise<{ success: boolean; validationStatus: string; score: number; fetchBlocked?: boolean }> {
  const site = record.site as SiteKey;
  const mapping = (record.validated_mapping ?? record.inferred_mapping) as InferredMapping | null;

  console.log(`[SCOUT_VALIDATE] Starting validation for ${site} ${record.brand} ${record.model}`);

  if (!mapping || !record.source_url) {
    console.warn('[SCOUT_VALIDATE] No mapping or source_url — skipping');
    return { success: false, validationStatus: 'invalid', score: 0 };
  }

  const params: LinkGenParams = {
    brand: record.brand,
    model: record.model,
    fuel: record.fuel || undefined,
    trim: record.trim || undefined,
    site,
  };

  const validationResult = await validateGeneratedUrl(record.source_url, site, params);
  const now = new Date().toISOString();

  console.log(`[SCOUT_VALIDATE] Result: status=${validationResult.validationStatus} score=${validationResult.score}`);

  // Guard: if fetch was blocked (no Zyte key or network failure) — do NOT write anything
  if (isFetchBlocker(validationResult.issues)) {
    console.log(`[SCOUT_VALIDATE] Fetch blocked — not writing to DB, keeping pending`);
    return { success: false, validationStatus: 'pending', score: 0, fetchBlocked: true };
  }

  // Never overwrite a better existing scout_score
  const existingScoutScore = record.scout_score ?? 0;
  if (validationResult.score < existingScoutScore) {
    console.log(`[SCOUT_VALIDATE] new score ${validationResult.score} < existing ${existingScoutScore} — not overwriting`);
    await supabase
      .from('linkgen_mapping_memory')
      .update({
        failure_count: (record.failure_count ?? 0) + 1,
        last_checked_at: now,
        updated_at: now,
      })
      .eq('id', record.id);
    return { success: false, validationStatus: validationResult.validationStatus, score: validationResult.score };
  }

  if (validationResult.score >= 80 && !(await goldenBlocked(String(record.site)))) {
    console.log(`[SCOUT_VALIDATE] score=${validationResult.score} >= 80 — promoting to valid`);
    await supabase
      .from('linkgen_mapping_memory')
      .update({
        validated_mapping: mapping as unknown as import('../database.types').Json,
        validated_url: record.source_url,
        scout_score: validationResult.score,
        confidence: Math.round(validationResult.score) / 100,
        validation_status: 'valid',
        issues: (validationResult.issues as unknown as import('../database.types').Json) ?? null,
        success_count: (record.success_count ?? 0) + 1,
        last_checked_at: now,
        updated_at: now,
      })
      .eq('id', record.id);

    return { success: true, validationStatus: 'valid', score: validationResult.score };
  }

  if (validationResult.score >= 60) {
    console.log(`[SCOUT_VALIDATE] score=${validationResult.score} 60-79 — marking partial`);
    await supabase
      .from('linkgen_mapping_memory')
      .update({
        scout_score: validationResult.score,
        validation_status: 'partial',
        issues: (validationResult.issues as unknown as import('../database.types').Json) ?? null,
        failure_count: (record.failure_count ?? 0) + 1,
        last_checked_at: now,
        updated_at: now,
      })
      .eq('id', record.id);

    return { success: false, validationStatus: 'partial', score: validationResult.score };
  }

  // Score < 60 — invalid
  console.log(`[SCOUT_VALIDATE] score=${validationResult.score} < 60 — marking invalid`);
  await supabase
    .from('linkgen_mapping_memory')
    .update({
      scout_score: validationResult.score,
      validation_status: 'invalid',
      issues: (validationResult.issues as unknown as import('../database.types').Json) ?? null,
      failure_count: (record.failure_count ?? 0) + 1,
      last_checked_at: now,
      updated_at: now,
    })
    .eq('id', record.id);

  return {
    success: false,
    validationStatus: 'invalid',
    score: validationResult.score,
  };
}
