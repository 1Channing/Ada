/** Regroupement des fragments pdf.js en lignes — module PUR (navigateur et worker). */
import type { TextLine } from './bankStatements';

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
