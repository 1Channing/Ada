export type SiteKey = 'LEBONCOIN' | 'MARKTPLAATS';

export interface LinkGenParams {
  site: SiteKey;
  brand: string;
  model: string;
  year?: string | number;
  mileage?: string | number;
  fuel?: string;
  trim?: string;
  country?: string;
}

export interface LinkGenLogEntry {
  level: 'INPUT' | 'MAPPING' | 'OUTPUT';
  message: string;
  data?: Record<string, unknown>;
}

export interface LinkGenResult {
  url: string;
  site: SiteKey;
  debugLogs: LinkGenLogEntry[];
}
