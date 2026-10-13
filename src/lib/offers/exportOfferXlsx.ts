/**
 * OFFRES FOURNISSEUR — réédition à la charte MC Export : Excel (deux
 * feuilles, comme le livrable validé du 14/09), formats et téléchargement.
 * Le PDF (jsPDF) vit dans exportOfferPdf.ts. Tout est généré depuis les
 * données normalisées : aucun texte n'est rédigé par un modèle.
 */
// xlsx-js-style : même API que SheetJS, avec les STYLES (gras, fond, retour à la
// ligne, bordures, formats) — SheetJS communautaire n'en écrit aucun (30/09).
import * as XLSXns from 'xlsx-js-style';
// Module CommonJS : selon le bundler, l'API est sur l'espace de noms ou sur `default`.
const XLSX = ((XLSXns as unknown as { default?: typeof XLSXns }).default ?? XLSXns) as typeof XLSXns;
import type { OfferVehicle } from './parseSupplierFile';
import { bodyOf, labelOf, engineOf, fuelLabel, BUILTIN_COLUMNS, cellValue, effectiveColumns, defaultExportColumns, displayLabel, type ExportColumn, type ExportContext } from './exportColumns';
import { EXPORT_TEXT, type ExportLang, type PriceBasis } from './offerSettings';

export interface OfferDocument {
  title: string;              // « OPEL ASTRA — SÉLECTION PROFESSIONNELLE »
  subtitle: string;           // « 6 véhicules · prix HT · transport à la charge de l'acheteur »
  date: string;               // « 14 septembre 2026 »
  vehicles: OfferVehicle[];   // déjà filtrés (sélectionnés) et ordonnés
  showDamages: boolean;
  showSupplierPrice: boolean; // jamais pour un client — utile en interne
  /** false = offre sans prix (demande d'offre, 06/10) : aucune colonne de prix. */
  showPrices?: boolean;
  footer: string;
  /** Colonnes réglées sur l'offre (ordre, libellés, colonnes libres) — absent = colonnes historiques. */
  columns?: ExportColumn[];
  /** Paramètres de l'offre (11/10) : langue, base de nos prix (stockés HT), TVA, prix fournisseur. */
  lang?: ExportLang;
  priceBasis?: PriceBasis;
  saleVat?: number;
  supplierHt?: (v: OfferVehicle) => number | null;
  /** Dommages en euros quand le fichier est en couronnes (13/10). */
  damagesEur?: (v: OfferVehicle) => number | null;
}

/** Contexte d'export d'un document, et colonnes à utiliser : la forme historique ne vaut qu'en français, prix HT, colonnes non réglées. */
export function exportSetupOf(doc: OfferDocument): { ctx: ExportContext; columns: ExportColumn[] | undefined } {
  const ctx: ExportContext = { lang: doc.lang ?? 'fr', basis: doc.priceBasis ?? 'ht', saleVat: doc.saleVat ?? 0.2, supplierHt: doc.supplierHt, damagesEur: doc.damagesEur };
  const columns = doc.columns ?? (ctx.lang !== 'fr' || ctx.basis === 'ttc' ? defaultExportColumns() : undefined);
  return { ctx, columns };
}


export const fmtEur = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
export const fmtKm = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} km`);
export const fmtDate = (iso: string | null | undefined) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR'); };
// Libellés partagés avec le PDF et le réglage des colonnes (exportColumns.ts).
export { bodyOf, labelOf, engineOf, fuelLabel } from './exportColumns';

export function buildOfferWorkbook(doc: OfferDocument): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  // COLONNES SELON LES DONNÉES PRÉSENTES (décision Channing 22/09, liste
  // Sorento « trop de vide ») : une colonne vide pour tous les véhicules
  // n'est pas exportée ; véhicule et prix restent toujours.
  type Cell = string | number | null;
  type Col = { label: string; w: number; get: (v: OfferVehicle) => Cell; always?: boolean; fmt?: 'eur' | 'km'; wrap?: boolean; strong?: boolean; link?: boolean };
  const allCols: Col[] = [
    { label: 'Châssis (VIN)', w: 18, get: (v) => v.vin ?? '' },
    { label: 'Véhicule', w: 22, get: (v) => labelOf(v), always: true },
    // Exemplaires (catalogue Record Rent a Car 07/10) : une ligne par modèle, le nombre à côté.
    { label: 'Unités', w: 8, get: (v) => ((v.quantity ?? 1) > 1 ? v.quantity! : null) },
    { label: 'Motorisation', w: 30, get: (v) => ((v.engine ?? '').trim() || (v.version ?? '').trim() ? engineOf(v) : '') },
    { label: 'Version', w: 40, get: (v) => v.version ?? '' },
    { label: 'Carrosserie', w: 12, get: (v) => bodyOf(v) },
    { label: '1re immatriculation', w: 16, get: (v) => v.reg_date ?? '' },
    { label: 'Kilométrage', w: 12, get: (v) => v.km ?? null },
    { label: 'Couleur', w: 12, get: (v) => v.color ?? '' },
    { label: 'Énergie', w: 20, get: (v) => (v.fuel ? fuelLabel(v.fuel) : '') },
    { label: 'Puissance (ch)', w: 12, get: (v) => v.power_ch ?? null },
    { label: 'Boîte', w: 12, get: (v) => v.gearbox ?? '' },
    { label: 'CO₂ (g/km)', w: 10, get: (v) => v.co2 ?? null },
    ...(doc.showDamages ? [{ label: 'Dommages chiffrés (€)', w: 16, get: (v: OfferVehicle) => (doc.damagesEur ? doc.damagesEur(v) : v.damages ?? null) }] : []),
    ...(doc.showPrices === false ? [] : [{ label: 'Prix de vente HT (€)', w: 18, get: (v: OfferVehicle) => v.sale_price ?? null, always: true }]),
    ...(doc.showSupplierPrice ? [{ label: 'Prix fournisseur HT (€)', w: 18, get: (v: OfferVehicle) => v.price_ht ?? null }] : []),
    { label: 'Rapport', w: 40, get: (v) => v.report_url ?? '' },
  ];
  // Mise en forme déduite des libellés historiques (colonnes non réglées).
  const legacyFlags = (c: Col): Col => ({
    ...c, fmt: /€/.test(c.label) ? 'eur' : /Kilom/.test(c.label) ? 'km' : undefined,
    wrap: ['Véhicule', 'Motorisation', 'Version', 'Couleur', 'Rapport'].includes(c.label),
    strong: c.label.startsWith('Prix de vente'), link: c.label === 'Rapport',
  });
  const { ctx, columns } = exportSetupOf(doc);
  const T = EXPORT_TEXT[ctx.lang];
  const cols: Col[] = columns
    ? effectiveColumns(columns, doc.vehicles, doc.showPrices !== false, ctx).map((c) => {
      const b = c.builtin ? BUILTIN_COLUMNS[c.builtin] : null;
      const label = displayLabel(c, ctx);
      return {
        label, w: b?.xlsxW ?? Math.max(12, Math.min(40, label.length + 4)), get: (v: OfferVehicle) => cellValue(c, v, ctx),
        fmt: c.builtin === 'km' ? 'km' : b?.numeric && /price|damages/.test(c.builtin ?? '') ? 'eur' : undefined,
        wrap: Boolean(b?.wrap) || !c.builtin || c.builtin === 'report', strong: c.builtin === 'price', link: c.builtin === 'report',
      };
    })
    : allCols.filter((c) => c.always || doc.vehicles.some((v) => { const x = c.get(v); return x !== '' && x != null; })).map(legacyFlags);
  const head: Cell[][] = [
    [doc.title], [doc.subtitle], [`${T.offerOf(doc.date)} — ${doc.footer}`], [],
    cols.map((c) => c.label),
  ];
  const rows = doc.vehicles.map((v) => cols.map((c) => c.get(v)));
  const ws1 = XLSX.utils.aoa_to_sheet([...head, ...rows]);
  ws1['!cols'] = cols.map((c) => ({ wch: c.w }));
  // MISE EN FORME (30/09, constat Channing sur l'offre Allemagne : « les
  // lignes se chevauchent ») : titres fusionnés sur toute la largeur, en-tête
  // en gras sur fond sombre, texte long à la ligne avec une hauteur de ligne
  // calculée, bordures fines, prix et km formatés, volets figés, filtre.
  const ncol = cols.length;
  const lastCol = XLSX.utils.encode_col(ncol - 1);
  ws1['!merges'] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: ncol - 1 } }));
  const wrapCols = new Set(cols.map((c, i) => (c.wrap ? i : -1)).filter((i) => i >= 0));
  const numFmt = (c: Col) => (c.fmt === 'eur' ? '#,##0 "€"' : c.fmt === 'km' ? '#,##0' : undefined);
  const border = { top: { style: 'thin', color: { rgb: 'D0D5DD' } }, bottom: { style: 'thin', color: { rgb: 'D0D5DD' } }, left: { style: 'thin', color: { rgb: 'D0D5DD' } }, right: { style: 'thin', color: { rgb: 'D0D5DD' } } };
  const styleCell = (r: number, c: number, s: Record<string, unknown>) => {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (!ws1[ref]) ws1[ref] = { t: 's', v: '' };
    (ws1[ref] as { s?: unknown }).s = s;
  };
  styleCell(0, 0, { font: { bold: true, sz: 16, color: { rgb: '0F172A' } }, alignment: { vertical: 'center' } });
  styleCell(1, 0, { font: { sz: 11, color: { rgb: '475569' } }, alignment: { vertical: 'center' } });
  styleCell(2, 0, { font: { sz: 10, italic: true, color: { rgb: '64748B' } }, alignment: { vertical: 'center' } });
  for (let c = 0; c < ncol; c++) {
    styleCell(4, c, { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E293B' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border });
  }
  const heights: Array<{ hpt: number }> = [{ hpt: 26 }, { hpt: 18 }, { hpt: 16 }, { hpt: 8 }, { hpt: 32 }];
  rows.forEach((row, ri) => {
    let lines = 1;
    row.forEach((val, c) => {
      const col = cols[c];
      const wrap = wrapCols.has(c);
      if (wrap && typeof val === 'string' && val) lines = Math.max(lines, Math.ceil(val.length / Math.max(8, cols[c].w - 2)));
      styleCell(5 + ri, c, {
        alignment: { vertical: 'top', wrapText: wrap, horizontal: typeof val === 'number' ? 'right' : 'left' },
        border,
        ...(ri % 2 === 1 ? { fill: { fgColor: { rgb: 'F8FAFC' } } } : {}),
        ...(col.strong ? { font: { bold: true } } : {}),
        ...(numFmt(col) && typeof val === 'number' ? { numFmt: numFmt(col) } : {}),
      });
      if (col.link && typeof val === 'string' && val.startsWith('http')) {
        (ws1[XLSX.utils.encode_cell({ r: 5 + ri, c })] as { l?: unknown }).l = { Target: val, Tooltip: 'Ouvrir le rapport' };
      }
    });
    heights.push({ hpt: 15 * Math.min(lines, 6) + 4 });
  });
  ws1['!rows'] = heights;
  ws1['!autofilter'] = { ref: `A5:${lastCol}${5 + rows.length}` };
  XLSX.utils.book_append_sheet(wb, ws1, T.sheet);

  const ws2Head: string[] = [...T.sheet2Head];
  const ws2Rows = doc.vehicles.map((v) => [v.vin ?? '', v.brand, v.model, v.engine ?? '', v.fuel ? fuelLabel(v.fuel, ctx.lang) : '', v.gearbox ?? '', v.location ?? '',
    v.vat_recoverable == null ? '' : v.vat_recoverable ? T.yes : T.no, v.imported == null ? '' : v.imported ? T.yes : T.no,
    Object.entries(v.extras).map(([k, val]) => `${k}: ${val}`).join(' · ')]);
  const ws2 = XLSX.utils.aoa_to_sheet([ws2Head, ...ws2Rows]);
  const w2 = [18, 12, 14, 28, 20, 12, 22, 12, 8, 60];
  ws2['!cols'] = w2.map((w) => ({ wch: w }));
  ws2Head.forEach((_, c) => { (ws2[XLSX.utils.encode_cell({ r: 0, c })] as { s?: unknown }).s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E293B' } }, alignment: { wrapText: true, vertical: 'center' }, border }; });
  ws2['!rows'] = [{ hpt: 30 }, ...ws2Rows.map((r) => ({ hpt: 15 * Math.min(6, Math.max(1, Math.ceil(String(r[9]).length / 58), Math.ceil(String(r[3]).length / 26))) + 4 }))];
  ws2Rows.forEach((r, ri) => r.forEach((val, c) => {
    const ref = XLSX.utils.encode_cell({ r: 1 + ri, c });
    if (!ws2[ref]) ws2[ref] = { t: 's', v: '' };
    (ws2[ref] as { s?: unknown }).s = { alignment: { vertical: 'top', wrapText: c === 3 || c === 9 }, border, ...(typeof val === 'number' ? {} : {}) };
  }));
  XLSX.utils.book_append_sheet(wb, ws2, T.sheet2);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadBlob(data: ArrayBuffer | Blob, filename: string, mime: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export const slugFile = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'offre';
