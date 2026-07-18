import { getSiteAdapter } from '../study-core/marketplaces';
import { resolveYearRange } from '../study-core/marketplaces/urlTemplate';
import { sharedSupabase as supabase } from '../supabaseShared';
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

// ─── Learned secondary params (BACKLOG 2bis) ─────────────────────────────────
//
// A confirmed ingestion stores EVERY confirmed field↔param pair in
// fieldToParam (e.g. Bilbasen power → hpfrom), and opaque enum codes in
// linkgen_enum_mappings (e.g. Bilbasen fuel code '3' ↔ ELECTRIQUE). Re-inject
// them when regenerating a URL so a validated mapping is immediately reusable
// for any criterion — numeric fields carry the user's value, enum fields carry
// the learned site code (never guessed: no learned code → param untouched).

const LEARNED_ENUM_FIELDS = ['fuel', 'gearbox', 'color', 'vehicleType'] as const;

/**
 * A reused validated_url embeds the ORIGINAL ingestion's year/mileage values —
 * variables by design. Override them with the current request's values (or
 * remove them when the request doesn't filter), in the query string AND in a
 * Marktplaats-style `#key:value|…` hash.
 */
function overrideVariableParams(url: string, mapping: InferredMapping, params: LinkGenParams): string {
  const { yearFrom, yearTo } = resolveYearRange(params);
  const overrides: Array<[string | undefined, string]> = [
    [mapping.yearFromParam ?? mapping.fieldToParam?.year?.paramName, yearFrom],
    [mapping.yearToParam ?? mapping.fieldToParam?.yearTo?.paramName, yearTo],
    [mapping.mileageParam ?? mapping.fieldToParam?.mileage?.paramName, params.mileage ? String(params.mileage) : ''],
  ];
  try {
    const u = new URL(url);
    let hash = u.hash.replace(/^#/, '');
    const hashStyle = hash.includes(':'); // Marktplaats `#q:…|mileageTo:…`
    for (const [param, value] of overrides) {
      if (!param || param.startsWith('_path')) continue;
      if (hashStyle) {
        const parts = hash.split('|').filter((seg) => seg && !seg.startsWith(`${param}:`));
        if (value) parts.push(`${param}:${value}`);
        hash = parts.join('|');
      } else if (value) {
        u.searchParams.set(param, value);
      } else {
        u.searchParams.delete(param);
      }
    }
    u.hash = hash ? `#${hash}` : '';
    return u.toString();
  } catch {
    return url;
  }
}

function numericParamValue(field: string, params: LinkGenParams): string | undefined {
  const raw =
    field === 'power' ? params.minPower :
    field === 'doors' ? params.doors :
    field === 'seats' ? params.seats :
    undefined;
  const s = raw != null ? String(raw).trim() : '';
  return /^\d+$/.test(s) ? s : undefined;
}

async function applyLearnedSecondaryParams(
  url: string,
  site: SiteKey,
  mapping: InferredMapping,
  params: LinkGenParams,
  logs: LinkGenLogEntry[]
): Promise<string> {
  const fieldToParam = mapping.fieldToParam ?? {};
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }

  for (const [field, seg] of Object.entries(fieldToParam)) {
    if (!seg?.paramName || seg.paramName.startsWith('_path')) continue; // path/hash IDs: template's job
    if (parsed.hash.includes(`${seg.paramName}:`)) continue; // hash-param sites (Marktplaats)
    // minPower is a LOWER bound — never inject it into an upper-bound param
    // (powerto/hpto) a confirmed mapping may have attributed to 'power'.
    if (field === 'power' && /to$|max/i.test(seg.paramName)) continue;

    // Numeric criteria: transparent values, inject directly.
    const numeric = numericParamValue(field, params);
    if (numeric !== undefined) {
      parsed.searchParams.set(seg.paramName, numeric);
      logs.push({ level: 'MAPPING', message: `[MAPPING_MEMORY] Learned param ${seg.paramName}=${numeric} (${field})`, data: {} });
      continue;
    }

    // Enum criteria: only inject a HUMAN-CONFIRMED site code.
    if ((LEARNED_ENUM_FIELDS as readonly string[]).includes(field)) {
      const label = String((params as unknown as Record<string, unknown>)[field] ?? '').trim();
      if (!label) continue;
      const { data } = await supabase
        .from('linkgen_enum_mappings')
        .select('code')
        .eq('site', site)
        .eq('field', field)
        .ilike('label', label)
        .maybeSingle();
      if (data?.code) {
        parsed.searchParams.set(seg.paramName, data.code);
        logs.push({ level: 'MAPPING', message: `[MAPPING_MEMORY] Learned enum ${seg.paramName}=${data.code} (${field}=${label})`, data: {} });
      }
    }
  }
  return parsed.toString();
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

    // Look up validated mappings in memory — several rows can exist for the
    // same brand+model (fuel/trim variants); prefer the one matching the
    // requested fuel/trim, then the neutral (no fuel/trim) one.
    const { data: memoryRows } = await supabase
      .from('linkgen_mapping_memory')
      .select('*')
      .eq('site', site)
      .ilike('brand', params.brand ?? '')
      .ilike('model', params.model ?? '')
      .eq('validation_status', 'valid')
      .gte('confidence', 0.75)
      .order('confidence', { ascending: false })
      .limit(5);
    const wantFuel = (params.fuel ?? '').trim().toUpperCase();
    const wantTrim = (params.trim ?? '').trim().toUpperCase();
    const rowFuel = (r: Record<string, unknown>) => String(r.fuel ?? '').trim().toUpperCase();
    const rowTrim = (r: Record<string, unknown>) => String(r.trim ?? '').trim().toUpperCase();
    const candidates = (memoryRows ?? []) as unknown as Array<Record<string, unknown>>;
    const memoryRecord =
      candidates.find((r) => rowFuel(r) === wantFuel && rowTrim(r) === wantTrim) ??
      candidates.find((r) => rowFuel(r) === '' && rowTrim(r) === '') ??
      candidates[0] ?? null;

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

      // BEST source: the human-validated URL itself — it carries site-specific
      // path facets (Marktplaats model IDs) no template can rebuild. Usable
      // only when its fuel/trim scope matches the request; year/mileage are
      // variables and get overridden below.
      const recFuel = rowFuel(memoryRecord as Record<string, unknown>);
      const recTrim = rowTrim(memoryRecord as Record<string, unknown>);
      const validatedUrl = (record as unknown as { validated_url?: string | null }).validated_url ?? null;
      const scopeMatches = (recFuel === wantFuel || (recFuel === '' && wantFuel === '')) &&
        (recTrim === wantTrim || (recTrim === '' && wantTrim === ''));
      if (validatedUrl && scopeMatches && mapping) {
        let url = overrideVariableParams(validatedUrl, mapping, params);
        url = await applyLearnedSecondaryParams(url, site, mapping, params, logs);
        logs.push({
          level: 'OUTPUT',
          message: '[MAPPING_MEMORY] Reusing human-validated URL (variables overridden)',
          data: { url },
        });
        results.push({
          site,
          country: adapter.country,
          url,
          debugLogs: logs,
          warnings: [],
          validationStatus: 'not_checked',
          mappingSource: 'learned',
        });
        continue;
      }

      if (mapping) {
        const reconstructed = reconstructUrlFromMapping(mapping, detectedParams, params, site);

        if (reconstructed) {
          const finalUrl = await applyLearnedSecondaryParams(reconstructed, site, mapping, params, logs);
          logs.push({
            level: 'OUTPUT',
            message: '[MAPPING_MEMORY] URL reconstructed from learned mapping',
            data: { url: finalUrl },
          });

          results.push({
            site,
            country: adapter.country,
            url: finalUrl,
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

    // Even on template fallback, a memory record's learned secondary params
    // (power/doors/seats + enum codes) still apply on top of the template URL.
    let fallbackUrl = fallbackResult.url;
    if (memoryRecord) {
      const record = memoryRecord as unknown as MappingMemoryRecord;
      const mapping = (record.validated_mapping ?? record.inferred_mapping) as InferredMapping | null;
      if (mapping) fallbackUrl = await applyLearnedSecondaryParams(fallbackUrl, site, mapping, params, logs);
    }

    results.push({
      site,
      country: adapter.country,
      url: fallbackUrl,
      debugLogs: [...logs, ...fallbackResult.debugLogs],
      warnings: fallbackResult.debugLogs
        .filter((l) => l.level === 'WARNING')
        .map((l) => l.message),
      validationStatus: fallbackUrl.includes(adapter.domain)
        ? 'not_checked'
        : 'invalid',
      mappingSource: 'default_template',
    });
  }

  return results;
}
