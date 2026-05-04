import {
  fetchHtmlLite,
  parseLeboncoinSample,
  parseMarktplaasSample,
  parseBilbasenSample,
} from '../scraperClient';
import { normalizeForMatch } from './normalizer';
import type {
  SiteKey,
  LinkGenParams,
  LinkGenUrlResult,
  LinkGenValidationResult,
  LinkGenIssue,
  LinkGenLogEntry,
  ValidationStatus,
} from './types';

// ─── listing count extraction ────────────────────────────────────────────────

const COUNT_PATTERNS: Record<SiteKey, RegExp> = {
  MARKTPLAATS: /(\d[\d\s.]*)\s+advertentie/i,
  LEBONCOIN: /(\d[\d\s]*)\s+annonce/i,
  BILBASEN: /(\d[\d\s.]*)\s+resultat/i,
};

function parseCount(raw: string): number {
  // Remove non-digit chars except space, then parse
  return parseInt(raw.replace(/[^\d]/g, ''), 10) || 0;
}

function extractListingCount(
  html: string,
  site: SiteKey,
  sampleLength: number
): { count: number; method: 'regex' | 'dom' | 'fallback' } {
  // 1. Try site-specific regex on visible text
  const textOnly = html.replace(/<[^>]+>/g, ' ');
  const match = textOnly.match(COUNT_PATTERNS[site]);
  if (match) {
    const count = parseCount(match[1]);
    if (count > 0) return { count, method: 'regex' };
  }

  // 2. Try counting DOM listing blocks (article, li with class containing "listing" or "item")
  const domMatches = html.match(
    /<(article|li)[^>]*class="[^"]*(?:listing|Listing|result|Result|item|Item)[^"]*"/g
  );
  if (domMatches && domMatches.length > 0) {
    return { count: domMatches.length, method: 'dom' };
  }

  // 3. Fallback: sample length
  return { count: sampleLength, method: 'fallback' };
}

// ─── scoring ─────────────────────────────────────────────────────────────────

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
  if (trimHit && normTrim) score += 20;
  if (fuelHit && normFuel) score += 10;

  // If trim or fuel not provided, redistribute points so max is still meaningful
  // (brand+model always possible = 70 pts baseline)

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

// ─── public API ──────────────────────────────────────────────────────────────

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

  // Check Zyte key availability before fetching
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

  // Fetch HTML — 1 call, max 1 retry (handled inside fetchHtmlLite)
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

  // Parse sample listings using the correct site parser
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

  // Extract listing count
  const { count: listingCount, method: listingCountMethod } = extractListingCount(
    html,
    site,
    sample.length
  );

  if (listingCount === 0) {
    // We have a page but no detectable listings
    logs.push({
      level: 'VALIDATION',
      message: '[LINKGEN_VALIDATION] listingCount = 0',
      data: { listingCountMethod },
    });
  }

  // Score sample
  const { score, detectedFilters, issues } = scoreListings(sample, params);

  if (listingCount === 0 && !issues.find((i) => i.type === 'low_listing_count')) {
    issues.push({ type: 'low_listing_count' });
  }

  const validationStatus = listingCount === 0 && sample.length === 0
    ? 'partial'  // page loaded but nothing parseable — don't call it invalid
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
    debugLogs: logs,
  };
}

export async function validateAllUrls(
  results: LinkGenUrlResult[],
  params: LinkGenParams
): Promise<LinkGenUrlResult[]> {
  return Promise.all(
    results.map(async (r) => {
      const validation = await validateGeneratedUrl(r.url, r.site, params);
      return {
        ...r,
        validationStatus: validation.validationStatus,
        validationScore: validation.score,
        listingCount: validation.listingCount,
        listingCountMethod: validation.listingCountMethod,
        validationIssues: validation.issues,
        debugLogs: [...r.debugLogs, ...validation.debugLogs],
      };
    })
  );
}
