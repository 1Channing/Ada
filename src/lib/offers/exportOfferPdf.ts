/**
 * OFFRES FOURNISSEUR — PDF paysage à la charte MC Export (jsPDF, navigateur
 * seulement : le module Excel vit à part pour rester testable hors navigateur).
 */
import jsPDF from 'jspdf';
import type { OfferVehicle } from './parseSupplierFile';
import { fmtDate, bodyOf, labelOf, engineOf, fuelLabel, type OfferDocument } from './exportOfferXlsx';

const ENCRE: [number, number, number] = [0x22, 0x34, 0x6e];
const OCEAN: [number, number, number] = [0x2c, 0x5f, 0x9e];
const GRIS: [number, number, number] = [0x64, 0x74, 0x8b];

/** Nombres pour le PDF : l'espace fine insécable du format français (U+202F)
 *  n'existe pas dans la police Helvetica de jsPDF et sortait en « / »
 *  (constat Channing 14/09 : « 10/700 ») — espace normale à la place. */
const pdfNum = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ');

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
    { key: 'eng', label: 'Motorisation', w: 48, wrap: true, get: (v) => engineOf(v), has: (v) => Boolean((v.engine ?? '').trim() || (v.version ?? '').trim()) },
    { key: 'fuel', label: 'Energie', w: 24, wrap: true, get: (v) => fuelLabel(v.fuel), has: (v) => Boolean(v.fuel) },
    { key: 'reg', label: '1re immat.', w: 22, get: (v) => fmtDate(v.reg_date).replace('—', NA), has: (v) => Boolean(v.reg_date) },
    { key: 'km', label: 'Km', w: 22, align: 'right', get: (v) => (v.km == null ? NA : pdfNum(v.km)), has: (v) => v.km != null },
    { key: 'pow', label: 'Ch', w: 14, align: 'right', get: (v) => (v.power_ch == null ? NA : String(v.power_ch)), has: (v) => v.power_ch != null },
    { key: 'gb', label: 'Boite', w: 20, get: (v) => (v.gearbox ? (v.gearbox === 'AUTOMATIQUE' ? 'Auto' : v.gearbox === 'MANUELLE' ? 'Manuelle' : v.gearbox) : NA), has: (v) => Boolean(v.gearbox) },
    { key: 'co2', label: 'CO2', w: 14, align: 'right', get: (v) => (v.co2 == null ? NA : String(v.co2)), has: (v) => v.co2 != null },
    ...(doc.showDamages ? [{ key: 'dmg', label: 'Dommages (EUR)', w: 26, align: 'right' as const, get: (v: OfferVehicle) => (v.damages == null ? NA : pdfNum(v.damages)), has: (v: OfferVehicle) => v.damages != null }] : []),
    { key: 'price', label: 'Prix HT (EUR)', w: 30, align: 'right', get: (v) => (v.sale_price == null ? NA : pdfNum(v.sale_price)), has: () => true },
    { key: 'rep', label: 'Inspection', w: 28, get: (v) => (v.report_url ? 'Voir le rapport' : NA), has: (v) => Boolean(v.report_url) },
  ];
  // COLONNES SELON LES DONNÉES PRÉSENTES (décision Channing 22/09, liste
  // Sorento : « trop de vide ») : une colonne vide pour TOUS les véhicules
  // n'est pas imprimée — la place revient aux colonnes renseignées.
  const cols = allCols.filter((c) => doc.vehicles.some((v) => c.has(v)));
  const tableW = cols.reduce((a, c) => a + c.w, 0);
  const scale = (W - 2 * margin) / tableW;
  cols.forEach((c) => { c.w = c.w * scale; });

  const drawHeader = () => {
    if (logo) { try { pdf.addImage(logo, 'PNG', margin, 8, 14, 11); } catch { /* logo illisible */ } }
    pdf.setTextColor(...ENCRE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10);
    pdf.text('MC EXPORT', margin + (logo ? 17 : 0), 15);
    pdf.setFontSize(16); pdf.text(doc.title, W / 2, 15, { align: 'center' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GRIS);
    pdf.text(doc.subtitle, W / 2, 21, { align: 'center' });
    pdf.text(doc.date.toUpperCase(), W - margin, 15, { align: 'right' });
    pdf.text('PRIX HORS TAXES', W - margin, 21, { align: 'right' });
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
    for (const c of cols) { pdf.text(c.label, c.align === 'right' ? x + c.w - 2 : x + 2, y + 5.5, { align: c.align === 'right' ? 'right' : 'left' }); x += c.w; }
    y += headH;
  };
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(FONT);
  const cellLines = (c: Col, v: OfferVehicle): string[] => {
    const lines = pdf.splitTextToSize(c.get(v), c.w - 4) as string[];
    return c.wrap ? lines.slice(0, 2) : lines.slice(0, 1);
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
          pdf.text(txt, c.align === 'right' ? x + c.w - 2 : x + 2, ty, { align: c.align === 'right' ? 'right' : 'left' });
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

