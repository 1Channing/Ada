/**
 * LES RÈGLES APPRISES VALIDÉES (Atelier › Apprentissage des sites, 30/10) : linkgen_learned_rules, statut
 * « active » seulement — chargées comme le dictionnaire (taxonomy.ts), rafraîchies au-delà de 10 min. Table
 * absente (SQL du 30/10 pas encore collé) ou illisible : aucune règle, sans bruit, rien ne casse.
 *
 * Et la file : ce que le générateur ne sait pas écrire est noté (linkgen_note_gap), une même lacune au plus une
 * fois par heure et par navigateur ou worker.
 */
import { sharedSupabase as supabase } from '../supabaseShared';
import { learningKey, type LearnedRuleRow, type LearningKind } from './learning';

let rules: LearnedRuleRow[] = [];
let loadedAt = 0;
let pending: Promise<void> | null = null;

export async function loadLearnedRules(): Promise<void> {
  const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: LearnedRuleRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('linkgen_learned_rules')
      .select('id, site, kind, brand_key, model_key, criterion, value_key, rule, status')
      .eq('status', 'active').order('validated_at', { ascending: true }).range(from, from + 999);
    if (error) break;
    out.push(...((data ?? []) as LearnedRuleRow[]));
    if (!data || data.length < 1000) break;
  }
  rules = out;
  loadedAt = Date.now();
}

export async function ensureLearnedRules(maxAgeMs = 10 * 60_000): Promise<void> {
  if (loadedAt && Date.now() - loadedAt < maxAgeMs) return;
  pending ??= loadLearnedRules().catch(() => { loadedAt = Date.now(); }).finally(() => { pending = null; });
  await pending;
}

/** Les règles actives d'un site (déjà chargées). */
export const learnedRulesFor = (site: string): LearnedRuleRow[] => rules.filter((r) => r.site === site);

/** Pour les tests : poser les règles sans base. */
export function setLearnedRulesForTests(rows: LearnedRuleRow[]): void {
  rules = rows;
  loadedAt = Date.now();
}

// ─── Noter une lacune ─────────────────────────────────────────────────────────────────────────────

const recent = new Map<string, number>();
let noteDisabled = false;

export interface GapNote {
  kind: LearningKind;
  site: string;
  brand: string;
  model: string;
  brandKey: string;
  modelKey: string;
  criterion?: string;
  value?: string;
  valueKey?: string;
  source: string;
  startUrl: string;
}

/** Note une lacune pour l'apprentissage des sites — en arrière-plan, jamais bloquant. */
export function noteLearningGap(g: GapNote): void {
  if (noteDisabled) return;
  const key = learningKey(g.kind, g.site, { brandKey: g.brandKey, modelKey: g.modelKey, criterion: g.criterion, valueKey: g.valueKey });
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - 3_600_000) return;
  recent.set(key, now);
  const sb = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> };
  void Promise.resolve(sb.rpc('linkgen_note_gap', {
    p_key: key, p_kind: g.kind, p_site: g.site, p_brand: g.brand, p_model: g.model,
    p_criterion: g.criterion ?? '', p_value: g.value ?? '', p_source: g.source, p_start_url: g.startUrl,
  })).then(({ error }) => {
    // SQL du 30/10 pas encore collé : on se tait pour le reste de la session.
    if (error && /linkgen_note_gap|does not exist|Could not find/i.test(error.message)) noteDisabled = true;
  }, () => undefined);
}

/** Pour les tests : vider l'anti-doublon. */
export function resetGapNotesForTests(): void {
  recent.clear();
  noteDisabled = false;
}
