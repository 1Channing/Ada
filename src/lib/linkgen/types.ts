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
    | 'parse_error';
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
  debugLogs: LinkGenLogEntry[];
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
}
