/**
 * MAILS D'ADA ET DANA — la logique pure, partagée par le worker (lecture et
 * envoi Gmail) et par l'onglet Agents (16/10). Aucun import : portable
 * (navigateur et Node), testée par test/agents-mail.test.ts.
 *
 * - Adresses : « Jean Dupont <jean@x.fr>, b@y.nl » → adresses en minuscules.
 * - Réponse reçue : la partie nouvelle, sans l'historique cité (FR, EN, NL,
 *   DE, DA, ES, IT, Outlook).
 * - Tri automatique sans IA : réponse automatique (absence), rebond (adresse
 *   morte → liste « ne plus contacter »), demande d'arrêt explicite.
 * - Envoi : le message MIME (texte simple, UTF-8, objet encodé, réponse dans
 *   le même fil grâce à In-Reply-To et References).
 */

export interface MailAddress { name: string; email: string }

const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;
export const isEmail = (s: string): boolean => EMAIL_RE.test(s.trim());

/** « Jean Dupont <jean@x.fr>, "Dupont, Marie" <m@y.nl>, z@w.de » → adresses (minuscules, sans doublon). */
export function parseAddressList(raw: string | null | undefined): MailAddress[] {
  if (!raw) return [];
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  let inAngle = false;
  for (const ch of raw) {
    if (ch === '"' && !inAngle) inQuote = !inQuote;
    else if (ch === '<' && !inQuote) inAngle = true;
    else if (ch === '>' && !inQuote) inAngle = false;
    if ((ch === ',' || ch === ';') && !inQuote && !inAngle) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  const out: MailAddress[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    const m = s.match(/^(.*)<([^<>]+)>\s*$/);
    const email = (m ? m[2] : s).trim().replace(/^mailto:/i, '').toLowerCase();
    if (!isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    const name = m ? m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim() : '';
    out.push({ name, email });
  }
  return out;
}

/** Domaine d'une adresse (« x@Garage.fr » → « garage.fr »). */
export const domainOf = (email: string): string => (email.split('@')[1] ?? '').trim().toLowerCase();

/** Objet de réponse : « Re: » une seule fois, quelle que soit la langue du préfixe déjà là. */
export function replySubject(subject: string): string {
  const s = (subject ?? '').trim();
  if (/^(re|aw|sv|antw|r|rif|ref|res|vs)\s*:/i.test(s)) return s;
  return s ? `Re: ${s}` : 'Re:';
}

// --- Encodages (sans Buffer : marche aussi dans le navigateur) --------------

export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = (b64url ?? '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64UrlToUtf8(b64url: string): string {
  return new TextDecoder('utf-8').decode(base64UrlToBytes(b64url));
}

export function utf8ToBase64Url(s: string): string {
  return utf8ToBase64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** En-tête RFC 2047 : un texte non ASCII devient =?UTF-8?B?…?= (découpé pour rester sous 76 caractères). */
export function encodeHeaderWord(s: string): string {
  if (!/[^\x20-\x7e]/.test(s)) return s;
  const words: string[] = [];
  let chunk = '';
  for (const ch of s) {
    const next = chunk + ch;
    if (new TextEncoder().encode(next).length > 42) { words.push(chunk); chunk = ch; } else chunk = next;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${utf8ToBase64(w)}?=`).join(' ');
}

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');

export interface OutgoingMail {
  fromEmail: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
  /** La signature avec logo de l'agente (18/10) : l'image, intégrée au mail (jamais un lien vers une image hébergée). */
  signatureImage?: SignatureImage | null;
  /** La signature texte qui termine le corps : remplacée par l'image dans la version HTML. */
  signatureText?: string | null;
}

/** Une image de signature (PNG) : son contenu en base64, ses dimensions d'affichage et son texte de remplacement. */
export interface SignatureImage { base64: string; name: string; alt: string; width: number; height: number }

/** Les dimensions d'un PNG, lues dans son en-tête (null si ce n'en est pas un). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const n = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  return { width: n(16), height: n(20) };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** La version HTML d'un mail en texte simple : les paragraphes, les retours à la ligne, puis la signature avec logo. */
export function htmlBody(body: string, signatureText: string | null | undefined, img: SignatureImage, cid: string): string {
  let text = body.replace(/\r\n/g, '\n').trim();
  const sig = (signatureText ?? '').replace(/\r\n/g, '\n').trim();
  // La signature texte (« Dana\nMC Export ») cède la place au logo, qui porte déjà le nom.
  if (sig && text.endsWith(sig)) text = text.slice(0, -sig.length).trimEnd();
  const paragraphs = text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const w = Math.round(img.width / 2);
  const h = Math.round(img.height / 2);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${paragraphs}`
    + `<p style="margin:16px 0 0"><img src="cid:${cid}" alt="${escapeHtml(img.alt)}" width="${w}" height="${h}" style="display:block;border:0;width:${w}px;height:${h}px"></p></div></body></html>`;
}

/** Le message prêt pour l'API Gmail (champ raw, encodé ensuite en base64url). */
export function buildMime(m: OutgoingMail): string {
  const to = m.to.map((x) => x.trim()).filter(Boolean);
  if (to.length === 0 || to.some((x) => !isEmail(x))) throw new Error(`destinataire invalide : « ${m.to.join(', ')} »`);
  const cc = (m.cc ?? []).map((x) => x.trim()).filter(Boolean);
  if (cc.some((x) => !isEmail(x))) throw new Error(`copie invalide : « ${cc.join(', ')} »`);
  if (!isEmail(m.fromEmail)) throw new Error(`expéditeur invalide : « ${m.fromEmail} »`);
  const from = m.fromName ? `${encodeHeaderWord(m.fromName.replace(/[\r\n"]/g, ' ').trim())} <${m.fromEmail}>` : m.fromEmail;
  const subject = m.subject.replace(/[\r\n]+/g, ' ').trim();
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${encodeHeaderWord(subject)}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo.replace(/[\r\n]/g, '')}`] : []),
    ...(m.references ? [`References: ${m.references.replace(/[\r\n]+/g, ' ')}`] : []),
    'MIME-Version: 1.0',
  ];
  const body = m.body.replace(/\r?\n/g, '\r\n');
  const text = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(utf8ToBase64(body))];
  const img = m.signatureImage;
  if (!img) return `${[...headers, ...text.slice(0, 2)].join('\r\n')}\r\n\r\n${text[3]}\r\n`;
  // Avec le logo : le texte simple, et le HTML qui montre l'image jointe au mail (cid) — rien à télécharger ailleurs.
  const tag = Math.random().toString(36).slice(2, 10);
  const alt = `ada_alt_${tag}`;
  const rel = `ada_rel_${tag}`;
  const cid = `${img.name.replace(/[^a-z0-9.-]/gi, '')}.${tag}@mc-export.com`;
  return [
    ...headers, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, ...text,
    `--${alt}`, `Content-Type: multipart/related; boundary="${rel}"`, '',
    `--${rel}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(utf8ToBase64(htmlBody(m.body, m.signatureText, img, cid))),
    `--${rel}`, `Content-Type: image/png; name="${img.name}"`, 'Content-Transfer-Encoding: base64', `Content-ID: <${cid}>`, `Content-Disposition: inline; filename="${img.name}"`, '', wrap76(img.base64.replace(/\s+/g, '')),
    `--${rel}--`, `--${alt}--`, '',
  ].join('\r\n');
}

/** « References » d'une réponse : celles du message auquel on répond, plus son identifiant. */
export function replyReferences(parentReferences: string | null | undefined, parentMessageId: string | null | undefined): string | null {
  const ids = `${parentReferences ?? ''} ${parentMessageId ?? ''}`.match(/<[^<>\s]+>/g) ?? [];
  const uniq = [...new Set(ids)];
  return uniq.length ? uniq.slice(-20).join(' ') : null;
}

// --- Lecture d'un mail reçu ---------------------------------------------------

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', euro: '€' };

/** Texte lisible d'un HTML de mail (quand il n'y a pas de partie texte). */
export function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, n: string) => ENTITIES[n.toLowerCase()] ?? all)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Ligne d'attribution d'un historique cité, dans les langues des marchés.
const ATTRIBUTION = [
  /^on .{4,200}wrote:\s*$/i,
  /^le .{4,200}a écrit\s*:\s*$/i,
  /^op .{4,200}schreef.{0,200}:\s*$/i,
  /^am .{4,200}schrieb.{0,200}:\s*$/i,
  /^den .{4,200}skrev.{0,200}:\s*$/i,
  /^el .{4,200}escribió\s*:\s*$/i,
  /^il .{4,200}ha scritto\s*:\s*$/i,
  /^-{2,}\s*(original message|message d'origine|ursprüngliche nachricht|oorspronkelijk bericht|oprindelig meddelelse|mensaje original|messaggio originale)\s*-{2,}/i,
  /^_{10,}\s*$/,
];
// Bloc d'en-tête Outlook : « De : » puis « Envoyé : » (et équivalents).
const OUTLOOK_FROM = /^(de|from|von|van|fra|da)\s*:\s*\S/i;
const OUTLOOK_SENT = /^(envoyé|sent|gesendet|verzonden|sendt|enviado|inviato|date)\s*:\s*\S/i;

/** La partie nouvelle d'une réponse : tout ce qui précède l'historique cité. */
export function stripQuoted(text: string): string {
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const joined = i + 1 < lines.length ? `${l} ${lines[i + 1].trim()}` : l;
    if (ATTRIBUTION.some((re) => re.test(l)) || ((/^(on|le|op|am|den|el|il) /i.test(l)) && ATTRIBUTION.some((re) => re.test(joined)))) { cut = i; break; }
    if (OUTLOOK_FROM.test(l) && lines.slice(i + 1, i + 4).some((x) => OUTLOOK_SENT.test(x.trim()))) { cut = i; break; }
    // Un bloc de lignes citées « > » qui court jusqu'à la fin = historique.
    if (/^>/.test(l) && lines.slice(i).every((x) => /^>/.test(x.trim()) || x.trim() === '')) { cut = i; break; }
  }
  // Signature : coupée au séparateur « -- » ou à la mention d'envoi d'un téléphone
  // (le message entier reste consultable).
  for (let i = 0; i < cut; i++) {
    const l = lines[i].trim();
    if (i > 0 && (/^--\s*$/.test(lines[i]) || MOBILE_SIGNATURE.test(l))) { cut = i; break; }
  }
  const fresh = lines.slice(0, cut).join('\n').trim();
  return fresh || (text ?? '').trim();
}

const MOBILE_SIGNATURE = /^(envoyé de mon|sent from my|verzonden (vanaf|met) mijn|von meinem .{1,30} gesendet|sendt fra min|enviado desde mi|inviato da)\b/i;

export type Headers = Record<string, string>;

/** En-têtes Gmail ([{name, value}]) → objet aux clés en minuscules. */
export function headersOf(list: Array<{ name?: string; value?: string }> | null | undefined): Headers {
  const out: Headers = {};
  for (const h of list ?? []) if (h?.name) out[h.name.toLowerCase()] = h.value ?? '';
  return out;
}

/** L'en-tête des mails internes d'ADA (le bilan du jour à l'équipe, 18/10) : ils restent dans Gmail, hors de la Messagerie. */
export const INTERNAL_HEADER = 'X-ADA-Interne';

/** Un mail interne d'ADA (en-tête ci-dessus), pas une conversation ? */
export function isInternalMail(h: Headers): boolean {
  return !!h[INTERNAL_HEADER.toLowerCase()];
}

const AUTO_SUBJECT = /^(automatic reply|auto(matic)?[- ]?reply|autoreply|out of (the )?office|réponse automatique|absence|abwesen|automatische antwort|afwezig|automatisch antwoord|fravær|autosvar|automatisk svar|respuesta automática|fuera de la oficina|risposta automatica|fuori ufficio)/i;

/** Réponse automatique (absence, accusé de réception) : en-têtes d'abord, objet ensuite. */
export function isAutoReply(h: Headers, subject: string): boolean {
  const auto = (h['auto-submitted'] ?? '').trim().toLowerCase();
  if (auto && auto !== 'no') return true;
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-autoresponse']) return true;
  if (/^(auto_reply|auto-reply)$/i.test((h['precedence'] ?? '').trim())) return true;
  return AUTO_SUBJECT.test((subject ?? '').trim());
}

/** Avis de non-remise (adresse morte, boîte pleine…). */
export function isBounce(fromEmail: string, subject: string, h: Headers): boolean {
  if (/^(mailer-daemon|postmaster)@/i.test((fromEmail ?? '').trim())) return true;
  if (/report-type\s*=\s*"?delivery-status/i.test(h['content-type'] ?? '')) return true;
  return /(delivery status notification|undeliver|returned mail|mail delivery (failed|subsystem)|failure notice|non remis|non distribuable|unzustellbar|onbestelbaar|kunne ikke leveres|no se puede entregar|non recapitato)/i.test(subject ?? '');
}

/** Les destinataires refusés d'un avis de non-remise (hors nos propres boîtes). */
export function bouncedRecipients(h: Headers, text: string, ownMailboxes: string[]): string[] {
  const own = new Set(ownMailboxes.map((m) => m.toLowerCase()));
  const found = new Set<string>();
  for (const e of (h['x-failed-recipients'] ?? '').split(/[,\s]+/)) if (isEmail(e)) found.add(e.toLowerCase());
  for (const m of (text ?? '').matchAll(/final-recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?/gi)) found.add(m[1].toLowerCase());
  if (found.size === 0) {
    for (const m of (text ?? '').slice(0, 3000).matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) found.add(m[0].toLowerCase());
  }
  return [...found].filter((e) => !own.has(e) && !/^(mailer-daemon|postmaster|noreply|no-reply)@/i.test(e)).slice(0, 5);
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const STOP_PATTERNS = [
  /^\s*(stop|stopp|unsubscribe|desinscription|desinscrire|afmelden|abmelden)\b/,
  /\b(desinscri|desabonn|unsubscrib|uitschrijven|afmelden|abmelden|austragen|afmeld|framelding|frameld|darme de baja|darse de baja|disiscriv|cancellatemi)/,
  /\bne (plus|pas) (me )?(recevoir|contacter|ecrire|relancer)\b/,
  /\b(remove me|take me off|do not (contact|email)|don'?t (contact|email) me|stop (emailing|contacting|sending))\b/,
  /\b(niet meer (mailen|contacteren|benaderen)|geen (e-?mails|mails) meer)\b/,
  /\b(keine (e-?mails|mails|werbung) mehr|nicht mehr (kontaktieren|anschreiben))\b/,
  /\b(ikke kontakt|ingen (flere )?mails|kontakt mig ikke)\b/,
  /\b(no me (contacte|escriba)s?|no (quiero|deseo) recibir)\b/,
  /\b(non (contattatemi|scrivetemi)|non voglio ricevere)\b/,
];

/** Demande d'arrêt EXPLICITE en tête de réponse (« STOP », « désinscrire », « unsubscribe »…). */
export function isStopRequest(freshText: string): boolean {
  const head = fold((freshText ?? '').slice(0, 300));
  return STOP_PATTERNS.some((re) => re.test(head));
}
