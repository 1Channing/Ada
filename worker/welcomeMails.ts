/**
 * ENVOI DES MAILS DE BIENVENUE (01/11, Channing) : l'admin a déposé le mail (texte final) dans
 * welcome_mails ; ici il part depuis la boîte d'Ada (délégation Gmail du domaine), avec sa
 * signature texte, en-tête interne (la synchro de sa boîte ne le compte pas comme prospection ; les
 * réponses, elles, arrivent normalement chez Ada). Sondage toutes les 30 s. Fail-open : sans clé
 * Google ou boîte refusée → « failed » avec la raison exacte, visible dans Admin ; jamais rejoué
 * d'office (doublon).
 */
import { sharedSupabase } from '../src/lib/supabaseShared';
import { mailCreds, sendPlainMail } from './mailer';
import { loadAgents, type AgentRow } from './agents/store';
import { INTERNAL_HEADER } from '../src/lib/agents/mail';

const supabase = sharedSupabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const POLL_MS = 30_000;
let running = false;

interface Row { id: string; to_email: string; to_name: string; subject: string; body: string; thread_id?: string | null; sent_at?: string | null }

export function startWelcomeMails(): void {
  setInterval(() => void tick(), POLL_MS);
  setTimeout(() => void tick(), 20_000);
  setTimeout(() => void backfillThreads(), 40_000);
  console.warn('[BIENVENUE] envoi des mails de bienvenue actif (sondage 30 s, boîte d\'Ada)');
}

/**
 * LE MAIL DANS LA MESSAGERIE D'ADA (01/11, Channing : « je ne vois pas les mails envoyés ») : parti avec
 * l'en-tête interne, il n'est pas repris par la synchro Gmail — on crée donc le fil et le message « envoyé »
 * nous-mêmes (onglet Envoyés ; la réponse du destinataire rejoindra ce fil par son identifiant Gmail).
 */
async function recordThread(ada: AgentRow, m: Row, body: string, ids: { id: string; threadId: string } | null): Promise<string | null> {
  const at = m.sent_at ?? new Date().toISOString();
  const { data: th, error: e1 } = await supabase.from('agent_threads').insert({
    agent: ada.agent, mailbox: ada.mailbox, subject: m.subject, counterpart_email: m.to_email, counterpart_name: m.to_name || null,
    gmail_thread_id: ids?.threadId ?? null, last_message_at: at, last_direction: 'out',
  }).select('id');
  const threadId = ((th ?? []) as Array<{ id: string }>)[0]?.id;
  if (e1 || !threadId) { console.warn(`[BIENVENUE] fil non créé pour ${m.to_email} : ${e1?.message ?? '?'}`); return null; }
  const { error: e2 } = await supabase.from('agent_messages').insert({
    thread_id: threadId, agent: ada.agent, mailbox: ada.mailbox, channel: 'mail', direction: 'out', status: 'envoye', kind: 'reponse', author: 'systeme',
    gmail_message_id: ids?.id ?? null, from_email: ada.mailbox, from_name: ada.display_name, to_emails: [m.to_email], cc_emails: [],
    subject: m.subject, body_text: body, sent_at: at,
  });
  if (e2) console.warn(`[BIENVENUE] message non enregistré pour ${m.to_email} : ${e2.message}`);
  await supabase.from('welcome_mails').update({ thread_id: threadId }).eq('id', m.id);
  return threadId;
}

/** Les mails partis avant ce correctif : un fil chacun (sans identifiant Gmail), une seule fois. */
async function backfillThreads(): Promise<void> {
  const { data, error } = await supabase.from('welcome_mails').select('id, to_email, to_name, subject, body, thread_id, sent_at').eq('status', 'sent').is('thread_id', null).limit(50);
  if (error || !data?.length) return; // colonne absente (SQL à coller) ou rien à rattraper
  const ada = (await loadAgents()).find((a) => a.agent === 'ada');
  if (!ada) return;
  for (const m of data as Row[]) await recordThread(ada, m, `${m.body.trim()}\n\n${(ada.signature ?? '').trim()}`.trim(), null);
  console.warn(`[BIENVENUE] ${data.length} mail(s) déjà envoyé(s) ajouté(s) à la Messagerie d'Ada`);
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { data, error } = await supabase.from('welcome_mails').select('id, to_email, to_name, subject, body').eq('status', 'queued').order('created_at').limit(10);
    if (error || !data?.length) return;
    const creds = mailCreds();
    const ada = (await loadAgents()).find((a) => a.agent === 'ada');
    for (const m of data as Row[]) {
      const { data: claimed } = await supabase.from('welcome_mails').update({ status: 'sending' }).eq('id', m.id).eq('status', 'queued').select('id');
      if (!claimed || claimed.length === 0) continue;
      if (!creds) { await supabase.from('welcome_mails').update({ status: 'failed', error: 'GOOGLE_SERVICE_ACCOUNT_JSON absent sur le worker : envoi impossible' }).eq('id', m.id); continue; }
      if (!ada) { await supabase.from('welcome_mails').update({ status: 'failed', error: 'Agente Ada introuvable (agent_settings) : envoi impossible' }).eq('id', m.id); continue; }
      try {
        const body = `${m.body.trim()}\n\n${(ada.signature ?? '').trim()}`.trim();
        // Depuis la boîte d'Ada uniquement (jamais depuis une autre adresse) ; en-tête interne : la synchro
        // Gmail ne le reprend pas, le fil est créé juste après.
        const ids = await sendPlainMail(creds, { from: ada.mailbox, fromName: `${ada.display_name} (ADA)`, to: m.to_email, subject: m.subject, body, headers: { [INTERNAL_HEADER]: 'bienvenue' } });
        const sentAt = new Date().toISOString();
        await supabase.from('welcome_mails').update({ status: 'sent', sent_at: sentAt, error: null }).eq('id', m.id);
        await recordThread(ada, { ...m, sent_at: sentAt }, body, ids);
        console.warn(`[BIENVENUE] mail envoyé à ${m.to_email}`);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        await supabase.from('welcome_mails').update({ status: 'failed', error: why.slice(0, 1000) }).eq('id', m.id);
        console.warn(`[BIENVENUE] échec vers ${m.to_email} : ${why}`);
      }
    }
  } finally { running = false; }
}
