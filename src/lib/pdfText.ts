/**
 * PDF → lignes de texte (02/10, relevés de compte). Les fragments de texte
 * d'une page sont regroupés par hauteur (même ligne à ±2 pt) et lus de
 * gauche à droite, comme à l'écran ; chaque ligne garde sa page, sa hauteur
 * et l'abscisse de ses fragments (colonnes Débit / Crédit des relevés CIC,
 * Shine). C'est la forme attendue par src/lib/bankStatements.ts. pdf.js
 * chargé à la demande, build « legacy » (même raison que pdfToImages).
 */
import type { TextLine } from './bankStatements';

export async function pdfToLines(file: Blob): Promise<TextLine[]> {
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
  } finally { await doc.destroy(); }
  return out;
}

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
