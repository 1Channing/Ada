/**
 * ADA ET DANA — LES MAILS REÇUS (16/10). Toutes les 2 minutes, l'historique
 * Gmail de chaque boîte connectée (history.list depuis le dernier curseur ;
 * à la connexion, ADA part de maintenant — rien d'antérieur n'est importé) :
 * - chaque mail entre dans son fil (agent_threads / agent_messages), avec la
 *   partie nouvelle séparée de l'historique cité et ses pièces jointes
 *   rangées dans le bucket privé agent-mail ;
 * - tri sans IA : rebond (adresse morte → « ne plus contacter »), absence,
 *   demande d'arrêt explicite (→ « ne plus contacter ») ;
 * - une vraie réponse sonne dans la cloche du responsable (et part par
 *   e-mail via les rappels) ;
 * - un mail envoyé depuis Gmail lui-même (hors ADA) est aussi archivé ;
 *   pas le bilan du jour à l'équipe (en-tête interne, 18/10).
 * Aucun contenu de mail n'est écrit dans les logs (worker_logs est lisible).
 */
import {
  headersOf, parseAddressList, stripQuoted, htmlToText, isAutoReply, isBounce, bouncedRecipients, isStopRequest, base64UrlToUtf8, isInternalMail,
} from '../../src/lib/agents/mail';
import { gmail, GmailError, NotConnected } from './google';
import { sb, journal, alertOwner, suppress, updateAgent, advanceProspect, type AgentRow } from './store';

interface GmailPart {
  partId?: string; mimeType?: string; filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
interface GmailMessage { id: string; threadId: string; labelIds?: string[]; internalDate?: string; snippet?: string; payload?: GmailPart }

const CATCH_UP_QUERY = 'newer_than:7d -in:spam -in:trash -in:drafts';
const MAX_CATCH_UP = 300;
const ALERT_WINDOW_MS = 24 * 3600 * 1000;
const MAX_ATTACHMENT = 25 * 1024 * 1024;

interface Collected { text: string; html: string; attachments: Array<{ name: string; mime: string; size: number; attachmentId?: string; data?: string; inline: boolean }> }

function collect(part: GmailPart | undefined, acc: Collected = { text: '', html: '', attachments: [] }): Collected {
  if (!part) return acc;
  const mime = (part.mimeType ?? '').toLowerCase();
  const h = headersOf(part.headers);
  const disposition = (h['content-disposition'] ?? '').toLowerCase();
  if (part.filename) {
    acc.attachments.push({
      name: part.filename, mime: mime || 'application/octet-stream', size: part.body?.size ?? 0,
      attachmentId: part.body?.attachmentId, data: part.body?.data, inline: disposition.startsWith('inline') || !!h['content-id'],
    });
  } else if (mime === 'text/plain' && part.body?.data && !acc.text) acc.text = base64UrlToUtf8(part.body.data);
  else if (mime === 'text/html' && part.body?.data && !acc.html) acc.html = base64UrlToUtf8(part.body.data);
  for (const p of part.parts ?? []) collect(p, acc);
  return acc;
}

const safeName = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-120) || 'piece-jointe';
const cleanSubject = (s: string) => s.replace(/^((re|aw|sv|antw|tr|fw|fwd|wg|rv|r|rif|vs)\s*:\s*)+/i, '').trim();

async function saveAttachments(a: AgentRow, m: GmailMessage, list: Collected['attachments']): Promise<Array<{ path: string; name: string; mime: string; size: number }>> {
  const out: Array<{ path: string; name: string; mime: string; size: number }> = [];
  for (const att of list) {
    // Logos et images de signature : on ne garde pas les petites images intégrées au texte.
    if (att.inline && att.mime.startsWith('image/') && att.size < 150_000) continue;
    if (att.size > MAX_ATTACHMENT) continue;
    try {
      let b64 = att.data;
      if (!b64 && att.attachmentId) b64 = (await gmail<{ data?: string }>(a.mailbox, `/messages/${m.id}/attachments/${att.attachmentId}`)).data;
      if (!b64) continue;
      const bytes = Buffer.from(b64, 'base64url');
      const path = `${a.agent}/${m.id}/${safeName(att.name)}`;
      const { error } = await sb.storage.from('agent-mail').upload(path, bytes, { contentType: att.mime, upsert: true });
      if (error) { console.warn(`[AGENTS] ${a.agent} : pièce jointe non rangée (${error.message})`); continue; }
      out.push({ path, name: att.name, mime: att.mime, size: bytes.length });
    } catch (e) {
      console.warn(`[AGENTS] ${a.agent} : pièce jointe illisible (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return out;
}

async function threadFor(a: AgentRow, m: GmailMessage, subject: string, counterpart: { name: string; email: string } | undefined): Promise<{ id: string; unread: boolean } | null> {
  const find = async () => {
    const { data } = await sb.from('agent_threads').select('id, unread').eq('mailbox', a.mailbox).eq('gmail_thread_id', m.threadId).maybeSingle();
    return (data as { id: string; unread: boolean } | null) ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  const { data, error } = await sb.from('agent_threads').insert({
    agent: a.agent, mailbox: a.mailbox, gmail_thread_id: m.threadId, subject: cleanSubject(subject).slice(0, 300),
    counterpart_email: counterpart?.email ?? null, counterpart_name: counterpart?.name || null,
  }).select('id, unread').single();
  if (error) {
    // Un autre worker vient de créer le même fil : on le relit.
    if (/duplicate key/i.test(error.message)) return find();
    console.warn(`[AGENTS] ${a.agent} : fil non créé (${error.message})`);
    return null;
  }
  return data as { id: string; unread: boolean };
}

/** Un mail Gmail → son fil et sa ligne ; les suites (rebond, arrêt, alerte). Rend true s'il est nouveau. */
async function importMessage(a: AgentRow, m: GmailMessage, ownMailboxes: string[]): Promise<boolean> {
  const labels = m.labelIds ?? [];
  if (labels.includes('DRAFT') || labels.includes('SPAM') || labels.includes('TRASH')) return false;
  const h = headersOf(m.payload?.headers);
  // Le bilan du jour à l'équipe (18/10) part de cette boîte mais n'est pas une conversation : il reste dans Gmail.
  if (isInternalMail(h)) return false;
  const from = parseAddressList(h['from'])[0];
  const direction: 'in' | 'out' = from?.email === a.mailbox ? 'out' : 'in';
  const to = parseAddressList(h['to']);
  const cc = parseAddressList(h['cc']);
  const subject = (h['subject'] ?? '').trim();
  const body = collect(m.payload);
  const text = (body.text || htmlToText(body.html) || m.snippet || '').trim();
  const fresh = direction === 'in' ? stripQuoted(text) : null;
  const at = new Date(Number(m.internalDate) || Date.now());

  let classification: string | null = null;
  let autoReply = false;
  if (direction === 'in') {
    if (isBounce(from?.email ?? '', subject, h)) classification = 'rebond';
    else if (isAutoReply(h, subject)) { classification = 'absence'; autoReply = true; }
    else if (isStopRequest(fresh ?? '')) classification = 'stop';
  }

  const counterpart = direction === 'in' ? from : to[0];
  const thread = await threadFor(a, m, subject, counterpart);
  if (!thread) return false;
  const attachments = await saveAttachments(a, m, body.attachments);

  const { data: inserted, error } = await sb.from('agent_messages').upsert({
    thread_id: thread.id, agent: a.agent, mailbox: a.mailbox, channel: 'mail', direction,
    status: direction === 'in' ? 'recu' : 'envoye', kind: direction === 'in' ? 'recu' : 'reponse',
    author: direction === 'in' ? 'systeme' : 'humain',
    gmail_message_id: m.id, rfc_message_id: h['message-id'] || null, in_reply_to: h['in-reply-to'] || null, references_header: h['references'] || null,
    from_email: from?.email ?? null, from_name: from?.name || null,
    to_emails: to.map((x) => x.email), cc_emails: cc.map((x) => x.email),
    subject, body_text: text, body_new: fresh, attachments, classification, auto_reply: autoReply,
    received_at: direction === 'in' ? at.toISOString() : null, sent_at: direction === 'out' ? at.toISOString() : null,
  }, { onConflict: 'mailbox,gmail_message_id', ignoreDuplicates: true }).select('id');
  if (error) { console.warn(`[AGENTS] ${a.agent} : mail non enregistré (${error.message})`); return false; }
  const row = ((inserted ?? []) as Array<{ id: string }>)[0];
  if (!row) return false; // déjà là (autre worker)

  await sb.from('agent_threads').update({
    last_message_at: at.toISOString(), last_direction: direction,
    last_classification: classification ?? (direction === 'in' ? 'reponse' : null),
    unread: direction === 'in' && !autoReply && classification !== 'rebond' ? true : thread.unread,
  }).eq('id', thread.id);

  if (direction !== 'in') return true;
  if (classification === 'stop') await advanceProspect(thread.id, 'perdu');
  else if (!autoReply && classification !== 'rebond') await advanceProspect(thread.id, 'repondu');
  const who = from?.name || from?.email || '?';
  if (classification === 'rebond') {
    for (const dead of bouncedRecipients(h, text, ownMailboxes)) {
      if (await suppress(dead, 'rebond', a.agent, `avis de non-remise du ${at.toISOString().slice(0, 10)}`)) {
        await journal({ agent: a.agent, actor: 'systeme', kind: 'rebond', summary: `Adresse morte ajoutée à « ne plus contacter » : ${dead}`, threadId: thread.id, messageId: row.id });
      }
    }
    return true;
  }
  if (classification === 'stop' && from?.email) {
    if (await suppress(from.email, 'stop', a.agent, 'demande d\'arrêt dans sa réponse')) {
      await journal({ agent: a.agent, actor: 'systeme', kind: 'desinscription', summary: `${who} ne veut plus être contacté : ajouté à « ne plus contacter »`, threadId: thread.id, messageId: row.id });
    }
  }
  // Alerte : une vraie réponse, récente — pas les lettres d'information (onglets Promotions,
  // Réseaux sociaux, Forums de Gmail).
  const bulk = labels.some((l) => l === 'CATEGORY_PROMOTIONS' || l === 'CATEGORY_SOCIAL' || l === 'CATEGORY_FORUMS');
  if (!bulk && classification !== 'absence' && Date.now() - at.getTime() < ALERT_WINDOW_MS) {
    const name = a.display_name;
    const title = classification === 'stop' ? `${name} : ${who} demande à ne plus être contacté` : `${name} : réponse de ${who}`;
    await alertOwner(a, `agent-mail:${row.id}`, title, `« ${subject} »\n\n${(fresh ?? '').slice(0, 600)}`, `/agents?agente=${a.agent}&fil=${thread.id}`);
  }
  return true;
}

/** Synchronise une boîte. */
export async function syncMailbox(a: AgentRow, ownMailboxes: string[]): Promise<void> {
  let ids: string[] = [];
  let history: string | null = null;
  if (!a.gmail_history_id) {
    // Première connexion : ADA part de MAINTENANT. Rien de ce que la boîte contenait avant
    // n'entre dans ADA (17/10 : une boîte reprise d'un ancien collaborateur garde ses anciens
    // mails pour elle).
    const prof = await gmail<{ historyId?: string }>(a.mailbox, '/profile');
    await updateAgent(a.agent, { gmail_history_id: prof.historyId ?? null, last_sync_at: new Date().toISOString(), last_sync_error: null });
    await journal({ agent: a.agent, actor: 'systeme', kind: 'synchro_debut', summary: `Boîte ${a.mailbox} suivie à partir de maintenant (les mails antérieurs restent dans Gmail)` });
    return;
  } else {
    let pageToken: string | undefined;
    try {
      do {
        const r = await gmail<{ history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>; historyId?: string; nextPageToken?: string }>(
          a.mailbox, '/history', { query: { startHistoryId: a.gmail_history_id, historyTypes: 'messageAdded', maxResults: 500, pageToken } });
        for (const step of r.history ?? []) for (const added of step.messagesAdded ?? []) ids.push(added.message.id);
        history = r.historyId ?? history;
        pageToken = r.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if (!(e instanceof GmailError && e.status === 404)) throw e;
      // Curseur trop ancien (synchro arrêtée plus d'une semaine) : rattrapage des 7 derniers
      // jours (sans doublon), puis on repart du curseur du moment.
      ids = [];
      let pageToken: string | undefined;
      do {
        const r = await gmail<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(a.mailbox, '/messages', { query: { q: CATCH_UP_QUERY, maxResults: 100, pageToken } });
        ids.push(...(r.messages ?? []).map((x) => x.id));
        pageToken = r.nextPageToken;
      } while (pageToken && ids.length < MAX_CATCH_UP);
      history = (await gmail<{ historyId?: string }>(a.mailbox, '/profile')).historyId ?? null;
    }
  }

  ids = [...new Set(ids)];
  let added = 0;
  if (ids.length > 0) {
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await sb.from('agent_messages').select('gmail_message_id').eq('mailbox', a.mailbox).in('gmail_message_id', ids.slice(i, i + 100));
      for (const r of (data ?? []) as Array<{ gmail_message_id: string }>) known.add(r.gmail_message_id);
    }
    const fetched: GmailMessage[] = [];
    for (const id of ids.filter((x) => !known.has(x))) {
      try { fetched.push(await gmail<GmailMessage>(a.mailbox, `/messages/${id}`, { query: { format: 'full' } })); }
      catch (e) { if (!(e instanceof GmailError && e.status === 404)) throw e; }
    }
    fetched.sort((x, y) => Number(x.internalDate ?? 0) - Number(y.internalDate ?? 0));
    for (const m of fetched) if (await importMessage(a, m, ownMailboxes)) added++;
  }
  await updateAgent(a.agent, { gmail_history_id: history ?? a.gmail_history_id, last_sync_at: new Date().toISOString(), last_sync_error: null });
  if (added > 0) console.warn(`[AGENTS] ${a.agent} : ${added} mail(s) importé(s)`);
}

/** Erreur de synchro : notée sur l'agente (et au journal quand elle change). */
export async function recordSyncError(a: AgentRow, e: unknown): Promise<void> {
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400);
  if (msg !== a.last_sync_error) {
    await journal({ agent: a.agent, actor: 'systeme', kind: e instanceof NotConnected ? 'boite_deconnectee' : 'sync_erreur', summary: `Boîte ${a.mailbox} : ${msg}` });
    if (!(e instanceof NotConnected)) console.warn(`[AGENTS] ${a.agent} : synchro en échec (${msg})`);
  }
  await updateAgent(a.agent, { last_sync_error: msg });
}
