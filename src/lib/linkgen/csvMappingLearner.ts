import { supabase } from '../supabase';
import type {
  CsvLearnerRow,
  CsvAnalysisResult,
  CsvBatchResult,
  DetectedParams,
  InferredMapping,
} from './types';

// ─── Robust CSV parser ────────────────────────────────────────────────────────
// Handles: quoted fields, commas inside quotes, ; or , separators, CRLF/LF, empty lines

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
        // escaped quote
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

export function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) return [];

  const sep = detectSeparator(lines[0]);
  const headers = parseCSVLine(lines[0], sep).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));

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
  return rows;
}

// ─── Column name normalisation ────────────────────────────────────────────────
// Maps various CSV column names from different ADA exports to canonical names

const COLUMN_ALIASES: Record<string, keyof CsvLearnerRow> = {
  // site / marketplace
  site: 'site',
  source_marketplace: 'site',
  market_source_url: 'site',  // fallback
  // country
  country: 'country',
  source_country: 'country',
  country_source: 'country',
  // brand
  brand: 'brand',
  marque: 'brand',
  make: 'brand',
  // model
  model: 'model',
  modele: 'model',
  model_pattern: 'model',
  // year
  year: 'year',
  annee: 'year',
  year_min: 'year',
  yearfrom: 'year',
  // mileage
  mileage: 'mileage',
  max_mileage: 'mileage',
  mileage_max: 'mileage',
  km_max: 'mileage',
  // fuel
  fuel: 'fuel',
  carburant: 'fuel',
  energie: 'fuel',
  // trim
  trim: 'trim',
  version: 'trim',
  finition: 'trim',
  // url — prefer source_search_url
  url: 'url',
  source_search_url: 'url',
  market_source_url_col: 'url',  // placeholder
};

export function normalizeCsvRow(raw: Record<string, string>): CsvLearnerRow | null {
  const mapped: Partial<CsvLearnerRow> = {};

  for (const [rawKey, value] of Object.entries(raw)) {
    const canonical = COLUMN_ALIASES[rawKey];
    if (canonical && value) {
      // Don't overwrite if already set (priority: first match wins per canonical key order)
      if (!(canonical in mapped)) {
        (mapped as Record<string, string>)[canonical] = value;
      }
    }
  }

  // Special case: if url not yet resolved, try market_source_url column
  if (!mapped.url) {
    const fallback = raw['market_source_url'] ?? raw['market_source'] ?? '';
    if (fallback) mapped.url = fallback;
  }

  // Derive site from url domain if not provided
  if (!mapped.site && mapped.url) {
    try {
      const domain = new URL(mapped.url).hostname.toLowerCase();
      if (domain.includes('leboncoin')) mapped.site = 'LEBONCOIN';
      else if (domain.includes('marktplaats')) mapped.site = 'MARKTPLAATS';
      else if (domain.includes('bilbasen')) mapped.site = 'BILBASEN';
    } catch {
      // ignore
    }
  }

  // Normalise site to uppercase
  if (mapped.site) {
    mapped.site = mapped.site.toUpperCase().trim();
  }

  if (!mapped.brand || !mapped.model || !mapped.url) return null;

  return {
    site: mapped.site ?? 'UNKNOWN',
    country: mapped.country ?? '',
    brand: mapped.brand,
    model: mapped.model,
    year: mapped.year,
    mileage: mapped.mileage,
    fuel: mapped.fuel,
    trim: mapped.trim,
    url: mapped.url,
  };
}

// ─── URL decomposition ────────────────────────────────────────────────────────

function decomposeUrl(rawUrl: string): DetectedParams | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.warn(`[URL_ANALYSIS] Cannot parse URL: ${rawUrl}`);
    return null;
  }

  const queryParams: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => { queryParams[k] = v; });

  const hashParams: Record<string, string> = {};
  const hash = parsed.hash.replace(/^#/, '');
  if (hash) {
    // Marktplaats uses |key:value|key:value format
    const pipeSegments = hash.split('|');
    for (const seg of pipeSegments) {
      const colonIdx = seg.indexOf(':');
      if (colonIdx > 0) {
        const k = seg.slice(0, colonIdx).trim();
        const v = seg.slice(colonIdx + 1).trim();
        if (k) hashParams[k] = v;
      } else {
        // standard key=value
        const eqIdx = seg.indexOf('=');
        if (eqIdx > 0) {
          hashParams[seg.slice(0, eqIdx).trim()] = seg.slice(eqIdx + 1).trim();
        }
      }
    }
    // Also try standard URLSearchParams on the hash
    try {
      const hashSearchParams = new URLSearchParams(hash);
      hashSearchParams.forEach((v, k) => {
        if (!(k in hashParams)) hashParams[k] = v;
      });
    } catch {
      // ignore
    }
  }

  const pathSegments = parsed.pathname
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    rawUrl,
    domain: parsed.hostname,
    queryParams,
    hashParams,
    pathSegments,
  };
}

// ─── Field matching helpers ───────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_\s+]/g, '').replace(/[^a-z0-9]/g, '');
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

function findParamInPath(
  segments: string[],
  fieldValue: string
): MatchResult | null {
  for (const seg of segments) {
    if (valueContains(seg, fieldValue)) {
      return { paramName: '_path', rawValue: seg, source: 'path' };
    }
  }
  return null;
}

// ─── Core analysis ────────────────────────────────────────────────────────────

export function analyzeCsvUrl(row: CsvLearnerRow): CsvAnalysisResult {
  const warnings: string[] = [];
  const paramToField: Record<string, string> = {};
  const fieldToParam: Record<string, { paramName: string; rawValue: string }> = {};

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
      detectedParams: {
        rawUrl: row.url,
        domain: '',
        queryParams: {},
        hashParams: {},
        pathSegments: [],
      },
      inferredMapping: {
        paramToField: {},
        fieldToParam: {},
      },
      confidence: 0,
      warnings: [`[URL_ANALYSIS] Cannot parse URL: ${row.url}`],
    };
  }

  console.log(`[CSV_LEARNER] Analyzing URL: ${row.url}`, { brand: row.brand, model: row.model });

  const allQueryAndHash = { ...detectedParams.queryParams, ...detectedParams.hashParams };

  // Fields to match and their expected values
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

    // Try query params first, then hash, then path
    let match =
      findParamForField(detectedParams.queryParams, value, 'query') ??
      findParamForField(detectedParams.hashParams, value, 'hash') ??
      findParamInPath(detectedParams.pathSegments, value);

    if (match) {
      matchedWeight += weight;
      fieldToParam[field] = { paramName: match.paramName, rawValue: match.rawValue };
      if (match.paramName !== '_path') {
        paramToField[match.paramName] = field;
      }
      console.log(`[URL_ANALYSIS] ${field} → ${match.paramName}=${match.rawValue}`);
    } else {
      warnings.push(`[URL_ANALYSIS] Expected field "${field}" (value: "${value}") not found in URL params`);
    }
  }

  // Detect sort param
  const sortParamName = Object.keys(allQueryAndHash).find(
    (k) => k.toLowerCase().includes('sort') || k.toLowerCase().includes('order')
  ) ?? Object.keys(detectedParams.hashParams).find(
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
      // Marktplaats: constructionYearFrom:2020|constructionYearTo:2022
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

export function analyzeCsvBatch(rows: CsvLearnerRow[]): CsvBatchResult {
  const analyzed: CsvAnalysisResult[] = rows.map((row) => analyzeCsvUrl(row));

  const confidenceAvg =
    analyzed.length > 0
      ? Math.round((analyzed.reduce((sum, a) => sum + a.confidence, 0) / analyzed.length) * 100) / 100
      : 0;

  const mappingsDetected = analyzed.filter(
    (a) => a.inferredMapping.brandParam && a.inferredMapping.modelParam
  ).length;

  const warningCount = analyzed.reduce((sum, a) => sum + a.warnings.length, 0);

  return { analyzed, confidenceAvg, mappingsDetected, warningCount };
}

// ─── Supabase persistence ─────────────────────────────────────────────────────

export async function saveMappingToMemory(
  analysis: CsvAnalysisResult
): Promise<{ saved: boolean; reason: string }> {
  console.log(`[MAPPING_MEMORY] Saving mapping for ${analysis.site} ${analysis.brand} ${analysis.model}`);

  // First check if a record already exists
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
      // Better confidence — update
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
      // Lower or equal confidence — increment failure_count, keep existing
      await supabase
        .from('linkgen_mapping_memory')
        .update({ failure_count: (existing.failure_count ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      return { saved: false, reason: 'skipped (existing mapping has equal or higher confidence)' };
    }
  }

  // New record — insert
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

  // Sequential to avoid upsert conflicts
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
