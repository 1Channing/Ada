/**
 * FYC — EXPORT PDF À LA CHARTE MC EXPORT (10/11, Channing : « un export PDF façon MC Export comme une inspection
 * mais avec notre logo et toutes les informations, le plus propre et pro, uniformisé »).
 *
 * A4 portrait, même en-tête que les offres (logo, MC EXPORT, titre, date) : la voiture du rapport, son état,
 * nos prix, le marché cible (filtres et chiffres MI) et le client cible (stock comparable). Police Helvetica de
 * jsPDF : libellés en ASCII (« EUR », pas « € »).
 */
import jsPDF from 'jspdf';
import type { FycInspection } from '../services/fyc';

const ENCRE: [number, number, number] = [0x22, 0x34, 0x6e];
const OCEAN: [number, number, number] = [0x2c, 0x5f, 0x9e];
const GRIS: [number, number, number] = [0x64, 0x74, 0x8b];
const safe = (t: string) => t.replace(/€/g, 'EUR').replace(/[–—]/g, '-').replace(/[  ]/g, ' ').replace(/[«»]/g, '"');
const num = (n: number | null | undefined) => (n == null ? '-' : Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' '));
const eur = (n: number | null | undefined) => (n == null ? '-' : `${num(n)} EUR`);
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '-');

export interface FycMarketSummary {
  country: string; sites: string; count: number; median: number; p25: number; p75: number; min: number; max: number;
  comparables: number; comparablesMedian: number | null; position: string; filtersLabel: string; lastScan: string | null;
}
export interface FycClientSummary {
  name: string; country: string | null; stockTotal: number | null; stockDate: string | null;
  rows: Array<{ title: string; year: number | null; km: number | null; price: number | null }>;
  min: number | null; median: number | null;
}

async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch('/logo-mark.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
  } catch { return null; }
}

export async function buildFycPdf(insp: FycInspection, market: FycMarketSummary | null, client: FycClientSummary | null, author: string): Promise<Blob> {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const logo = await loadLogo();
  const car = [insp.brand, insp.model].filter(Boolean).join(' ') || 'Vehicule';
  const title = `Fiche FYC - ${car}`;
  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  let page = 1;
  let y = 0;

  const header = () => {
    if (logo) { try { pdf.addImage(logo, 'PNG', margin, 8, 14, 11); } catch { /* logo illisible */ } }
    pdf.setTextColor(...ENCRE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10);
    pdf.text('MC EXPORT', margin + (logo ? 17 : 0), 15);
    pdf.setFontSize(15); pdf.text(safe(title), W / 2, 15, { align: 'center' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GRIS);
    pdf.text('Find Your Customer - inspection, marche et client cible', W / 2, 21, { align: 'center' });
    pdf.text(today.toUpperCase(), W - margin, 15, { align: 'right' });
    pdf.setDrawColor(...ENCRE); pdf.setLineWidth(0.4); pdf.line(margin, 26, W - margin, 26);
    y = 33;
  };
  const footer = () => {
    pdf.setFontSize(7.5); pdf.setTextColor(...GRIS); pdf.setFont('helvetica', 'normal');
    pdf.text(safe(`MC Export - fiche generee par Ada le ${today}${author ? ` pour ${author}` : ''} - rapport n° ${insp.report_number ?? '-'}`), margin, H - 7);
    pdf.text(String(page), W - margin, H - 7, { align: 'right' });
  };
  const ensure = (h: number) => { if (y + h > H - 14) { footer(); pdf.addPage(); page++; header(); } };
  const section = (t: string) => {
    ensure(14);
    pdf.setFillColor(...ENCRE); pdf.rect(margin, y, W - 2 * margin, 7, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5);
    pdf.text(safe(t).toUpperCase(), margin + 3, y + 4.9);
    y += 10;
  };
  const kv = (rows: Array<[string, string]>, cols = 2) => {
    const colW = (W - 2 * margin) / cols;
    for (let i = 0; i < rows.length; i += cols) {
      ensure(7);
      for (let c = 0; c < cols; c++) {
        const r = rows[i + c]; if (!r) continue;
        const x = margin + c * colW;
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...GRIS);
        pdf.text(safe(r[0]), x, y + 4);
        pdf.setFont('helvetica', 'bold'); pdf.setTextColor(30, 41, 59);
        const v = pdf.splitTextToSize(safe(r[1] || '-'), colW - 42);
        pdf.text(v[0] ?? '-', x + 40, y + 4);
      }
      y += 6.5;
    }
    y += 2;
  };
  const bullets = (items: string[], color: [number, number, number] = [30, 41, 59]) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...color);
    for (const it of items) {
      const lines = pdf.splitTextToSize(safe(`- ${it}`), W - 2 * margin - 6);
      ensure(lines.length * 4.2 + 1);
      pdf.text(lines, margin + 3, y + 3.5);
      y += lines.length * 4.2 + 1;
    }
    y += 2;
  };
  const table = (head: string[], rows: string[][], widths: number[], aligns: Array<'left' | 'right'>) => {
    const scale = (W - 2 * margin) / widths.reduce((a, b) => a + b, 0);
    const ws = widths.map((w) => w * scale);
    const drawHead = () => {
      ensure(8);
      pdf.setFillColor(...OCEAN); pdf.rect(margin, y, W - 2 * margin, 6, 'F');
      pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
      let x = margin;
      head.forEach((h, i) => { pdf.text(safe(h), aligns[i] === 'right' ? x + ws[i] - 2 : x + 2, y + 4.2, { align: aligns[i] === 'right' ? 'right' : 'left' }); x += ws[i]; });
      y += 6;
    };
    drawHead();
    rows.forEach((r, ri) => {
      if (y + 6 > H - 14) { footer(); pdf.addPage(); page++; header(); drawHead(); }
      if (ri % 2 === 1) { pdf.setFillColor(243, 246, 251); pdf.rect(margin, y, W - 2 * margin, 6, 'F'); }
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(30, 41, 59);
      let x = margin;
      r.forEach((c, i) => { const t = pdf.splitTextToSize(safe(c), ws[i] - 4)[0] ?? ''; pdf.text(t, aligns[i] === 'right' ? x + ws[i] - 2 : x + 2, y + 4.2, { align: aligns[i] === 'right' ? 'right' : 'left' }); x += ws[i]; });
      y += 6;
    });
    y += 3;
  };

  header();
  // Bandeau voiture
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.setTextColor(...ENCRE);
  pdf.text(safe(car), margin, y + 4);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GRIS);
  pdf.text(safe([insp.year ? `${insp.year}` : null, insp.km != null ? `${num(insp.km)} km` : null, insp.fuel, insp.gearbox, insp.power_ch ? `${insp.power_ch} ch` : null].filter(Boolean).join(' - ')), margin, y + 10);
  y += 16;

  section('Vehicule inspecte');
  kv([
    ['Marque / modele', car], ['VIN', insp.vin ?? '-'],
    ['1re immatriculation', date(insp.first_registration)], ['Kilometrage', insp.km != null ? `${num(insp.km)} km` : '-'],
    ['Energie', insp.fuel ?? '-'], ['Boite', insp.gearbox ?? '-'],
    ['Puissance', insp.power_ch ? `${insp.power_ch} ch` : '-'], ['Carrosserie', insp.body ?? '-'],
    ['Couleur', insp.color ?? '-'], ['Portes / places', `${insp.doors ?? '-'} / ${insp.seats ?? '-'}`],
    ['Rapport', `n° ${insp.report_number ?? '-'} du ${date(insp.report_date)}`], ['Lien', insp.source_url.length > 60 ? `${insp.source_url.slice(0, 57)}...` : insp.source_url],
  ]);

  section('Etat du vehicule (rapport)');
  const dev = insp.damages.devaluation; const use = insp.damages.usage;
  kv([['Repeinte', insp.repainted == null ? 'non precise' : insp.repainted ? 'oui' : 'non'], ['Dommages', `${dev.length} de devaluation, ${use.length} d'usage`]]);
  if (dev.length) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...ENCRE); ensure(6); pdf.text('Devaluation (a prevoir)', margin, y + 3.5); y += 5; bullets(dev.map((d) => d.raw)); }
  if (use.length) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...ENCRE); ensure(6); pdf.text("Traces d'usage (acceptables)", margin, y + 3.5); y += 5; bullets(use.map((d) => d.raw), GRIS); }
  if (!dev.length && !use.length) bullets(['Rien a signaler dans le rapport.']);

  section('Nos prix');
  kv([['Prix d\'achat', eur(insp.purchase_price)], ['Prix d\'attaque', eur(insp.attack_price)]]);
  if (insp.notes.trim()) bullets(insp.notes.trim().split(/\n+/));

  section('Marche cible');
  if (market) {
    kv([
      ['Pays / sites', `${market.country} - ${market.sites}`], ['Recherche MI', market.filtersLabel],
      ['Annonces', `${market.count}${market.lastScan ? ` (scan du ${market.lastScan})` : ''}`], ['Mediane', eur(market.median)],
      ['Fourchette', `${eur(market.p25)} - ${eur(market.p75)} (P25-P75)`], ['Min / max', `${eur(market.min)} / ${eur(market.max)}`],
      ['Comparables (annee +-1, km +-30 %)', `${market.comparables}${market.comparablesMedian != null ? ` - mediane ${eur(market.comparablesMedian)}` : ''}`], ['Notre prix d\'attaque', `${eur(insp.attack_price)} - ${market.position}`],
    ]);
  } else bullets(['Pas de donnees de marche : lance la recherche dans le Market Intelligence.']);

  section('Client cible');
  if (client) {
    kv([
      ['Contact', `${client.name}${client.country ? ` (${client.country})` : ''}`], ['Stock releve', client.stockTotal != null ? `${num(client.stockTotal)} vehicules${client.stockDate ? ` le ${client.stockDate}` : ''}` : '-'],
      ['Comparables en stock', String(client.rows.length)], ['Leur prix min / mediane', `${eur(client.min)} / ${eur(client.median)}`],
    ]);
    if (client.rows.length) table(['Voiture chez le client', 'Annee', 'Km', 'Prix affiche'], client.rows.slice(0, 15).map((r) => [r.title, r.year ? String(r.year) : '-', num(r.km), eur(r.price)]), [90, 20, 30, 40], ['left', 'right', 'right', 'right']);
    else bullets(['Aucune voiture comparable dans son stock releve.']);
  } else bullets(['Aucun client cible choisi.']);

  footer();
  return pdf.output('blob');
}
