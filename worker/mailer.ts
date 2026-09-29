/**
 * ENVOI D'E-MAILS DEPUIS UN DOSSIER (29/09, chantier e-mails — étape 3).
 *
 * Le front dépose une ligne « queued » dans dossier_emails ; ici on l'envoie
 * par l'API Gmail AU NOM de la personne connectée (From = son adresse
 * Google Workspace) : la réponse de l'acheteur arrive dans SA boîte, dans le
 * fil, comme aujourd'hui. Mécanique : le compte de service du tableur
 * (GOOGLE_SERVICE_ACCOUNT_JSON) signe un JWT avec `sub` = l'expéditeur —
 * possible seulement si l'administrateur Google Workspace a accordé à ce
 * compte de service la délégation à l'échelle du domaine avec le droit
 * https://www.googleapis.com/auth/gmail.send. Le client_id à autoriser est
 * journalisé au démarrage.
 *
 * Fail-open : sans clé, la boucle est inactive ; une ligne qui échoue passe
 * « failed » avec la raison exacte de Google, rien ne bloque le dossier.
 */
import { createSign } from 'node:crypto';
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';

const POLL_MS = 20_000;
const BUCKET = 'admin-documents';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

interface Creds { client_email: string; private_key: string; client_id?: string }
interface Attachment { path: string; name?: string }
interface QueuedMail {
  id: string; to_email: string; subject: string; body: string; attachments: Attachment[];
  sender_email: string; sender_name: string | null;
}

let running = false;

export function startMailer(): void {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) { console.log('[MAIL] en attente de GOOGLE_SERVICE_ACCOUNT_JSON — envoi d\'e-mails inactif'); return; }
  let creds: Creds;
  try { creds = JSON.parse(raw) as Creds; } catch { console.warn('[MAIL] GOOGLE_SERVICE_ACCOUNT_JSON illisible — envoi inactif'); return; }
  // Visible dans worker_logs : ce qu'il faut autoriser dans Google Admin.
  console.warn(`[MAIL] compte de service ${creds.client_email} — client_id ${creds.client_id ?? '(absent du JSON)'} : à autoriser dans Google Admin → Sécurité → Contrôle des API → Délégation au niveau du domaine, avec le droit ${GMAIL_SCOPE}`);
  setInterval(() => void tick(creds), POLL_MS);
  setTimeout(() => void tick(creds), 15_000);
  console.log('[MAIL] boucle d\'envoi active (poll 20 s)');
}

async function tick(creds: Creds): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { data, error } = await supabase.from('dossier_emails')
      .select('id, to_email, subject, body, attachments, sender_email, sender_name')
      .eq('status', 'queued').order('created_at', { ascending: true }).limit(5);
    if (error) { if (!/does not exist|schema cache/i.test(error.message)) console.warn(`[MAIL] lecture de la file impossible: ${error.message}`); return; }
    for (const m of (data ?? []) as unknown as QueuedMail[]) {
      try {
        const { id, threadId } = await sendOne(creds, m);
        await supabase.from('dossier_emails').update({ status: 'sent', sent_at: new Date().toISOString(), gmail_message_id: id, gmail_thread_id: threadId, error: null } as never).eq('id', m.id);
        console.warn(`[MAIL] envoyé : « ${m.subject} » → ${m.to_email} de ${m.sender_email} (${(m.attachments ?? []).length} pièce(s))`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from('dossier_emails').update({ status: 'failed', error: msg.slice(0, 1000) } as never).eq('id', m.id);
        console.warn(`[MAIL] échec « ${m.subject} » → ${m.to_email} : ${msg}`);
      }
    }
  } finally { running = false; }
}

/** Jeton Gmail au nom de `sub` (délégation domaine). */
async function gmailToken(creds: Creds, sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: creds.client_email, sub, scope: GMAIL_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(creds.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
  });
  const j = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!j.access_token) {
    const why = j.error === 'unauthorized_client'
      ? `délégation domaine non accordée au compte de service (client_id ${creds.client_id ?? '?'}) pour ${GMAIL_SCOPE}, ou ${sub} hors du domaine Google Workspace`
      : `${j.error ?? res.status} — ${j.error_description ?? ''}`;
    throw new Error(`Google refuse le jeton : ${why}`);
  }
  return j.access_token;
}

const encodeHeader = (s: string) => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s);
const wrap76 = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');

async function sendOne(creds: Creds, m: QueuedMail): Promise<{ id: string; threadId: string }> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to_email)) throw new Error(`destinataire invalide : « ${m.to_email} »`);
  const token = await gmailToken(creds, m.sender_email);
  const boundary = `ada_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const from = m.sender_name ? `${encodeHeader(m.sender_name)} <${m.sender_email}>` : m.sender_email;
  const parts: string[] = [];
  parts.push(`--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(Buffer.from(m.body, 'utf8').toString('base64'))}\r\n`);
  for (const a of m.attachments ?? []) {
    const { data, error } = await supabase.storage.from(BUCKET).download(a.path);
    if (error || !data) throw new Error(`pièce jointe introuvable dans le storage : ${a.path} (${error?.message ?? 'vide'})`);
    const bytes = Buffer.from(await data.arrayBuffer());
    const name = a.name || a.path.split('/').pop() || 'document.pdf';
    const type = name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : name.toLowerCase().endsWith('.png') ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'application/octet-stream';
    parts.push(`--${boundary}\r\nContent-Type: ${type}; name="${encodeHeader(name)}"\r\nContent-Disposition: attachment; filename="${encodeHeader(name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(bytes.toString('base64'))}\r\n`);
  }
  const mime = [
    `From: ${from}`, `To: ${m.to_email}`, `Subject: ${encodeHeader(m.subject)}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts, `--${boundary}--`, '',
  ].join('\r\n');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url') }),
  });
  const j = (await res.json()) as { id?: string; threadId?: string; error?: { message?: string } };
  if (!res.ok || !j.id) throw new Error(`Gmail ${res.status} : ${j.error?.message ?? 'envoi refusé'}`);
  return { id: j.id, threadId: j.threadId ?? '' };
}
