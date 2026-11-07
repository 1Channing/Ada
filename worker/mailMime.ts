/**
 * CONSTRUCTION D'UN E-MAIL (MIME) — partie pure, sans réseau ni base (07/11).
 *
 * Jusqu'ici : texte brut + pièces jointes. Depuis le 07/11 (Channing : « ma signature qui est enregistrée…
 * c'est possible de l'intégrer ? ») : quand l'expéditeur a une signature Gmail, le message part en
 * multipart/alternative (texte brut pour les lecteurs simples + HTML avec la signature, comme un envoi
 * depuis Gmail). Sans signature, le texte brut seul, comme avant.
 */
export interface MimeAttachment { name: string; type: string; bytes: Buffer }
export interface MimeInput {
  from: string; fromName?: string | null; to: string; subject: string; body: string;
  /** Signature HTML de l'expéditeur (Gmail → paramètres → signature), ajoutée sous le texte. */
  signatureHtml?: string | null;
  attachments?: MimeAttachment[];
  headers?: Record<string, string>;
}

export const encodeHeader = (s: string) => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s);
const wrap76 = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');
const b64body = (s: string | Buffer) => wrap76((typeof s === 'string' ? Buffer.from(s, 'utf8') : s).toString('base64'));
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Texte brut → HTML fidèle : lignes conservées, liens cliquables, police lisible partout. */
export function textToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) =>
    escapeHtml(line).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1">$1</a>') || '');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">${lines.map((l) => (l ? `<div>${l}</div>` : '<div><br></div>')).join('')}</div>`;
}

/** Le message complet (en-têtes + corps), prêt pour Gmail (`raw` = base64url de cette chaîne). */
export function buildMime(m: MimeInput): string {
  const from = m.fromName ? `${encodeHeader(m.fromName)} <${m.from}>` : m.from;
  const stamp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const textPart = (b: string) => `Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64body(b)}\r\n`;
  let bodyPart: string;
  if (m.signatureHtml && m.signatureHtml.trim()) {
    // Même présentation que Gmail : le texte, une ligne vide, puis le bloc de signature.
    const html = `<html><body>${textToHtml(m.body)}<div><br></div><div class="gmail_signature">${m.signatureHtml}</div></body></html>`;
    const alt = `alt_${stamp}`;
    bodyPart = [
      `Content-Type: multipart/alternative; boundary="${alt}"`, '',
      `--${alt}`, textPart(m.body).trimEnd(), '',
      `--${alt}`, `Content-Type: text/html; charset="UTF-8"`, 'Content-Transfer-Encoding: base64', '', b64body(html), '',
      `--${alt}--`, '',
    ].join('\r\n');
  } else {
    bodyPart = textPart(m.body);
  }
  const headers = [
    `From: ${from}`, `To: ${m.to}`, `Subject: ${encodeHeader(m.subject)}`, 'MIME-Version: 1.0',
    ...Object.entries(m.headers ?? {}).map(([k, v]) => `${k}: ${v.replace(/[\r\n]+/g, ' ')}`),
  ];
  const atts = m.attachments ?? [];
  if (atts.length === 0) {
    // Sans pièce jointe : le corps (texte seul, ou alternative texte/HTML) est le message.
    const firstLine = bodyPart.split('\r\n')[0];
    const rest = bodyPart.slice(firstLine.length + 2);
    return [...headers, firstLine, rest].join('\r\n');
  }
  const mixed = `ada_${stamp}`;
  const parts = [`--${mixed}\r\n${bodyPart}`];
  for (const a of atts) {
    parts.push(`--${mixed}\r\nContent-Type: ${a.type}; name="${encodeHeader(a.name)}"\r\nContent-Disposition: attachment; filename="${encodeHeader(a.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64body(a.bytes)}\r\n`);
  }
  return [...headers, `Content-Type: multipart/mixed; boundary="${mixed}"`, '', ...parts, `--${mixed}--`, ''].join('\r\n');
}
