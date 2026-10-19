/**
 * LES LEÇONS, CÔTÉ WORKER (19/10 ; la consigne et le contrôle :
 * src/lib/agents/lessons.ts). Les leçons validées par Channing sont relues
 * avant chaque fiche, chaque recherche approfondie et chaque mail ; une
 * correction de l'équipe — le bon contact donné sur une fiche, un brouillon
 * refusé avec son motif, un brouillon corrigé puis envoyé — devient une
 * leçon PROPOSÉE (Haiku 5.5), que Channing valide, reformule ou rejette
 * (« Ce que … sait »). Table agent_lessons (SQL agents_lecons) : sans elle,
 * l'agente travaille comme avant.
 */
import { HAIKU } from '../../src/lib/agents/aiCost';
import { LESSON_SYSTEM, LESSON_SCHEMA, lessonPrompt, cleanLesson, lessonsFor, lessonLines, type Lesson, type LessonMaterial, type LessonOutput } from '../../src/lib/agents/lessons';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { sb, journal } from './store';
import type { AiAgent } from './qualify';

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; rows: Lesson[] }>();
const missing = (m: string) => /does not exist|schema cache|relation .*agent_lessons/i.test(m);
let table: { at: number; ok: boolean } | null = null;

/**
 * La table agent_lessons existe-t-elle (SQL agents_lecons collé) ? Sans elle, aucune leçon n'est
 * proposée — pas d'appel à Haiku, et les corrections ne sont pas marquées : elles serviront une fois la table créée.
 */
async function lessonsTable(): Promise<boolean> {
  if (table && Date.now() - table.at < TTL_MS) return table.ok;
  const { error } = await sb.from('agent_lessons').select('id').limit(1);
  table = { at: Date.now(), ok: !(error && missing(error.message)) };
  return table.ok;
}

/** Les leçons d'une agente (relues toutes les 5 minutes ; aucune tant que le SQL n'est pas collé). */
export async function loadLessons(agent: string): Promise<Lesson[]> {
  const c = cache.get(agent);
  if (c && Date.now() - c.at < TTL_MS) return c.rows;
  const { data, error } = await sb.from('agent_lessons').select('*').eq('agent', agent).eq('status', 'validee').limit(200);
  const rows = error ? [] : (data ?? []) as Lesson[];
  cache.set(agent, { at: Date.now(), rows });
  return rows;
}
export const forgetLessons = (): void => { cache.clear(); table = null; };

/** Les lignes de leçons d'une consigne (recherche, ou mails), pour ce type d'entreprise et ce pays. */
export async function lessonsBlock(agent: string, scope: 'recherche' | 'mail', ctx: { segment?: string | null; kind?: string | null; country?: string | null }): Promise<string[]> {
  return lessonLines(lessonsFor(await loadLessons(agent), scope, ctx));
}

/**
 * Propose une leçon à partir d'une correction : Haiku la formule, elle est enregistrée « proposée » —
 * rien ne change dans les consignes tant que Channing ne l'a pas validée. Rend l'identifiant, ou null.
 */
export async function proposeLesson(a: AiAgent, m: LessonMaterial, details: Record<string, unknown>, taskId: string | null): Promise<string | null> {
  if (!(await lessonsTable())) return null;
  let out: LessonOutput | null = null;
  try {
    const budget = Number(a.daily_budget_usd);
    const r = await callClaude<LessonOutput>({
      agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'lecon', model: HAIKU,
      system: LESSON_SYSTEM, user: lessonPrompt(m), schema: LESSON_SCHEMA as unknown as Record<string, unknown>, maxTokens: 1500, effort: 'low', taskId,
    });
    out = r.data;
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) return null;
    console.warn(`[AGENTS] leçon non proposée : ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  const l = cleanLesson(out);
  if (!l) return null;
  const { data, error } = await sb.from('agent_lessons').insert({
    agent: a.agent, status: 'proposee', scope: l.scope, segment: l.segment ?? m.segment ?? null, country: l.country, text: l.text, source: m.source, details,
  }).select('id');
  if (error) {
    if (!missing(error.message)) console.warn(`[AGENTS] leçon non enregistrée : ${error.message}`);
    return null;
  }
  const id = ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  await journal({ agent: a.agent, actor: a.agent, kind: 'lecon_proposee', summary: `Leçon proposée (${m.company}) : « ${l.text} » — à valider dans « Ce que ${a.display_name} sait »`, details: { lecon: id, source: m.source } });
  return id;
}

interface DraftRow {
  id: string; thread_id: string; agent: string; status: string; subject: string; body_text: string; refused_reason: string | null; updated_at: string;
  ai_notes: { texte_initial?: string; lecon?: string; aiguillage?: unknown } | null;
}

const words = (s: string) => s.toLowerCase().split(/[^a-zà-ÿ0-9]+/i).filter((w) => w.length > 2);
/** Un brouillon vraiment corrigé : plus d'un mot sur six changé (pas une virgule). */
export function reallyEdited(before: string, after: string): boolean {
  const a = words(before);
  const b = new Set(words(after));
  if (!a.length) return false;
  const kept = a.filter((w) => b.has(w)).length;
  const added = [...b].filter((w) => !a.includes(w)).length;
  return (a.length - kept + added) / Math.max(a.length, b.size) > 1 / 6;
}

/**
 * Le cycle : les brouillons refusés avec un motif et les brouillons corrigés puis validés de la semaine
 * deviennent des leçons proposées — trois au plus par cycle, chacun une fois (noté sur le message).
 */
export async function autoLessons(a: AiAgent): Promise<void> {
  if (!(await lessonsTable())) return;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await sb.from('agent_messages').select('id, thread_id, agent, status, subject, body_text, refused_reason, updated_at, ai_notes')
    .eq('agent', a.agent).eq('direction', 'out').eq('author', a.agent).in('status', ['refuse', 'valide', 'envoi', 'envoye']).gte('updated_at', since).limit(200);
  if (error) return;
  const rows = ((data ?? []) as DraftRow[]).filter((m) => !m.ai_notes?.lecon);
  let n = 0;
  for (const m of rows) {
    if (n >= 3) break;
    const refused = m.status === 'refuse' && (m.refused_reason ?? '').trim().length >= 8;
    const initial = m.ai_notes?.texte_initial ?? '';
    const edited = m.status !== 'refuse' && !!initial && reallyEdited(initial, m.body_text);
    if (!refused && !edited) continue;
    const { data: th } = await sb.from('agent_threads').select('prospect_id, counterpart_name, subject').eq('id', m.thread_id).maybeSingle();
    const t = th as { prospect_id: string | null; counterpart_name: string | null; subject: string } | null;
    let company = t?.counterpart_name ?? t?.subject ?? '?';
    let country: string | null = null;
    let kind: string | null = null;
    if (t?.prospect_id) {
      const { data: p } = await sb.from('agent_prospects').select('name, country, kind').eq('id', t.prospect_id).maybeSingle();
      const x = p as { name: string; country: string | null; kind: string | null } | null;
      if (x) { company = x.name; country = x.country; kind = x.kind; }
    }
    n++;
    const id = await proposeLesson(a, {
      source: refused ? 'refus' : 'correction', agent: a.agent === 'dana' ? 'dana' : 'ada', company, country, segment: kind, segmentLabel: kind,
      draft: refused ? `${m.subject}\n\n${m.body_text}` : initial, reason: refused ? m.refused_reason : null, sent: edited ? m.body_text : null,
    }, { message_id: m.id }, null);
    // Noté sur le message, même sans leçon (rien à apprendre) : il n'est pas relu au prochain cycle.
    await sb.from('agent_messages').update({ ai_notes: { ...(m.ai_notes ?? {}), lecon: id ?? 'aucune' } }).eq('id', m.id);
  }
}
