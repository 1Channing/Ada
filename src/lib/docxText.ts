/**
 * TEXTE D'UN .DOCX, DANS LE NAVIGATEUR (10/11 soir, Channing : « il faut qu'on puisse ajouter un docx à la place d'une
 * URL »). Sans bibliothèque : un .docx est un zip ; on lit son répertoire central, on décompresse (DecompressionStream)
 * et on sort des LIGNES de texte, comme pour un PDF.
 *
 * Deux formes : le Word classique (word/document.xml : un paragraphe ou une cellule = une ligne) et le « docx
 * conteneur » des exports GIS@WEB de VWFS (word/afchunk.mht : une page HTML en quoted-printable, dont chaque cellule
 * de tableau devient une ligne). Testé sur l'export VWFS 2024790787.
 */

type Entry = { name: string; method: number; compressedSize: number; offset: number };

function readCentralDirectory(buf: Uint8Array): Entry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Fin de répertoire central : signature 0x06054b50, cherchée depuis la fin (commentaire ≤ 64 Ko).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('fichier zip illisible (fin de répertoire absente)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(buf: Uint8Array, e: Entry): Promise<Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error(`entrée zip illisible : ${e.name}`);
  const nameLen = dv.getUint16(e.offset + 26, true), extraLen = dv.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error(`compression zip non gérée (${e.method})`);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const decodeEntities = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

/** Page HTML → lignes : une par cellule, paragraphe, titre ou <br>. */
export function htmlToLines(html: string): string[] {
  let t = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<\/(td|th|p|div|tr|li|h\d|table)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return t.split('\n').map((l) => decodeEntities(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Partie text/html d'un MHT (quoted-printable ou base64) → HTML. */
function mhtToHtml(raw: string): string {
  const boundary = raw.match(/boundary="?([^"\r\n]+)"?/)?.[1];
  const parts = boundary ? raw.split(`--${boundary}`) : [raw];
  const part = parts.find((p) => /Content-Type:\s*text\/html/i.test(p)) ?? parts[0];
  const sep = part.search(/\r?\n\r?\n/);
  const head = part.slice(0, sep); const body = part.slice(sep).replace(/^\r?\n\r?\n/, '');
  if (/Content-Transfer-Encoding:\s*base64/i.test(head)) {
    const bin = atob(body.replace(/\s+/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(head)) {
    // Quoted-printable : « =XX » octet, « = » en fin de ligne = continuation ; décodé en UTF-8.
    const bytes: number[] = [];
    const s = body.replace(/=\r?\n/g, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
      else bytes.push(...new TextEncoder().encode(c));
    }
    return new TextDecoder().decode(Uint8Array.from(bytes));
  }
  return body;
}

/** word/document.xml → lignes (paragraphes et cellules). */
function documentXmlToLines(xml: string): string[] {
  const out: string[] = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const t = (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, '')).join('');
    const line = decodeEntities(t).replace(/\s+/g, ' ').trim();
    if (line) out.push(line);
  }
  return out;
}

export async function docxToLines(file: Blob): Promise<string[]> { return (await docxToLinesEx(file)).lines; }

/** Les photos du véhicule référencées par la page HTML (11/11 : « ajouter les photos ») : les <img> d'au moins
 *  100 px de large, ou dont l'adresse est une image du véhicule (GIS@WEB : …/images/<VIN>/…) — les icônes
 *  (couleur, pays, équipements, 30 px) sont écartées. */
export function photoUrlsOfHtml(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = tag.match(/\bsrc\s*=\s*"?([^"\s>]+)"?/i)?.[1];
    if (!src || !/^https?:\/\//i.test(src)) continue;
    const w = Number(tag.match(/\bwidth\s*=\s*"?(\d+)/i)?.[1] ?? 0);
    if (w >= 100 || /\/images\/[A-Z0-9]{11,17}\//i.test(src)) { const u = decodeEntities(src); if (!out.includes(u)) out.push(u); }
  }
  return out;
}

export async function docxToLinesEx(file: Blob): Promise<{ lines: string[]; photoUrls: string[] }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = readCentralDirectory(buf);
  const byName = (n: string) => entries.find((e) => e.name === n);
  const chunk = entries.find((e) => /^word\/afchunk.*\.mht$/i.test(e.name));
  if (chunk) {
    const raw = new TextDecoder().decode(await readEntry(buf, chunk));
    const html = mhtToHtml(raw);
    return { lines: htmlToLines(html), photoUrls: photoUrlsOfHtml(html) };
  }
  const doc = byName('word/document.xml');
  if (!doc) throw new Error('ce .docx ne contient pas de document Word lisible');
  return { lines: documentXmlToLines(new TextDecoder().decode(await readEntry(buf, doc))), photoUrls: [] };
}
