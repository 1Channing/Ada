/**
 * ADA ET DANA — L'ENVOI (16/10). Ne part QUE ce qu'un administrateur a
 * validé dans ADA (statut « valide », posé par la base avec l'empreinte du
 * texte). Avant chaque envoi, le worker vérifie :
 * - la boîte est connectée ;
 * - horaires de bureau (heure de Paris, jours et heures réglables) ;
 * - aucun destinataire sur la liste « ne plus contacter » ;
 * - premiers contacts et relances : plafond du jour et écart aléatoire entre
 *   deux envois (les réponses à quelqu'un qui a écrit partent tout de suite) ;
 * - le texte est EXACTEMENT celui validé (agent_message_unchanged).
 * Puis réservation (valide → envoi : deux workers n'envoient jamais le même
 * mail), envoi Gmail dans le même fil, et l'identifiant du message gardé
 * pour que la réponse suivante reste dans la conversation.
 * Un envoi coupé par un redémarrage n'est JAMAIS rejoué d'office (doublon).
 */
import { buildMime, headersOf, replyReferences } from '../../src/lib/agents/mail';
import { inSendWindow, parisDayStart, randomGapMs, suppressionMatch, countsAgainstCap } from '../../src/lib/agents/sendPolicy';
import { gmail, NotConnected } from './google';
import { recordLearningCase } from '../learningBox';
import { sb, loadSuppressions, updateAgent, type AgentRow } from './store';

const STUCK_MS = 10 * 60 * 1000;

interface OutMessage {
  id: string; thread_id: string; agent: string; mailbox: string; kind: string;
  to_emails: string[]; cc_emails: string[]; subject: string; body_text: string;
  scheduled_after: string | null; approved_at: string | null;
}

async function fail(m: OutMessage, why: string): Promise<void> {
  await sb.from('agent_messages').update({ status: 'echec', error: why.slice(0, 1000) }).eq('id', m.id).in('status', ['valide', 'envoi']);
}

export async function sendDue(agents: AgentRow[]): Promise<void> {
  // Envois coupés par un redémarrage : échec explicite, jamais rejoués (doublon possible).
  await sb.from('agent_messages')
    .update({ status: 'echec', error: 'Envoi interrompu par un redémarrage du worker — non renvoyé pour éviter un doublon. Vérifier les « Messages envoyés » de la boîte avant de réessayer.' })
    .eq('status', 'envoi').lt('updated_at', new Date(Date.now() - STUCK_MS).toISOString());

  const { data, error } = await sb.from('agent_messages')
    .select('id, thread_id, agent, mailbox, kind, to_emails, cc_emails, subject, body_text, scheduled_after, approved_at')
    .eq('status', 'valide').eq('direction', 'out').eq('channel', 'mail')
    .order('approved_at', { ascending: true }).limit(20);
  if (error) { console.warn(`[AGENTS] file d'envoi illisible : ${error.message}`); return; }
  const queue = (data ?? []) as OutMessage[];
  if (queue.length === 0) return;
  const suppressed = await loadSuppressions();

  for (const m of queue) {
    const a = agents.find((x) => x.agent === m.agent);
    if (!a || !a.gmail_connected_email || a.mailbox !== m.mailbox) continue; // attend la connexion de la boîte
    const now = new Date();
    if (m.scheduled_after && Date.parse(m.scheduled_after) > now.getTime()) continue;
    if (!inSendWindow(now, a)) continue;
    const blocked = suppressionMatch([...m.to_emails, ...m.cc_emails], suppressed);
    if (blocked) { await fail(m, `Destinataire sur la liste « ne plus contacter » (${blocked}) : non envoyé.`); continue; }
    const cold = countsAgainstCap(m.kind);
    if (cold) {
      if (a.next_send_after && Date.parse(a.next_send_after) > now.getTime()) continue;
      const { count } = await sb.from('agent_messages').select('id', { count: 'exact', head: true })
        .eq('agent', a.agent).eq('status', 'envoye').in('kind', ['premier_contact', 'relance']).gte('sent_at', parisDayStart(now).toISOString());
      if ((count ?? 0) >= a.daily_first_contact_cap) continue;
    }
    const { data: unchanged } = await sb.rpc('agent_message_unchanged', { p_id: m.id });
    if (unchanged !== true) { await fail(m, 'Le texte a changé depuis la validation : à revalider.'); continue; }

    const { data: claimed } = await sb.from('agent_messages').update({ status: 'envoi' }).eq('id', m.id).eq('status', 'valide').select('id');
    if (!claimed || (claimed as unknown[]).length === 0) continue;
    try {
      const { data: thread } = await sb.from('agent_threads').select('id, gmail_thread_id').eq('id', m.thread_id).single();
      const { data: parent } = await sb.from('agent_messages').select('rfc_message_id, references_header')
        .eq('thread_id', m.thread_id).neq('id', m.id).not('rfc_message_id', 'is', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      const p = parent as { rfc_message_id: string | null; references_header: string | null } | null;
      const raw = buildMime({
        fromEmail: a.mailbox, fromName: a.sender_name, to: m.to_emails, cc: m.cc_emails, subject: m.subject, body: m.body_text,
        inReplyTo: p?.rfc_message_id ?? null, references: replyReferences(p?.references_header, p?.rfc_message_id),
      });
      const t = thread as { id: string; gmail_thread_id: string | null } | null;
      const sent = await gmail<{ id: string; threadId: string }>(a.mailbox, '/messages/send', {
        method: 'POST', body: { raw: Buffer.from(raw).toString('base64url'), ...(t?.gmail_thread_id ? { threadId: t.gmail_thread_id } : {}) },
      });
      // Son Message-ID : la réponse du destinataire, puis la nôtre, resteront dans le fil.
      let rfc: string | null = null;
      try {
        const meta = await gmail<{ payload?: { headers?: Array<{ name?: string; value?: string }> } }>(a.mailbox, `/messages/${sent.id}`, { query: { format: 'metadata', metadataHeaders: 'Message-ID' } });
        rfc = headersOf(meta.payload?.headers)['message-id'] || null;
      } catch { /* l'envoi a réussi ; seul le fil des réponses suivantes est moins sûr */ }
      const done = { status: 'envoye', sent_at: new Date().toISOString(), gmail_message_id: sent.id, rfc_message_id: rfc, error: null };
      let { error: upErr } = await sb.from('agent_messages').update(done).eq('id', m.id);
      if (upErr && /duplicate key/i.test(upErr.message)) {
        // Un autre worker a déjà archivé ce message envoyé : on garde la ligne d'ADA (celle qui porte la validation).
        await sb.from('agent_messages').delete().eq('mailbox', a.mailbox).eq('gmail_message_id', sent.id).neq('id', m.id);
        ({ error: upErr } = await sb.from('agent_messages').update(done).eq('id', m.id));
      }
      if (upErr) console.warn(`[AGENTS] ${a.agent} : envoyé mais non marqué (${upErr.message})`);
      await sb.from('agent_threads').update({
        ...(t?.gmail_thread_id ? {} : { gmail_thread_id: sent.threadId }),
        last_message_at: new Date().toISOString(), last_direction: 'out',
      }).eq('id', m.thread_id);
      if (cold) await updateAgent(a.agent, { next_send_after: new Date(Date.now() + randomGapMs(a.min_gap_seconds, a.max_gap_seconds)).toISOString() });
      console.warn(`[AGENTS] ${a.agent} : 1 mail envoyé (${m.kind})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await fail(m, e instanceof NotConnected ? `Boîte non connectée : ${msg}` : msg);
      void recordLearningCase({ kind: 'agent_mail_failed', key: m.id, title: `${a.display_name} : un mail validé n'est pas parti`, actor: 'equipe', link: `/agents?fil=${m.thread_id}`, detail: { error: msg.slice(0, 500), agent: a.agent } });
    }
  }
}
