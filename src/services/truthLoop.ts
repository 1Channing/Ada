/**
 * Truth Center — briques 3b / 4 / 5 côté FRONT (GO Channing 03/09) :
 * lectures des tables écrites par le worker à la fin de chaque vague, et
 * le geste « figer un cas doré » (admin) depuis la Bibliothèque.
 * Toutes les lectures dégradent proprement tant que la migration
 * 20260904100000 n'est pas collée (null / listes vides, jamais d'erreur).
 */
import { supabase } from '../lib/supabase';

export interface TruthDigest {
  day: string;
  generated_at: string;
  summary: string;
  payload: {
    etudes?: { actives: number; passees: number; non_passees: string[] };
    annonces?: { nouvelles: number; baisses: number; par_site: Record<string, number> };
    dossiers?: { ouverts: number; nouveaux: string[]; resolus: number };
    segments_douteux?: Array<{ segment: string; score: number }>;
    cas_dores_en_echec?: string[];
    sites?: { erreurs_zyte: number; pages_bloquees: number };
    taxonomie_apprise?: Record<string, number>;
    veille_legale?: string;
  };
}

export interface ConfidenceRow {
  site: string; country: string; brand: string; model: string;
  score: number; label: 'fiable' | 'a_surveiller' | 'douteux';
  components: Record<string, { points?: number; [k: string]: unknown }>;
  computed_at: string;
}

export interface GoldenRow {
  id: string; site: string; label: string; criterion: string; source: string;
  created_by: string | null; created_at: string;
  last_run_at: string | null; last_status: 'pass' | 'fail' | null; last_url: string | null; last_detail: string | null;
}

export const CONFIDENCE_LABEL: Record<ConfidenceRow['label'], string> = {
  fiable: 'fiable', a_surveiller: 'à surveiller', douteux: 'douteux',
};

export async function loadLatestDigest(): Promise<TruthDigest | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('truth_digests').select('*').order('day', { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  return data[0] as TruthDigest;
}

/** Badge par segment, clé `${site}|${country}|${BRAND}|${MODEL}`. */
export async function loadConfidence(): Promise<Map<string, ConfidenceRow>> {
  const out = new Map<string, ConfidenceRow>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('truth_confidence').select('*').limit(2000);
  if (error) return out;
  for (const r of (data ?? []) as ConfidenceRow[]) out.set(`${r.site}|${r.country}|${r.brand}|${r.model}`, r);
  return out;
}
export const confidenceKey = (site: string, country: string, brand: string, model: string) =>
  `${site}|${country}|${brand.toUpperCase()}|${(model ?? '').toUpperCase()}`;

export async function loadGolden(): Promise<GoldenRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('truth_golden').select('*').order('site').order('label');
  if (error) return [];
  return (data ?? []) as GoldenRow[];
}

/** Figer un cas doré depuis la Bibliothèque (admin) — la valeur DOIT être
 *  native au moment du geste : on fige une preuve, jamais un espoir. */
export async function addGolden(input: { site: string; label: string; criterion: string; brand: string; extra: Record<string, unknown>; distinctFrom?: Record<string, unknown>; url: string | null; createdBy: string }): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('truth_golden').insert({
    site: input.site, label: input.label, criterion: input.criterion, source: 'bibliotheque', created_by: input.createdBy,
    params: { brand: input.brand, model: '', extra: input.extra, ...(input.distinctFrom ? { distinctFrom: input.distinctFrom } : {}) },
    last_run_at: new Date().toISOString(), last_status: 'pass', last_url: input.url, last_detail: 'figé depuis la Bibliothèque',
  });
  return error ? error.message : null;
}

export async function deleteGolden(id: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('truth_golden').delete().eq('id', id);
  return error ? error.message : null;
}
