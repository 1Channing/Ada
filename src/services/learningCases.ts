/**
 * BOÎTE À APPRENDRE, côté front (01/10). Les cas qu'ADA ne sait pas encore
 * traiter, enregistrés par le worker (vitrines non reconnues…), à revoir
 * ensemble : lecture, clôture (fait / ignoré), réouverture.
 */
import { supabase } from '../lib/supabase';

export interface LearningCase {
  id: string; kind: string; key: string; title: string; url: string | null; contact_id: string | null; submitted_by: string | null;
  detail: Record<string, unknown> | null; status: 'open' | 'done' | 'ignored'; seen_count: number; resolution: string | null;
  created_at: string; last_seen_at: string; resolved_at: string | null;
}

export const KIND_LABEL: Record<string, string> = {
  dealer_site_unknown: 'Vitrine de concession non reconnue',
};

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /does not exist|relation|schema cache/i.test(m);

export async function listLearningCases(status: 'open' | 'done' | 'ignored' | 'all' = 'open'): Promise<{ cases: LearningCase[]; error: string | null }> {
  let q = untyped.from('learning_cases').select('*').order('last_seen_at', { ascending: false }).limit(500);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { cases: [], error: missing(error.message) ? 'SQL du 01/10 (learning_cases) à coller.' : error.message };
  return { cases: (data ?? []) as LearningCase[], error: null };
}

export async function setLearningCaseStatus(id: string, status: 'open' | 'done' | 'ignored', resolution?: string): Promise<string | null> {
  const { error } = await untyped.from('learning_cases').update({
    status, resolution: status === 'open' ? null : (resolution ?? null), resolved_at: status === 'open' ? null : new Date().toISOString(),
  }).eq('id', id);
  return error ? error.message : null;
}
