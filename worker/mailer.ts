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
import { recordLearningCase } from './learningBox';
import { buildMime, type MimeAttachment } from './mailMime';

const POLL_MS = 20_000;
const BUCKET = 'admin-documents';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
/** SIGNATURE GMAIL (07/11, Channing : « ma signature qui est enregistrée… c'est possible de l'intégrer ? ») :
 *  lue dans les paramètres Gmail de l'expéditeur (sendAs → signature) et ajoutée sous le texte des e-mails
 *  envoyés en son nom depuis Ada. Demande un droit de plus dans la délégation domaine ; sans lui, l'envoi
 *  part sans signature (fail-open) et worker_logs le dit une fois par adresse. */
export const GMAIL_SETTINGS_SCOPE = 'https://www.googleapis.com/auth/gmail.settings.basic';
const SIGNATURE_TTL_MS = 30 * 60 * 1000;
const signatureCache = new Map<string, { html: string | null; at: number }>();

interface Creds { client_email: string; private_key: string; client_id?: string }
interface Attachment { path: string; name?: string }
interface QueuedMail {
  id: string; to_email: string; subject: string; body: string; attachments: Attachment[];
  sender_email: string; sender_name: string | null; sent_by: string | null;
}
const ALLOWED_PREFIXES = ['transactions/', 'dossiers/', 'contacts/'];
const STUCK_MS = 10 * 60 * 1000;

let running = false;

/** Identifiants Gmail (compte de service, délégation domaine) — null sans clé ou clé illisible. */
export function mailCreds(): Creds | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try { return JSON.parse(raw) as Creds; } catch { return null; }
}

/** Un e-mail texte simple AU NOM de `from` (adresse du domaine Google Workspace),
 *  sans pièce jointe — rappels (12/10), bilan du jour des agentes (18/10, avec
 *  son en-tête interne). Mêmes refus que les dossiers : hors domaine, Google
 *  refuse le jeton et l'erreur remonte telle quelle. */
export async function sendPlainMail(creds: Creds, mail: { from: string; fromName?: string | null; to: string; subject: string; body: string; headers?: Record<string, string> }): Promise<{ id: string; threadId: string }> {
  return sendOne(creds, { id: '', to_email: mail.to, subject: mail.subject, body: mail.body, attachments: [], sender_email: mail.from, sender_name: mail.fromName ?? null, sent_by: null }, mail.headers);
}

export function startMailer(): void {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) { console.log('[MAIL] en attente de GOOGLE_SERVICE_ACCOUNT_JSON — envoi d\'e-mails inactif'); return; }
  const creds = mailCreds();
  if (!creds) { console.warn('[MAIL] GOOGLE_SERVICE_ACCOUNT_JSON illisible — envoi inactif'); return; }
  // Visible dans worker_logs : ce qu'il faut autoriser dans Google Admin.
  console.warn(`[MAIL] compte de service ${creds.client_email} — client_id ${creds.client_id ?? '(absent du JSON)'} : à autoriser dans Google Admin → Sécurité → Contrôle des API → Délégation au niveau du domaine, avec les droits ${GMAIL_SCOPE} et ${GMAIL_SETTINGS_SCOPE} (signature)`);
  setInterval(() => void tick(creds), POLL_MS);
  setTimeout(() => void tick(creds), 15_000);
  console.log('[MAIL] boucle d\'envoi active (poll 20 s)');
}

async function tick(creds: Creds): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Une ligne « sending » depuis plus de 10 min = envoi interrompu par un
    // redémarrage : on ne sait pas si Gmail l'a reçue → JAMAIS rejouée
    // d'office (pas de doublon), échec explicite pour l'opérateur.
    await supabase.from('dossier_emails')
      .update({ status: 'failed', error: 'Envoi interrompu par un redémarrage du worker — non renvoyé pour éviter un doublon. Vérifie ta boîte « Messages envoyés » avant de réessayer.' } as never)
      .eq('status', 'sending').lt('sent_at', new Date(Date.now() - STUCK_MS).toISOString());
    const { data, error } = await supabase.from('dossier_emails')
      .select('id, to_email, subject, body, attachments, sender_email, sender_name, sent_by')
      .eq('status', 'queued').order('created_at', { ascending: true }).limit(5);
    if (error) { if (!/does not exist|schema cache/i.test(error.message)) console.warn(`[MAIL] lecture de la file impossible: ${error.message}`); return; }
    for (const m of (data ?? []) as unknown as QueuedMail[]) {
      // RÉSERVATION : seule la mise à jour queued → sending qui touche la
      // ligne autorise l'envoi. Deux workers (redéploiement) ne peuvent pas
      // envoyer le même e-mail. sent_at sert d'horodatage de réservation.
      const { data: claimed } = await supabase.from('dossier_emails')
        .update({ status: 'sending', sent_at: new Date().toISOString() } as never)
        .eq('id', m.id).eq('status', 'queued').select('id');
      if (!claimed || (claimed as unknown[]).length === 0) continue;
      try {
        // EXPÉDITEUR = COMPTE CONNECTÉ : l'adresse From doit être celle du
        // compte qui a déposé la ligne — personne n'écrit au nom d'un autre.
        if (!m.sent_by) throw new Error('expéditeur inconnu (sent_by vide) — envoi refusé');
        const { data: u, error: uErr } = await supabase.auth.admin.getUserById(m.sent_by);
        const accountEmail = (u?.user?.email ?? '').trim().toLowerCase();
        if (uErr || !accountEmail) throw new Error(`compte expéditeur introuvable — envoi refusé`);
        if (accountEmail !== m.sender_email.trim().toLowerCase()) throw new Error(`expéditeur ${m.sender_email} ≠ compte connecté ${accountEmail} — envoi refusé`);
        for (const a of m.attachments ?? []) {
          if (!ALLOWED_PREFIXES.some((p) => a.path.startsWith(p)) || a.path.includes('..')) throw new Error(`pièce jointe hors du dossier refusée : ${a.path}`);
        }
        const { id, threadId } = await sendOne(creds, m, {}, true);
        await supabase.from('dossier_emails').update({ status: 'sent', sent_at: new Date().toISOString(), gmail_message_id: id, gmail_thread_id: threadId, error: null } as never).eq('id', m.id);
        console.warn(`[MAIL] envoyé : « ${m.subject} » → ${m.to_email} de ${m.sender_email} (${(m.attachments ?? []).length} pièce(s))`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from('dossier_emails').update({ status: 'failed', error: msg.slice(0, 1000) } as never).eq('id', m.id);
        console.warn(`[MAIL] échec « ${m.subject} » → ${m.to_email} : ${msg}`);
        // Boîte à apprendre (02/10) : un e-mail en échec attend une action de
        // l'équipe (adresse, pièce, droits Gmail) — un cas par e-mail.
        void recordLearningCase({ kind: 'mail_failed', key: m.id, title: `E-mail en échec : « ${m.subject} » → ${m.to_email}`, actor: 'equipe', link: '/ventes', detail: { error: msg.slice(0, 500), to: m.to_email, from: m.sender_email, transactionId: (m as { transaction_id?: string }).transaction_id ?? null } });
      }
    }
  } finally { running = false; }
}

/** Jeton Gmail au nom de `sub` (délégation domaine). */
async function gmailToken(creds: Creds, sub: string, scope: string = GMAIL_SCOPE): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: creds.client_email, sub, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(creds.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
  });
  const j = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!j.access_token) {
    const why = j.error === 'unauthorized_client'
      ? `délégation domaine non accordée au compte de service (client_id ${creds.client_id ?? '?'}) pour ${scope}, ou ${sub} hors du domaine Google Workspace`
      : `${j.error ?? res.status} — ${j.error_description ?? ''}`;
    throw new Error(`Google refuse le jeton : ${why}`);
  }
  return j.access_token;
}

/** La signature Gmail enregistrée de l'expéditeur (HTML), ou null : droit non accordé, pas de signature,
 *  ou Google injoignable — jamais bloquant. Gardée 30 min par adresse. */
export async function gmailSignature(creds: Creds, sender: string): Promise<string | null> {
  const key = sender.trim().toLowerCase();
  const hit = signatureCache.get(key);
  if (hit && Date.now() - hit.at < SIGNATURE_TTL_MS) return hit.html;
  let html: string | null = null;
  try {
    const token = await gmailToken(creds, key, GMAIL_SETTINGS_SCOPE);
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(key)}`, { headers: { authorization: `Bearer ${token}` } });
    const j = (await res.json()) as { signature?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(`Gmail ${res.status} : ${j.error?.message ?? 'lecture refusée'}`);
    html = (j.signature ?? '').trim() || null;
    if (!hit) console.warn(`[MAIL] signature Gmail de ${key} : ${html ? `${html.length} caractères` : 'aucune (vide dans Gmail)'}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!hit) console.warn(`[MAIL] signature Gmail de ${key} illisible — envoi sans signature : ${msg}`);
  }
  signatureCache.set(key, { html, at: Date.now() });
  return html;
}

/** SIGNATURE EN IMAGE (08/11, Channing : « voici l'image de base à intégrer dans le mail ») : déposée dans Ada
 *  (page Admin → Ma signature e-mail), storage admin-documents/signatures/<adresse>.png|jpg — même règle de nom
 *  que src/services/signature.ts. Gardée 30 min par adresse ; absente → null, jamais bloquant. */
const signatureImageCache = new Map<string, { img: { bytes: Buffer; type: string } | null; at: number }>();
export async function signatureImage(sender: string): Promise<{ bytes: Buffer; type: string } | null> {
  const key = sender.trim().toLowerCase();
  const hit = signatureImageCache.get(key);
  if (hit && Date.now() - hit.at < SIGNATURE_TTL_MS) return hit.img;
  const base = `signatures/${key.replace(/[^a-z0-9._-]/g, '_')}`;
  let img: { bytes: Buffer; type: string } | null = null;
  for (const [ext, type] of [['png', 'image/png'], ['jpg', 'image/jpeg']] as const) {
    const { data, error } = await supabase.storage.from(BUCKET).download(`${base}.${ext}`);
    if (!error && data) { img = { bytes: Buffer.from(await data.arrayBuffer()), type }; break; }
  }
  if (!hit || !!hit.img !== !!img) console.warn(`[MAIL] signature en image de ${key} : ${img ? `${Math.round(img.bytes.length / 1024)} Ko (${img.type})` : 'aucune (Admin → Ma signature e-mail)'}`);
  signatureImageCache.set(key, { img, at: Date.now() });
  return img;
}

async function sendOne(creds: Creds, m: QueuedMail, extraHeaders: Record<string, string> = {}, withSignature = false): Promise<{ id: string; threadId: string }> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to_email)) throw new Error(`destinataire invalide : « ${m.to_email} »`);
  const token = await gmailToken(creds, m.sender_email);
  const attachments: MimeAttachment[] = [];
  for (const a of m.attachments ?? []) {
    const { data, error } = await supabase.storage.from(BUCKET).download(a.path);
    if (error || !data) throw new Error(`pièce jointe introuvable dans le storage : ${a.path} (${error?.message ?? 'vide'})`);
    const name = a.name || a.path.split('/').pop() || 'document.pdf';
    const type = name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : name.toLowerCase().endsWith('.png') ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'application/octet-stream';
    attachments.push({ name, type, bytes: Buffer.from(await data.arrayBuffer()) });
  }
  const signatureHtml = withSignature ? await gmailSignature(creds, m.sender_email) : null;
  const sigImage = withSignature ? await signatureImage(m.sender_email) : null;
  const mime = buildMime({ from: m.sender_email, fromName: m.sender_name, to: m.to_email, subject: m.subject, body: m.body, signatureHtml, signatureImage: sigImage, attachments, headers: extraHeaders });
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url') }),
  });
  const j = (await res.json()) as { id?: string; threadId?: string; error?: { message?: string } };
  if (!res.ok || !j.id) throw new Error(`Gmail ${res.status} : ${j.error?.message ?? 'envoi refusé'}`);
  return { id: j.id, threadId: j.threadId ?? '' };
}
