/**
 * LA RÉPONSE PRÉPARÉE À UN MAIL REÇU, CÔTÉ WORKER (18/10 ; consigne et
 * contrôle : src/lib/agents/reply.ts). La synchro de la boîte pose une tâche
 * quand un prospect répond pour de vrai, dans une conversation lancée par MC
 * Export ; la tâche réutilise le type « premier_mail » (params.reponse_a =
 * le mail reçu), sans SQL à coller. Opus 5.5 écrit la réponse, ADA la
 * contrôle et l'enregistre « à valider », sous le mail reçu dans le fil :
 * rien ne part sans Channing.
 * 19/10 — l'aiguillage : quand la réponse donne le contact cherché (écrit
 * dans son mail, jamais deviné), il entre sur la fiche comme le contact à
 * qui écrire, et le vrai premier mail est préparé pour lui (à valider) ;
 * la réponse à l'aiguilleur le remercie, simplement.
 */
import { OPUS } from '../../src/lib/agents/aiCost';
import { replySystem, replyPrompt, REPLY_SCHEMA, checkReply, INTENT_LABEL, givenContact, type ReplyOutput, type ReplyTurn } from '../../src/lib/agents/reply';
import { hasMx } from './qualify';
import { lessonsBlock } from './lessons';
import { forgetTeam } from './team';
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
interface ThreadMail {
  id: string; direction: string; status: string; channel: string; body_text: string; body_new: string | null; attachments: Array<{ name: string }> | null; received_at: string | null; sent_at: string | null; created_at: string;
  ai_notes?: { aiguillage?: { cherche?: string; cible?: string | null } } | null;
}

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
    sb.from('agent_messages').select('id, direction, status, channel, body_text, body_new, attachments, received_at, sent_at, created_at, ai_notes').eq('thread_id', inMail.thread_id).order('created_at', { ascending: true }).limit(100),
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
  // 19/10 : un fil d'aiguillage — on lui avait demandé le contact de la bonne personne.
  const ask = all.find((m) => m.direction === 'out' && m.ai_notes?.aiguillage)?.ai_notes?.aiguillage ?? null;
  const routing = ask ? { cherche: ask.cherche ?? 'pouvait nous aider', cible: ask.cible ?? null } : null;
  const lessons = await lessonsBlock(a.agent, 'mail', {});
  const base = replyPrompt({ role, company, person: who, summary, history, instructions: a.instructions ?? '', routing });
  const prompt = lessons.length ? `${base}\n\n${lessons.join('\n')}` : base;

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
  // Le contact qu'il donne, s'il est écrit dans son mail : il entre sur la fiche, et le premier mail lui est préparé.
  const lastText = (() => { const m = all.find((x) => x.id === inMail.id); return `${m?.body_new ?? ''}\n${m?.body_text ?? ''}`; })();
  const given = givenContact(out, lastText);
  if (given && thread.prospect_id && given.email !== inMail.from_email?.toLowerCase()) {
    await applyGivenContact(a, thread.prospect_id, given, who, !!routing, taskId).catch((e: unknown) => console.warn(`[AGENTS] contact donné non enregistré : ${e instanceof Error ? e.message : String(e)}`));
  }
  const subject = replySubject(inMail.subject || thread.subject).slice(0, 200);
  const { data: ins, error } = await sb.from('agent_messages').insert({
    thread_id: thread.id, agent: a.agent, mailbox: a.mailbox, channel: 'mail', direction: 'out', status: 'a_valider', kind: 'reponse', author: a.agent,
    to_emails: [inMail.from_email], cc_emails: [], subject, body_text: withAgentSignature(out.corps, a.signature ?? ''),
    translation_fr: out.langue === 'fr' ? null : out.traduction_fr ?? null,
    ai_notes: {
      modele: OPUS, cout_usd: Math.round(cost * 10_000) / 10_000, langue: out.langue, mots: check.words, faits: (out.faits ?? []).slice(0, 12), alertes: check.warnings,
      resume: out.resume, intention: out.intention, appel: !!out.appel, texte_initial: out.corps.trim(), contact_donne: given ?? null,
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

/**
 * Le contact donné en réponse (19/10) : sur la fiche (« via aiguillage », sa source : la réponse), comme
 * le contact à qui écrire ; puis le premier mail préparé pour lui, à valider. Rien ne part sans Channing.
 */
async function applyGivenContact(a: AiAgent, prospectId: string, c: { nom: string | null; fonction: string | null; email: string; telephone: string | null }, from: string, routing: boolean, taskId: string | null): Promise<void> {
  const { data } = await sb.from('agent_prospects').select('id, name, people, emails, best_contact').eq('id', prospectId).maybeSingle();
  const p = data as { id: string; name: string; people: Array<Record<string, unknown>> | null; emails: Array<{ email: string }> | null; best_contact: Record<string, unknown> | null } | null;
  if (!p) return;
  const day = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const source = `réponse de ${from} du ${day}`;
  const nom = c.nom ?? c.email;
  const fonction = c.fonction ?? (routing ? 'contact donné en réponse à notre demande' : 'contact donné');
  const people = [...(p.people ?? []).filter((x) => String(x.email ?? '').toLowerCase() !== c.email), { nom, fonction, email: c.email, telephone: c.telephone, source, via: 'aiguillage', niveau: 'demarrer' }];
  const mx = await hasMx(c.email.split('@')[1] ?? '');
  const emails = [...(p.emails ?? []).filter((e) => e.email !== c.email), { email: c.email, nature: 'nominatif', source, mx, via: 'aiguillage' }];
  const best = { nom, fonction, email: c.email, telephone: c.telephone, niveau: 'demarrer', pourquoi: `Contact donné par ${from}${routing ? ', en réponse à notre demande' : ''}.` };
  await sb.from('agent_prospects').update({ people: people.slice(0, 20), emails: emails.slice(0, 30), best_contact: best, updated_at: new Date().toISOString() }).eq('id', p.id);
  forgetTeam();
  await journal({ agent: a.agent, actor: a.agent, kind: 'contact_donne', summary: `${from} a donné le contact de ${nom}${c.fonction ? ` (${c.fonction})` : ''} pour ${p.name} : ${c.email}${mx ? '' : ' (le domaine ne reçoit pas de courrier)'}${mx ? ' — premier mail préparé, à valider' : ''}`, details: { prospect_id: p.id, email: c.email } });
  if (!mx) return;
  const { error } = await sb.from('agent_tasks').insert({ agent: a.agent, kind: 'premier_mail', params: { prospect_ids: [p.id], apres_aiguillage: true, auto: true }, created_by: null });
  if (error) console.warn(`[AGENTS] premier mail après aiguillage non demandé : ${error.message}`);
  void taskId;
}
