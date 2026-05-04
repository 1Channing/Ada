import { SEARCH_TEMPLATES } from './templates';
import { mapBrand, mapModel, mapFuel } from './mappings';
import type { LinkGenParams, LinkGenResult, LinkGenLogEntry } from './types';

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

  // Remove unfilled optional params from query string (&key={...} or |key:{...})
  result = result
    // Remove &param=... when the value is still a placeholder or empty
    .replace(/&[^=&|#]+={[^}]+}/g, '')
    // Remove |segment:{...} for Marktplaats unfilled segments
    .replace(/\|[^|#]+:\{[^}]+\}/g, '');

  return result;
}

export function generateSearchUrl(params: LinkGenParams): LinkGenResult {
  const logs: LinkGenLogEntry[] = [];

  logs.push({
    level: 'INPUT',
    message: '[LINKGEN_INPUT] Parameters received',
    data: { ...params } as Record<string, unknown>,
  });

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
    },
  });

  const template = SEARCH_TEMPLATES[params.site];

  let url: string;

  if (params.site === 'MARKTPLAATS') {
    const query = buildMarktplaatsQuery(mappedBrand, mappedModel, params.trim);

    const vars: Record<string, string> = { query };
    if (params.year) vars['year'] = String(params.year);
    if (params.mileage) vars['mileage'] = String(params.mileage);

    url = applyTemplate(template, vars);
  } else {
    // LEBONCOIN
    const vars: Record<string, string> = {
      brand: mappedBrand,
      model: mappedModel,
    };
    if (params.year) vars['year'] = String(params.year);
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
