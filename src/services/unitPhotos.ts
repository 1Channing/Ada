/**
 * DOSSIER PHOTOS D'UNE SINGLE UNIT (12/11, Channing : « je veux juste joindre le dossier de photos en PDF tel qu'il est
 * quand on le dépose, juste les photos qui défilent sans rien d'autre »).
 *
 * Un seul PDF déposé → publié tel quel. Plusieurs fichiers (PDF et/ou images) → un PDF assemblé : les pages des PDF
 * copiées dans l'ordre, chaque image sur une page à ses proportions, aucun texte. Publié dans le bucket public
 * fyc-fiches (même emplacement que les fiches MC Export), l'adresse va en lien « inspection » de la ligne de l'offre.
 */
import { PDFDocument } from 'pdf-lib';
import { supabase } from '../lib/supabase';
import { FICHES_BUCKET, FICHES_SQL_HINT } from './fycFiche';

const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
const isImage = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name);

/** Image déposée → JPEG ≤ 2 000 px (PNG/WebP convertis ; HEIC refusé par le navigateur → erreur explicite). */
async function toJpeg(file: Blob): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encodage JPEG impossible'))), 'image/jpeg', 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Le PDF à publier : tel quel s'il est seul, sinon assemblé. */
export async function buildUnitDossier(files: File[], onStatus?: (s: string) => void): Promise<{ blob: Blob; name: string; notes: string[] }> {
  const notes: string[] = [];
  const usable = files.filter((f) => isPdf(f) || isImage(f));
  for (const f of files) if (!usable.includes(f)) notes.push(`${f.name} ignoré (ni PDF ni image)`);
  if (!usable.length) throw new Error('aucun PDF ni image déposé');
  if (usable.length === 1 && isPdf(usable[0])) return { blob: usable[0], name: usable[0].name, notes };
  onStatus?.('assemblage du dossier photos…');
  const out = await PDFDocument.create();
  for (const f of usable) {
    try {
      if (isPdf(f)) {
        const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const p of pages) out.addPage(p);
      } else {
        const jpg = await out.embedJpg(await toJpeg(f));
        // Page aux proportions de la photo (largeur A4 paysage 842 pt), rien d'autre dessus.
        const w = 842; const h = Math.round((jpg.height / jpg.width) * w);
        out.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
      }
    } catch (e) { notes.push(`${f.name} : ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (out.getPageCount() === 0) throw new Error('aucune page lisible dans les fichiers déposés');
  const bytes = await out.save();
  const base = (usable.find(isPdf)?.name ?? 'photos').replace(/\.pdf$/i, '');
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), name: `${base}.pdf`, notes };
}

/** Publie le dossier (bucket public fyc-fiches, dossier units/<clé>/) et rend son adresse publique. */
export async function publishUnitDossier(key: string, files: File[], onStatus?: (s: string) => void): Promise<{ url: string | null; error: string | null; notes: string[] }> {
  try {
    const { blob, name, notes } = await buildUnitDossier(files, onStatus);
    onStatus?.('publication du dossier photos…');
    const safeKey = key.replace(/[^A-Za-z0-9_-]+/g, '-');
    const safeName = name.replace(/[^A-Za-z0-9._-]+/g, '-');
    const path = `units/${safeKey}/${safeName}`;
    const up = await supabase.storage.from(FICHES_BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (up.error) return { url: null, error: /bucket|not found|row-level|policy/i.test(up.error.message) ? `${FICHES_SQL_HINT} (${up.error.message})` : up.error.message, notes };
    return { url: supabase.storage.from(FICHES_BUCKET).getPublicUrl(path).data.publicUrl, error: null, notes };
  } catch (e) { return { url: null, error: e instanceof Error ? e.message : String(e), notes: [] }; }
}
