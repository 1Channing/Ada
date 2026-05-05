import { supabase } from '../supabase';
import type { LinkGenParams, ScoutHypothesis, SiteKey, ValidationStatus } from './types';

/**
 * Looks up pending CSV-sourced memory records for the given site/brand/model
 * and returns them as Scout hypotheses to be tested (never used directly).
 *
 * A pending record is only promoted to valid if Scout scores it >= 80.
 * Fetch failures keep the record pending.
 */
export async function getPendingMappingHypotheses(
  params: LinkGenParams,
  site: SiteKey
): Promise<ScoutHypothesis[]> {
  if (!params.brand || !params.model) return [];

  const { data, error } = await supabase
    .from('linkgen_mapping_memory')
    .select('id, source_url, confidence, scout_score')
    .eq('site', site)
    .ilike('brand', params.brand)
    .ilike('model', params.model)
    .eq('validation_status', 'pending')
    .gte('confidence', 0.7)
    .order('confidence', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return [];

  // Cast because database.types may not reflect this table
  const record = data as unknown as { id: string; source_url: string | null };
  if (!record.source_url) return [];

  return [
    {
      url: record.source_url,
      reason: 'csv_pending_mapping_hypothesis',
      score: 0,
      status: 'not_checked' as ValidationStatus,
      rankInBatch: 1,
      memoryRecordId: record.id,
    },
  ];
}
