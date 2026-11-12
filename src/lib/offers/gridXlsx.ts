/**
 * GRILLE BRUTE ↔ FICHIER XLSX (12/11, Channing après une fusion : « j'ai perdu le fichier brut d'une des listes, il faut
 * qu'on puisse avoir accès aux fichiers bruts en dessous comme avant »). Un fichier Excel déposé n'est gardé que comme
 * grille dans l'offre (source_grid) ; à la fusion, la grille de chaque autre offre est réécrite en .xlsx et rangée dans
 * le stockage à côté des PDF déposés (source_files), pour rester consultable sous « Fichier d'origine, brut ».
 */
import * as XLSX from 'xlsx';

export function gridToXlsxBlob(grid: unknown[][], sheetName = 'Feuille1'): Blob {
  const rows = grid.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? null : typeof c === 'object' ? JSON.stringify(c) : c)) : []));
  const ws = XLSX.utils.aoa_to_sheet(rows as (string | number | boolean | null)[][]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille1');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Nom de fichier .xlsx sûr pour le stockage (accents et espaces retirés). */
export const xlsxStorageName = (filename: string) =>
  `${(filename.replace(/\.[^.]+$/, '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'liste')}.xlsx`;

export const isSpreadsheetName = (name: string) => /\.(xlsx|xlsm|xls|csv)$/i.test(name);
