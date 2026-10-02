/**
 * PDF → lignes de texte (02/10, relevés de compte). Les fragments de texte
 * d'une page sont regroupés par hauteur (même ligne à ±2 pt) et lus de
 * gauche à droite, comme à l'écran ; chaque ligne garde sa page, sa hauteur
 * et l'abscisse de ses fragments (colonnes Débit / Crédit des relevés CIC,
 * Shine). C'est la forme attendue par src/lib/bankStatements.ts. pdf.js
 * chargé à la demande, build « legacy » (même raison que pdfToImages).
 */
import type { TextLine } from './bankStatements';

export async function pdfToLines(file: Blob): Promise<TextLine[]> { return (await pdfToLinesEx(file)).lines; }

/**
 * Lignes d'un PDF, avec REPLI OCR quand il n'a aucun texte (02/10 soir :
 * relevés Pennylane « imprimés » depuis la visionneuse Safari, texte converti
 * en tracés ; Preview les affiche, aucun lecteur n'y lit un caractère).
 * Chaque page est rendue en image (échelle 3) puis lue par tesseract.js
 * (français + anglais, modèles chargés depuis le CDN à la première
 * utilisation). Vérifié sur Pennylane janvier : 28 lignes sur 29, le solde
 * final signale la ligne manquante. `ocr` vaut true dans ce cas pour que le
 * dépôt le dise.
 */
export async function pdfToLinesEx(file: Blob): Promise<{ lines: TextLine[]; ocr: boolean }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const out: TextLine[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      out.push(...groupLines(tc.items as Array<{ str?: string; transform?: number[] }>, n));
      page.cleanup();
    }
    if (out.length > 0 || doc.numPages === 0) return { lines: out, ocr: false };
    // Aucun texte : OCR page par page.
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker(['fra', 'eng']);
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 3 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas indisponible');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        const r = await worker.recognize(canvas, {}, { blocks: true });
        out.push(...ocrLines((r.data as unknown as OcrData).blocks ?? [], n));
        page.cleanup(); canvas.width = 0; canvas.height = 0;
      }
    } finally { await worker.terminate(); }
    return { lines: out, ocr: true };
  } finally { await doc.destroy(); }
}

type OcrData = { blocks: Array<{ paragraphs: Array<{ lines: Array<{ bbox: { y0: number }; words: Array<{ text: string; bbox: { x0: number } }> }> }> }> };
/** Lignes OCR d'une page : mots avec abscisse, lignes de même hauteur (±12 px) fusionnées, confusions O/0 corrigées dans les plaques et les montants. */
export function ocrLines(blocks: OcrData['blocks'], page: number): TextLine[] {
  const raw: TextLine[] = [];
  for (const b of blocks) for (const p of b.paragraphs) for (const l of p.lines) {
    const frags = l.words.map((w) => ({ x: w.bbox.x0, s: fixOcrToken(w.text) })).filter((f) => f.s);
    if (frags.length) raw.push({ text: '', page, y: -l.bbox.y0, frags });
  }
  const merged: TextLine[] = [];
  for (const l of raw.sort((a, b) => b.y - a.y)) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.y - l.y) <= 12) prev.frags.push(...l.frags);
    else merged.push({ ...l, frags: [...l.frags] });
  }
  for (const m of merged) { m.frags.sort((a, b) => a.x - b.x); m.text = m.frags.map((f) => f.s).join(' ').replace(/\s+/g, ' ').trim(); }
  return merged.filter((m) => m.text);
}
const fixOcrToken = (t: string): string => {
  const s = t.trim();
  if (/^[A-Z]{2}[0-9O]{3}[A-Z]{2}$/.test(s)) return s.slice(0, 2) + s.slice(2, 5).replace(/O/g, '0') + s.slice(5); // plaque GKOO8LM → GK008LM
  if (/^[\dO][\dO .\u00a0]*,[\dO]{2}$/.test(s)) return s.replace(/O/g, '0'); // montant
  return s;
};

/** Fragments pdf.js d'une page → lignes (exporté pour les tests hors navigateur). */
export function groupLines(items: Array<{ str?: string; transform?: number[] }>, page = 1): TextLine[] {
  const rows = new Map<number, Array<{ x: number; s: string }>>();
  for (const it of items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const y = it.transform[5];
    let key: number | undefined;
    for (const k of rows.keys()) if (Math.abs(k - y) <= 2) { key = k; break; }
    if (key === undefined) { key = y; rows.set(key, []); }
    rows.get(key)!.push({ x: it.transform[4], s: it.str.trim() });
  }
  return [...rows.entries()].sort((a, b) => b[0] - a[0])
    .map(([y, frags]) => { frags.sort((a, b) => a.x - b.x); return { text: frags.map((f) => f.s).join(' ').replace(/\s+/g, ' ').trim(), page, y, frags }; })
    .filter((l) => l.text);
}
