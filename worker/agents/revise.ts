/**
 * LA MODIFICATION DEMANDÉE À L'AGENTE, CÔTÉ WORKER (23/11 ; src/lib/agents/revise.ts). Une tâche « premier_mail »
 * avec params.reecrire (l'identifiant du mail) et params.note : l'agente reprend son mail (brouillon ou à valider),
 * le corrige selon la note, et le remplace en place — objet, texte (avec sa signature), traduction, alertes — toujours
 * « à valider ». La version d'avant et la note restent dans ai_notes.revisions. Un mail parti ou en partance n'est
 * jamais réécrit.
 */
import { OPUS } from '../../src/lib/agents/aiCost';
import { doctrineOf } from '../../src/lib/agents/danaDoctrine';
import { withAgentSignature } from '../../src/lib/agents/firstMail';
import { reviseSystem, revisePrompt, checkRevised, stripAgentSignature, REVISE_SCHEMA, type ReviseOutput } from '../../src/lib/agents/revise';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { live } from './live';
import type { AiAgent } from './qualify';
import { sb, journal } from './store';

interface Msg {
  id: string; thread_id: string; agent: string; direction: string; status: string; kind: string; subject: string; body_text: string;
  translation_fr: string | null; ai_notes: Record<string, unknown> | null;
}
const EDITABLE = ['brouillon', 'a_valider', 'refuse', 'pour_channing'];
const KIND_LABEL = (m: Msg): string => {
  const c = m.ai_notes?.campagne as { mode?: string } | undefined;
  if (c) return c.mode === 'aiguillage' ? 'mail d\'aiguillage' : 'premier mail ciblé';
  if (m.ai_notes?.aiguillage) return 'mail d\'aiguillage';
  return m.kind === 'reponse' ? 'réponse' : m.kind === 'relance' ? 'relance' : 'premier mail';
};

export async function reviseDraft(messageId: string, a: AiAgent, taskId: string | null, note: string): Promise<{ status: 'redige' | 'ignore' | 'echec'; detail: string; cost: number }> {
  const { data } = await sb.from('agent_messages').select('id, thread_id, agent, direction, status, kind, subject, body_text, translation_fr, ai_notes').eq('id', messageId).maybeSingle();
  const m = data as Msg | null;
  if (!m) return { status: 'echec', detail: 'mail introuvable', cost: 0 };
  if (m.agent !== a.agent || m.direction !== 'out') return { status: 'ignore', detail: 'pas un mail de l\'agente', cost: 0 };
  if (!EDITABLE.includes(m.status)) return { status: 'ignore', detail: `le mail est « ${m.status} » : il ne se réécrit plus`, cost: 0 };
  if (!note.trim()) return { status: 'ignore', detail: 'pas de note', cost: 0 };

  const [{ data: th }, { data: lastIn }] = await Promise.all([
    sb.from('agent_threads').select('counterpart_name, counterpart_email').eq('id', m.thread_id).maybeSingle(),
    sb.from('agent_messages').select('body_new, body_text').eq('thread_id', m.thread_id).eq('direction', 'in').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const t = th as { counterpart_name: string | null; counterpart_email: string | null } | null;
  const inbound = lastIn as { body_new: string | null; body_text: string | null } | null;
  const language = String(m.ai_notes?.langue ?? 'fr');
  const role = a.agent === 'dana' ? 'dana' : 'ada';
  const before = stripAgentSignature(m.body_text, a.signature ?? '');
  const prompt = revisePrompt({
    language, kindLabel: KIND_LABEL(m), counterpart: t?.counterpart_name || t?.counterpart_email || null,
    subject: m.subject, body: before, translation: m.translation_fr, lastInbound: inbound ? (inbound.body_new || inbound.body_text) : null, note,
  });
  live(taskId, `${a.display_name} corrige le mail à ${t?.counterpart_name || t?.counterpart_email || '?'} selon votre note (IA)`);
  let out: ReviseOutput;
  let cost = 0;
  try {
    const budget = Number(a.daily_budget_usd);
    const r = await callClaude<ReviseOutput>({
      agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'revision', model: OPUS,
      system: reviseSystem(role, a.display_name, role === 'dana' ? doctrineOf(a.instructions) : (a.instructions ?? '')), user: prompt,
      schema: REVISE_SCHEMA as unknown as Record<string, unknown>, maxTokens: 4000, effort: 'medium', taskId, fallbacks: true,
    });
    out = r.data as ReviseOutput;
    cost = r.costUsd;
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    return { status: 'echec', detail: e instanceof Error ? e.message : String(e), cost: 0 };
  }
  if (!out?.corps?.trim()) return { status: 'echec', detail: 'correction vide', cost };
  const check = checkRevised(out, role, `${m.subject}\n${before}`, note);
  const prev = Array.isArray(m.ai_notes?.revisions) ? (m.ai_notes!.revisions as unknown[]) : [];
  const notes = {
    ...(m.ai_notes ?? {}),
    alertes: check.warnings, mots: check.words,
    cout_usd: Math.round(((Number(m.ai_notes?.cout_usd) || 0) + cost) * 10_000) / 10_000,
    revisions: [...prev, { at: new Date().toISOString(), note: note.trim(), objet_avant: m.subject, texte_avant: before, cout_usd: Math.round(cost * 10_000) / 10_000 }].slice(-10),
  };
  const { error } = await sb.from('agent_messages').update({
    subject: (out.objet?.trim() || m.subject).slice(0, 200), body_text: withAgentSignature(out.corps, a.signature ?? ''),
    translation_fr: language === 'fr' ? null : (out.traduction_fr ?? m.translation_fr), ai_notes: notes, status: 'a_valider', error: null,
  }).eq('id', m.id).in('status', EDITABLE);
  if (error) return { status: 'echec', detail: `mail non remplacé : ${error.message}`, cost };
  await journal({
    agent: a.agent, actor: a.agent, kind: 'mail_corrige', threadId: m.thread_id, messageId: m.id,
    summary: `Mail corrigé selon la note de Channing pour ${t?.counterpart_name || t?.counterpart_email || '?'} — à valider${check.warnings.length ? ` (${check.warnings.length} point${check.warnings.length > 1 ? 's' : ''} à vérifier)` : ''}`,
    details: { note: note.trim(), cost_usd: Math.round(cost * 10_000) / 10_000 },
  });
  return { status: 'redige', detail: t?.counterpart_name || t?.counterpart_email || m.id, cost };
}
