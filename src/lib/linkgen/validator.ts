import {
  fetchHtmlLite,
  parseLeboncoinSample,
  parseMarktplaasSample,
  parseBilbasenSample,
} from '../scraperClient';
import { normalizeForMatch } from './normalizer';
import { generateSearchUrl } from './generator';
import { suggestUrlCorrection } from './correctionStrategies';
import { EXPECTED_DOMAINS } from './templates';
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
} from './types';

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

// ─── scoring ──────────────────────────────────────────────────────────────────

function scoreListings(
  sample: { title: string }[],
  params: LinkGenParams
): {
  score: number;
  detectedFilters: { brand: boolean; model: boolean; trim: boolean; fuel: boolean };
  issues: LinkGenIssue[];
} {
  const normBrand = normalizeForMatch(params.brand ?? '');
  const normModel = normalizeForMatch(params.model ?? '');
  const normTrim = params.trim ? normalizeForMatch(params.trim) : null;
  const normFuel = params.fuel ? normalizeForMatch(params.fuel) : null;

  let brandHit = false;
  let modelHit = false;
  let trimHit = false;
  let fuelHit = false;

  for (const listing of sample) {
    const normTitle = normalizeForMatch(listing.title);
    if (!brandHit && normBrand && normTitle.includes(normBrand)) brandHit = true;
    if (!modelHit && normModel && normTitle.includes(normModel)) modelHit = true;
    if (!trimHit && normTrim && normTitle.includes(normTrim)) trimHit = true;
    if (!fuelHit && normFuel && normTitle.includes(normFuel)) fuelHit = true;
  }

  let score = 0;
  if (brandHit) score += 40;
  if (modelHit) score += 30;
  if (normTrim && trimHit) score += 20;
  if (normFuel && fuelHit) score += 10;

  const issues: LinkGenIssue[] = [];
  if (!brandHit) issues.push({ type: 'brand_missing' });
  if (!modelHit) issues.push({ type: 'model_missing' });
  if (normFuel && !fuelHit) issues.push({ type: 'fuel_mismatch' });

  return {
    score,
    detectedFilters: { brand: brandHit, model: modelHit, trim: trimHit, fuel: fuelHit },
    issues,
  };
}

function statusFromScore(score: number): ValidationStatus {
  if (score >= 70) return 'valid';
  if (score >= 40) return 'partial';
  return 'invalid';
}

// ─── diagnostics builder ──────────────────────────────────────────────────────

function buildDiagnostics(
  url: string,
  site: SiteKey,
  params: LinkGenParams,
  detectedFilters: { brand: boolean; model: boolean; trim: boolean; fuel: boolean },
  listingCount: number,
  sample: { title: string }[]
): { diagnostics: LinkGenDiagnostics; extraIssues: LinkGenIssue[] } {
  let actualDomain = '';
  try {
    actualDomain = new URL(url).hostname;
  } catch {
    actualDomain = '';
  }
  const expectedDomain = EXPECTED_DOMAINS[site];

  const yearApplied =
    !!(params.yearFrom && url.includes(String(params.yearFrom))) ||
    !!(params.yearTo && url.includes(String(params.yearTo))) ||
    !!(params.year && url.includes(String(params.year)));

  const mileageApplied = !!(params.mileage && url.includes(String(params.mileage)));

  const sortApplied =
    url.includes('sort') ||
    url.includes('sortBy') ||
    url.includes('sortby') ||
    url.includes('sortOrder') ||
    url.includes('order=');

  // Fuel applied: check if the mapped fuel value appears in the URL
  const fuelApplied = params.fuel
    ? (() => {
        // Check for any numeric or text fuel indicator in the URL
        const urlLower = url.toLowerCase();
        return urlLower.includes('fuel=') || urlLower.includes('fueltype=');
      })()
    : true;

  const diagnostics: LinkGenDiagnostics = {
    expectedDomain,
    actualDomain,
    brandApplied: detectedFilters.brand,
    modelApplied: detectedFilters.model,
    trimApplied: detectedFilters.trim,
    fuelApplied: detectedFilters.fuel,
    yearApplied,
    mileageApplied,
    sortApplied,
    listingCount,
    sampleTitles: sample.slice(0, 5).map((l) => l.title.slice(0, 60)),
  };

  const extraIssues: LinkGenIssue[] = [];

  if (actualDomain && !actualDomain.includes(expectedDomain)) {
    extraIssues.push({ type: 'wrong_domain' });
  }
  if (!detectedFilters.model && sample.length > 0) {
    extraIssues.push({ type: 'model_not_applied' });
  }
  if (params.trim && !detectedFilters.trim && sample.length > 0) {
    extraIssues.push({ type: 'trim_not_applied' });
  }
  if (params.fuel && !fuelApplied) {
    extraIssues.push({ type: 'fuel_mapping_suspect' });
  }
  if (params.yearFrom && !yearApplied) {
    extraIssues.push({ type: 'year_filter_not_applied' });
  }
  if (params.mileage && !mileageApplied) {
    extraIssues.push({ type: 'mileage_filter_not_applied' });
  }
  if (!sortApplied) {
    extraIssues.push({ type: 'sort_not_applied' });
  }
  if (listingCount === 0) {
    extraIssues.push({ type: 'no_listings' });
  }

  return { diagnostics, extraIssues };
}

// ─── public API ───────────────────────────────────────────────────────────────

export async function validateGeneratedUrl(
  url: string,
  site: SiteKey,
  params: LinkGenParams
): Promise<LinkGenValidationResult> {
  const logs: LinkGenLogEntry[] = [];

  logs.push({
    level: 'VALIDATION',
    message: '[LINKGEN_VALIDATION] Starting Scout Check',
    data: { url, site },
  });

  const zyteKey =
    (import.meta.env.VITE_ZYTE_API_KEY as string | undefined) ||
    (import.meta.env.ZYTE_API_KEY as string | undefined) ||
    '';

  if (!zyteKey) {
    logs.push({
      level: 'WARNING',
      message: '[LINKGEN_VALIDATION] validation skipped (no Zyte key)',
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

  const html = await fetchHtmlLite(url);

  if (!html) {
    logs.push({
      level: 'VALIDATION',
      message: '[LINKGEN_VALIDATION] fetch failed or returned empty HTML',
      data: { url },
    });
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

  // Parse sample listings
  let sample: { title: string }[] = [];
  try {
    if (site === 'LEBONCOIN') {
      sample = parseLeboncoinSample(html, url, 5);
    } else if (site === 'MARKTPLAATS') {
      sample = parseMarktplaasSample(html, url, 5);
    } else if (site === 'BILBASEN') {
      sample = parseBilbasenSample(html, url, 5);
    }
  } catch {
    logs.push({
      level: 'VALIDATION',
      message: '[LINKGEN_VALIDATION] parser error — using fallback scoring',
    });
  }

  const { count: listingCount, method: listingCountMethod } = extractListingCount(
    html,
    site,
    sample.length
  );

  const { score, detectedFilters, issues } = scoreListings(sample, params);

  const { diagnostics, extraIssues } = buildDiagnostics(
    url,
    site,
    params,
    detectedFilters,
    listingCount,
    sample
  );

  // Merge issues, deduplicating by type
  const allIssueTypes = new Set(issues.map((i) => i.type));
  for (const ei of extraIssues) {
    if (!allIssueTypes.has(ei.type)) {
      issues.push(ei);
      allIssueTypes.add(ei.type);
    }
  }

  const validationStatus =
    listingCount === 0 && sample.length === 0
      ? 'partial'
      : statusFromScore(score);

  logs.push({
    level: 'VALIDATION',
    message: '[LINKGEN_VALIDATION] Scoring complete',
    data: {
      score,
      validationStatus,
      listingCount,
      listingCountMethod,
      brand: detectedFilters.brand,
      model: detectedFilters.model,
      trim: detectedFilters.trim,
      fuel: detectedFilters.fuel,
      issues: issues.map((i) => i.type).join(', ') || 'none',
    },
  });

  return {
    score,
    isRelevant: score >= 70,
    issues,
    detectedFilters,
    listingCount,
    listingCountMethod,
    validationStatus,
    diagnostics,
    debugLogs: logs,
  };
}

/**
 * Validate a URL, and if not valid, attempt one correction + re-validation.
 * Maximum 2 Zyte fetches per URL (1 original + 1 corrected).
 */
export async function validateWithRetry(
  result: LinkGenUrlResult,
  params: LinkGenParams
): Promise<LinkGenRetryResult & { updatedResult: LinkGenUrlResult }> {
  const original = await validateGeneratedUrl(result.url, result.site, params);

  // Merge original validation into the result
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

  if (original.validationStatus === 'valid') {
    return { original, updatedResult };
  }

  // Attempt correction
  const suggestion = suggestUrlCorrection(updatedResult, params);

  if (!suggestion.canRetry || !suggestion.correctedUrl) {
    return {
      original,
      updatedResult: {
        ...updatedResult,
        correctionReason: suggestion.reason,
      },
    };
  }

  // Generate corrected URL if not already done by the strategy
  const correctedUrl = suggestion.correctedUrl;
  const corrected = await validateGeneratedUrl(correctedUrl, result.site, params);

  updatedResult = {
    ...updatedResult,
    correctedUrl,
    correctionReason: suggestion.reason,
    validationAfter: corrected.validationStatus,
    validationScoreAfter: corrected.score,
  };

  return { original, corrected, correctedUrl, correctionReason: suggestion.reason, updatedResult };
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
