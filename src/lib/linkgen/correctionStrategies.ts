import { getSiteAdapter } from '../study-core/marketplaces';
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

// ─── generateHypotheses ───────────────────────────────────────────────────────
// Returns at most 2 ordered hypotheses to try after the original fetch.
//
// Priority:
// 1. pending CSV memory hypothesis (if available)
// 2. site-specific structured fix (delegated to the site adapter)
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
  const siteHypotheses = getSiteAdapter(site).generateCorrectionHypotheses(params, issueTypes);

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

  const candidates = getSiteAdapter(site).generateCorrectionHypotheses(params, issueTypes);

  const first = candidates.find((c) => c.url !== original);
  if (!first) return { canRetry: false, reason: 'no correction strategy available for the detected issues' };
  return { canRetry: true, correctedUrl: first.url, reason: first.reason };
}
