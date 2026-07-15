/**
 * Shared, site-agnostic template substitution helpers.
 * Ported verbatim from the pre-refactor src/lib/linkgen/generator.ts —
 * behavior is unchanged, only the location moved so every adapter can
 * reuse the same implementation instead of duplicating it.
 */

import type { SearchCriteria } from './types';

/** Resolve yearFrom / yearTo from params (handles legacy `year` field). */
export function resolveYearRange(params: SearchCriteria): { yearFrom: string; yearTo: string } {
  if (params.year && !params.yearFrom && !params.yearTo) {
    const y = String(params.year);
    return { yearFrom: y, yearTo: y };
  }
  return {
    yearFrom: params.yearFrom ? String(params.yearFrom) : '',
    yearTo: params.yearTo ? String(params.yearTo) : '',
  };
}

/**
 * Replace {placeholder} tokens in a template with provided values.
 * Any placeholder whose value is empty/null/undefined is stripped,
 * along with its surrounding separator chars (& | ,).
 */
export function applyTemplate(template: string, vars: Record<string, string>): string {
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
