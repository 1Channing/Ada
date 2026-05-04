import { SEARCH_TEMPLATES, SITE_COUNTRIES } from './templates';
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

  // Remove unfilled optional params: &key={...} or ?key={...} or &key=min-{...}
  result = result
    .replace(/&[^=&|#?]+=[^&|#?]*\{[^}]+\}[^&|#?]*/g, '')
    .replace(/\?[^=&|#]+=[^&|#]*\{[^}]+\}[^&|#]*/g, (match) => {
      // If this was the first param (starts with ?), convert next & to ? if present
      return '';
    })
    // Remove |segment:{...} for Marktplaats unfilled segments
    .replace(/\|[^|#]+:\{[^}]+\}/g, '');

  // Clean up malformed ? (if first ? param was removed, fix the URL)
  result = result.replace(/\?&/, '?').replace(/\?$/, '');

  return result;
}

// Resolve yearFrom / yearTo from params (handles legacy `year` field)
function resolveYearRange(params: LinkGenParams): { yearFrom: string; yearTo: string } {
  // Legacy: if only `year` is provided, treat as both from and to
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
  } else {
    // LEBONCOIN
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

    return {
      site,
      country: SITE_COUNTRIES[site],
      url: result.url,
      debugLogs: result.debugLogs,
      warnings,
      validationStatus: 'not_checked' as const,
    };
  });
}
