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
