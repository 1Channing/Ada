/**
 * OFFRES FOURNISSEUR — PDF paysage à la charte MC Export (jsPDF, navigateur
 * seulement : le module Excel vit à part pour rester testable hors navigateur).
 */
import jsPDF from 'jspdf';
import type { OfferVehicle } from './parseSupplierFile';
import { fmtDate, bodyOf, labelOf, engineOf, fuelLabel, exportSetupOf, type OfferDocument } from './exportOfferXlsx';
import { BUILTIN_COLUMNS, cellValue, effectiveColumns, gearboxLabel, type BuiltinColumnKey, type ExportColumn, type ExportContext } from './exportColumns';
import { EXPORT_TEXT } from './offerSettings';

const ENCRE: [number, number, number] = [0x22, 0x34, 0x6e];
const OCEAN: [number, number, number] = [0x2c, 0x5f, 0x9e];
const GRIS: [number, number, number] = [0x64, 0x74, 0x8b];

/** Nombres pour le PDF : l'espace fine insécable du format français (U+202F)
 *  n'existe pas dans la police Helvetica de jsPDF et sortait en « / »
 *  (constat Channing 14/09 : « 10/700 ») — espace normale à la place. */
const pdfNum = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ');

/** Libellés PDF des colonnes intégrées non renommées (ASCII : la police Helvetica de jsPDF). */
const PDF_LABEL_EN: Record<BuiltinColumnKey, string> = {
  vin: 'Chassis (VIN)', vehicle: 'Vehicle', qty: 'Units', engine: 'Engine', version: 'Version', body: 'Body',
  reg: '1st reg.', km: 'Km', color: 'Colour', fuel: 'Fuel', power: 'Hp', gearbox: 'Gearbox', co2: 'CO2',
  damages: 'Damages (EUR)', price: 'Price excl. VAT (EUR)', supplier_price: 'Supplier excl. VAT (EUR)', location: 'Storage', report: 'Inspection',
};
const pdfBuiltinLabel = (k: BuiltinColumnKey, ctx: ExportContext) => {
  if (k === 'price' && ctx.basis === 'ttc') return ctx.lang === 'en' ? 'Price incl. VAT (EUR)' : 'Prix TTC (EUR)';
  return (ctx.lang === 'en' ? PDF_LABEL_EN : PDF_LABEL)[k];
};
const PDF_LABEL: Record<BuiltinColumnKey, string> = {
  vin: 'Chassis (VIN)', vehicle: 'Vehicule', qty: 'Unites', engine: 'Motorisation', version: 'Version', body: 'Carrosserie',
  reg: '1re immat.', km: 'Km', color: 'Couleur', fuel: 'Energie', power: 'Ch', gearbox: 'Boite', co2: 'CO2',
  damages: 'Dommages (EUR)', price: 'Prix HT (EUR)', supplier_price: 'Prix fourn. HT (EUR)', location: 'Lieu de stockage', report: 'Inspection',
};
/** Texte libre → ce que Helvetica sait écrire : sans accents, € → EUR, ₂ → 2, tirets longs → -. */
const pdfSafe = (t: string) => t.replace(/€/g, 'EUR').replace(/₂/g, '2').replace(/[\u2013\u2014]/g, '-').replace(/[\u202f\u00a0]/g, ' ')
  .normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]/g, '');

async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch('/logo-mark.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
  } catch { return null; }
}

export async function buildOfferPdf(doc: OfferDocument): Promise<Blob> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const logo = await loadLogo();
  const margin = 12;

  // POLICE HELVETICA DE jsPDF (constat Channing 22/09 sur le PDF Opel) : « € »,
  // « ₂ » et le tiret cadratin n'existent pas dans son encodage — ils
  // sortaient en « () », « C O » et vide. Libellés en ASCII, vide = « - ».
  const NA = '-';
  type Col = { key: string; label: string; w: number; align?: 'right'; wrap?: boolean; get: (v: OfferVehicle) => string; has: (v: OfferVehicle) => boolean };
  const allCols: Col[] = [
    { key: 'vin', label: 'Chassis (VIN)', w: 40, get: (v) => v.vin ?? NA, has: (v) => Boolean(v.vin) },
    { key: 'veh', label: 'Vehicule', w: 46, wrap: true, get: (v) => `${labelOf(v)}${bodyOf(v) ? ` - ${bodyOf(v)}` : ''}${v.color ? ` - ${v.color}` : ''}`, has: () => true },
    // MOTORISATION (demande Channing 22/09) : la colonne Engine du fournisseur
    // telle quelle (« 1.2 Turbo. 96 kW (130 PS). S/S »), sinon la ligne
    // version d'origine — jamais rédigée, jamais perdue.
    // Exemplaires (catalogue Record Rent a Car 07/10) : une ligne par modèle, le nombre à côté.
    { key: 'qty', label: 'Unites', w: 14, align: 'right', get: (v) => String(v.quantity ?? 1), has: (v) => (v.quantity ?? 1) > 1 },
    { key: 'eng', label: 'Motorisation', w: 48, wrap: true, get: (v) => engineOf(v), has: (v) => Boolean((v.engine ?? '').trim() || (v.version ?? '').trim()) },
    { key: 'fuel', label: 'Energie', w: 24, wrap: true, get: (v) => fuelLabel(v.fuel), has: (v) => Boolean(v.fuel) },
    { key: 'reg', label: '1re immat.', w: 22, get: (v) => fmtDate(v.reg_date).replace('—', NA), has: (v) => Boolean(v.reg_date) },
    { key: 'km', label: 'Km', w: 22, align: 'right', get: (v) => (v.km == null ? NA : pdfNum(v.km)), has: (v) => v.km != null },
    { key: 'pow', label: 'Ch', w: 14, align: 'right', get: (v) => (v.power_ch == null ? NA : String(v.power_ch)), has: (v) => v.power_ch != null },
    { key: 'gb', label: 'Boite', w: 20, get: (v) => (v.gearbox ? (v.gearbox === 'AUTOMATIQUE' ? 'Auto' : v.gearbox === 'MANUELLE' ? 'Manuelle' : v.gearbox) : NA), has: (v) => Boolean(v.gearbox) },
    { key: 'co2', label: 'CO2', w: 14, align: 'right', get: (v) => (v.co2 == null ? NA : String(v.co2)), has: (v) => v.co2 != null },
    ...(doc.showDamages ? [{ key: 'dmg', label: 'Dommages (EUR)', w: 26, align: 'right' as const, get: (v: OfferVehicle) => (v.damages == null ? NA : pdfNum(v.damages)), has: (v: OfferVehicle) => v.damages != null }] : []),
    ...(doc.showPrices === false ? [] : [{ key: 'price', label: 'Prix HT (EUR)', w: 30, align: 'right' as const, get: (v: OfferVehicle) => (v.sale_price == null ? NA : pdfNum(v.sale_price)), has: () => true }]),
    { key: 'rep', label: 'Inspection', w: 28, get: (v) => (v.report_url ? 'Voir le rapport' : NA), has: (v) => Boolean(v.report_url) },
  ];
  // COLONNES SELON LES DONNÉES PRÉSENTES (décision Channing 22/09, liste
  // Sorento : « trop de vide ») : une colonne vide pour TOUS les véhicules
  // n'est pas imprimée — la place revient aux colonnes renseignées.
  // Colonnes réglées sur l'offre (11/10) : ordre, libellés et colonnes libres de l'offre.
  const { ctx, columns } = exportSetupOf(doc);
  const T = EXPORT_TEXT[ctx.lang];
  const configured = (cs: ExportColumn[]): Col[] => effectiveColumns(cs, doc.vehicles, doc.showPrices !== false, ctx).map((c) => {
    const b = c.builtin ? BUILTIN_COLUMNS[c.builtin] : null;
    const label = c.builtin && c.label === BUILTIN_COLUMNS[c.builtin].label ? pdfBuiltinLabel(c.builtin, ctx) : pdfSafe(c.label);
    const text = (v: OfferVehicle): string => {
      const x = cellValue(c, v, ctx);
      if (x === '' || x == null) return NA;
      if (c.builtin === 'reg') return fmtDate(String(x)).replace('—', NA);
      if (c.builtin === 'report') return pdfSafe(T.report);
      if (c.builtin === 'gearbox') return pdfSafe(gearboxLabel(v.gearbox, ctx.lang));
      return typeof x === 'number' ? pdfNum(x) : pdfSafe(String(x));
    };
    return {
      key: c.builtin === 'price' ? 'price' : c.builtin === 'report' ? 'rep' : c.id, label,
      w: b?.pdfW ?? Math.max(20, Math.min(46, c.label.length * 2.2 + 6)), align: b?.numeric ? 'right' as const : undefined,
      wrap: Boolean(b?.wrap) || !c.builtin, get: text, has: () => true,
    };
  });
  const cols = columns ? configured(columns) : allCols.filter((c) => doc.vehicles.some((v) => c.has(v)));
  const tableW = cols.reduce((a, c) => a + c.w, 0);
  const scale = (W - 2 * margin) / tableW;
  cols.forEach((c) => { c.w = c.w * scale; });
  // Colonnes réglées (souvent plus nombreuses) : une mise à l'échelle uniforme
  // coupait les dates (« 06/03/202 »). Les colonnes courtes reçoivent la largeur
  // de leur texte le plus long (en-tête compris), les colonnes longues se
  // partagent le reste et passent sur deux lignes.
  if (columns) {
    const avail = W - 2 * margin;
    const textW = (t: string, bold: boolean) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(7.5); return pdf.getTextWidth(t); };
    const fixed = cols.filter((c) => !c.wrap);
    const flex = cols.filter((c) => c.wrap);
    // En-têtes sur deux lignes au besoin : une colonne courte prend la largeur
    // de sa valeur la plus longue ou du plus long MOT de son en-tête.
    const longestWord = (t: string, bold: boolean) => Math.max(0, ...t.split(/\s+/).map((w) => textW(w, bold)));
    fixed.forEach((c) => { c.w = Math.min(60, Math.max(longestWord(c.label, true), ...doc.vehicles.map((v) => textW(c.get(v), c.key === 'price'))) + 4); });
    // Une colonne longue ne descend jamais sous son plus long mot (« Essence » ne
    // sort plus « Essenc-e »), plafonné à 30 mm.
    const flexMin = (c: Col) => Math.min(30, Math.max(14, longestWord(c.label, true) + 4, ...doc.vehicles.map((v) => longestWord(c.get(v), false) + 4)));
    const rest = avail - fixed.reduce((a, c) => a + c.w, 0);
    const flexBase = flex.reduce((a, c) => a + c.w, 0);
    const flexMinTotal = flex.reduce((a, c) => a + flexMin(c), 0);
    if (flex.length && rest >= flexMinTotal) {
      flex.forEach((c) => { c.w = Math.max(flexMin(c), (c.w / flexBase) * rest); });
      const over = cols.reduce((a, c) => a + c.w, 0) - avail;
      if (over > 0) { const room = flex.reduce((a, c) => a + (c.w - flexMin(c)), 0); flex.forEach((c) => { c.w -= room > 0 ? (over * (c.w - flexMin(c))) / room : 0; }); }
    } else {
      // Trop de colonnes : les colonnes longues descendent à leur minimum d'abord,
      // les colonnes courtes (chiffres, dates) ne rétrécissent qu'en dernier recours.
      flex.forEach((c) => { c.w = flexMin(c); });
      const total = cols.reduce((a, c) => a + c.w, 0);
      if (total > avail) { const k = avail / total; cols.forEach((c) => { c.w *= k; }); }
      else if (flex.length) { const extra = (avail - total) / flex.length; flex.forEach((c) => { c.w += extra; }); }
    }
  }

  const drawHeader = () => {
    if (logo) { try { pdf.addImage(logo, 'PNG', margin, 8, 14, 11); } catch { /* logo illisible */ } }
    pdf.setTextColor(...ENCRE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10);
    pdf.text('MC EXPORT', margin + (logo ? 17 : 0), 15);
    pdf.setFontSize(16); pdf.text(doc.title, W / 2, 15, { align: 'center' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GRIS);
    pdf.text(doc.subtitle, W / 2, 21, { align: 'center' });
    pdf.text(doc.date.toUpperCase(), W - margin, 15, { align: 'right' });
    pdf.text(pdfSafe(T.pdfPrices(ctx.basis)), W - margin, 21, { align: 'right' });
    pdf.setDrawColor(...OCEAN); pdf.setLineWidth(0.6); pdf.line(margin, 25, W - margin, 25);
  };
  const drawFooter = (page: number, pages: number) => {
    pdf.setFontSize(7.5); pdf.setTextColor(...GRIS); pdf.setFont('helvetica', 'normal');
    pdf.text(doc.footer, margin, H - 7);
    pdf.text(`${page} / ${pages}`, W - margin, H - 7, { align: 'right' });
  };
  // Lignes à hauteur variable : les colonnes longues (véhicule, motorisation,
  // énergie) passent sur DEUX lignes au lieu d'être coupées (« 1.2 MHEV 100
  // kW (136 », « Hybride r », constat 22/09).
  const LINE = 3.6;
  const headH = 8;
  const FONT = 7.5;
  let y = 30;
  const drawTableHead = () => {
    pdf.setFillColor(...ENCRE); pdf.rect(margin, y, W - 2 * margin, headH, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(FONT);
    let x = margin;
    for (const c of cols) {
      const lines = (pdf.splitTextToSize(c.label, c.w - 3) as string[]).slice(0, 2);
      const tx = c.align === 'right' ? x + c.w - 1.5 : x + 1.5;
      lines.forEach((t, i) => {
        const wdt = pdf.getTextWidth(t);
        if (wdt > c.w - 3) pdf.setFontSize(Math.max(4.5, (FONT * (c.w - 3)) / wdt));
        pdf.text(t, tx, lines.length === 1 ? y + 5.5 : y + 3.6 + i * 3.2, { align: c.align === 'right' ? 'right' : 'left' });
        pdf.setFontSize(FONT);
      });
      x += c.w;
    }
    y += headH;
  };
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(FONT);
  // Une cellule courte (chiffre, date, plaque) n'est JAMAIS coupée (11/10, constat
  // Channing : « 24 800 km » sortait « 24 » — le texte était coupé à l'espace des
  // milliers et seule la première ligne était imprimée) : si elle déborde, sa
  // police rétrécit. Une cellule longue passe sur deux lignes, « … » si elle continue.
  const cellLines = (c: Col, v: OfferVehicle): string[] => {
    const text = c.get(v);
    if (!c.wrap) return [text];
    const lines = pdf.splitTextToSize(text, c.w - 4) as string[];
    return lines.length > 2 ? [lines[0], `${lines[1].replace(/\s+\S*$/, '')}...`] : lines;
  };
  const rows = doc.vehicles.map((v) => {
    const cells = cols.map((c) => cellLines(c, v));
    const n = Math.max(1, ...cells.map((l) => l.length));
    return { v, cells, h: 3 + n * LINE + 1.5 };
  });
  // Pagination calculée sur les hauteurs réelles.
  const pageBreaks: number[] = [];
  { let yy = 30 + headH; rows.forEach((r, i) => { if (yy + r.h > H - 14) { pageBreaks.push(i); yy = 30 + headH; } yy += r.h; }); }
  const total = pageBreaks.length + 1;
  let page = 1;
  drawHeader(); drawTableHead();
  rows.forEach((r, i) => {
    if (pageBreaks.includes(i)) {
      drawFooter(page, total); pdf.addPage(); page++; y = 30; drawHeader(); drawTableHead();
    }
    if (i % 2 === 1) { pdf.setFillColor(243, 246, 251); pdf.rect(margin, y, W - 2 * margin, r.h, 'F'); }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(FONT); pdf.setTextColor(30, 41, 59);
    let x = margin;
    cols.forEach((c, ci) => {
      const lines = r.cells[ci];
      if (c.key === 'price') { pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...ENCRE); }
      lines.forEach((txt, li) => {
        const ty = y + 3 + LINE * (li + 1) - 0.6;
        if (c.key === 'rep' && r.v.report_url) {
          pdf.setTextColor(...OCEAN);
          pdf.textWithLink(txt, x + 2, ty, { url: r.v.report_url });
        } else {
          const room = c.w - 3;
          const width = pdf.getTextWidth(txt);
          if (!c.wrap && width > room) pdf.setFontSize(Math.max(4.5, (FONT * room) / width));
          pdf.text(txt, c.align === 'right' ? x + c.w - 1.5 : x + 1.5, ty, { align: c.align === 'right' ? 'right' : 'left' });
          pdf.setFontSize(FONT);
        }
      });
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(30, 41, 59);
      x += c.w;
    });
    pdf.setDrawColor(226, 232, 240); pdf.setLineWidth(0.2); pdf.line(margin, y + r.h, W - margin, y + r.h);
    y += r.h;
  });
  drawFooter(page, total);
  return pdf.output('blob');
}

