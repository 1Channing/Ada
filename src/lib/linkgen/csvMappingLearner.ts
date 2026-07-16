import { supabase } from '../supabase';
import { decomposeUrl } from '../study-core/marketplaces/urlDecompose';
import type {
  CsvLearnerRow,
  CsvAnalysisResult,
  CsvBatchResult,
  CsvImportDiagnostics,
  CsvRejection,
  InferredMapping,
} from './types';

// ─── ADA positional format ────────────────────────────────────────────────────

export const ADA_POSITIONAL_MAPPING: Record<number, string> = {
  0: 'study_id',
  1: 'brand',
  2: 'model',
  3: 'year',
  4: 'mileage',
  5: 'target_country',
  6: 'target_url',
  7: 'source_country',
  8: 'source_url',
};

// Header words that indicate a headered CSV (any normalised header matching one of these → headered mode)
const KNOWN_HEADER_WORDS = new Set([
  'brand', 'model', 'url', 'site', 'source_search_url', 'source_url',
  'target_url', 'target_search_url', 'marketplace', 'marque', 'search_url',
  'link', 'liens', 'lien', 'country', 'pays', 'make', 'fuel', 'carburant',
]);

// ─── CSV parser helpers ───────────────────────────────────────────────────────

function detectSeparator(firstLine: string): ',' | ';' {
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

function parseCSVLine(line: string, sep: ',' | ';'): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// ─── String normalisation ─────────────────────────────────────────────────────

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeHeader(h: string): string {
  return stripAccents(h.toLowerCase().trim().replace(/\s+/g, '_'));
}

// ─── CSV mode detection ───────────────────────────────────────────────────────

function detectCsvMode(firstLineFields: string[]): 'headered' | 'headerless_ada' {
  for (const field of firstLineFields) {
    const norm = normalizeHeader(field);
    if (KNOWN_HEADER_WORDS.has(norm)) {
      return 'headered';
    }
  }
  console.log('[CSV_LEARNER] ADA headerless CSV detected — switching to positional mapping');
  return 'headerless_ada';
}

// ─── Main CSV parser ──────────────────────────────────────────────────────────

export interface ParseCSVResult {
  rows: Record<string, string>[];
  separator: ',' | ';';
  headers: string[];
  rawRowCount: number;
  csvMode: 'headered' | 'headerless_ada';
}

export function parseCSV(raw: string): ParseCSVResult {
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { rows: [], separator: ',', headers: [], rawRowCount: 0, csvMode: 'headered' };
  }

  const sep = detectSeparator(lines[0]);
  const firstLineFields = parseCSVLine(lines[0], sep);
  const csvMode = detectCsvMode(firstLineFields);

  if (csvMode === 'headerless_ada') {
    // All lines are data — first line is NOT a header
    const headers = Object.values(ADA_POSITIONAL_MAPPING);
    const rows: Record<string, string>[] = [];

    for (const line of lines) {
      const values = parseCSVLine(line, sep);
      if (values.every((v) => v === '')) continue;
      const row: Record<string, string> = {};
      Object.entries(ADA_POSITIONAL_MAPPING).forEach(([idxStr, fieldName]) => {
        const idx = Number(idxStr);
        row[fieldName] = (values[idx] ?? '').trim();
      });
      rows.push(row);
    }

    return { rows, separator: sep, headers, rawRowCount: lines.length, csvMode: 'headerless_ada' };
  }

  // Headered mode: first line is header
  const rawHeaders = firstLineFields;
  const headers = rawHeaders.map((h) => h.toLowerCase().trim());

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], sep);
    if (values.every((v) => v === '')) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? '').trim();
    });
    rows.push(row);
  }

  return { rows, separator: sep, headers, rawRowCount: lines.length - 1, csvMode: 'headered' };
}

// ─── Site detection ───────────────────────────────────────────────────────────

function inferSiteFromUrl(url: string): { site: string; warning?: string } {
  if (!url) return { site: 'UNKNOWN', warning: 'unknown_site: empty URL' };
  try {
    const domain = new URL(url).hostname.toLowerCase();
    if (domain.includes('leboncoin')) return { site: 'LEBONCOIN' };
    if (domain.includes('marktplaats')) return { site: 'MARKTPLAATS' };
    if (domain.includes('bilbasen')) return { site: 'BILBASEN' };
    return { site: 'UNKNOWN', warning: `unknown_site: unrecognised domain "${domain}"` };
  } catch {
    return { site: 'UNKNOWN', warning: `unknown_site: invalid URL "${url.slice(0, 60)}"` };
  }
}

// ─── Column aliases (headered mode) ──────────────────────────────────────────

type CsvFieldKey = keyof CsvLearnerRow | 'source_url_alt' | 'target_url_alt';

const COLUMN_ALIASES: Record<string, CsvFieldKey> = {
  // url (main — source direction)
  url: 'url',
  search_url: 'url',
  source_search_url: 'url',
  source_url: 'url',
  link: 'url',
  liens: 'url',
  lien: 'url',
  // target url
  target_search_url: 'target_url_alt',
  target_url: 'target_url_alt',
  // site
  site: 'site',
  marketplace: 'site',
  source_marketplace: 'site',
  target_marketplace: 'site',
  market: 'site',
  // country
  country: 'country',
  source_country: 'country',
  target_country: 'country',
  pays: 'country',
  // brand
  brand: 'brand',
  marque: 'brand',
  make: 'brand',
  // model
  model: 'model',
  modele: 'model',
  modeles: 'model',
  model_pattern: 'model',
  // year
  year: 'year',
  annee: 'year',
  regdate: 'year',
  year_from: 'year',
  year_min: 'year',
  yearfrom: 'year',
  // mileage
  mileage: 'mileage',
  kilometrage: 'mileage',
  max_mileage: 'mileage',
  mileage_max: 'mileage',
  km_max: 'mileage',
  // fuel
  fuel: 'fuel',
  carburant: 'fuel',
  energie: 'fuel',
  // trim
  trim: 'trim',
  finition: 'trim',
  version: 'trim',
};

function rowPreview(raw: Record<string, string>): string {
  return Object.entries(raw)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v.slice(0, 20)}`)
    .join(' | ');
}

// ─── normalizeCsvRows ─────────────────────────────────────────────────────────

export interface NormalizeBatchResult {
  rows: CsvLearnerRow[];
  rejections: CsvRejection[];
  targetUrlCount: number;
  sourceUrlCount: number;
}

export function normalizeCsvRows(
  rawRows: Record<string, string>[],
  csvMode: 'headered' | 'headerless_ada' = 'headered'
): NormalizeBatchResult {
  if (csvMode === 'headerless_ada') {
    return normalizeAdaRows(rawRows);
  }
  return normalizeHeaderedRows(rawRows);
}

function normalizeAdaRows(rawRows: Record<string, string>[]): NormalizeBatchResult {
  const rows: CsvLearnerRow[] = [];
  const rejections: CsvRejection[] = [];
  let targetUrlCount = 0;
  let sourceUrlCount = 0;

  rawRows.forEach((raw, idx) => {
    const rowNum = idx + 1; // No header offset in ADA mode — row 1 is the first data line

    if (Object.values(raw).every((v) => !v)) {
      rejections.push({ rowIndex: rowNum, reason: 'empty_row', preview: '' });
      return;
    }

    const brand = raw['brand'] ?? '';
    const model = raw['model'] ?? '';
    const year = raw['year'] || undefined;
    const mileage = raw['mileage'] || undefined;
    const targetCountry = raw['target_country'] ?? '';
    const targetUrl = raw['target_url'] ?? '';
    const sourceCountry = raw['source_country'] ?? '';
    const sourceUrl = raw['source_url'] ?? '';

    const hasIdentifier = brand.length > 0 || model.length > 0;

    if (!targetUrl && !sourceUrl) {
      rejections.push({ rowIndex: rowNum, reason: 'missing_url', preview: rowPreview(raw) });
      return;
    }

    const warnings: string[] = [];

    if (targetUrl) {
      const { site, warning } = inferSiteFromUrl(targetUrl);
      if (warning) warnings.push(warning);
      if (hasIdentifier || targetUrl) {
        targetUrlCount++;
        rows.push({
          site,
          country: targetCountry,
          brand,
          model,
          year,
          mileage,
          url: targetUrl,
        });
      }
    }

    if (sourceUrl) {
      const { site, warning } = inferSiteFromUrl(sourceUrl);
      if (warning) warnings.push(warning);
      if (hasIdentifier || sourceUrl) {
        sourceUrlCount++;
        rows.push({
          site,
          country: sourceCountry,
          brand,
          model,
          year,
          mileage,
          url: sourceUrl,
        });
      }
    }

    if (warnings.length > 0) {
      console.warn(`[CSV_LEARNER] row ${rowNum}:`, warnings.join('; '));
    }
  });

  return { rows, rejections, targetUrlCount, sourceUrlCount };
}

function normalizeHeaderedRows(rawRows: Record<string, string>[]): NormalizeBatchResult {
  const rows: CsvLearnerRow[] = [];
  const rejections: CsvRejection[] = [];
  let targetUrlCount = 0;
  let sourceUrlCount = 0;

  rawRows.forEach((raw, idx) => {
    const rowNum = idx + 2; // +2 because row 1 is the header

    if (Object.values(raw).every((v) => !v)) {
      rejections.push({ rowIndex: rowNum, reason: 'empty_row', preview: '' });
      return;
    }

    const mapped: Partial<Record<CsvFieldKey, string>> = {};

    for (const [rawKey, value] of Object.entries(raw)) {
      if (!value) continue;
      const normKey = normalizeHeader(rawKey);
      const canonical = COLUMN_ALIASES[normKey];
      if (canonical && !(canonical in mapped)) {
        mapped[canonical] = value;
      }
    }

    // Fallback: any column containing "url" that wasn't resolved as target
    if (!mapped.url) {
      for (const [rawKey, value] of Object.entries(raw)) {
        if (value && rawKey.toLowerCase().includes('url') && COLUMN_ALIASES[normalizeHeader(rawKey)] !== 'target_url_alt') {
          mapped.url = value;
          break;
        }
      }
    }

    if (!mapped.url) {
      rejections.push({ rowIndex: rowNum, reason: 'missing_url', preview: rowPreview(raw) });
      return;
    }

    if (!mapped.brand && !mapped.model) {
      rejections.push({ rowIndex: rowNum, reason: 'missing_brand_and_model', preview: rowPreview(raw) });
      return;
    }

    // Infer site
    if (!mapped.site) {
      const { site } = inferSiteFromUrl(mapped.url as string);
      mapped.site = site;
    } else {
      mapped.site = (mapped.site as string).toUpperCase().trim();
    }

    const baseRow: CsvLearnerRow = {
      site: (mapped.site as string),
      country: (mapped.country as string) ?? '',
      brand: (mapped.brand as string) ?? '',
      model: (mapped.model as string) ?? '',
      year: mapped.year as string | undefined,
      mileage: mapped.mileage as string | undefined,
      fuel: mapped.fuel as string | undefined,
      trim: mapped.trim as string | undefined,
      url: mapped.url as string,
    };

    sourceUrlCount++;
    rows.push(baseRow);

    if (mapped.target_url_alt) {
      const { site } = inferSiteFromUrl(mapped.target_url_alt as string);
      targetUrlCount++;
      rows.push({
        ...baseRow,
        site,
        url: mapped.target_url_alt as string,
      });
    }
  });

  return { rows, rejections, targetUrlCount, sourceUrlCount };
}

// ─── URL decomposition ────────────────────────────────────────────────────────
// decomposeUrl moved to study-core/marketplaces/urlDecompose.ts (shared with
// the Ingestion pipeline) — imported above, same implementation.

// ─── Field matching ───────────────────────────────────────────────────────────

function normalize(s: string): string {
  return stripAccents(s).toLowerCase().replace(/[-_\s+]/g, '').replace(/[^a-z0-9]/g, '');
}

function valueContains(paramValue: string, fieldValue: string): boolean {
  if (!fieldValue || !paramValue) return false;
  const normParam = normalize(paramValue);
  const normField = normalize(fieldValue);
  return normField.length >= 2 && normParam.includes(normField);
}

interface MatchResult {
  paramName: string;
  rawValue: string;
  source: 'query' | 'hash' | 'path';
}

function findParamForField(
  params: Record<string, string>,
  fieldValue: string,
  source: 'query' | 'hash'
): MatchResult | null {
  for (const [k, v] of Object.entries(params)) {
    if (valueContains(v, fieldValue)) {
      return { paramName: k, rawValue: v, source };
    }
  }
  return null;
}

function findParamInPath(segments: string[], fieldValue: string): MatchResult | null {
  for (const seg of segments) {
    if (valueContains(seg, fieldValue)) {
      return { paramName: '_path', rawValue: seg, source: 'path' };
    }
  }
  return null;
}

// ─── Core URL analysis ────────────────────────────────────────────────────────

export function analyzeCsvUrl(row: CsvLearnerRow): CsvAnalysisResult {
  const warnings: string[] = [];
  const paramToField: Record<string, string> = {};
  const fieldToParam: Record<string, { paramName: string; rawValue: string }> = {};

  if (!row.brand && !row.model) {
    warnings.push('[CSV_LEARNER] brand and model both empty — structural analysis only, confidence will be 0');
  }

  const detectedParams = decomposeUrl(row.url);

  if (!detectedParams) {
    return {
      site: row.site,
      country: row.country,
      brand: row.brand,
      model: row.model,
      fuel: row.fuel ?? '',
      trim: row.trim ?? '',
      sourceUrl: row.url,
      detectedParams: { rawUrl: row.url, domain: '', queryParams: {}, hashParams: {}, pathSegments: [] },
      inferredMapping: { paramToField: {}, fieldToParam: {} },
      confidence: 0,
      warnings: [...warnings, `[URL_ANALYSIS] Cannot parse URL: ${row.url}`],
    };
  }

  console.log(`[CSV_LEARNER] Analyzing URL: ${row.url}`, { brand: row.brand, model: row.model });

  const allQueryAndHash = { ...detectedParams.queryParams, ...detectedParams.hashParams };

  const fieldsToMatch: Array<{ field: string; value: string; weight: number }> = [
    { field: 'brand', value: row.brand, weight: 2 },
    { field: 'model', value: row.model, weight: 2 },
    { field: 'year', value: row.year ?? '', weight: 1 },
    { field: 'mileage', value: row.mileage ?? '', weight: 1 },
    { field: 'fuel', value: row.fuel ?? '', weight: 1 },
    { field: 'trim', value: row.trim ?? '', weight: 0.5 },
  ].filter((f) => f.value.length > 0);

  let totalWeight = 0;
  let matchedWeight = 0;

  for (const { field, value, weight } of fieldsToMatch) {
    totalWeight += weight;

    const match =
      findParamForField(detectedParams.queryParams, value, 'query') ??
      findParamForField(detectedParams.hashParams, value, 'hash') ??
      findParamInPath(detectedParams.pathSegments, value);

    if (match) {
      matchedWeight += weight;
      fieldToParam[field] = { paramName: match.paramName, rawValue: match.rawValue };
      if (match.paramName !== '_path') paramToField[match.paramName] = field;
      console.log(`[URL_ANALYSIS] ${field} → ${match.paramName}=${match.rawValue}`);
    } else {
      warnings.push(`[URL_ANALYSIS] Expected field "${field}" (value: "${value}") not found in URL params`);
    }
  }

  // Detect sort param
  const sortParamName =
    Object.keys(allQueryAndHash).find(
      (k) => k.toLowerCase().includes('sort') || k.toLowerCase().includes('order')
    );

  // Detect year range params
  let yearFromParam: string | undefined;
  let yearToParam: string | undefined;
  if (row.year) {
    for (const [k, v] of Object.entries(allQueryAndHash)) {
      const kl = k.toLowerCase();
      if (v === row.year || v.startsWith(row.year)) {
        if (kl.includes('from') || kl.includes('min') || kl.includes('debut') || kl.includes('start')) {
          yearFromParam = k;
        } else if (kl.includes('to') || kl.includes('max') || kl.includes('fin') || kl.includes('end')) {
          yearToParam = k;
        } else if (!yearFromParam) {
          yearFromParam = k;
        }
      }
      if (kl.includes('yearfrom') || kl === 'constructionyearfrom') yearFromParam = k;
      if (kl.includes('yearto') || kl === 'constructionyearto') yearToParam = k;
    }
  }

  // Warn about unrecognised params
  for (const k of Object.keys(allQueryAndHash)) {
    if (!(k in paramToField) && k !== sortParamName) {
      warnings.push(`[URL_ANALYSIS] Unrecognised param: "${k}" = "${allQueryAndHash[k]}"`);
    }
  }

  const confidence = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) / 100 : 0;

  const inferredMapping: InferredMapping = {
    brandParam: fieldToParam['brand']?.paramName,
    modelParam: fieldToParam['model']?.paramName,
    yearFromParam,
    yearToParam,
    mileageParam: fieldToParam['mileage']?.paramName,
    fuelParam: fieldToParam['fuel']?.paramName,
    trimParam: fieldToParam['trim']?.paramName,
    sortParam: sortParamName,
    paramToField,
    fieldToParam,
  };

  console.log(`[CSV_LEARNER] Analysis complete`, { confidence, warnings: warnings.length });

  return {
    site: row.site,
    country: row.country,
    brand: row.brand,
    model: row.model,
    fuel: row.fuel ?? '',
    trim: row.trim ?? '',
    sourceUrl: row.url,
    detectedParams,
    inferredMapping,
    confidence,
    warnings,
  };
}

// ─── Batch analysis ───────────────────────────────────────────────────────────

export interface AnalyzeBatchOptions {
  filename?: string;
  fileSizeBytes?: number;
  detectedSeparator?: ',' | ';';
  detectedHeaders?: string[];
  rawRowCount?: number;
  rejections?: CsvRejection[];
  csvMode?: 'headered' | 'headerless_ada';
  targetUrlCount?: number;
  sourceUrlCount?: number;
}

export function analyzeCsvBatch(
  rows: CsvLearnerRow[],
  options: AnalyzeBatchOptions = {}
): CsvBatchResult {
  const analyzed: CsvAnalysisResult[] = rows.map((row) => analyzeCsvUrl(row));

  const confidenceAvg =
    analyzed.length > 0
      ? Math.round((analyzed.reduce((sum, a) => sum + a.confidence, 0) / analyzed.length) * 100) / 100
      : 0;

  const mappingsDetected = analyzed.filter(
    (a) => a.inferredMapping.brandParam && a.inferredMapping.modelParam
  ).length;

  const warningCount = analyzed.reduce((sum, a) => sum + a.warnings.length, 0);

  const importDiagnostics: CsvImportDiagnostics = {
    filename: options.filename ?? '',
    fileSizeBytes: options.fileSizeBytes ?? 0,
    detectedSeparator: options.detectedSeparator ?? ',',
    detectedHeaders: options.detectedHeaders ?? [],
    rawRowCount: options.rawRowCount ?? rows.length,
    validRowCount: rows.length,
    rejectedRowCount: options.rejections?.length ?? 0,
    rejections: (options.rejections ?? []).slice(0, 10),
    csvMode: options.csvMode,
    adaPositionalMapping: options.csvMode === 'headerless_ada' ? ADA_POSITIONAL_MAPPING : undefined,
    generatedRowCount: rows.length,
    targetUrlCount: options.targetUrlCount,
    sourceUrlCount: options.sourceUrlCount,
  };

  return { analyzed, confidenceAvg, mappingsDetected, warningCount, importDiagnostics };
}

// ─── Supabase persistence ─────────────────────────────────────────────────────

export async function saveMappingToMemory(
  analysis: CsvAnalysisResult
): Promise<{ saved: boolean; reason: string }> {
  console.log(`[MAPPING_MEMORY] Saving mapping for ${analysis.site} ${analysis.brand} ${analysis.model}`);

  const { data: existing } = await supabase
    .from('linkgen_mapping_memory')
    .select('id, confidence, failure_count')
    .eq('site', analysis.site)
    .eq('country', analysis.country)
    .eq('brand', analysis.brand)
    .eq('model', analysis.model)
    .eq('fuel', analysis.fuel)
    .eq('trim', analysis.trim)
    .maybeSingle();

  if (existing) {
    if (analysis.confidence > existing.confidence) {
      const { error } = await supabase
        .from('linkgen_mapping_memory')
        .update({
          source_url: analysis.sourceUrl,
          detected_params: analysis.detectedParams as unknown as import('../database.types').Json,
          inferred_mapping: analysis.inferredMapping as unknown as import('../database.types').Json,
          confidence: analysis.confidence,
          validation_status: 'pending',
          issues: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        console.warn('[MAPPING_MEMORY] Update error', error.message);
        return { saved: false, reason: error.message };
      }
      return { saved: true, reason: 'updated (higher confidence)' };
    } else {
      await supabase
        .from('linkgen_mapping_memory')
        .update({ failure_count: (existing.failure_count ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      return { saved: false, reason: 'skipped (existing mapping has equal or higher confidence)' };
    }
  }

  const { error } = await supabase.from('linkgen_mapping_memory').insert({
    site: analysis.site,
    country: analysis.country,
    brand: analysis.brand,
    model: analysis.model,
    fuel: analysis.fuel,
    trim: analysis.trim,
    source_url: analysis.sourceUrl,
    detected_params: analysis.detectedParams as unknown as import('../database.types').Json,
    inferred_mapping: analysis.inferredMapping as unknown as import('../database.types').Json,
    confidence: analysis.confidence,
    validation_status: 'pending',
    success_count: 0,
    failure_count: 0,
  });

  if (error) {
    console.warn('[MAPPING_MEMORY] Insert error', error.message);
    return { saved: false, reason: error.message };
  }

  return { saved: true, reason: 'inserted' };
}

export async function saveMappingsBatch(
  analyses: CsvAnalysisResult[]
): Promise<{ saved: number; skipped: number; errors: number }> {
  let saved = 0;
  let skipped = 0;
  let errors = 0;

  for (const analysis of analyses) {
    const result = await saveMappingToMemory(analysis);
    if (result.saved) {
      saved++;
    } else if (result.reason.startsWith('skipped')) {
      skipped++;
    } else {
      errors++;
    }
  }

  console.log(`[MAPPING_MEMORY] Batch save complete: ${saved} saved, ${skipped} skipped, ${errors} errors`);
  return { saved, skipped, errors };
}
