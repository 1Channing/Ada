/**
 * Ingestion — granular retention writes (browser side).
 *
 * Consumes a pure IngestionAnalysis (study-core/ingestion.ts) and applies
 * the cardinal retention rule to linkgen_mapping_memory:
 *
 * - Only 100%-confirmed fields are ever written (source='human_verified',
 *   confidence 1.0, validation_status 'valid').
 * - A memory row requires at least brand AND model confirmed — the row's
 *   unique key and the memory-first generator lookup are meaningless
 *   without them. Anything less → audit event only, no memory write.
 * - Deduplication: a second ingestion confirming the exact same taxonomy
 *   reinforces the row (human_confirmations + 1). Two CERTAIN but
 *   CONTRADICTORY mappings never overwrite each other silently — the
 *   existing row is kept, the conflict is logged for human review.
 * - A pre-existing csv_import row is upgraded: human + scrape verification
 *   outranks CSV substring inference.
 * - Every ingestion attempt (including scrape failures) writes one
 *   linkgen_ingestion_events row. That table is audit-only — never read by
 *   URL generation.
 */

import { supabase } from '../supabase';
import type { Json } from '../database.types';
import type { SearchCriteria } from '../study-core/marketplaces/types';
import type { DetectedParams } from '../study-core/marketplaces/urlDecompose';
import type { IngestionAnalysis, IngestionInferredMapping } from '../study-core/ingestion';

export interface PersistIngestionInput {
  url: string;
  site: string;
  /** ISO country code (adapter.countryCode) — same convention as existing memory rows. */
  country: string;
  criteria: SearchCriteria;
  /** null when the discovery scrape failed — event-only persistence. */
  analysis: IngestionAnalysis | null;
  sampleSize: number;
  scrapeError?: string | null;
  detectedParams: DetectedParams | null;
  submittedBy?: string;
}

export type MemoryAction =
  | 'inserted'
  | 'reinforced'
  | 'upgraded_from_csv'
  | 'conflict_kept_existing'
  | 'none';

export interface MappingConflict {
  field: string;
  existing: string;
  incoming: string;
}

export interface PersistIngestionOutcome {
  memoryAction: MemoryAction;
  memoryRecordId: string | null;
  conflicts: MappingConflict[];
  eventError?: string;
  memoryError?: string;
}

const TAXONOMY_FIELDS = ['brand', 'model', 'fuel', 'trim'] as const;

/**
 * Contradiction check on taxonomy fields only (year/mileage raw values are
 * variables by design and never compared). A field mapped on both sides
 * with a different param name or raw value is a conflict; a field present
 * on one side only is NOT (it gets merged during reinforcement).
 */
function findTaxonomyConflicts(
  existing: IngestionInferredMapping | null,
  incoming: IngestionInferredMapping
): MappingConflict[] {
  if (!existing?.fieldToParam) return [];
  const conflicts: MappingConflict[] = [];
  for (const field of TAXONOMY_FIELDS) {
    const a = existing.fieldToParam[field];
    const b = incoming.fieldToParam[field];
    if (a && b && (a.paramName !== b.paramName || a.rawValue !== b.rawValue)) {
      conflicts.push({
        field,
        existing: `${a.paramName}=${a.rawValue}`,
        incoming: `${b.paramName}=${b.rawValue}`,
      });
    }
  }
  return conflicts;
}

function mergeMappings(
  existing: IngestionInferredMapping | null,
  incoming: IngestionInferredMapping
): IngestionInferredMapping {
  if (!existing) return incoming;
  return {
    ...existing,
    ...Object.fromEntries(
      Object.entries(incoming).filter(([, v]) => v !== undefined && v !== null)
    ),
    paramToField: { ...existing.paramToField, ...incoming.paramToField },
    fieldToParam: { ...existing.fieldToParam, ...incoming.fieldToParam },
  } as IngestionInferredMapping;
}

export async function persistIngestionResult(
  input: PersistIngestionInput
): Promise<PersistIngestionOutcome> {
  const { url, site, country, criteria, analysis, sampleSize, scrapeError, detectedParams, submittedBy } = input;
  const now = new Date().toISOString();

  const outcome: PersistIngestionOutcome = {
    memoryAction: 'none',
    memoryRecordId: null,
    conflicts: [],
  };

  const confirmed = new Set(analysis?.confirmedFields ?? []);
  const canWriteMemory = !scrapeError && analysis !== null && confirmed.has('brand') && confirmed.has('model');

  if (canWriteMemory && analysis) {
    const keyBrand = String(criteria.brand ?? '').trim().toUpperCase();
    const keyModel = String(criteria.model ?? '').trim().toUpperCase();
    const keyFuel = confirmed.has('fuel') ? String(criteria.fuel ?? '').trim().toUpperCase() : '';
    const keyTrim = confirmed.has('trim') ? String(criteria.trim ?? '').trim() : '';

    const { data: existingRows, error: lookupError } = await supabase
      .from('linkgen_mapping_memory')
      .select('id, source, confidence, validated_url, validated_mapping, inferred_mapping, human_confirmations, success_count')
      .eq('site', site)
      .ilike('country', country)
      .ilike('brand', keyBrand)
      .ilike('model', keyModel)
      .ilike('fuel', keyFuel)
      .ilike('trim', keyTrim)
      .limit(1);

    if (lookupError) {
      outcome.memoryError = lookupError.message;
    } else {
      const existing = existingRows?.[0] ?? null;

      if (!existing) {
        const { data: inserted, error } = await supabase
          .from('linkgen_mapping_memory')
          .insert({
            site,
            country,
            brand: keyBrand,
            model: keyModel,
            fuel: keyFuel,
            trim: keyTrim,
            source_url: url,
            detected_params: detectedParams as unknown as Json,
            inferred_mapping: analysis.inferredMapping as unknown as Json,
            validated_mapping: analysis.inferredMapping as unknown as Json,
            confidence: 1,
            validation_status: 'valid',
            validated_url: analysis.validatedUrl,
            source: 'human_verified',
            human_confirmations: 1,
            last_confirmed_at: now,
            last_checked_at: now,
          })
          .select('id')
          .single();

        if (error) {
          outcome.memoryError = error.message;
        } else {
          outcome.memoryAction = 'inserted';
          outcome.memoryRecordId = inserted?.id ?? null;
        }
      } else {
        const existingMapping = (existing.validated_mapping ?? existing.inferred_mapping) as IngestionInferredMapping | null;

        if (existing.source === 'human_verified') {
          const conflicts = findTaxonomyConflicts(existingMapping, analysis.inferredMapping);

          if (conflicts.length > 0) {
            // Two certain-but-contradictory mappings: keep the existing one
            // untouched, surface the conflict for human review via the event.
            outcome.memoryAction = 'conflict_kept_existing';
            outcome.memoryRecordId = existing.id;
            outcome.conflicts = conflicts;
          } else {
            const merged = mergeMappings(existingMapping, analysis.inferredMapping);
            const { error } = await supabase
              .from('linkgen_mapping_memory')
              .update({
                validated_mapping: merged as unknown as Json,
                human_confirmations: (existing.human_confirmations ?? 0) + 1,
                last_confirmed_at: now,
                last_checked_at: now,
                updated_at: now,
                // Upgrade only, never downgrade: fill validated_url when ours
                // is trustworthy and the stored one is absent.
                ...(analysis.validatedUrl && !existing.validated_url
                  ? { validated_url: analysis.validatedUrl }
                  : {}),
              })
              .eq('id', existing.id);

            if (error) {
              outcome.memoryError = error.message;
            } else {
              outcome.memoryAction = 'reinforced';
              outcome.memoryRecordId = existing.id;
            }
          }
        } else {
          // csv_import (any status): human + discovery-scrape verification
          // outranks CSV substring inference — upgrade the row in place.
          const { error } = await supabase
            .from('linkgen_mapping_memory')
            .update({
              source_url: url,
              detected_params: detectedParams as unknown as Json,
              inferred_mapping: analysis.inferredMapping as unknown as Json,
              validated_mapping: analysis.inferredMapping as unknown as Json,
              confidence: 1,
              validation_status: 'valid',
              validated_url: analysis.validatedUrl,
              source: 'human_verified',
              human_confirmations: 1,
              last_confirmed_at: now,
              last_checked_at: now,
              updated_at: now,
            })
            .eq('id', existing.id);

          if (error) {
            outcome.memoryError = error.message;
          } else {
            outcome.memoryAction = 'upgraded_from_csv';
            outcome.memoryRecordId = existing.id;
          }
        }
      }
    }
  }

  // Learn opaque enum codes (gearbox/color/vehicleType) → confirmed label,
  // gated on the core taxonomy being confirmed so we never learn from an
  // off-target sample. This is what lets a later ingestion auto-recognise the
  // same code (e.g. gearbox=2 → Automatique) without the user re-declaring it.
  if (canWriteMemory && analysis) {
    await learnEnumMappings(site, analysis, criteria);
  }

  // Audit event — always written, including scrape failures and memory errors.
  const retained = (analysis?.confirmations ?? [])
    .filter((c) => c.status === 'confirmed')
    .map((c) => ({ field: c.field, declared: c.declaredValue, matchCount: c.matchCount, sampleSize: c.sampleSize, method: c.method }));
  const discarded = (analysis?.confirmations ?? [])
    .filter((c) => c.status === 'rejected')
    .map((c) => ({ field: c.field, declared: c.declaredValue, reason: c.reason ?? '' }));

  const { error: eventError } = await supabase.from('linkgen_ingestion_events').insert({
    submitted_url: url,
    site,
    declared_criteria: criteria as unknown as Json,
    detected_params: detectedParams as unknown as Json,
    sample_size: sampleSize,
    scrape_error: scrapeError ?? null,
    retained: retained as unknown as Json,
    discarded: discarded as unknown as Json,
    conflicts: outcome.conflicts.length > 0 ? (outcome.conflicts as unknown as Json) : null,
    memory_record_id: outcome.memoryRecordId,
    memory_action: outcome.memoryAction,
    submitted_by: submittedBy ?? null,
  });

  if (eventError) {
    console.warn('[INGESTION] audit event insert failed:', eventError.message);
    outcome.eventError = eventError.message;
  }

  return outcome;
}

// ─── Learned enum dictionary (opaque code ↔ confirmed label) ──────────────────

/** Enum fields whose URL value is an opaque code worth learning. */
const LEARNABLE_ENUM_FIELDS = ['gearbox', 'color', 'vehicleType'] as const;
type LearnableEnumField = (typeof LEARNABLE_ENUM_FIELDS)[number];

/**
 * Persist confirmed enum code→label pairs. Reinforces on identical repeat;
 * on a contradictory label for the same code, keeps the existing one (same
 * "certain-or-nothing" philosophy as the mapping memory).
 */
async function learnEnumMappings(
  site: string,
  analysis: IngestionAnalysis,
  criteria: SearchCriteria
): Promise<void> {
  const confirmed = new Set(analysis.confirmedFields);
  const now = new Date().toISOString();

  for (const field of LEARNABLE_ENUM_FIELDS) {
    if (!confirmed.has(field)) continue;
    const seg = analysis.inferredMapping.fieldToParam[field];
    const label = String((criteria as unknown as Record<string, unknown>)[field] ?? '').trim();
    if (!seg || !seg.rawValue || !label) continue;
    const code = seg.rawValue;

    const { data: existing } = await supabase
      .from('linkgen_enum_mappings')
      .select('id, label, confirmations')
      .eq('site', site)
      .eq('field', field)
      .eq('code', code)
      .maybeSingle();

    if (!existing) {
      await supabase.from('linkgen_enum_mappings').insert({
        site, field, code, label, confirmations: 1,
        last_confirmed_at: now, updated_at: now,
      });
    } else if (existing.label.toLowerCase() === label.toLowerCase()) {
      await supabase
        .from('linkgen_enum_mappings')
        .update({
          confirmations: (existing.confirmations ?? 0) + 1,
          last_confirmed_at: now, updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      // Contradiction (same code, different label) — keep existing, log only.
      console.warn(`[INGESTION] enum conflict ${site}/${field}/${code}: kept "${existing.label}", ignored "${label}"`);
    }
  }
}

/**
 * Look up already-learned enum labels for a pasted URL, so the Ingestion form
 * can auto-fill fields the user has confirmed before. Returns a partial
 * criteria patch ({ gearbox: 'Automatique', … }).
 */
export async function loadLearnedEnums(
  site: string,
  segments: Array<{ paramName: string; raw: string; guessField?: string }>
): Promise<Partial<Record<LearnableEnumField, string>>> {
  const out: Partial<Record<LearnableEnumField, string>> = {};
  const enumSegs = segments.filter(
    (s) => s.guessField && (LEARNABLE_ENUM_FIELDS as readonly string[]).includes(s.guessField)
  );
  if (enumSegs.length === 0) return out;

  for (const seg of enumSegs) {
    const field = seg.guessField as LearnableEnumField;
    const { data } = await supabase
      .from('linkgen_enum_mappings')
      .select('label')
      .eq('site', site)
      .eq('field', field)
      .eq('code', seg.raw)
      .maybeSingle();
    if (data?.label) out[field] = data.label;
  }
  return out;
}
