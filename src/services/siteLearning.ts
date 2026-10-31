/**
 * L'APPRENTISSAGE DES SITES, CÔTÉ NAVIGATEUR (Atelier › Apprentissage des sites, 30/10) : la file
 * (linkgen_learning_items), les règles validées (linkgen_learned_rules) et les gestes — proposer une adresse,
 * « absent du site », valider, refuser, ignorer, retirer — tous par les fonctions SQL du 30/10, jamais par
 * écriture directe (quarantaine : rien n'entre dans la taxonomie sans un administrateur).
 */
import { supabase } from '../lib/supabase';
import { healOpenGaps } from '../lib/linkgen/gapHealing';
import { loadLearnedRules } from '../lib/linkgen/learnedRules';
import type { FilterRule, ModelFragment } from '../lib/linkgen/learning';

export type LearningStatus = 'a_chercher' | 'proposee' | 'a_valider' | 'validee' | 'absente' | 'suspendue' | 'resolue' | 'ignoree';

export interface Evaluation { verdict: 'ok' | 'echec' | 'humain' | 'impossible'; url: string; sample: number; detail: string; titles: string[] }

export interface LearningItem {
  id: string; kind: 'modele' | 'filtre'; site: string; brand: string; model: string; criterion: string; value: string;
  hits: number; sources: string[]; priority: number; first_seen_at: string; last_seen_at: string;
  start_url: string | null; status: LearningStatus; proposed_url: string | null; proposed_at: string | null;
  absent_note: string | null; learned: { rule?: ModelFragment | FilterRule; change?: string; absent?: boolean; value_key?: string } | null;
  check_result: { verdict: Evaluation['verdict']; conflict?: boolean; change?: string; claude?: Evaluation; ada?: Evaluation;
    /** Nom de Claude plus précis que le modèle (une version ?) : jamais validé seul (31/10). */
    warning?: string } | null;
  verify_url: string | null; decision_note: string | null; attempts: number; updated_at: string;
}

export interface LearnedRule {
  id: string; site: string; kind: 'modele' | 'filtre'; brand: string; model: string; criterion: string; value: string; value_key: string;
  rule: ModelFragment | FilterRule; status: 'active' | 'suspendue' | 'retiree'; proof_url: string | null; verify_url: string | null;
  validated_at: string; fail_count: number; last_check_at: string | null; retired_at: string | null; retire_note: string | null;
  /** null = validée automatiquement (contrôles à 100 %, 31/10). */
  validated_by: string | null;
}

const ITEM_COLS = 'id, kind, site, brand, model, criterion, value, hits, sources, priority, first_seen_at, last_seen_at, start_url, status, proposed_url, proposed_at, absent_note, learned, check_result, verify_url, decision_note, attempts, updated_at';
const sb = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Le SQL du 30/10 n'est pas encore collé ? (message à afficher tel quel) */
export const SQL_HINT = 'Le SQL du 30/10 (supabase/migrations/20261030200000_apprentissage_sites.sql) n\'est pas encore collé dans Supabase : la file d\'apprentissage est vide tant qu\'il manque.';
const missing = (m: string) => /linkgen_learning_items|linkgen_learned_rules|does not exist|schema cache/i.test(m);

export async function listLearningItems(statuses: LearningStatus[]): Promise<{ items: LearningItem[]; error: string | null }> {
  const { data, error } = await sb.from('linkgen_learning_items').select(ITEM_COLS).in('status', statuses)
    .order('priority', { ascending: false }).order('hits', { ascending: false }).order('last_seen_at', { ascending: false }).limit(300);
  if (error) return { items: [], error: missing(error.message) ? SQL_HINT : error.message };
  return { items: (data ?? []) as LearningItem[], error: null };
}

export async function listLearnedRules(): Promise<{ rules: LearnedRule[]; error: string | null }> {
  const { data, error } = await sb.from('linkgen_learned_rules')
    .select('id, site, kind, brand, model, criterion, value, value_key, rule, status, proof_url, verify_url, validated_at, validated_by, fail_count, last_check_at, retired_at, retire_note')
    .in('status', ['active', 'suspendue']).order('validated_at', { ascending: false }).limit(500);
  if (error) return { rules: [], error: missing(error.message) ? SQL_HINT : error.message };
  return { rules: (data ?? []) as LearnedRule[], error: null };
}

const call = async (fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: string | null }> => {
  const { data, error } = await sb.rpc(fn, args);
  return { data, error: error ? (missing(error.message) ? SQL_HINT : error.message) : null };
};

export const proposeUrl = async (id: string, url: string) => (await call('linkgen_learning_propose', { p_id: id, p_url: url.trim() })).error;
/** Le nom exact du modèle lu sur le site (31/10) : ADA construit et vérifie l'adresse elle-même. */
export const proposeLabel = async (id: string, label: string) => {
  const r = await call('linkgen_learning_propose_label', { p_id: id, p_label: label.trim() });
  return r.error && /propose_label|Could not find the function/i.test(r.error) ? 'Le SQL du 31/10 (20261031100000_apprentissage_nom_exact.sql) n\'est pas encore collé dans Supabase.' : r.error;
};
export const markAbsent = async (id: string, note: string) => (await call('linkgen_learning_absent', { p_id: id, p_note: note })).error;
export const ignoreItem = async (id: string, note: string) => (await call('linkgen_learning_ignore', { p_id: id, p_note: note })).error;

/** Valider ou refuser. Validé : les lacunes de campagne du même modèle se ferment, les règles sont rechargées. */
export async function decide(it: LearningItem, validate: boolean, note: string): Promise<string | null> {
  const { error } = await call('linkgen_learning_decide', { p_id: it.id, p_validate: validate, p_note: note });
  if (error) return error;
  if (validate) {
    if (it.kind === 'modele' && !it.learned?.absent) await healOpenGaps(it.site, it.brand, it.model).catch(() => 0);
    await loadLearnedRules().catch(() => undefined);
  }
  return null;
}

export async function retireRule(id: string, note: string): Promise<string | null> {
  const { error } = await call('linkgen_learned_rule_retire', { p_rule_id: id, p_note: note });
  if (!error) await loadLearnedRules().catch(() => undefined);
  return error;
}

/** Ce qu'une règle fait, en clair. */
export function describeRule(rule: ModelFragment | FilterRule | undefined | null): string {
  if (!rule) return '—';
  if ('op' in rule) return rule.op === 'param' ? `paramètre ${rule.param} = « ${rule.value} »` : `chemin : /${rule.segments.join('/')} après /${rule.after}`;
  switch (rule.encoding) {
    case 'param': return `paramètre ${rule.param} (valeur nue${rule.unit ? `, en ${rule.unit}` : ''})`;
    case 'range': return `paramètre ${rule.param}, plage « min${rule.sep}max » (borne ${rule.side === 'min' ? 'basse' : 'haute'})`;
    case 'hash': return `ancre #${rule.key}`;
    case 'code': return `paramètre ${rule.param} = ${rule.code}`;
    case 'segment': return `segment de chemin /${rule.segment}`;
  }
}
