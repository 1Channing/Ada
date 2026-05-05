import { SEARCH_TEMPLATES, SITE_COUNTRIES, EXPECTED_DOMAINS } from './templates';
import { mapBrand, mapModel, mapFuel, isSupportedParam } from './mappings';
import { supabase } from '../supabase';
import type {
  LinkGenParams,
  LinkGenResult,
  LinkGenLogEntry,
  LinkGenUrlResult,
  MappingMemoryRecord,
  InferredMapping,
  SiteKey,
} from './types';

// Normalise a single token: lower-case, trim, collapse spaces to +
export function normalizeToken(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '+')
    .replace(/[^a-z0-9+\-]/g, '');
}

// Build the Marktplaats q= query: brand+model[+trim], no duplication, no empty segments
export function buildMarktplaatsQuery(
  brand: string,
  model: string,
  trim?: string
): string {
  const normBrand = normalizeToken(brand);
  const normModel = normalizeToken(model);

  const base = [normBrand, normModel].filter(Boolean).join('+');

  if (!trim || !trim.trim()) return base;

  const normTrim = normalizeToken(trim);
  if (!normTrim) return base;

  // Anti-duplication: check if trim tokens are already present in base
  const baseParts = base.split('+');
  const trimParts = normTrim.split('+');
  const alreadyPresent = trimParts.every((t) => baseParts.includes(t));

  if (alreadyPresent) return base;

  return `${base}+${normTrim}`;
}

// Replace {placeholder} tokens in a template with provided values.
// Any placeholder whose value is empty/null/undefined is stripped,
// along with its surrounding separator chars (& | ,).
function applyTemplate(template: string, vars: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{${key}}`;
    if (result.includes(placeholder)) {
      result = result.split(placeholder).join(value);
    }
  }

  // Remove unfilled optional params: &key={...} or &key=prefix-{...}
  result = result
    .replace(/&[^=&|#?]+=([^&|#?]*\{[^}]+\}[^&|#?]*)/g, '')
    // Remove |segment:{...} for Marktplaats unfilled segments
    .replace(/\|[^|#]+:\{[^}]+\}/g, '');

  return result;
}

// Resolve yearFrom / yearTo from params (handles legacy `year` field)
function resolveYearRange(params: LinkGenParams): { yearFrom: string; yearTo: string } {
  if (params.year && !params.yearFrom && !params.yearTo) {
    const y = String(params.year);
    return { yearFrom: y, yearTo: y };
  }
  return {
    yearFrom: params.yearFrom ? String(params.yearFrom) : '',
    yearTo: params.yearTo ? String(params.yearTo) : '',
  };
}

export function generateSearchUrl(params: LinkGenParams & { site: SiteKey }): LinkGenResult {
  const logs: LinkGenLogEntry[] = [];
  const { yearFrom, yearTo } = resolveYearRange(params);

  logs.push({
    level: 'INPUT',
    message: '[LINKGEN_INPUT] Parameters received',
    data: { ...params } as Record<string, unknown>,
  });

  // Warn on unsupported params
  if (params.minPower !== undefined && !isSupportedParam(params.site, 'minPower')) {
    logs.push({
      level: 'WARNING',
      message: `[LINKGEN_WARNING] minPower ignored for ${params.site} until mapping is implemented`,
      data: { minPower: params.minPower },
    });
  }

  // Apply mappings
  const mappedBrand = mapBrand(params.site, params.brand || '');
  const mappedModel = mapModel(params.site, params.model || '');
  const mappedFuel = params.fuel ? mapFuel(params.site, params.fuel) : null;

  logs.push({
    level: 'MAPPING',
    message: '[LINKGEN_MAPPING] Values after mapping',
    data: {
      brand: `${params.brand} → ${mappedBrand}`,
      model: `${params.model} → ${mappedModel}`,
      fuel: params.fuel ? `${params.fuel} → ${mappedFuel}` : '(not provided)',
      trim: params.trim || '(not provided)',
      yearFrom: yearFrom || '(not provided)',
      yearTo: yearTo || '(not provided)',
    },
  });

  const template = SEARCH_TEMPLATES[params.site];
  let url: string;

  if (params.site === 'MARKTPLAATS') {
    const query = buildMarktplaatsQuery(mappedBrand, mappedModel, params.trim);
    const vars: Record<string, string> = { query };
    if (yearFrom) vars['yearFrom'] = yearFrom;
    if (yearTo) vars['yearTo'] = yearTo;
    if (params.mileage) vars['mileage'] = String(params.mileage);
    url = applyTemplate(template, vars);

  } else if (params.site === 'BILBASEN') {
    const vars: Record<string, string> = {
      brand: mappedBrand,
      model: mappedModel,
    };
    if (yearFrom) vars['yearFrom'] = yearFrom;
    if (yearTo) vars['yearTo'] = yearTo;
    if (params.mileage) vars['mileage'] = String(params.mileage);
    // Only inject fuel if mapping produced a non-empty value (GPL maps to '' for Bilbasen)
    if (mappedFuel && mappedFuel.trim()) vars['fuel'] = mappedFuel;
    url = applyTemplate(template, vars);

  } else if (params.site === 'LEBONCOIN') {
    const vars: Record<string, string> = {
      brand: mappedBrand,
      model: mappedModel,
    };
    if (yearFrom) vars['yearFrom'] = yearFrom;
    if (yearTo) vars['yearTo'] = yearTo;
    if (params.mileage) vars['mileage'] = String(params.mileage);
    if (mappedFuel) vars['fuel'] = mappedFuel;
    if (params.trim && params.trim.trim()) vars['trim'] = params.trim.trim();
    url = applyTemplate(template, vars);

  } else {
    // Should never reach here — all SiteKey values are handled above
    const exhaustiveCheck: never = params.site;
    throw new Error(`[LINKGEN_ROUTE_ERROR] Unknown site: ${exhaustiveCheck}`);
  }

  // Guard: ensure generated URL belongs to the expected domain
  const expectedDomain = EXPECTED_DOMAINS[params.site];
  if (!url.includes(expectedDomain)) {
    logs.push({
      level: 'WARNING',
      message: `[LINKGEN_ROUTE_ERROR] Generated URL does not match expected domain`,
      data: { site: params.site, expectedDomain, url },
    });
  }

  logs.push({
    level: 'OUTPUT',
    message: '[LINKGEN_OUTPUT] URL generated',
    data: { url },
  });

  return { url, site: params.site, debugLogs: logs };
}

export function generateSearchUrls(params: LinkGenParams): LinkGenUrlResult[] {
  const sites = params.selectedSites ?? (params.site ? [params.site] : []);

  return sites.map((site) => {
    const singleParams = { ...params, site };
    const result = generateSearchUrl(singleParams);

    const warnings = result.debugLogs
      .filter((l) => l.level === 'WARNING')
      .map((l) => l.message);

    // Domain guard at the multi-site level
    const expectedDomain = EXPECTED_DOMAINS[site];
    const domainOk = result.url.includes(expectedDomain);

    return {
      site,
      country: SITE_COUNTRIES[site],
      url: result.url,
      debugLogs: result.debugLogs,
      warnings,
      validationStatus: domainOk ? ('not_checked' as const) : ('invalid' as const),
      ...(domainOk ? {} : {
        validationIssues: [{ type: 'wrong_domain' as const }],
      }),
    };
  });
}

// ─── Memory-first URL reconstruction ─────────────────────────────────────────

/**
 * Reconstruct a search URL from a validated InferredMapping record + current params.
 * Returns null if the mapping cannot produce a complete, valid URL.
 */
function reconstructUrlFromMapping(
  mapping: InferredMapping,
  detectedParams: { queryParams: Record<string, string>; hashParams: Record<string, string> } | null,
  params: LinkGenParams,
  site: SiteKey
): string | null {
  if (!mapping.brandParam && !mapping.modelParam) return null;

  const { yearFrom, yearTo } = (() => {
    if (params.year && !params.yearFrom && !params.yearTo) {
      const y = String(params.year);
      return { yearFrom: y, yearTo: y };
    }
    return {
      yearFrom: params.yearFrom ? String(params.yearFrom) : '',
      yearTo: params.yearTo ? String(params.yearTo) : '',
    };
  })();

  // Use the base URL template for the site and substitute values
  // via the learned param names
  const template = SEARCH_TEMPLATES[site];
  if (!template) return null;

  // Build substitution from learned field→param mappings
  const subs: Record<string, string> = {};

  if (mapping.brandParam && params.brand) {
    subs[mapping.brandParam] = mapBrand(site, params.brand);
  }
  if (mapping.modelParam && params.model) {
    subs[mapping.modelParam] = mapModel(site, params.model);
  }
  if (mapping.yearFromParam && yearFrom) subs[mapping.yearFromParam] = yearFrom;
  if (mapping.yearToParam && yearTo) subs[mapping.yearToParam] = yearTo;
  if (mapping.mileageParam && params.mileage) subs[mapping.mileageParam] = String(params.mileage);
  if (mapping.fuelParam && params.fuel) {
    const mappedFuel = mapFuel(site, params.fuel);
    if (mappedFuel) subs[mapping.fuelParam] = mappedFuel;
  }
  if (mapping.trimParam && params.trim) subs[mapping.trimParam] = params.trim.trim();

  // If we couldn't populate brand or model, don't use this mapping
  if (!subs[mapping.brandParam ?? ''] && !subs[mapping.modelParam ?? '']) return null;

  // Verify at least brand or model can be placed
  const hasBrand = mapping.brandParam && subs[mapping.brandParam];
  const hasModel = mapping.modelParam && subs[mapping.modelParam];
  if (!hasBrand && !hasModel) return null;

  // Reconstruct by replacing known param values in the template
  // Strategy: start from a base URL derived from detectedParams domain + path,
  // then layer the current substitutions on top.
  // The safest fallback is to use the standard template substitution.
  try {
    const baseUrl = new URL(template.split('?')[0].split('#')[0]);
    const expectedDomain = EXPECTED_DOMAINS[site];
    if (!baseUrl.hostname.includes(expectedDomain)) return null;

    // Use original template approach — replace placeholders with learned param names
    // by building the URL from scratch using the template
    let rebuilt = template;

    // Map template placeholders to learned param names, then to values
    const fieldToPlaceholder: Record<string, string> = {
      brand: '{brand}',
      model: '{model}',
      yearFrom: '{yearFrom}',
      yearTo: '{yearTo}',
      mileage: '{mileage}',
      fuel: '{fuel}',
      trim: '{trim}',
    };

    const fieldToValue: Record<string, string> = {
      brand: subs[mapping.brandParam ?? ''] ?? '',
      model: subs[mapping.modelParam ?? ''] ?? '',
      yearFrom: yearFrom,
      yearTo: yearTo,
      mileage: params.mileage ? String(params.mileage) : '',
      fuel: mapping.fuelParam && subs[mapping.fuelParam] ? subs[mapping.fuelParam] : '',
      trim: params.trim?.trim() ?? '',
    };

    for (const [field, placeholder] of Object.entries(fieldToPlaceholder)) {
      const value = fieldToValue[field] ?? '';
      if (value) {
        rebuilt = rebuilt.split(placeholder).join(value);
      }
    }

    // Strip unfilled placeholders
    rebuilt = rebuilt
      .replace(/&[^=&|#?]+=([^&|#?]*\{[^}]+\}[^&|#?]*)/g, '')
      .replace(/\|[^|#]+:\{[^}]+\}/g, '');

    // Final sanity check: URL must contain expected domain
    if (!rebuilt.includes(expectedDomain)) return null;

    return rebuilt;
  } catch {
    return null;
  }
}

/**
 * Memory-first async variant of generateSearchUrls.
 * For each site, looks up linkgen_mapping_memory for a validated mapping
 * (validation_status = 'valid', confidence >= 0.75).
 * Falls back to the standard template if no valid mapping found.
 *
 * The original generateSearchUrls() is NOT modified — it stays synchronous.
 */
export async function generateSearchUrlsWithMemory(
  params: LinkGenParams
): Promise<LinkGenUrlResult[]> {
  const sites = params.selectedSites ?? (params.site ? [params.site] : []);
  const results: LinkGenUrlResult[] = [];

  for (const site of sites) {
    const logs: LinkGenLogEntry[] = [];

    // Look up validated mapping in memory
    const { data: memoryRecord } = await supabase
      .from('linkgen_mapping_memory')
      .select('*')
      .eq('site', site)
      .ilike('brand', params.brand ?? '')
      .ilike('model', params.model ?? '')
      .eq('validation_status', 'valid')
      .gte('confidence', 0.75)
      .order('confidence', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (memoryRecord) {
      const record = memoryRecord as unknown as MappingMemoryRecord;
      const mapping = (record.validated_mapping ?? record.inferred_mapping) as InferredMapping | null;
      const detectedParams = record.detected_params as { queryParams: Record<string, string>; hashParams: Record<string, string> } | null;

      logs.push({
        level: 'INPUT',
        message: '[MAPPING_MEMORY] Found validated mapping',
        data: {
          site,
          confidence: String(record.confidence),
          validation_status: record.validation_status,
          source_url: record.source_url ?? '',
        },
      });

      if (mapping) {
        const reconstructed = reconstructUrlFromMapping(mapping, detectedParams, params, site);

        if (reconstructed) {
          logs.push({
            level: 'OUTPUT',
            message: '[MAPPING_MEMORY] URL reconstructed from learned mapping',
            data: { url: reconstructed },
          });

          results.push({
            site,
            country: SITE_COUNTRIES[site],
            url: reconstructed,
            debugLogs: logs,
            warnings: [],
            validationStatus: 'not_checked',
            mappingSource: 'learned',
          });
          continue;
        }

        logs.push({
          level: 'WARNING',
          message: '[MAPPING_MEMORY] Learned mapping could not reconstruct a complete URL — falling back to template',
          data: { site },
        });
      }
    } else {
      logs.push({
        level: 'INPUT',
        message: '[MAPPING_MEMORY] No validated mapping found — using default template',
        data: { site, brand: params.brand ?? '', model: params.model ?? '' },
      });
    }

    // Fallback to standard template
    const singleParams = { ...params, site };
    const fallbackResult = generateSearchUrl(singleParams);

    results.push({
      site,
      country: SITE_COUNTRIES[site],
      url: fallbackResult.url,
      debugLogs: [...logs, ...fallbackResult.debugLogs],
      warnings: fallbackResult.debugLogs
        .filter((l) => l.level === 'WARNING')
        .map((l) => l.message),
      validationStatus: fallbackResult.url.includes(EXPECTED_DOMAINS[site])
        ? 'not_checked'
        : 'invalid',
      mappingSource: 'default_template',
    });
  }

  return results;
}
