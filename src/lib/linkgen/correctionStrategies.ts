import { generateSearchUrl } from './generator';
import { getPendingMappingHypotheses } from './memoryHypotheses';
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

// ─── buildLeboncoinModelCandidates ────────────────────────────────────────────
// Returns candidate u_car_model values in priority order.
// 1. BRAND_MODEL (combined uppercase, e.g. TOYOTA_YARIS)
// 2. brand_model (combined lowercase)
// 3. MODEL only (already the default — included so caller can detect duplication)

export function buildLeboncoinModelCandidates(brand: string, model: string): string[] {
  const normBrand = brand.trim().toUpperCase().replace(/\s+/g, '_');
  const normModel = model.trim().toUpperCase().replace(/\s+/g, '_');
  const combined = `${normBrand}_${normModel}`;
  const combinedLower = combined.toLowerCase();
  const modelOnly = normModel;

  // Deduplicate (e.g. if brand was empty)
  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of [combined, combinedLower, modelOnly]) {
    if (!seen.has(c)) { seen.add(c); result.push(c); }
  }
  return result;
}

// ─── generateHypotheses ───────────────────────────────────────────────────────
// Returns at most 2 ordered hypotheses to try after the original fetch.
//
// Priority:
// 1. pending CSV memory hypothesis (if available)
// 2. site-specific structured fix
// 3. simplified fallback
//
// The function is async to allow the memory lookup.

export async function generateHypotheses(
  result: LinkGenUrlResult,
  params: LinkGenParams
): Promise<ScoutHypothesis[]> {
  const issues = result.validationIssues ?? [];
  const issueTypes = new Set(issues.map((i: LinkGenIssue) => i.type));
  const site = result.site;
  const original = result.url;

  // 1. CSV pending memory hypothesis — tested first, never used as final result
  const memoryHypotheses = await getPendingMappingHypotheses(params, site);
  const memoryUrls = new Set(memoryHypotheses.map((h) => h.url));

  // 2. Site-specific structured hypotheses
  let siteHypotheses: Array<{ url: string; reason: string }> = [];
  if (site === 'LEBONCOIN') {
    siteHypotheses = leboncoinHypotheses(params, issueTypes);
  } else if (site === 'MARKTPLAATS') {
    siteHypotheses = marktplaatsHypotheses(params, issueTypes);
  } else if (site === 'BILBASEN') {
    siteHypotheses = bilbasenHypotheses(params, issueTypes);
  }

  // Merge: memory first, then site-specific (deduplicated against original + memory)
  const candidates: ScoutHypothesis[] = [];

  for (const mh of memoryHypotheses) {
    if (mh.url !== original) candidates.push(mh);
  }

  for (const sh of siteHypotheses) {
    if (sh.url !== original && !memoryUrls.has(sh.url)) {
      candidates.push({
        url: sh.url,
        reason: sh.reason,
        score: 0,
        status: 'not_checked' as ValidationStatus,
        rankInBatch: candidates.length + 1,
      });
    }
  }

  // Cap at 2 and assign final ranks
  return candidates.slice(0, 2).map((c, i) => ({ ...c, rankInBatch: i + 1 }));
}

function tryGenerate(params: LinkGenParams & { site: SiteKey }): string | null {
  try {
    return generateSearchUrl(params).url;
  } catch {
    return null;
  }
}

// ─── LEBONCOIN ────────────────────────────────────────────────────────────────
// Priority:
// 1. BRAND_MODEL format (e.g. TOYOTA_YARIS) if model_not_applied or parser_failed_on_html
// 2. drop trim + fuel (widest fallback)

function leboncoinHypotheses(
  params: LinkGenParams,
  issueTypes: Set<string>
): Array<{ url: string; reason: string }> {
  const result: Array<{ url: string; reason: string }> = [];

  const modelNotApplied = issueTypes.has('model_not_applied') || issueTypes.has('parser_failed_on_html');

  // H1: try BRAND_MODEL combined format for the model parameter
  if (modelNotApplied || !issueTypes.has('fuel_mapping_suspect')) {
    const candidates = buildLeboncoinModelCandidates(params.brand ?? '', params.model ?? '');
    // The default URL uses MODEL only (index 2). Try index 0 (BRAND_MODEL) first.
    const brandModelCandidate = candidates[0]; // e.g. TOYOTA_YARIS
    if (brandModelCandidate) {
      const url = tryGenerate({
        ...params,
        site: 'LEBONCOIN',
        // Override model — inject brand_model candidate into trim as text fallback
        // Actually we need to pass the combined model into the u_car_model param.
        // The generator uses mapModel() internally, so we pass the raw candidate as model
        // and rely on the passthrough path in mappings.
        model: brandModelCandidate,
        fuel: modelNotApplied ? undefined : params.fuel, // drop fuel if model was main issue
      });
      if (url) {
        result.push({
          url,
          reason: `LEBONCOIN H1: model param changed to combined format ${brandModelCandidate}`,
        });
      }
    }
  }

  // H1-alt: if fuel was the issue, drop fuel
  if (result.length === 0 && issueTypes.has('fuel_mapping_suspect') && params.fuel) {
    const url = tryGenerate({ ...params, site: 'LEBONCOIN', fuel: undefined });
    if (url) result.push({ url, reason: 'LEBONCOIN H1: fuel filter removed (mapping suspect)' });
  }

  // H2: drop trim + fuel, keep model+year+mileage (widest structured search)
  if (result.length < 2 && (params.fuel || params.trim)) {
    const url = tryGenerate({ ...params, site: 'LEBONCOIN', fuel: undefined, trim: undefined });
    if (url) result.push({ url, reason: 'LEBONCOIN H2: fuel + trim removed (widest structured fallback)' });
  }

  return result;
}

// ─── MARKTPLAATS ──────────────────────────────────────────────────────────────
// H1: fuel suspect → drop fuel; else regenerate
// H2: brand+model without trim

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
    if (url) result.push({ url, reason: 'MARKTPLAATS H2: trim removed, brand+model only' });
  }

  return result;
}

// ─── BILBASEN ─────────────────────────────────────────────────────────────────
// H1: fuel suspect → drop fuel; else regenerate structured
// H2: brand+model only

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
// Kept for backward compatibility. Returns only the first hypothesis.
// Callers that need the full list should use generateHypotheses() directly.

export function suggestUrlCorrection(
  result: LinkGenUrlResult,
  params: LinkGenParams
): CorrectionSuggestion {
  // Sync fallback — no memory lookup, only site-specific strategies
  const issues = result.validationIssues ?? [];
  const issueTypes = new Set(issues.map((i: LinkGenIssue) => i.type));
  const site = result.site;
  const original = result.url;

  let candidates: Array<{ url: string; reason: string }> = [];
  if (site === 'LEBONCOIN') candidates = leboncoinHypotheses(params, issueTypes);
  else if (site === 'MARKTPLAATS') candidates = marktplaatsHypotheses(params, issueTypes);
  else if (site === 'BILBASEN') candidates = bilbasenHypotheses(params, issueTypes);

  const first = candidates.find((c) => c.url !== original);
  if (!first) return { canRetry: false, reason: 'no correction strategy available for the detected issues' };
  return { canRetry: true, correctedUrl: first.url, reason: first.reason };
}
