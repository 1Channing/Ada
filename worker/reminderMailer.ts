/**
 * RAPPELS PAR E-MAIL (12/10, Channing : « pour le groupe MC Export, que les
 * rappels envoient un mail à leur propriétaire à la date, avec la note »).
 *
 * Chaque minute : les rappels (user_tasks avec due_at) échus, ouverts et pas
 * encore notifiés partent par e-mail à leur propriétaire — DE SA PROPRE
 * ADRESSE À SA PROPRE ADRESSE, par la même délégation Gmail que les e-mails
 * de dossier (mailer.ts). Ne marche donc que pour les comptes du domaine
 * Google Workspace (mc-export.com) : pour un autre compte, Google refuse le
 * jeton, l'erreur est gardée sur le rappel (notify_error) et on n'insiste
 * pas — la cloche, elle, sonne pour tout le monde.
 *
 * Réservation par mise à jour conditionnelle (notified_at IS NULL) : deux
 * workers (redéploiement) n'envoient jamais le même rappel. Un rappel
 * reporté (snooze) revient avec notified_at remis à null par le front.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { mailCreds, sendPlainMail } from './mailer';

const POLL_MS = 60_000;
let running = false;

interface Due { id: string; assignee_id: string; title: string; note: string | null; link: string | null; due_at: string }

export function startReminderMailer(): void {
  const creds = mailCreds();
  if (!creds) { console.log('[RAPPEL] sans GOOGLE_SERVICE_ACCOUNT_JSON — rappels par e-mail inactifs (la cloche reste)'); return; }
  setInterval(() => void tick(), POLL_MS);
  setTimeout(() => void tick(), 30_000);
  console.log('[RAPPEL] rappels par e-mail actifs (poll 60 s, de soi à soi, comptes du domaine)');
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const creds = mailCreds();
    if (!creds) return;
    const sb = supabase as unknown as { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => Promise<{ data: { user?: { email?: string | null } | null } | null; error: { message: string } | null }> } } }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data, error } = await sb.from('user_tasks')
      .select('id, assignee_id, title, note, link, due_at')
      .eq('status', 'open').not('due_at', 'is', null).lte('due_at', new Date().toISOString()).is('notified_at', null)
      .order('due_at', { ascending: true }).limit(20);
    if (error) {
      if (!/notified_at|does not exist|schema cache/i.test(error.message)) console.warn(`[RAPPEL] lecture impossible : ${error.message}`);
      return; // colonne absente (SQL du 12/10 pas collé) : rien à faire, sans bruit
    }
    for (const r of (data ?? []) as Due[]) {
      const { data: claimed } = await sb.from('user_tasks')
        .update({ notified_at: new Date().toISOString() }).eq('id', r.id).is('notified_at', null).select('id');
      if (!claimed || (claimed as unknown[]).length === 0) continue;
      try {
        const { data: u, error: uErr } = await sb.auth.admin.getUserById(r.assignee_id);
        const email = (u?.user?.email ?? '').trim().toLowerCase();
        if (uErr || !email) throw new Error('adresse du propriétaire introuvable');
        const { data: p } = await sb.from('profiles').select('display_name').eq('id', r.assignee_id).maybeSingle();
        const name = ((p as { display_name?: string | null } | null)?.display_name ?? '').trim() || null;
        // Adresse publique d'ADA (12/10 : ada.mc-export.com) — ADA_APP_URL la remplace sans toucher au code.
        const base = (process.env.ADA_APP_URL ?? 'https://ada.mc-export.com').replace(/\/+$/, '');
        const link = r.link ? (/^https?:\/\//.test(r.link) ? r.link : `${base}${r.link}`) : `${base}/`;
        const when = new Date(r.due_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const body = [
          `Rappel posé dans ADA pour le ${when}.`,
          '',
          r.title,
          ...(r.note?.trim() ? ['', r.note.trim()] : []),
          '',
          `Ouvrir dans ADA : ${link}`,
          '',
          "— ADA. Ce message t'est envoyé depuis ta propre adresse, à l'échéance du rappel.",
        ].join('\n');
        await sendPlainMail(creds, { from: email, fromName: name ? `${name} (ADA)` : 'ADA', to: email, subject: `Rappel ADA : ${r.title}`, body });
        console.warn(`[RAPPEL] e-mail envoyé à ${email} : « ${r.title} » (échéance ${when})`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sb.from('user_tasks').update({ notify_error: msg.slice(0, 500) }).eq('id', r.id);
        console.warn(`[RAPPEL] e-mail non envoyé pour « ${r.title} » : ${msg}`);
      }
    }
  } finally { running = false; }
}
