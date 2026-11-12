/**
 * FYC — FICHE VÉHICULE PDF À LA CHARTE MC EXPORT (10/11, Channing : « reproduire comme l'inspection mais avec nos
 * visuels, le plus propre et pro, uniformisé, dans la langue du pays cible »).
 *
 * Document DESTINÉ AU CLIENT : la voiture du rapport (données, équipements, pneus, état constaté) et nos coordonnées.
 * Aucun prix (12/11), jamais le prix d'achat, jamais les notes internes. Libellés dans la langue
 * du pays cible (fr, en, nl, de, da, sv, es, it) ; les VALEURS du rapport (énergie, équipements, constats…) aussi quand
 * leur traduction est fournie (worker, 11/11) ; les photos du rapport en tête et en fin de fiche (11/11).
 * A4 portrait, même en-tête que les offres (logo, MC EXPORT, titre, date). Police Helvetica : ASCII (« EUR »).
 */
import jsPDF from 'jspdf';
import type { FycInspection } from '../services/fyc';
import type { FycTranslation } from './fycTranslation';

const ENCRE: [number, number, number] = [0x22, 0x34, 0x6e];
const OCEAN: [number, number, number] = [0x2c, 0x5f, 0x9e];
const GRIS: [number, number, number] = [0x64, 0x74, 0x8b];
const safe = (t: string) => t.replace(/€/g, 'EUR').replace(/[–—]/g, '-').replace(/[\u202f\u00a0]/g, ' ').replace(/[«»]/g, '"').replace(/[’]/g, "'");
const num = (n: number | null | undefined) => (n == null ? '-' : Math.round(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' '));

export type FycLang = 'fr' | 'en' | 'nl' | 'de' | 'da' | 'sv' | 'es' | 'it';
/** Langue du document d'après le pays cible du marché. */
export function langOfCountry(country: string | null | undefined): FycLang {
  const c = (country ?? '').toUpperCase();
  if (['FR', 'BE', 'LU', 'MC'].includes(c)) return 'fr';
  if (c === 'NL') return 'nl';
  if (['DE', 'AT', 'CH'].includes(c)) return 'de';
  if (c === 'DK') return 'da';
  if (c === 'SE') return 'sv';
  if (c === 'ES') return 'es';
  if (c === 'IT') return 'it';
  return 'en';
}

type Dict = Record<string, string>;
const T: Record<FycLang, Dict> = {
  fr: { photos: "Photos", title: 'Fiche vehicule', subtitle: 'Vehicule inspecte - disponible a la vente', data: 'Donnees du vehicule', make: 'Marque', model: 'Modele', version: 'Type constructeur', body: 'Carrosserie', vin: 'N° de chassis', reg: '1re immatriculation', km: 'Kilometrage', fuel: 'Energie', gearbox: 'Boite de vitesses', power: 'Puissance', color: 'Couleur', doors: 'Portes', seats: 'Places', equipment: 'Equipements', tyres: 'Pneus montes', condition: 'Etat constate (inspection independante)', deval: 'Points a prevoir', usage: "Traces d'usage, acceptables", none: 'Rien a signaler', repainted: 'Peinture refaite', yes: 'oui', no: 'non', report: 'Rapport d\'inspection', of: 'du', price: 'Notre prix', priceNote: 'Prix net vendeur, vehicule tel que decrit, depart France. Validite 7 jours.', contact: 'Votre contact MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Page', date: 'Date', more: 'et {n} autres', service: "Historique d'entretien", ch: 'ch' },
  en: { photos: "Photos", title: 'Vehicle sheet', subtitle: 'Inspected vehicle - available for sale', data: 'Vehicle data', make: 'Make', model: 'Model', version: 'Manufacturer type code', body: 'Body', vin: 'VIN', reg: 'First registration', km: 'Mileage', fuel: 'Fuel', gearbox: 'Gearbox', power: 'Power', color: 'Colour', doors: 'Doors', seats: 'Seats', equipment: 'Equipment', tyres: 'Mounted tyres', condition: 'Condition (independent inspection)', deval: 'Points to plan for', usage: 'Usage marks, acceptable', none: 'Nothing to report', repainted: 'Repainted', yes: 'yes', no: 'no', report: 'Inspection report', of: 'of', price: 'Our price', priceNote: 'Net price, vehicle as described, ex France. Valid 7 days.', contact: 'Your MC Export contact', footer: 'MC Export - Export from France - mc-export.com', page: 'Page', date: 'Date', more: 'and {n} more', service: 'Service history', ch: 'hp' },
  nl: { photos: "Foto's", title: 'Voertuigfiche', subtitle: 'Geinspecteerd voertuig - te koop', data: 'Voertuiggegevens', make: 'Merk', model: 'Model', version: 'Typecode fabrikant', body: 'Carrosserie', vin: 'Chassisnummer', reg: 'Eerste toelating', km: 'Kilometerstand', fuel: 'Brandstof', gearbox: 'Transmissie', power: 'Vermogen', color: 'Kleur', doors: 'Deuren', seats: 'Zitplaatsen', equipment: 'Uitrusting', tyres: 'Gemonteerde banden', condition: 'Staat (onafhankelijke inspectie)', deval: 'Te voorzien', usage: 'Gebruikssporen, acceptabel', none: 'Niets te melden', repainted: 'Overgespoten', yes: 'ja', no: 'nee', report: 'Inspectierapport', of: 'van', price: 'Onze prijs', priceNote: 'Nettoprijs, voertuig zoals beschreven, af Frankrijk. 7 dagen geldig.', contact: 'Uw contact bij MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Pagina', date: 'Datum', more: 'en {n} andere', service: 'Onderhoudshistorie', ch: 'pk' },
  de: { photos: "Fotos", title: 'Fahrzeugblatt', subtitle: 'Begutachtetes Fahrzeug - zum Verkauf', data: 'Fahrzeugdaten', make: 'Marke', model: 'Modell', version: 'HSN / TSN', body: 'Karosserie', vin: 'Fahrgestellnummer', reg: 'Erstzulassung', km: 'Kilometerstand', fuel: 'Kraftstoff', gearbox: 'Getriebe', power: 'Leistung', color: 'Farbe', doors: 'Tueren', seats: 'Sitze', equipment: 'Ausstattung', tyres: 'Montierte Reifen', condition: 'Zustand (unabhaengiges Gutachten)', deval: 'Einzuplanen', usage: 'Gebrauchsspuren, akzeptabel', none: 'Nichts zu melden', repainted: 'Nachlackiert', yes: 'ja', no: 'nein', report: 'Gutachten', of: 'vom', price: 'Unser Preis', priceNote: 'Nettopreis, Fahrzeug wie beschrieben, ab Frankreich. 7 Tage gueltig.', contact: 'Ihr Ansprechpartner bei MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Seite', date: 'Datum', more: 'und {n} weitere', service: 'Wartungshistorie', ch: 'PS' },
  da: { photos: "Fotos", title: 'Koeretoejsblad', subtitle: 'Inspiceret koeretoej - til salg', data: 'Koeretoejsdata', make: 'Maerke', model: 'Model', version: 'Typekode', body: 'Karrosseri', vin: 'Stelnummer', reg: '1. registrering', km: 'Kilometerstand', fuel: 'Braendstof', gearbox: 'Gearkasse', power: 'Effekt', color: 'Farve', doors: 'Doere', seats: 'Saeder', equipment: 'Udstyr', tyres: 'Monterede daek', condition: 'Stand (uafhaengig inspektion)', deval: 'Skal paaregnes', usage: 'Brugsspor, acceptable', none: 'Intet at bemaerke', repainted: 'Omlakeret', yes: 'ja', no: 'nej', report: 'Inspektionsrapport', of: 'af', price: 'Vores pris', priceNote: 'Nettopris, koeretoej som beskrevet, ab Frankrig. Gaelder 7 dage.', contact: 'Din kontakt hos MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Side', date: 'Dato', more: 'og {n} andre', service: 'Servicehistorik', ch: 'hk' },
  sv: { photos: "Foton", title: 'Fordonsblad', subtitle: 'Besiktigat fordon - till salu', data: 'Fordonsdata', make: 'Maerke', model: 'Modell', version: 'Typkod', body: 'Kaross', vin: 'Chassinummer', reg: 'Foersta registrering', km: 'Miltal', fuel: 'Braensle', gearbox: 'Vaexellaada', power: 'Effekt', color: 'Faerg', doors: 'Doerrar', seats: 'Saeten', equipment: 'Utrustning', tyres: 'Monterade daeck', condition: 'Skick (oberoende besiktning)', deval: 'Att raekna med', usage: 'Bruksspaar, acceptabla', none: 'Inget att anmaerka', repainted: 'Omlackerad', yes: 'ja', no: 'nej', report: 'Besiktningsrapport', of: 'fraan', price: 'Vaart pris', priceNote: 'Nettopris, fordon enligt beskrivning, fritt Frankrike. Gaeller 7 dagar.', contact: 'Din kontakt paa MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Sida', date: 'Datum', more: 'och {n} till', service: 'Servicehistorik', ch: 'hk' },
  es: { photos: "Fotos", title: 'Ficha del vehiculo', subtitle: 'Vehiculo inspeccionado - en venta', data: 'Datos del vehiculo', make: 'Marca', model: 'Modelo', version: 'Codigo de tipo', body: 'Carroceria', vin: 'Bastidor', reg: '1a matriculacion', km: 'Kilometraje', fuel: 'Combustible', gearbox: 'Cambio', power: 'Potencia', color: 'Color', doors: 'Puertas', seats: 'Plazas', equipment: 'Equipamiento', tyres: 'Neumaticos montados', condition: 'Estado (inspeccion independiente)', deval: 'A prever', usage: 'Marcas de uso, aceptables', none: 'Nada que senalar', repainted: 'Repintado', yes: 'si', no: 'no', report: 'Informe de inspeccion', of: 'del', price: 'Nuestro precio', priceNote: 'Precio neto, vehiculo segun descripcion, salida Francia. Validez 7 dias.', contact: 'Su contacto en MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Pagina', date: 'Fecha', more: 'y {n} mas', service: 'Historial de mantenimiento', ch: 'CV' },
  it: { photos: "Foto", title: 'Scheda veicolo', subtitle: 'Veicolo ispezionato - in vendita', data: 'Dati del veicolo', make: 'Marca', model: 'Modello', version: 'Codice tipo', body: 'Carrozzeria', vin: 'Telaio', reg: '1a immatricolazione', km: 'Chilometraggio', fuel: 'Alimentazione', gearbox: 'Cambio', power: 'Potenza', color: 'Colore', doors: 'Porte', seats: 'Posti', equipment: 'Dotazioni', tyres: 'Pneumatici montati', condition: 'Stato (ispezione indipendente)', deval: 'Da prevedere', usage: "Segni d'uso, accettabili", none: 'Nulla da segnalare', repainted: 'Riverniciato', yes: 'si', no: 'no', report: 'Rapporto di ispezione', of: 'del', price: 'Il nostro prezzo', priceNote: 'Prezzo netto, veicolo come descritto, franco Francia. Validita 7 giorni.', contact: 'Il vostro contatto MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Pagina', date: 'Data', more: 'e altri {n}', service: 'Storico tagliandi', ch: 'CV' },
};
const LOCALE: Record<FycLang, string> = { fr: 'fr-FR', en: 'en-GB', nl: 'nl-NL', de: 'de-DE', da: 'da-DK', sv: 'sv-SE', es: 'es-ES', it: 'it-IT' };

async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch('/logo-mark.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
  } catch { return null; }
}

export interface FycPdfContact { name: string; email: string | null; phone?: string | null }
/** Compléments de la fiche : photos (data URL JPEG/PNG, dans l'ordre), photos des dommages légendées, valeurs traduites. */
export interface FycPdfExtras { photos?: string[]; defects?: Array<{ data: string; caption: string; list: 'devaluation' | 'usage' | null; idx: number | null }>; translation?: FycTranslation | null }
const imageFormat = (dataUrl: string) => (/^data:image\/png/i.test(dataUrl) ? 'PNG' : /^data:image\/webp/i.test(dataUrl) ? 'WEBP' : 'JPEG');

export async function buildFycPdf(insp: FycInspection, lang: FycLang, contact: FycPdfContact, extras: FycPdfExtras = {}): Promise<Blob> {
  const t = T[lang];
  // Valeurs traduites quand elles existent, sinon celles du rapport.
  const tr = extras.translation ?? null;
  const v = { fuel: tr?.fuel ?? insp.fuel, gearbox: tr?.gearbox ?? insp.gearbox, body: tr?.body ?? insp.body, color: tr?.color ?? insp.color,
    equipment: tr?.equipment ?? insp.equipment, tyres: tr?.tyres ?? insp.tyres,
    devaluation: tr?.devaluation ?? insp.damages.devaluation.map((d) => d.raw), usage: tr?.usage ?? insp.damages.usage.map((d) => d.raw) };
  const photos = (extras.photos ?? []).filter(Boolean);
  const loc = LOCALE[lang];
  const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(loc) : '-');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const logo = await loadLogo();
  const car = [insp.brand, insp.model].filter(Boolean).join(' ') || '-';
  const today = new Date().toLocaleDateString(loc, { day: '2-digit', month: 'long', year: 'numeric' });
  let page = 1;
  let y = 0;

  const header = () => {
    if (logo) { try { pdf.addImage(logo, 'PNG', margin, 8, 14, 11); } catch { /* logo illisible */ } }
    pdf.setTextColor(...ENCRE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10);
    pdf.text('MC EXPORT', margin + (logo ? 17 : 0), 15);
    // Titre = la voiture seule (12/11, Channing : « Vehicle sheet, je veux le supprimer, ça se chevauche ») ; la police
    // se réduit pour tenir entre « MC EXPORT » et la date (TESLA MODEL 3 LONG RANGE).
    const room = W - 2 * margin - 2 * 52;
    let size = 15; pdf.setFontSize(size);
    while (size > 9 && pdf.getTextWidth(safe(car)) > room) { size -= 0.5; pdf.setFontSize(size); }
    pdf.text(safe(car), W / 2, 15, { align: 'center' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GRIS);
    pdf.text(safe(t.subtitle), W / 2, 21, { align: 'center' });
    pdf.text(safe(today).toUpperCase(), W - margin, 15, { align: 'right' });
    pdf.setDrawColor(...ENCRE); pdf.setLineWidth(0.4); pdf.line(margin, 26, W - margin, 26);
    y = 33;
  };
  const footer = () => {
    pdf.setFontSize(7.5); pdf.setTextColor(...GRIS); pdf.setFont('helvetica', 'normal');
    pdf.text(safe(`${t.footer} - ${t.report} ${insp.report_number ? `n° ${insp.report_number} ${t.of} ` : ''}${date(insp.report_date)} - VIN ${insp.vin ?? '-'}`), margin, H - 7);
    pdf.text(`${t.page} ${page}`, W - margin, H - 7, { align: 'right' });
  };
  const ensure = (h: number) => { if (y + h > H - 14) { footer(); pdf.addPage(); page++; header(); } };
  const section = (title: string) => {
    ensure(14);
    pdf.setFillColor(...ENCRE); pdf.rect(margin, y, W - 2 * margin, 7, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5);
    pdf.text(safe(title).toUpperCase(), margin + 3, y + 4.9);
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
        // Valeur longue (« MODEL 3 LONG RANGE DUAL MOTOR », couleur à rallonge) : police réduite plutôt que tronquée.
        const val = safe(r[1] || '-'); let vs = 8.5;
        while (vs > 6 && pdf.getTextWidth(val) > colW - 42) { vs -= 0.5; pdf.setFontSize(vs); }
        pdf.text(val, x + 40, y + 4); pdf.setFontSize(8.5);
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
  const twoColumns = (items: string[]) => {
    const colW = (W - 2 * margin) / 2 - 3;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.8); pdf.setTextColor(30, 41, 59);
    const half = Math.ceil(items.length / 2);
    const cols = [items.slice(0, half), items.slice(half)];
    const wrapped = cols.map((c) => c.map((it) => pdf.splitTextToSize(safe(`- ${it}`), colW - 2) as string[]));
    const n = Math.max(wrapped[0].length, wrapped[1].length);
    for (let i = 0; i < n; i++) {
      const h = Math.max(wrapped[0][i]?.length ?? 0, wrapped[1][i]?.length ?? 0) * 3.6 + 0.8;
      ensure(h);
      for (let c = 0; c < 2; c++) { const l = wrapped[c][i]; if (l) pdf.text(l, margin + 2 + c * (colW + 6), y + 3); }
      y += h;
    }
    y += 2;
  };
  const subtitle = (s: string) => { ensure(7); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.8); pdf.setTextColor(...OCEAN); pdf.text(safe(s), margin, y + 3.5); y += 5.5; };
  /** Photo à ses proportions, centrée dans sa case (12/11, Channing : « les photos sont un peu écrasées ») :
   *  une vue large 1200×615 n'est plus étirée au 4:3. */
  const fitImage = (data: string, x: number, y0: number, w: number, h: number) => {
    let iw = w; let ih = h;
    try { const pr = pdf.getImageProperties(data); if (pr.width > 0 && pr.height > 0) { const k = Math.min(w / pr.width, h / pr.height); iw = pr.width * k; ih = pr.height * k; } } catch { /* proportions inconnues : case entière */ }
    pdf.addImage(data, imageFormat(data), x + (w - iw) / 2, y0 + (h - ih) / 2, iw, ih, undefined, 'FAST');
    pdf.setDrawColor(203, 213, 225); pdf.setLineWidth(0.2); pdf.rect(x, y0, w, h);
  };
  /** Hauteur d'une rangée de photos : la plus haute des photos à largeur w, plafonnée au 4:3 (une vue large n'a plus de bande blanche). */
  const rowHeight = (datas: string[], w: number) => {
    let h = 0;
    for (const d of datas) { try { const pr = pdf.getImageProperties(d); h = Math.max(h, pr.width > 0 ? Math.min(w * 0.75, w * pr.height / pr.width) : w * 0.75); } catch { h = Math.max(h, w * 0.75); } }
    return h || w * 0.75;
  };
  /** Photos en grille (2 par ligne), chacune à ses proportions dans un cadre fin, rangée à la hauteur de ses photos. */
  const photoGrid = (list: string[], perRow = 2) => {
    const gap = 4; const w = (W - 2 * margin - gap * (perRow - 1)) / perRow;
    for (let i = 0; i < list.length; i += perRow) {
      const h = rowHeight(list.slice(i, i + perRow), w);
      ensure(h + gap);
      for (let c = 0; c < perRow; c++) {
        const p = list[i + c]; if (!p) continue;
        const x = margin + c * (w + gap);
        try { fitImage(p, x, y, w, h); } catch { /* photo illisible : case vide */ }
      }
      y += h + gap;
    }
  };
  /** Photos de dommages : 3 par ligne, légende dessous (le dommage, traduit quand on l'a). */
  const defectGrid = (list: Array<{ data: string; caption: string }>, perRow = 3) => {
    const gap = 3; const w = (W - 2 * margin - gap * (perRow - 1)) / perRow;
    for (let i = 0; i < list.length; i += perRow) {
      const h = rowHeight(list.slice(i, i + perRow).map((p) => p.data), w);
      ensure(h + 9);
      for (let c = 0; c < perRow; c++) {
        const p = list[i + c]; if (!p) continue;
        const x = margin + c * (w + gap);
        try { fitImage(p.data, x, y, w, h); } catch { /* photo illisible */ }
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...GRIS);
        pdf.text(pdf.splitTextToSize(safe(p.caption), w)[0] ?? '', x, y + h + 3.2);
      }
      y += h + 8;
    }
    y += 1;
  };

  header();
  // Gros titre, police réduite si la voiture a un long nom.
  pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...ENCRE);
  { let ts = 16; pdf.setFontSize(ts); const roomTitle = W - 2 * margin; while (ts > 10 && pdf.getTextWidth(safe(car)) > roomTitle) { ts -= 0.5; pdf.setFontSize(ts); } }
  pdf.text(safe(car), margin, y + 5);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...GRIS);
  pdf.text(safe([insp.year ? String(insp.year) : null, insp.km != null ? `${num(insp.km)} km` : null, v.fuel, v.gearbox, insp.power_ch ? `${insp.power_ch} ${t.ch}` : null].filter(Boolean).join(' - ')), margin, y + 11);
  y += 18;

  // Les deux premières photos en tête (la voiture d'abord), les autres en fin de fiche.
  if (photos.length) photoGrid(photos.slice(0, 2));

  section(t.data);
  kv([
    [t.make, insp.brand ?? '-'], [t.model, insp.model ?? '-'],
    [t.reg, date(insp.first_registration)], [t.km, insp.km != null ? `${num(insp.km)} km` : '-'],
    [t.fuel, v.fuel ?? '-'], [t.gearbox, v.gearbox ?? '-'],
    [t.power, insp.power_ch ? `${insp.power_ch} ${t.ch}` : '-'], [t.body, v.body ?? '-'],
    [t.color, v.color ?? '-'], [`${t.doors} / ${t.seats}`, `${insp.doors ?? '-'} / ${insp.seats ?? '-'}`],
    [t.vin, insp.vin ?? '-'], [t.version, insp.version ?? '-'],
    // Single units (12/11) : CO2 et historique d'entretien saisis avec l'unité.
    ...(insp.raw_fields.co2 ? [['CO2', insp.raw_fields.co2] as [string, string]] : []),
    ...(insp.raw_fields.service_history ? [[t.service, insp.raw_fields.service_history] as [string, string]] : []),
  ]);

  if (v.equipment.length) { section(t.equipment); twoColumns(v.equipment); }
  if (v.tyres.length) { section(t.tyres); bullets(v.tyres); }

  section(t.condition);
  const dev = v.devaluation; const use = v.usage;
  kv([[t.repainted, insp.repainted == null ? '-' : insp.repainted ? t.yes : t.no], [t.report, `${insp.report_number ? `n° ${insp.report_number} ${t.of} ` : ''}${date(insp.report_date)}`]]);
  if (dev.length) { subtitle(t.deval); bullets(dev); }
  if (use.length) { subtitle(t.usage); bullets(use, GRIS); }
  if (!dev.length && !use.length) bullets([t.none]);
  // Photos des dommages (DEKRA), légendées par le dommage qu'elles illustrent, dans la langue de la fiche.
  const defects = (extras.defects ?? []).filter((d) => d.data).map((d) => ({ data: d.data, caption: (d.list && d.idx != null ? v[d.list][d.idx] : null) ?? d.caption }));
  if (defects.length) defectGrid(defects);

  // PLUS DE PRIX SUR LA FICHE (12/11, Channing : « on enlève la ligne prix, comme on a dit ») : ni cartouche en tête,
  // ni bloc « Notre prix » — le prix se discute dans l'offre, pas sur l'inspection.

  section(t.contact);
  kv([['MC Export', contact.name], ['E-mail', contact.email ?? '-'], ['Web', 'mc-export.com'], [t.date, today]]);

  if (photos.length > 2) { section(t.photos); photoGrid(photos.slice(2), photos.length > 12 ? 3 : 2); }

  footer();
  return pdf.output('blob');
}
