import { SEARCH_TEMPLATES, SITE_COUNTRIES, EXPECTED_DOMAINS } from './templates';
import { mapBrand, mapModel, mapFuel, isSupportedParam } from './mappings';
import type {
  LinkGenParams,
  LinkGenResult,
  LinkGenLogEntry,
  LinkGenUrlResult,
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
