export type SiteKey = 'LEBONCOIN' | 'MARKTPLAATS' | 'BILBASEN';

export interface LinkGenParams {
  // Multi-site generation
  selectedSites?: SiteKey[];
  // Legacy single-site (still supported for backward compat)
  site?: SiteKey;

  brand: string;
  model: string;

  yearFrom?: string | number;
  yearTo?: string | number;
  /** @deprecated use yearFrom + yearTo */
  year?: string | number;

  mileage?: string | number;
  fuel?: string;
  trim?: string;
  minPower?: string | number;
  country?: string;
}

export interface LinkGenLogEntry {
  level: 'INPUT' | 'MAPPING' | 'OUTPUT' | 'WARNING' | 'VALIDATION';
  message: string;
  data?: Record<string, unknown>;
}

/** Legacy single-site result — kept for backward compat */
export interface LinkGenResult {
  url: string;
  site: SiteKey;
  debugLogs: LinkGenLogEntry[];
}

export type ValidationStatus = 'not_checked' | 'valid' | 'partial' | 'invalid';

export interface LinkGenIssue {
  type:
    | 'brand_missing'
    | 'model_missing'
    | 'fuel_mismatch'
    | 'low_listing_count'
    | 'fetch_failed'
    | 'no_zyte_key'
    | 'parse_error'
    | 'wrong_domain'
    | 'fuel_mapping_suspect'
    | 'model_not_applied'
    | 'trim_not_applied'
    | 'year_filter_not_applied'
    | 'mileage_filter_not_applied'
    | 'sort_not_applied'
    | 'no_listings';
}

export interface LinkGenDiagnostics {
  expectedDomain: string;
  actualDomain: string;
  brandApplied: boolean;
  modelApplied: boolean;
  trimApplied: boolean;
  fuelApplied: boolean;
  yearApplied: boolean;
  mileageApplied: boolean;
  sortApplied: boolean;
  listingCount: number;
  sampleTitles: string[];
}

export interface LinkGenValidationResult {
  score: number;
  isRelevant: boolean;
  issues: LinkGenIssue[];
  detectedFilters: {
    brand: boolean;
    model: boolean;
    trim: boolean;
    fuel: boolean;
  };
  listingCount: number;
  listingCountMethod: 'regex' | 'dom' | 'fallback';
  validationStatus: ValidationStatus;
  diagnostics?: LinkGenDiagnostics;
  debugLogs: LinkGenLogEntry[];
}

export interface LinkGenRetryResult {
  original: LinkGenValidationResult;
  corrected?: LinkGenValidationResult;
  correctedUrl?: string;
  correctionReason?: string;
}

/** Multi-site result entry — one per site */
export interface LinkGenUrlResult {
  site: SiteKey;
  country: string;
  url: string;
  debugLogs: LinkGenLogEntry[];
  warnings: string[];
  validationStatus: ValidationStatus;
  validationScore?: number;
  listingCount?: number;
  listingCountMethod?: 'regex' | 'dom' | 'fallback';
  validationIssues?: LinkGenIssue[];
  diagnostics?: LinkGenDiagnostics;
  // Correction result (populated after Scout Check with retry)
  correctedUrl?: string;
  correctionReason?: string;
  validationAfter?: ValidationStatus;
  validationScoreAfter?: number;
  // Memory-first lookup result
  mappingSource?: 'learned' | 'default_template';
}

export interface LinkGenCorrectionRecord {
  site: SiteKey;
  inputParams: LinkGenParams;
  originalUrl: string;
  issues: LinkGenIssue[];
  correctedUrl?: string;
  correctionReason?: string;
  validationBefore: ValidationStatus;
  validationAfter?: ValidationStatus;
  createdAt: Date;
}

// ─── CSV Mapping Learner ──────────────────────────────────────────────────────

export interface CsvLearnerRow {
  site: string;
  country: string;
  brand: string;
  model: string;
  year?: string;
  mileage?: string;
  fuel?: string;
  trim?: string;
  url: string;
}

export interface DetectedParams {
  rawUrl: string;
  domain: string;
  queryParams: Record<string, string>;
  hashParams: Record<string, string>;
  pathSegments: string[];
}

export interface InferredMapping {
  brandParam?: string;
  modelParam?: string;
  yearFromParam?: string;
  yearToParam?: string;
  mileageParam?: string;
  fuelParam?: string;
  trimParam?: string;
  sortParam?: string;
  // raw param names mapped to their detected field
  paramToField: Record<string, string>;
  // field to its param name + raw value in the URL
  fieldToParam: Record<string, { paramName: string; rawValue: string }>;
}

export interface CsvAnalysisResult {
  site: string;
  country: string;
  brand: string;
  model: string;
  fuel: string;
  trim: string;
  sourceUrl: string;
  detectedParams: DetectedParams;
  inferredMapping: InferredMapping;
  confidence: number;
  warnings: string[];
}

export type CsvRejectionReason =
  | 'missing_url'
  | 'missing_brand_and_model'
  | 'empty_row'
  | 'parse_error'
  | 'unknown_headers';

export interface CsvRejection {
  rowIndex: number;
  reason: CsvRejectionReason;
  // up to 3 key=value pairs from the raw row for display
  preview: string;
}

export interface CsvImportDiagnostics {
  filename: string;
  fileSizeBytes: number;
  detectedSeparator: ',' | ';';
  detectedHeaders: string[];
  rawRowCount: number;
  validRowCount: number;
  rejectedRowCount: number;
  rejections: CsvRejection[]; // max 10
}

export interface CsvBatchResult {
  analyzed: CsvAnalysisResult[];
  confidenceAvg: number;
  mappingsDetected: number;
  warningCount: number;
  importDiagnostics: CsvImportDiagnostics;
}

export type MappingValidationStatus = 'pending' | 'valid' | 'invalid';

export interface MappingMemoryRecord {
  id: string;
  site: string;
  country: string;
  brand: string;
  model: string;
  fuel: string;
  trim: string;
  source_url: string | null;
  detected_params: DetectedParams | null;
  inferred_mapping: InferredMapping | null;
  validated_mapping: InferredMapping | null;
  confidence: number;
  validation_status: MappingValidationStatus;
  issues: LinkGenIssue[] | null;
  success_count: number;
  failure_count: number;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
}
