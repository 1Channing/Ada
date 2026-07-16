/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INGESTION — discovery-scrape confirmation (PURE, no I/O)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Confirms a user's declared search criteria against a scraped listing
 * sample, field by field. Cardinal retention rule: a field is either
 * confirmed beyond the threshold or discarded entirely — no reduced
 * confidence, no "needs review" state. An absent mapping always beats a
 * doubtful one.
 *
 * Data sources per field, structured first:
 * - year, mileage → the parsers' STRUCTURED fields (ScrapedListing.year /
 *   .mileage), more reliable than title text. Fields not present in enough
 *   listings are rejected for insufficient structured data, never guessed
 *   from text.
 * - brand, model → title text (normalizeForMatch: accent/case/separator safe
 *   across FR/NL/DA).
 * - trim → title + description text.
 * - fuel → per-site language-aware detector (adapter.inferFuel); parsers do
 *   not extract a structured fuel field today (see BACKLOG.md).
 *
 * No price comparison happens here, so site currencies (EUR vs DKK) never
 * enter a confirmation decision. Mileage is expressed in km on all
 * supported sites.
 */

import type { ScrapedListing } from './types';
import type { SearchCriteria, SiteAdapter, CandidateSegment } from './marketplaces/types';
import { normalizeForMatch } from './marketplaces/normalizer';

export const INGESTION_MIN_SAMPLE = 5;
export const INGESTION_CONFIRM_THRESHOLD = 0.9;

export type IngestionField =
  | 'brand' | 'model' | 'fuel' | 'year' | 'mileage' | 'trim'
  | 'gearbox' | 'power' | 'doors' | 'seats' | 'color' | 'vehicleType';

/** Secondary fields confirmed against structured listing attributes. */
const SECONDARY_FIELDS: IngestionField[] = ['gearbox', 'power', 'doors', 'seats', 'color', 'vehicleType'];

export interface FieldConfirmation {
  field: IngestionField;
  declaredValue: string;
  status: 'confirmed' | 'rejected';
  matchCount: number;
  /** Denominator actually used (full sample for text fields, structured-field count for year/mileage). */
  sampleSize: number;
  method: 'structured' | 'text';
  /** Set when rejected — the audit reason, human-readable. */
  reason?: string;
}

/** Mirrors linkgen's InferredMapping shape (kept structurally compatible). */
export interface IngestionInferredMapping {
  brandParam?: string;
  modelParam?: string;
  yearFromParam?: string;
  yearToParam?: string;
  mileageParam?: string;
  fuelParam?: string;
  trimParam?: string;
  paramToField: Record<string, string>;
  fieldToParam: Record<string, { paramName: string; rawValue: string }>;
}

export interface IngestionAnalysis {
  confirmations: FieldConfirmation[];
  confirmedFields: IngestionField[];
  rejectedFields: FieldConfirmation[];
  /**
   * The submitted URL, reusable as-is, ONLY when no declared field was
   * rejected. One rejected field means the URL contains an unverified
   * portion — the whole URL is then not trustworthy as a validated_url,
   * even though the confirmed segment↔field pairs are still retained.
   */
  validatedUrl: string | null;
  /** Built from CONFIRMED fields only, each attributed to a URL segment. */
  inferredMapping: IngestionInferredMapping;
  candidateSegments: CandidateSegment[];
}

// ─── Fuel canonicalisation ────────────────────────────────────────────────────

/** Declared form labels → canonical detector tokens. */
const DECLARED_FUEL_TO_CANONICAL: Record<string, string> = {
  ESSENCE: 'petrol',
  GASOLINE: 'petrol',
  PETROL: 'petrol',
  DIESEL: 'diesel',
  HYBRIDE: 'hybrid',
  HYBRID: 'hybrid',
  ELECTRIQUE: 'electric',
  ELECTRIC: 'electric',
  GPL: 'lpg',
  LPG: 'lpg',
  PLUG_IN_HYBRID: 'phev',
};

const PHEV_TOKENS = /\bplug-?in\b|\bphev\b|\bhybride rechargeable\b|\bplug-in-hybride\b|\bplugin-?hybrid\b/;

/** Shared fallback fuel detector (multi-language union) when an adapter has no inferFuel. */
function fallbackInferFuel(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  if (text.includes('diesel')) return 'diesel';
  if (/electr|électr|elektrisch|elektrisk|\belbil\b/.test(text)) return 'electric';
  if (/hybrid|hybride/.test(text)) return 'hybrid';
  if (/essence|benzine|benzin|petrol/.test(text)) return 'petrol';
  if (/\bgpl\b|\blpg\b|autogas/.test(text)) return 'lpg';
  return '';
}

function detectListingFuel(l: ScrapedListing, adapter: SiteAdapter): { canonical: string; isPhev: boolean } {
  const title = l.title ?? '';
  const description = l.description ?? '';
  const detect = adapter.inferFuel ?? fallbackInferFuel;
  const raw = detect(title, description);
  const canonical = raw === 'gpl' ? 'lpg' : raw;
  const isPhev = PHEV_TOKENS.test((title + ' ' + description).toLowerCase());
  return { canonical, isPhev };
}

// ─── Field-by-field confirmation ──────────────────────────────────────────────

function textMatchRate(
  listings: ScrapedListing[],
  needle: string,
  includeDescription: boolean
): number {
  const norm = normalizeForMatch(needle);
  if (!norm) return 0;
  return listings.filter((l) => {
    const haystack = normalizeForMatch(
      includeDescription ? `${l.title ?? ''} ${l.description ?? ''}` : (l.title ?? '')
    );
    return haystack.includes(norm);
  }).length;
}

function pct(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%';
}

export function confirmCriteriaAgainstSample(
  criteria: SearchCriteria,
  listings: ScrapedListing[],
  adapter: SiteAdapter
): FieldConfirmation[] {
  const out: FieldConfirmation[] = [];
  const n = listings.length;

  const declared = (value: string | number | undefined | null): string | null => {
    const s = value === undefined || value === null ? '' : String(value).trim();
    return s.length > 0 ? s : null;
  };

  const insufficientSample = n < INGESTION_MIN_SAMPLE;

  const pushText = (field: IngestionField, value: string, includeDescription: boolean) => {
    if (insufficientSample) {
      out.push({
        field, declaredValue: value, status: 'rejected', matchCount: 0, sampleSize: n,
        method: 'text', reason: `échantillon insuffisant (${n} annonces < ${INGESTION_MIN_SAMPLE})`,
      });
      return;
    }
    const matchCount = textMatchRate(listings, value, includeDescription);
    const rate = matchCount / n;
    if (rate >= INGESTION_CONFIRM_THRESHOLD) {
      out.push({ field, declaredValue: value, status: 'confirmed', matchCount, sampleSize: n, method: 'text' });
    } else {
      out.push({
        field, declaredValue: value, status: 'rejected', matchCount, sampleSize: n, method: 'text',
        reason: `${matchCount}/${n} annonces contiennent "${value}" (${pct(matchCount, n)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%)`,
      });
    }
  };

  // brand / model — title text (matches the validated examples' semantics)
  const brand = declared(criteria.brand);
  if (brand) pushText('brand', brand, false);
  const model = declared(criteria.model);
  if (model) pushText('model', model, false);
  // trim — title + description (same sources as the study pipeline's matchesTrim)
  const trim = declared(criteria.trim);
  if (trim) pushText('trim', trim, true);

  // fuel — language-aware detector over full sample (a listing whose fuel is
  // undetectable counts AGAINST confirmation, by design: certainty or nothing)
  const fuel = declared(criteria.fuel);
  if (fuel) {
    if (insufficientSample) {
      out.push({
        field: 'fuel', declaredValue: fuel, status: 'rejected', matchCount: 0, sampleSize: n,
        method: 'text', reason: `échantillon insuffisant (${n} annonces < ${INGESTION_MIN_SAMPLE})`,
      });
    } else {
      const canonical = DECLARED_FUEL_TO_CANONICAL[fuel.toUpperCase()] ?? normalizeForMatch(fuel);
      let matchCount = 0;
      const seen: Record<string, number> = {};
      for (const l of listings) {
        const { canonical: got, isPhev } = detectListingFuel(l, adapter);
        const label = got || 'indétecté';
        seen[label] = (seen[label] ?? 0) + 1;
        if (canonical === 'phev') {
          // Strict: PHEV only confirmed on explicit plug-in evidence, a plain
          // 'hybrid' detection is NOT enough (sites separate the two facets).
          if (isPhev) matchCount++;
        } else if (got && got === canonical) {
          matchCount++;
        }
      }
      const rate = matchCount / n;
      if (rate >= INGESTION_CONFIRM_THRESHOLD) {
        out.push({ field: 'fuel', declaredValue: fuel, status: 'confirmed', matchCount, sampleSize: n, method: 'text' });
      } else {
        const dist = Object.entries(seen).map(([k, v]) => `${v}/${n} ${k}`).join(', ');
        out.push({
          field: 'fuel', declaredValue: fuel, status: 'rejected', matchCount, sampleSize: n, method: 'text',
          reason: `échantillon: ${dist} vs déclaré ${fuel} — ${pct(matchCount, n)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%`,
        });
      }
    }
  }

  // year — STRUCTURED field; denominator = listings that carry a parsed year
  const yearFrom = declared(criteria.yearFrom ?? criteria.year);
  const yearTo = declared(criteria.yearTo);
  if (yearFrom) {
    const withYear = listings.filter((l) => l.year !== null && l.year !== undefined);
    const declaredLabel = yearTo ? `${yearFrom}-${yearTo}` : `≥${yearFrom}`;
    if (withYear.length < INGESTION_MIN_SAMPLE) {
      out.push({
        field: 'year', declaredValue: declaredLabel, status: 'rejected',
        matchCount: 0, sampleSize: withYear.length, method: 'structured',
        reason: `données structurées insuffisantes (${withYear.length} annonces avec année < ${INGESTION_MIN_SAMPLE})`,
      });
    } else {
      const from = Number(yearFrom);
      const to = yearTo ? Number(yearTo) : null;
      const matchCount = withYear.filter((l) => {
        const y = l.year as number;
        return to ? y >= from && y <= to : y >= from;
      }).length;
      const rate = matchCount / withYear.length;
      if (rate >= INGESTION_CONFIRM_THRESHOLD) {
        out.push({ field: 'year', declaredValue: declaredLabel, status: 'confirmed', matchCount, sampleSize: withYear.length, method: 'structured' });
      } else {
        out.push({
          field: 'year', declaredValue: declaredLabel, status: 'rejected', matchCount, sampleSize: withYear.length, method: 'structured',
          reason: `${matchCount}/${withYear.length} années structurées dans ${declaredLabel} (${pct(matchCount, withYear.length)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%)`,
        });
      }
    }
  }

  // mileage — STRUCTURED field; same denominator rule as year
  const mileage = declared(criteria.mileage);
  if (mileage) {
    const withMileage = listings.filter((l) => l.mileage !== null && l.mileage !== undefined);
    if (withMileage.length < INGESTION_MIN_SAMPLE) {
      out.push({
        field: 'mileage', declaredValue: `≤${mileage} km`, status: 'rejected',
        matchCount: 0, sampleSize: withMileage.length, method: 'structured',
        reason: `données structurées insuffisantes (${withMileage.length} annonces avec km < ${INGESTION_MIN_SAMPLE})`,
      });
    } else {
      const max = Number(mileage);
      const matchCount = withMileage.filter((l) => (l.mileage as number) <= max).length;
      const rate = matchCount / withMileage.length;
      if (rate >= INGESTION_CONFIRM_THRESHOLD) {
        out.push({ field: 'mileage', declaredValue: `≤${mileage} km`, status: 'confirmed', matchCount, sampleSize: withMileage.length, method: 'structured' });
      } else {
        out.push({
          field: 'mileage', declaredValue: `≤${mileage} km`, status: 'rejected', matchCount, sampleSize: withMileage.length, method: 'structured',
          reason: `${matchCount}/${withMileage.length} km structurés ≤ ${mileage} (${pct(matchCount, withMileage.length)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%)`,
        });
      }
    }
  }

  // ─── Secondary structured fields ────────────────────────────────────────────
  // All confirmed against parsed listing attributes (never the title). Where a
  // parser doesn't extract the attribute, the denominator falls below the min
  // and the field is rejected as "insufficient structured data" — honest, not
  // a false negative on the URL.

  // power — DIN horsepower range (structured ScrapedListing.powerDin)
  const powerFrom = declared(criteria.powerFrom);
  const powerTo = declared(criteria.powerTo);
  if (powerFrom || powerTo) {
    const label = `${powerFrom ?? '?'}-${powerTo ?? 'max'} ch`;
    const from = powerFrom ? Number(powerFrom) : null;
    const to = powerTo ? Number(powerTo) : null;
    out.push(confirmStructured(
      'power', label, listings,
      (l) => (l.powerDin ?? null),
      (v) => (from == null || v >= from) && (to == null || v <= to),
      n,
    ));
  }

  // doors / seats — exact structured integer
  const doors = declared(criteria.doors);
  if (doors) {
    out.push(confirmStructured(
      'doors', `${doors} portes`, listings,
      (l) => (l.doors ?? null),
      (v) => v === Number(doors),
      n,
    ));
  }
  const seats = declared(criteria.seats);
  if (seats) {
    out.push(confirmStructured(
      'seats', `${seats} places`, listings,
      (l) => (l.seats ?? null),
      (v) => v === Number(seats),
      n,
    ));
  }

  // gearbox / color / vehicleType — structured human LABEL match
  const gearbox = declared(criteria.gearbox);
  if (gearbox) out.push(confirmStructuredLabel('gearbox', gearbox, listings, (l) => l.gearbox ?? null, n));
  const color = declared(criteria.color);
  if (color) out.push(confirmStructuredLabel('color', color, listings, (l) => l.color ?? null, n));
  const vehicleType = declared(criteria.vehicleType);
  if (vehicleType) out.push(confirmStructuredLabel('vehicleType', vehicleType, listings, (l) => l.vehicleType ?? null, n));

  return out;
}

/** Confirm a numeric structured field against a predicate. */
function confirmStructured(
  field: IngestionField,
  declaredLabel: string,
  listings: ScrapedListing[],
  read: (l: ScrapedListing) => number | null,
  predicate: (v: number) => boolean,
  _fullSize: number,
): FieldConfirmation {
  const present = listings.filter((l) => read(l) !== null);
  if (present.length < INGESTION_MIN_SAMPLE) {
    return {
      field, declaredValue: declaredLabel, status: 'rejected', matchCount: 0, sampleSize: present.length,
      method: 'structured', reason: `données structurées insuffisantes (${present.length} annonces avec la donnée < ${INGESTION_MIN_SAMPLE})`,
    };
  }
  const matchCount = present.filter((l) => predicate(read(l) as number)).length;
  const rate = matchCount / present.length;
  if (rate >= INGESTION_CONFIRM_THRESHOLD) {
    return { field, declaredValue: declaredLabel, status: 'confirmed', matchCount, sampleSize: present.length, method: 'structured' };
  }
  return {
    field, declaredValue: declaredLabel, status: 'rejected', matchCount, sampleSize: present.length, method: 'structured',
    reason: `${matchCount}/${present.length} annonces correspondent (${pct(matchCount, present.length)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%)`,
  };
}

/** Confirm an enum structured field by human-label match (bidirectional includes). */
function confirmStructuredLabel(
  field: IngestionField,
  declaredLabel: string,
  listings: ScrapedListing[],
  read: (l: ScrapedListing) => string | null,
  _fullSize: number,
): FieldConfirmation {
  const declaredNorm = normalizeForMatch(declaredLabel);
  const present = listings.filter((l) => {
    const v = read(l);
    return v !== null && v !== undefined && v.trim().length > 0;
  });
  if (present.length < INGESTION_MIN_SAMPLE) {
    return {
      field, declaredValue: declaredLabel, status: 'rejected', matchCount: 0, sampleSize: present.length,
      method: 'structured', reason: `données structurées insuffisantes (${present.length} annonces avec la donnée < ${INGESTION_MIN_SAMPLE})`,
    };
  }
  const matchCount = present.filter((l) => {
    const lNorm = normalizeForMatch(read(l) as string);
    return lNorm.includes(declaredNorm) || declaredNorm.includes(lNorm);
  }).length;
  const rate = matchCount / present.length;
  if (rate >= INGESTION_CONFIRM_THRESHOLD) {
    return { field, declaredValue: declaredLabel, status: 'confirmed', matchCount, sampleSize: present.length, method: 'structured' };
  }
  return {
    field, declaredValue: declaredLabel, status: 'rejected', matchCount, sampleSize: present.length, method: 'structured',
    reason: `${matchCount}/${present.length} annonces = "${declaredLabel}" (${pct(matchCount, present.length)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%)`,
  };
}

// ─── Mapping construction (confirmed fields only) ─────────────────────────────

function segmentForField(
  segments: CandidateSegment[],
  field: IngestionField
): CandidateSegment | undefined {
  return segments.find((s) => s.guessField === field);
}

export function buildIngestionMapping(
  confirmations: FieldConfirmation[],
  segments: CandidateSegment[]
): IngestionInferredMapping {
  const mapping: IngestionInferredMapping = { paramToField: {}, fieldToParam: {} };
  const confirmed = new Set(confirmations.filter((c) => c.status === 'confirmed').map((c) => c.field));

  const attribute = (field: IngestionField, assign: (paramName: string) => void) => {
    if (!confirmed.has(field)) return;
    const seg = segmentForField(segments, field);
    // Confirmed but not attributable to any URL segment → retained as a
    // key value on the memory row, but absent from the param mapping.
    if (!seg) return;
    assign(seg.paramName);
    mapping.fieldToParam[field] = { paramName: seg.paramName, rawValue: seg.raw };
    if (!seg.paramName.startsWith('_path')) mapping.paramToField[seg.paramName] = field;
  };

  attribute('brand', (p) => { mapping.brandParam = p; });
  attribute('model', (p) => { mapping.modelParam = p; });
  attribute('fuel', (p) => { mapping.fuelParam = p; });
  attribute('trim', (p) => { mapping.trimParam = p; });
  attribute('mileage', (p) => { mapping.mileageParam = p; });

  // Secondary fields: recorded in the generic fieldToParam/paramToField maps
  // (no dedicated *Param property — URL generation from them is a later step).
  // For enum fields this is where the opaque code↔confirmed-value pairing lands
  // (e.g. gearbox param 'gearbox' with rawValue '2', confirmed as Automatique).
  for (const field of SECONDARY_FIELDS) {
    attribute(field, () => { /* generic maps only */ });
  }

  // year: 'from'/'to' distinction when the site uses two params (Bilbasen,
  // Marktplaats hash); single range param otherwise (Leboncoin regdate).
  if (confirmed.has('year')) {
    const yearSegs = segments.filter((s) => s.guessField === 'year');
    for (const seg of yearSegs) {
      const name = seg.paramName.toLowerCase();
      if (name.includes('to') && !name.includes('from')) {
        mapping.yearToParam = seg.paramName;
      } else if (!mapping.yearFromParam) {
        mapping.yearFromParam = seg.paramName;
      }
      mapping.fieldToParam[mapping.yearToParam === seg.paramName ? 'yearTo' : 'year'] =
        { paramName: seg.paramName, rawValue: seg.raw };
      if (!seg.paramName.startsWith('_path')) mapping.paramToField[seg.paramName] = 'year';
    }
  }

  return mapping;
}

// ─── Top-level analysis ───────────────────────────────────────────────────────

export function analyzeIngestion(
  url: string,
  criteria: SearchCriteria,
  listings: ScrapedListing[],
  adapter: SiteAdapter
): IngestionAnalysis {
  const confirmations = confirmCriteriaAgainstSample(criteria, listings, adapter);
  const segments = adapter.extractCandidateSegments?.(url) ?? [];
  const rejectedFields = confirmations.filter((c) => c.status === 'rejected');
  const confirmedFields = confirmations
    .filter((c) => c.status === 'confirmed')
    .map((c) => c.field);

  return {
    confirmations,
    confirmedFields,
    rejectedFields,
    // One rejected field poisons the URL as a whole (validated example 2) —
    // but never the individually confirmed segment↔field pairs.
    validatedUrl: rejectedFields.length === 0 && confirmations.length > 0 ? url : null,
    inferredMapping: buildIngestionMapping(confirmations, segments),
    candidateSegments: segments,
  };
}
