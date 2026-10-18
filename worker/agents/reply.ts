/**
 * LA RÉPONSE PRÉPARÉE À UN MAIL REÇU, CÔTÉ WORKER (18/10 ; consigne et
 * contrôle : src/lib/agents/reply.ts). La synchro de la boîte pose une tâche
 * quand un prospect répond pour de vrai, dans une conversation lancée par MC
 * Export ; la tâche réutilise le type « premier_mail » (params.reponse_a =
 * le mail reçu), sans SQL à coller. Opus 5.5 écrit la réponse, ADA la
 * contrôle et l'enregistre « à valider », sous le mail reçu dans le fil :
 * rien ne part sans Channing.
 */
import { OPUS } from '../../src/lib/agents/aiCost';
import { replySystem, replyPrompt, REPLY_SCHEMA, checkReply, INTENT_LABEL, type ReplyOutput, type ReplyTurn } from '../../src/lib/agents/reply';
import { replySubject } from '../../src/lib/agents/mail';
import { withAgentSignature } from '../../src/lib/agents/firstMail';
import { suppressionMatch } from '../../src/lib/agents/sendPolicy';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { sb, journal, loadSuppressions } from './store';
import { live } from './live';
import type { AiAgent } from './qualify';

export interface ReplyOutcome { status: 'redige' | 'ignore' | 'echec'; name: string; detail: string; cost: number }

/** Une réponse déjà écrite après le mail reçu (brouillon compris), ou partie. */
const ANSWERED = ['brouillon', 'a_valider', 'valide', 'envoi', 'envoye', 'envoye_main', 'pour_channing'];
/** Un mail reçu plus vieux que ça (rattrapage de la boîte) n'appelle pas de réponse préparée. */
const RECENT_MS = 3 * 86_400_000;

interface InMail { id: string; thread_id: string; agent: string; direction: string; from_email: string | null; from_name: string | null; subject: string; classification: string | null; auto_reply: boolean; received_at: string | null; created_at: string }
interface ThreadMail { id: string; direction: string; status: string; channel: string; body_text: string; body_new: string | null; attachments: Array<{ name: string }> | null; received_at: string | null; sent_at: string | null; created_at: string }

const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '?');

/** Après l'import d'une vraie réponse (sync.ts) : la réponse préparée est demandée, si la conversation vient de MC Export. */
export async function queueReplyDraft(agent: string, threadId: string, messageId: string, receivedAt: Date): Promise<void> {
  if (Date.now() - receivedAt.getTime() > RECENT_MS) return;
  const [{ data: th }, { data: sent }] = await Promise.all([
    sb.from('agent_threads').select('prospect_id').eq('id', threadId).maybeSingle(),
    sb.from('agent_messages').select('id').eq('thread_id', threadId).eq('direction', 'out').in('status', ['envoye', 'envoye_main']).limit(1),
  ]);
  const prospect = (th as { prospect_id?: string | null } | null)?.prospect_id ?? null;
  if (!prospect && ((sent ?? []) as unknown[]).length === 0) return;
  const { error } = await sb.from('agent_tasks').insert({ agent, kind: 'premier_mail', params: { reponse_a: messageId, auto: true }, created_by: null });
  if (error) console.warn(`[AGENTS] ${agent} : réponse préparée non demandée (${error.message})`);
}

export async function draftReply(messageId: string, a: AiAgent, taskId: string | null): Promise<ReplyOutcome> {
  const { data } = await sb.from('agent_messages').select('id, thread_id, agent, direction, from_email, from_name, subject, classification, auto_reply, received_at, created_at').eq('id', messageId).maybeSingle();
  const inMail = data as InMail | null;
  if (!inMail) return { status: 'echec', name: messageId, detail: 'mail reçu introuvable', cost: 0 };
  const who = inMail.from_name || inMail.from_email || '?';
  const skip = (detail: string): ReplyOutcome => ({ status: 'ignore', name: who, detail, cost: 0 });
  if (inMail.agent !== a.agent) return skip('pas dans sa boîte');
  if (inMail.direction !== 'in') return skip('pas un mail reçu');
  if (inMail.auto_reply || inMail.classification === 'rebond' || inMail.classification === 'absence') return skip('réponse automatique ou rebond');
  if (inMail.classification === 'stop') return skip('il demande qu\'on ne lui écrive plus');
  if (!inMail.from_email) return skip('expéditeur inconnu');
  if (suppressionMatch([inMail.from_email], await loadSuppressions())) return skip(`${inMail.from_email} est sur « ne plus contacter »`);

  const [{ data: th }, { data: ms }] = await Promise.all([
    sb.from('agent_threads').select('id, subject, prospect_id').eq('id', inMail.thread_id).maybeSingle(),
    sb.from('agent_messages').select('id, direction, status, channel, body_text, body_new, attachments, received_at, sent_at, created_at').eq('thread_id', inMail.thread_id).order('created_at', { ascending: true }).limit(100),
  ]);
  const thread = th as { id: string; subject: string; prospect_id: string | null } | null;
  const all = (ms ?? []) as ThreadMail[];
  if (!thread) return { status: 'echec', name: who, detail: 'fil introuvable', cost: 0 };
  if (all.some((m) => m.direction === 'out' && m.channel === 'mail' && m.created_at > inMail.created_at && ANSWERED.includes(m.status))) return skip('une réponse est déjà prête ou partie');
  if (all.some((m) => m.direction === 'in' && m.id !== inMail.id && m.created_at > inMail.created_at)) return skip('un mail plus récent est arrivé : c\'est à lui qu\'on répondra');
  const ours = all.some((m) => m.direction === 'out' && (m.status === 'envoye' || m.status === 'envoye_main'));
  if (!thread.prospect_id && !ours) return skip('pas une conversation lancée par MC Export');

  // Le matériel : le fil (les mails partis et reçus), sa fiche, les consignes de Channing.
  let company: string | null = null;
  let summary: string | null = null;
  if (thread.prospect_id) {
    const { data: p } = await sb.from('agent_prospects').select('name, summary').eq('id', thread.prospect_id).maybeSingle();
    company = (p as { name?: string } | null)?.name ?? null;
    summary = (p as { summary?: string | null } | null)?.summary ?? null;
  }
  const history: ReplyTurn[] = all
    .filter((m) => m.channel === 'mail' && (m.direction === 'in' || m.status === 'envoye' || m.status === 'envoye_main'))
    .map((m) => ({
      from: m.direction === 'in' ? 'eux' : 'nous', at: when(m.received_at ?? m.sent_at ?? m.created_at),
      text: (m.direction === 'in' ? m.body_new || m.body_text : m.body_text) ?? '', attachments: (m.attachments ?? []).map((x) => x.name),
    }));
  const role = a.agent === 'dana' ? 'dana' : 'ada';
  const prompt = replyPrompt({ role, company, person: who, summary, history, instructions: a.instructions ?? '' });

  live(taskId, `${who} a répondu : ${a.display_name} prépare la réponse (IA)`);
  let out: ReplyOutput;
  let cost = 0;
  try {
    const budget = Number(a.daily_budget_usd);
    const r = await callClaude<ReplyOutput>({
      agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'reponse', model: OPUS,
      system: replySystem(role, a.display_name), user: prompt, schema: REPLY_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 4000, effort: 'medium', prospectId: thread.prospect_id, taskId, fallbacks: true,
    });
    out = r.data as ReplyOutput;
    cost = r.costUsd;
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    return { status: 'echec', name: who, detail: e instanceof Error ? e.message : String(e), cost: 0 };
  }
  if (!out?.corps?.trim()) return { status: 'echec', name: who, detail: 'réponse vide', cost };
  const check = checkReply(out, role);
  const subject = replySubject(inMail.subject || thread.subject).slice(0, 200);
  const { data: ins, error } = await sb.from('agent_messages').insert({
    thread_id: thread.id, agent: a.agent, mailbox: a.mailbox, channel: 'mail', direction: 'out', status: 'a_valider', kind: 'reponse', author: a.agent,
    to_emails: [inMail.from_email], cc_emails: [], subject, body_text: withAgentSignature(out.corps, a.signature ?? ''),
    translation_fr: out.langue === 'fr' ? null : out.traduction_fr ?? null,
    ai_notes: {
      modele: OPUS, cout_usd: Math.round(cost * 10_000) / 10_000, langue: out.langue, mots: check.words, faits: (out.faits ?? []).slice(0, 12), alertes: check.warnings,
      resume: out.resume, intention: out.intention, appel: !!out.appel,
    },
  }).select('id');
  const id = ((ins ?? []) as Array<{ id: string }>)[0]?.id;
  if (error || !id) return { status: 'echec', name: who, detail: `réponse non enregistrée : ${error?.message ?? '?'}`, cost };
  await journal({
    agent: a.agent, actor: a.agent, kind: 'reponse_preparee', threadId: thread.id, messageId: id,
    summary: `Réponse préparée pour ${who} (« ${subject} ») : ${INTENT_LABEL[out.intention] ?? out.intention}${out.appel ? ', à appeler' : ''} — à valider`,
    details: { cout_usd: Math.round(cost * 10_000) / 10_000, intention: out.intention, resume: out.resume },
  });
  return { status: 'redige', name: who, detail: out.resume, cost };
}
