/**
 * DEMANDES DU SITE mc-export.com → LA CLOCHE D'ADA (25/10, Channing : « Je
 * suis ok pour les alertes »).
 *
 * Chaque minute, chaque nouvelle demande de site_leads (accueil B2B, pages de
 * rachat) pose un rappel dans la cloche de son responsable — Channing, ou le
 * compte MC Export dont SITE_LEADS_OWNER donne l'adresse —, avec le contact,
 * la voiture et la page (src/lib/siteLeads.ts).
 *
 * Le site envoie déjà lui-même l'e-mail d'alerte (notified_at rempli à
 * l'arrivée) : la cloche suffit, sans second e-mail. S'il n'a pas pu
 * (notified_at vide), le rappel part aussi par e-mail (reminderMailer, de soi
 * à soi) et la demande est marquée notifiée.
 *
 * Un rappel par demande (clé site_lead:<id>) ; seulement les demandes des
 * 7 derniers jours, pour ne pas sonner d'un coup pour tout l'historique.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { leadKey, leadReminder, type SiteLead } from '../src/lib/siteLeads';
import { mcExportAccounts } from './agents/recap';

const POLL_MS = 60_000;
const WINDOW_MS = 7 * 86_400_000;
const COLS = 'id, created_at, kind, lang, page, name, email, phone, company, country, message, details, notified_at';
let running = false;
let warned = false;

const ownerEmail = (): string => (process.env.SITE_LEADS_OWNER ?? 'channing@mc-export.com').trim().toLowerCase();

export function startSiteLeads(): void {
  setInterval(() => void siteLeadsTick(), POLL_MS);
  setTimeout(() => void siteLeadsTick(), 45_000);
  console.log(`[SITE] demandes du site → rappels dans la cloche de ${ownerEmail()} (poll 60 s)`);
}

/** Un passage : les rappels posés (exporté pour les tests). */
export async function siteLeadsTick(now = new Date()): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data, error } = await sb.from('site_leads').select(COLS)
      .eq('status', 'nouvelle').gte('created_at', new Date(now.getTime() - WINDOW_MS).toISOString())
      .order('created_at', { ascending: true }).limit(50);
    if (error) {
      // Table absente (SQL du 23/10 pas collé) : rien à faire, un seul avertissement.
      if (!warned) console.warn(`[SITE] demandes illisibles : ${error.message}`);
      warned = true;
      return 0;
    }
    const leads = (data ?? []) as SiteLead[];
    if (leads.length === 0) return 0;
    const { data: posted } = await sb.from('user_tasks').select('key').in('key', leads.map((l) => leadKey(l.id)));
    const have = new Set(((posted ?? []) as Array<{ key: string }>).map((t) => t.key));
    const todo = leads.filter((l) => !have.has(leadKey(l.id)));
    if (todo.length === 0) return 0;
    const owner = (await mcExportAccounts()).find((a) => a.email === ownerEmail())?.id;
    if (!owner) {
      if (!warned) console.warn(`[SITE] ${ownerEmail()} n'est pas un compte MC Export d'ADA : rappels des demandes non posés`);
      warned = true;
      return 0;
    }
    let count = 0;
    for (const l of todo) {
      const at = now.toISOString();
      const mailed = !!l.notified_at;
      const { title, note } = leadReminder(l);
      const { error: e } = await sb.from('user_tasks').upsert({
        assignee_id: owner, created_by: owner, key: leadKey(l.id), title, note, link: null, due_at: at,
        // Déjà signalée par e-mail par le site : la cloche seule (le rappel ne repart pas par e-mail).
        notified_at: mailed ? at : null,
      }, { onConflict: 'key', ignoreDuplicates: true });
      if (e) { console.warn(`[SITE] rappel non posé : ${e.message}`); continue; }
      if (!mailed) await sb.from('site_leads').update({ notified_at: at }).eq('id', l.id).is('notified_at', null);
      count++;
      console.warn(`[SITE] demande ${l.kind} (${l.lang}) : rappel dans la cloche${mailed ? '' : ', et par e-mail (le site n\'a pas pu l\'envoyer)'}`);
    }
    return count;
  } finally {
    running = false;
  }
}
