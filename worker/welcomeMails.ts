/**
 * ENVOI DES MAILS DE BIENVENUE (01/11, Channing) : l'admin a déposé le mail (texte final) dans
 * welcome_mails ; ici il part depuis la boîte d'Ada (délégation Gmail du domaine), avec sa
 * signature texte, en-tête interne (la synchro de sa boîte ne le compte pas comme prospection ; les
 * réponses, elles, arrivent normalement chez Ada). Sondage toutes les 30 s. Fail-open : sans clé
 * Google ou boîte refusée → « failed » avec la raison exacte, visible dans Admin ; jamais rejoué
 * d'office (doublon).
 */
import { sharedSupabase } from '../src/lib/supabaseShared';
import { mailCreds } from './mailer';
import { sendInternal } from './agents/internalMail';
import { loadAgents } from './agents/store';

const supabase = sharedSupabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const POLL_MS = 30_000;
let running = false;

interface Row { id: string; to_email: string; to_name: string; subject: string; body: string }

export function startWelcomeMails(): void {
  setInterval(() => void tick(), POLL_MS);
  setTimeout(() => void tick(), 20_000);
  console.warn('[BIENVENUE] envoi des mails de bienvenue actif (sondage 30 s, boîte d\'Ada)');
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
        const how = await sendInternal(creds, ada, m.to_email, { subject: m.subject, body }, 'bienvenue', true);
        if (how !== 'agente') throw new Error('la boîte d\'Ada a refusé l\'envoi (délégation Gmail) ; non envoyé depuis une autre adresse');
        await supabase.from('welcome_mails').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', m.id);
        console.warn(`[BIENVENUE] mail envoyé à ${m.to_email}`);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        await supabase.from('welcome_mails').update({ status: 'failed', error: why.slice(0, 1000) }).eq('id', m.id);
        console.warn(`[BIENVENUE] échec vers ${m.to_email} : ${why}`);
      }
    }
  } finally { running = false; }
}
