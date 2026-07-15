import { getSiteAdapter } from '../study-core/marketplaces';
import { resolveYearRange } from '../study-core/marketplaces/urlTemplate';
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

export function generateSearchUrl(params: LinkGenParams & { site: SiteKey }): LinkGenResult {
  const logs: LinkGenLogEntry[] = [];
  const adapter = getSiteAdapter(params.site);
  const { yearFrom, yearTo } = resolveYearRange(params);

  logs.push({
    level: 'INPUT',
    message: '[LINKGEN_INPUT] Parameters received',
    data: { ...params } as Record<string, unknown>,
  });

  const mappedBrand = adapter.mapBrand(params.brand || '');
  const mappedModel = adapter.mapModel(params.model || '');
  const mappedFuel = params.fuel ? adapter.mapFuel(params.fuel) : null;

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

  const { url, warnings } = adapter.buildSearchUrl(params);

  for (const w of warnings) {
    logs.push({ level: 'WARNING', message: w, data: { minPower: params.minPower } });
  }

  // Guard: ensure generated URL belongs to the expected domain
  if (!url.includes(adapter.domain)) {
    logs.push({
      level: 'WARNING',
      message: `[LINKGEN_ROUTE_ERROR] Generated URL does not match expected domain`,
      data: { site: params.site, expectedDomain: adapter.domain, url },
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
    const adapter = getSiteAdapter(site);

    const warnings = result.debugLogs
      .filter((l) => l.level === 'WARNING')
      .map((l) => l.message);

    // Domain guard at the multi-site level
    const domainOk = result.url.includes(adapter.domain);

    return {
      site,
      country: adapter.country,
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
  _detectedParams: { queryParams: Record<string, string>; hashParams: Record<string, string> } | null,
  params: LinkGenParams,
  site: SiteKey
): string | null {
  if (!mapping.brandParam && !mapping.modelParam) return null;

  const adapter = getSiteAdapter(site);
  const { yearFrom, yearTo } = resolveYearRange(params);

  // Use the base URL template for the site and substitute values
  // via the learned param names
  const template = adapter.urlTemplate;
  if (!template) return null;

  // Build substitution from learned field→param mappings
  const subs: Record<string, string> = {};

  if (mapping.brandParam && params.brand) {
    subs[mapping.brandParam] = adapter.mapBrand(params.brand);
  }
  if (mapping.modelParam && params.model) {
    subs[mapping.modelParam] = adapter.mapModel(params.model);
  }
  if (mapping.yearFromParam && yearFrom) subs[mapping.yearFromParam] = yearFrom;
  if (mapping.yearToParam && yearTo) subs[mapping.yearToParam] = yearTo;
  if (mapping.mileageParam && params.mileage) subs[mapping.mileageParam] = String(params.mileage);
  if (mapping.fuelParam && params.fuel) {
    const mappedFuel = adapter.mapFuel(params.fuel);
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
    if (!baseUrl.hostname.includes(adapter.domain)) return null;

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
    if (!rebuilt.includes(adapter.domain)) return null;

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
    const adapter = getSiteAdapter(site);

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
            country: adapter.country,
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
      country: adapter.country,
      url: fallbackResult.url,
      debugLogs: [...logs, ...fallbackResult.debugLogs],
      warnings: fallbackResult.debugLogs
        .filter((l) => l.level === 'WARNING')
        .map((l) => l.message),
      validationStatus: fallbackResult.url.includes(adapter.domain)
        ? 'not_checked'
        : 'invalid',
      mappingSource: 'default_template',
    });
  }

  return results;
}
