/**
 * FYC — FICHE VÉHICULE PDF À LA CHARTE MC EXPORT (10/11, Channing : « reproduire comme l'inspection mais avec nos
 * visuels, le plus propre et pro, uniformisé, dans la langue du pays cible »).
 *
 * Document DESTINÉ AU CLIENT : la voiture du rapport (données, équipements, pneus, état constaté), notre prix
 * (prix d'attaque) et nos coordonnées. Jamais le prix d'achat, jamais les notes internes. Libellés dans la langue
 * du pays cible (fr, en, nl, de, da, sv, es, it) ; les constats du rapport restent dans la langue du rapport.
 * A4 portrait, même en-tête que les offres (logo, MC EXPORT, titre, date). Police Helvetica : ASCII (« EUR »).
 */
import jsPDF from 'jspdf';
import type { FycInspection } from '../services/fyc';

const ENCRE: [number, number, number] = [0x22, 0x34, 0x6e];
const OCEAN: [number, number, number] = [0x2c, 0x5f, 0x9e];
const GRIS: [number, number, number] = [0x64, 0x74, 0x8b];
const safe = (t: string) => t.replace(/€/g, 'EUR').replace(/[–—]/g, '-').replace(/[  ]/g, ' ').replace(/[«»]/g, '"').replace(/[’]/g, "'");
const num = (n: number | null | undefined) => (n == null ? '-' : Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' '));

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
  fr: { title: 'Fiche vehicule', subtitle: 'Vehicule inspecte - disponible a la vente', data: 'Donnees du vehicule', make: 'Marque', model: 'Modele', version: 'Type constructeur', body: 'Carrosserie', vin: 'N° de chassis', reg: '1re immatriculation', km: 'Kilometrage', fuel: 'Energie', gearbox: 'Boite de vitesses', power: 'Puissance', color: 'Couleur', doors: 'Portes', seats: 'Places', equipment: 'Equipements', tyres: 'Pneus montes', condition: 'Etat constate (inspection independante)', deval: 'Points a prevoir', usage: "Traces d'usage, acceptables", none: 'Rien a signaler', repainted: 'Peinture refaite', yes: 'oui', no: 'non', report: 'Rapport d\'inspection', of: 'du', price: 'Notre prix', priceNote: 'Prix net vendeur, vehicule tel que decrit, depart France. Validite 7 jours.', contact: 'Votre contact MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Page', date: 'Date', more: 'et {n} autres', ch: 'ch' },
  en: { title: 'Vehicle sheet', subtitle: 'Inspected vehicle - available for sale', data: 'Vehicle data', make: 'Make', model: 'Model', version: 'Manufacturer type code', body: 'Body', vin: 'VIN', reg: 'First registration', km: 'Mileage', fuel: 'Fuel', gearbox: 'Gearbox', power: 'Power', color: 'Colour', doors: 'Doors', seats: 'Seats', equipment: 'Equipment', tyres: 'Mounted tyres', condition: 'Condition (independent inspection)', deval: 'Points to plan for', usage: 'Usage marks, acceptable', none: 'Nothing to report', repainted: 'Repainted', yes: 'yes', no: 'no', report: 'Inspection report', of: 'of', price: 'Our price', priceNote: 'Net price, vehicle as described, ex France. Valid 7 days.', contact: 'Your MC Export contact', footer: 'MC Export - Export from France - mc-export.com', page: 'Page', date: 'Date', more: 'and {n} more', ch: 'hp' },
  nl: { title: 'Voertuigfiche', subtitle: 'Geinspecteerd voertuig - te koop', data: 'Voertuiggegevens', make: 'Merk', model: 'Model', version: 'Typecode fabrikant', body: 'Carrosserie', vin: 'Chassisnummer', reg: 'Eerste toelating', km: 'Kilometerstand', fuel: 'Brandstof', gearbox: 'Transmissie', power: 'Vermogen', color: 'Kleur', doors: 'Deuren', seats: 'Zitplaatsen', equipment: 'Uitrusting', tyres: 'Gemonteerde banden', condition: 'Staat (onafhankelijke inspectie)', deval: 'Te voorzien', usage: 'Gebruikssporen, acceptabel', none: 'Niets te melden', repainted: 'Overgespoten', yes: 'ja', no: 'nee', report: 'Inspectierapport', of: 'van', price: 'Onze prijs', priceNote: 'Nettoprijs, voertuig zoals beschreven, af Frankrijk. 7 dagen geldig.', contact: 'Uw contact bij MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Pagina', date: 'Datum', more: 'en {n} andere', ch: 'pk' },
  de: { title: 'Fahrzeugblatt', subtitle: 'Begutachtetes Fahrzeug - zum Verkauf', data: 'Fahrzeugdaten', make: 'Marke', model: 'Modell', version: 'HSN / TSN', body: 'Karosserie', vin: 'Fahrgestellnummer', reg: 'Erstzulassung', km: 'Kilometerstand', fuel: 'Kraftstoff', gearbox: 'Getriebe', power: 'Leistung', color: 'Farbe', doors: 'Tueren', seats: 'Sitze', equipment: 'Ausstattung', tyres: 'Montierte Reifen', condition: 'Zustand (unabhaengiges Gutachten)', deval: 'Einzuplanen', usage: 'Gebrauchsspuren, akzeptabel', none: 'Nichts zu melden', repainted: 'Nachlackiert', yes: 'ja', no: 'nein', report: 'Gutachten', of: 'vom', price: 'Unser Preis', priceNote: 'Nettopreis, Fahrzeug wie beschrieben, ab Frankreich. 7 Tage gueltig.', contact: 'Ihr Ansprechpartner bei MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Seite', date: 'Datum', more: 'und {n} weitere', ch: 'PS' },
  da: { title: 'Koeretoejsblad', subtitle: 'Inspiceret koeretoej - til salg', data: 'Koeretoejsdata', make: 'Maerke', model: 'Model', version: 'Typekode', body: 'Karrosseri', vin: 'Stelnummer', reg: '1. registrering', km: 'Kilometerstand', fuel: 'Braendstof', gearbox: 'Gearkasse', power: 'Effekt', color: 'Farve', doors: 'Doere', seats: 'Saeder', equipment: 'Udstyr', tyres: 'Monterede daek', condition: 'Stand (uafhaengig inspektion)', deval: 'Skal paaregnes', usage: 'Brugsspor, acceptable', none: 'Intet at bemaerke', repainted: 'Omlakeret', yes: 'ja', no: 'nej', report: 'Inspektionsrapport', of: 'af', price: 'Vores pris', priceNote: 'Nettopris, koeretoej som beskrevet, ab Frankrig. Gaelder 7 dage.', contact: 'Din kontakt hos MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Side', date: 'Dato', more: 'og {n} andre', ch: 'hk' },
  sv: { title: 'Fordonsblad', subtitle: 'Besiktigat fordon - till salu', data: 'Fordonsdata', make: 'Maerke', model: 'Modell', version: 'Typkod', body: 'Kaross', vin: 'Chassinummer', reg: 'Foersta registrering', km: 'Miltal', fuel: 'Braensle', gearbox: 'Vaexellaada', power: 'Effekt', color: 'Faerg', doors: 'Doerrar', seats: 'Saeten', equipment: 'Utrustning', tyres: 'Monterade daeck', condition: 'Skick (oberoende besiktning)', deval: 'Att raekna med', usage: 'Bruksspaar, acceptabla', none: 'Inget att anmaerka', repainted: 'Omlackerad', yes: 'ja', no: 'nej', report: 'Besiktningsrapport', of: 'fraan', price: 'Vaart pris', priceNote: 'Nettopris, fordon enligt beskrivning, fritt Frankrike. Gaeller 7 dagar.', contact: 'Din kontakt paa MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Sida', date: 'Datum', more: 'och {n} till', ch: 'hk' },
  es: { title: 'Ficha del vehiculo', subtitle: 'Vehiculo inspeccionado - en venta', data: 'Datos del vehiculo', make: 'Marca', model: 'Modelo', version: 'Codigo de tipo', body: 'Carroceria', vin: 'Bastidor', reg: '1a matriculacion', km: 'Kilometraje', fuel: 'Combustible', gearbox: 'Cambio', power: 'Potencia', color: 'Color', doors: 'Puertas', seats: 'Plazas', equipment: 'Equipamiento', tyres: 'Neumaticos montados', condition: 'Estado (inspeccion independiente)', deval: 'A prever', usage: 'Marcas de uso, aceptables', none: 'Nada que senalar', repainted: 'Repintado', yes: 'si', no: 'no', report: 'Informe de inspeccion', of: 'del', price: 'Nuestro precio', priceNote: 'Precio neto, vehiculo segun descripcion, salida Francia. Validez 7 dias.', contact: 'Su contacto en MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Pagina', date: 'Fecha', more: 'y {n} mas', ch: 'CV' },
  it: { title: 'Scheda veicolo', subtitle: 'Veicolo ispezionato - in vendita', data: 'Dati del veicolo', make: 'Marca', model: 'Modello', version: 'Codice tipo', body: 'Carrozzeria', vin: 'Telaio', reg: '1a immatricolazione', km: 'Chilometraggio', fuel: 'Alimentazione', gearbox: 'Cambio', power: 'Potenza', color: 'Colore', doors: 'Porte', seats: 'Posti', equipment: 'Dotazioni', tyres: 'Pneumatici montati', condition: 'Stato (ispezione indipendente)', deval: 'Da prevedere', usage: "Segni d'uso, accettabili", none: 'Nulla da segnalare', repainted: 'Riverniciato', yes: 'si', no: 'no', report: 'Rapporto di ispezione', of: 'del', price: 'Il nostro prezzo', priceNote: 'Prezzo netto, veicolo come descritto, franco Francia. Validita 7 giorni.', contact: 'Il vostro contatto MC Export', footer: 'MC Export - Export from France - mc-export.com', page: 'Pagina', date: 'Data', more: 'e altri {n}', ch: 'CV' },
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

export async function buildFycPdf(insp: FycInspection, lang: FycLang, contact: FycPdfContact): Promise<Blob> {
  const t = T[lang];
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
    pdf.setFontSize(15); pdf.text(safe(`${t.title} - ${car}`), W / 2, 15, { align: 'center' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GRIS);
    pdf.text(safe(t.subtitle), W / 2, 21, { align: 'center' });
    pdf.text(safe(today).toUpperCase(), W - margin, 15, { align: 'right' });
    pdf.setDrawColor(...ENCRE); pdf.setLineWidth(0.4); pdf.line(margin, 26, W - margin, 26);
    y = 33;
  };
  const footer = () => {
    pdf.setFontSize(7.5); pdf.setTextColor(...GRIS); pdf.setFont('helvetica', 'normal');
    pdf.text(safe(`${t.footer} - ${t.report} n° ${insp.report_number ?? '-'} ${t.of} ${date(insp.report_date)} - VIN ${insp.vin ?? '-'}`), margin, H - 7);
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
        pdf.text(pdf.splitTextToSize(safe(r[1] || '-'), colW - 42)[0] ?? '-', x + 40, y + 4);
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

  header();
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...ENCRE);
  pdf.text(safe(car), margin, y + 5);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...GRIS);
  pdf.text(safe([insp.year ? String(insp.year) : null, insp.km != null ? `${num(insp.km)} km` : null, insp.fuel, insp.gearbox, insp.power_ch ? `${insp.power_ch} ${t.ch}` : null].filter(Boolean).join(' - ')), margin, y + 11);
  // Prix en évidence, à droite
  if (insp.attack_price != null) {
    pdf.setFillColor(236, 253, 245); pdf.setDrawColor(167, 243, 208); pdf.roundedRect(W - margin - 58, y - 1, 58, 15, 2, 2, 'FD');
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(4, 120, 87); pdf.text(safe(t.price).toUpperCase(), W - margin - 54, y + 4);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.text(`${num(insp.attack_price)} EUR`, W - margin - 54, y + 11);
  }
  y += 18;

  section(t.data);
  kv([
    [t.make, insp.brand ?? '-'], [t.model, insp.model ?? '-'],
    [t.reg, date(insp.first_registration)], [t.km, insp.km != null ? `${num(insp.km)} km` : '-'],
    [t.fuel, insp.fuel ?? '-'], [t.gearbox, insp.gearbox ?? '-'],
    [t.power, insp.power_ch ? `${insp.power_ch} ${t.ch}` : '-'], [t.body, insp.body ?? '-'],
    [t.color, insp.color ?? '-'], [`${t.doors} / ${t.seats}`, `${insp.doors ?? '-'} / ${insp.seats ?? '-'}`],
    [t.vin, insp.vin ?? '-'], [t.version, insp.version ?? '-'],
  ]);

  if (insp.equipment.length) { section(t.equipment); twoColumns(insp.equipment); }
  if (insp.tyres.length) { section(t.tyres); bullets(insp.tyres); }

  section(t.condition);
  const dev = insp.damages.devaluation; const use = insp.damages.usage;
  kv([[t.repainted, insp.repainted == null ? '-' : insp.repainted ? t.yes : t.no], [t.report, `n° ${insp.report_number ?? '-'} ${t.of} ${date(insp.report_date)}`]]);
  if (dev.length) { subtitle(t.deval); bullets(dev.map((d) => d.raw)); }
  if (use.length) { subtitle(t.usage); bullets(use.map((d) => d.raw), GRIS); }
  if (!dev.length && !use.length) bullets([t.none]);

  section(t.price);
  ensure(16);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.setTextColor(...ENCRE);
  pdf.text(insp.attack_price != null ? `${num(insp.attack_price)} EUR` : '-', margin, y + 7);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...GRIS);
  pdf.text(safe(t.priceNote), margin, y + 13);
  y += 18;

  section(t.contact);
  kv([['MC Export', contact.name], ['E-mail', contact.email ?? '-'], ['Web', 'mc-export.com'], [t.date, today]]);

  footer();
  return pdf.output('blob');
}
