import { generateSearchUrl } from './generator';
import type {
  LinkGenUrlResult,
  LinkGenParams,
  LinkGenIssue,
  SiteKey,
  ScoutHypothesis,
  ValidationStatus,
} from './types';

export interface CorrectionSuggestion {
  canRetry: boolean;
  correctedParams?: LinkGenParams & { site: SiteKey };
  correctedUrl?: string;
  reason: string;
}

// ─── generateHypotheses ───────────────────────────────────────────────────────
// Returns at most 2 ordered hypotheses to try after the original fetch fails.
// Each hypothesis is generated via the existing generateSearchUrl() — no hardcoded URLs.

export function generateHypotheses(
  result: LinkGenUrlResult,
  params: LinkGenParams
): ScoutHypothesis[] {
  const issues = result.validationIssues ?? [];
  const issueTypes = new Set(issues.map((i: LinkGenIssue) => i.type));
  const site = result.site;
  const candidates: Array<{ url: string; reason: string }> = [];

  if (site === 'LEBONCOIN') {
    candidates.push(...leboncoinHypotheses(params, issueTypes));
  } else if (site === 'MARKTPLAATS') {
    candidates.push(...marktplaatsHypotheses(params, issueTypes));
  } else if (site === 'BILBASEN') {
    candidates.push(...bilbasenHypotheses(params, issueTypes));
  }

  // Deduplicate against original URL and cap at 2
  const original = result.url;
  return candidates
    .filter((c) => c.url !== original)
    .slice(0, 2)
    .map((c, i) => ({
      url: c.url,
      reason: c.reason,
      score: 0,           // filled in by validator after fetch
      status: 'not_checked' as ValidationStatus,
      rankInBatch: i + 1,
    }));
}

function tryGenerate(params: LinkGenParams & { site: SiteKey }): string | null {
  try {
    return generateSearchUrl(params).url;
  } catch {
    return null;
  }
}

// ─── LEBONCOIN ────────────────────────────────────────────────────────────────
// H1: if fuel suspect → drop fuel
// H2: if model not applied → drop trim (keep model+year+mileage)
//     else if trim not applied → drop trim
//     else → drop fuel + trim (widest fallback)

function leboncoinHypotheses(
  params: LinkGenParams,
  issueTypes: Set<string>
): Array<{ url: string; reason: string }> {
  const result: Array<{ url: string; reason: string }> = [];

  // H1
  if (issueTypes.has('fuel_mapping_suspect') && params.fuel) {
    const url = tryGenerate({ ...params, site: 'LEBONCOIN', fuel: undefined });
    if (url) result.push({ url, reason: 'LEBONCOIN H1: fuel filter removed (mapping suspect)' });
  } else if (issueTypes.has('model_not_applied')) {
    // Move brand+model into trim free-text if model not picked up
    const url = tryGenerate({
      ...params,
      site: 'LEBONCOIN',
      trim: params.trim ? `${params.model} ${params.trim}` : params.model,
    });
    if (url) result.push({ url, reason: 'LEBONCOIN H1: brand+model moved to text query (model param not applied)' });
  } else {
    // Generic H1: drop fuel if present
    if (params.fuel) {
      const url = tryGenerate({ ...params, site: 'LEBONCOIN', fuel: undefined });
      if (url) result.push({ url, reason: 'LEBONCOIN H1: fuel removed (generic fallback)' });
    }
  }

  // H2
  if (result.length < 2) {
    if (params.trim && (issueTypes.has('trim_not_applied') || issueTypes.has('model_not_applied'))) {
      const url = tryGenerate({ ...params, site: 'LEBONCOIN', trim: undefined, fuel: undefined });
      if (url) result.push({ url, reason: 'LEBONCOIN H2: trim + fuel removed, keeping model+year+mileage' });
    } else if (params.fuel || params.trim) {
      const url = tryGenerate({ ...params, site: 'LEBONCOIN', fuel: undefined, trim: undefined });
      if (url) result.push({ url, reason: 'LEBONCOIN H2: fuel + trim removed (widest fallback)' });
    }
  }

  return result;
}

// ─── MARKTPLAATS ──────────────────────────────────────────────────────────────
// H1: full query brand+model+trim (already the default; generate fresh)
// H2: brand+model only (drop trim)

function marktplaatsHypotheses(
  params: LinkGenParams,
  issueTypes: Set<string>
): Array<{ url: string; reason: string }> {
  const result: Array<{ url: string; reason: string }> = [];

  if (issueTypes.has('fuel_mapping_suspect') && params.fuel) {
    const url = tryGenerate({ ...params, site: 'MARKTPLAATS', fuel: undefined });
    if (url) result.push({ url, reason: 'MARKTPLAATS H1: fuel removed (mapping suspect)' });
  } else {
    const url = tryGenerate({ ...params, site: 'MARKTPLAATS' });
    if (url) result.push({ url, reason: 'MARKTPLAATS H1: regenerated full query brand+model+trim' });
  }

  if (result.length < 2 && params.trim) {
    const url = tryGenerate({ ...params, site: 'MARKTPLAATS', trim: undefined });
    if (url) result.push({ url, reason: 'MARKTPLAATS H2: trim removed from query, brand+model only' });
  }

  return result;
}

// ─── BILBASEN ─────────────────────────────────────────────────────────────────
// H1: if fuel suspect → drop fuel; else regenerate structured brand+model
// H2: brand+model only (drop fuel + trim)

function bilbasenHypotheses(
  params: LinkGenParams,
  issueTypes: Set<string>
): Array<{ url: string; reason: string }> {
  const result: Array<{ url: string; reason: string }> = [];

  if (issueTypes.has('fuel_mapping_suspect') && params.fuel) {
    const url = tryGenerate({ ...params, site: 'BILBASEN', fuel: undefined });
    if (url) result.push({ url, reason: 'BILBASEN H1: fuel removed (mapping suspect)' });
  } else {
    const url = tryGenerate({ ...params, site: 'BILBASEN' });
    if (url) result.push({ url, reason: 'BILBASEN H1: regenerated structured params brand+model' });
  }

  if (result.length < 2 && (params.fuel || params.trim)) {
    const url = tryGenerate({ ...params, site: 'BILBASEN', fuel: undefined, trim: undefined });
    if (url) result.push({ url, reason: 'BILBASEN H2: fuel + trim removed, brand+model only' });
  }

  return result;
}

// ─── Legacy adapter ───────────────────────────────────────────────────────────
// Kept so existing callers of suggestUrlCorrection don't break.
// Returns only the first hypothesis as a CorrectionSuggestion.

export function suggestUrlCorrection(
  result: LinkGenUrlResult,
  params: LinkGenParams
): CorrectionSuggestion {
  const hypotheses = generateHypotheses(result, params);
  if (hypotheses.length === 0) {
    return { canRetry: false, reason: 'no correction strategy available for the detected issues' };
  }
  const first = hypotheses[0];
  return {
    canRetry: true,
    correctedUrl: first.url,
    reason: first.reason,
  };
}
