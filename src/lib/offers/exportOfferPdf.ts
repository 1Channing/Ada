/**
 * OFFRES FOURNISSEUR — PDF paysage à la charte MC Export (jsPDF, navigateur
 * seulement : le module Excel vit à part pour rester testable hors navigateur).
 */
import jsPDF from 'jspdf';
import type { OfferVehicle } from './parseSupplierFile';
import { fmtDate, bodyOf, labelOf, type OfferDocument } from './exportOfferXlsx';

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

  const cols: Array<{ key: string; label: string; w: number; align?: 'right'; get: (v: OfferVehicle) => string }> = [
    { key: 'vin', label: 'Châssis (VIN)', w: 40, get: (v) => v.vin ?? '—' },
    { key: 'veh', label: 'Véhicule', w: 62, get: (v) => `${labelOf(v)}${bodyOf(v) ? ` · ${bodyOf(v)}` : ''}${v.color ? ` · ${v.color}` : ''}` },
    { key: 'reg', label: '1re immat.', w: 22, get: (v) => fmtDate(v.reg_date) },
    { key: 'km', label: 'Km', w: 22, align: 'right', get: (v) => (v.km == null ? '—' : pdfNum(v.km)) },
    { key: 'pow', label: 'Ch', w: 14, align: 'right', get: (v) => (v.power_ch == null ? '—' : String(v.power_ch)) },
    { key: 'gb', label: 'Boîte', w: 20, get: (v) => (v.gearbox ? (v.gearbox === 'AUTOMATIQUE' ? 'Auto' : v.gearbox === 'MANUELLE' ? 'Manuelle' : v.gearbox) : '—') },
    { key: 'co2', label: 'CO₂', w: 14, align: 'right', get: (v) => (v.co2 == null ? '—' : String(v.co2)) },
    ...(doc.showDamages ? [{ key: 'dmg', label: 'Dommages (€)', w: 24, align: 'right' as const, get: (v: OfferVehicle) => (v.damages == null ? '—' : pdfNum(v.damages)) }] : []),
    { key: 'price', label: 'Prix HT (€)', w: 30, align: 'right', get: (v) => (v.sale_price == null ? '—' : pdfNum(v.sale_price)) },
    { key: 'rep', label: 'Inspection', w: 30, get: (v) => (v.report_url ? 'Voir le rapport' : '—') },
  ];
  const tableW = cols.reduce((a, c) => a + c.w, 0);
  const scale = Math.min(1, (W - 2 * margin) / tableW);
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
  const rowH = 9;
  const headH = 8;
  let y = 30;
  const drawTableHead = () => {
    pdf.setFillColor(...ENCRE); pdf.rect(margin, y, W - 2 * margin, headH, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
    let x = margin;
    for (const c of cols) { pdf.text(c.label, c.align === 'right' ? x + c.w - 2 : x + 2, y + 5.5, { align: c.align === 'right' ? 'right' : 'left' }); x += c.w; }
    y += headH;
  };
  drawHeader(); drawTableHead();
  const pagesNeeded = () => Math.max(1, Math.ceil(doc.vehicles.length / Math.floor((H - 30 - headH - 14) / rowH)));
  const total = pagesNeeded();
  let page = 1;
  doc.vehicles.forEach((v, i) => {
    if (y + rowH > H - 14) {
      drawFooter(page, total); pdf.addPage(); page++; y = 30; drawHeader(); drawTableHead();
    }
    if (i % 2 === 1) { pdf.setFillColor(243, 246, 251); pdf.rect(margin, y, W - 2 * margin, rowH, 'F'); }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(30, 41, 59);
    let x = margin;
    for (const c of cols) {
      const txt = pdf.splitTextToSize(c.get(v), c.w - 4)[0] ?? '';
      if (c.key === 'price') { pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...ENCRE); }
      if (c.key === 'rep' && v.report_url) {
        pdf.setTextColor(...OCEAN);
        pdf.textWithLink(txt, x + 4, y + 6, { url: v.report_url });
      } else {
        pdf.text(txt, c.align === 'right' ? x + c.w - 2 : x + 2, y + 6, { align: c.align === 'right' ? 'right' : 'left' });
      }
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(30, 41, 59);
      x += c.w;
    }
    pdf.setDrawColor(226, 232, 240); pdf.setLineWidth(0.2); pdf.line(margin, y + rowH, W - margin, y + rowH);
    y += rowH;
  });
  drawFooter(page, total);
  return pdf.output('blob');
}

