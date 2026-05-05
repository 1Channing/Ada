import { generateSearchUrl } from './generator';
import type {
  LinkGenUrlResult,
  LinkGenParams,
  LinkGenIssue,
  SiteKey,
} from './types';

export interface CorrectionSuggestion {
  canRetry: boolean;
  correctedParams?: LinkGenParams & { site: SiteKey };
  correctedUrl?: string;
  reason: string;
}

/**
 * Given a validated URL result and the original params, suggest one correction.
 * Only the first applicable rule fires — no stacking.
 * Maximum 1 retry is expected by the caller.
 */
export function suggestUrlCorrection(
  result: LinkGenUrlResult,
  params: LinkGenParams
): CorrectionSuggestion {
  const issues = result.validationIssues ?? [];
  const issueTypes = issues.map((i: LinkGenIssue) => i.type);
  const site = result.site;

  // Rule 1 — wrong_domain: regenerate using the correct site template
  if (issueTypes.includes('wrong_domain')) {
    try {
      const correctedParams = { ...params, site };
      const generated = generateSearchUrl(correctedParams);
      return {
        canRetry: true,
        correctedParams,
        correctedUrl: generated.url,
        reason: 'regenerated with correct site template (domain was wrong)',
      };
    } catch {
      return { canRetry: false, reason: 'wrong_domain: regeneration failed' };
    }
  }

  // Rule 2 — fuel_mapping_suspect: retry without fuel filter
  if (issueTypes.includes('fuel_mapping_suspect') && params.fuel) {
    const correctedParams: LinkGenParams & { site: SiteKey } = {
      ...params,
      site,
      fuel: undefined,
    };
    try {
      const generated = generateSearchUrl(correctedParams);
      return {
        canRetry: true,
        correctedParams,
        correctedUrl: generated.url,
        reason: 'fuel filter removed — mapping suspect, retrying without fuel constraint',
      };
    } catch {
      return { canRetry: false, reason: 'fuel_mapping_suspect: regeneration failed' };
    }
  }

  // Rule 3 — model_not_applied: for sites where the model param is not recognized,
  // move brand+model into free-text query (only meaningful for Leboncoin/Bilbasen)
  if (issueTypes.includes('model_not_applied') && site !== 'MARKTPLAATS') {
    // For Leboncoin: inject model into text= param
    // For Bilbasen: model goes into the make+model URL but trim it back to raw value
    const correctedParams: LinkGenParams & { site: SiteKey } = {
      ...params,
      site,
      // Force raw brand+model as trim text so it ends up in the free-text query
      trim: params.trim
        ? `${params.model} ${params.trim}`
        : params.model,
    };
    try {
      const generated = generateSearchUrl(correctedParams);
      return {
        canRetry: true,
        correctedParams,
        correctedUrl: generated.url,
        reason: 'model moved into free-text query (site-specific model param not recognized)',
      };
    } catch {
      return { canRetry: false, reason: 'model_not_applied: regeneration failed' };
    }
  }

  // Rule 4 — trim_not_applied on Marktplaats: trim is already injected via buildMarktplaatsQuery
  // This is a false positive — the trim is present in the q= param, not as a separate filter
  if (issueTypes.includes('trim_not_applied') && site === 'MARKTPLAATS') {
    return {
      canRetry: false,
      reason: 'trim is injected via the Marktplaats q= query string — not a separate filter param',
    };
  }

  // Rule 5 — trim_not_applied on other sites: move trim to the most visible text position
  if (issueTypes.includes('trim_not_applied') && params.trim) {
    const correctedParams: LinkGenParams & { site: SiteKey } = { ...params, site };
    try {
      const generated = generateSearchUrl(correctedParams);
      return {
        canRetry: true,
        correctedParams,
        correctedUrl: generated.url,
        reason: 'trim re-applied with regeneration (template may have dropped it)',
      };
    } catch {
      return { canRetry: false, reason: 'trim_not_applied: regeneration failed' };
    }
  }

  // Rule 6 — sort_not_applied: sort params are now baked into templates, so this is informational
  if (issueTypes.includes('sort_not_applied')) {
    return {
      canRetry: false,
      reason: 'sort params are embedded in the template — check site-specific sort behavior',
    };
  }

  // No applicable correction rule
  return {
    canRetry: false,
    reason: 'no correction strategy available for the detected issues',
  };
}
