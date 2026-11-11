/**
 * RAPPORT D'INSPECTION DEKRA (Starfleet « iop-bli », page HTML partagée, 11/11, Channing : « apprends à lire cette
 * inspection, il nous faut toutes les infos, les photos, les défauts »). Module pur, partagé navigateur / worker.
 *
 * La page porte : marque (h1), modèle (h2), VIN, immatriculation, 1re immatriculation, compteur, couleur, portes,
 * places ; lieu et dates d'inspection ; contrôles (Ok) ; le tableau « Dommages et corrections » (élément /
 * position, dommage, correction, une photo par dommage) ; éléments amovibles ; pneus (position, marque, dimension,
 * saison, profondeur) ; la galerie des photos légendées (voiture puis dommages). Selon le rapport : carrosserie,
 * boîte, énergie, puissance (kW → ch), cylindrée, sellerie. Pas d'équipements. Libellés fr / en / es / de / nl / it / pt
 * (comparés sans accents ni ponctuation).
 * Vérifié sur Renault Captur VF1RJB00876818100 (fr : 7 dommages, 8 + 4 photos) et Dacia Bigster UU1DJF01476453067
 * (es : boîte, énergie, 115 kW → 156 ch, 7 dommages dont un à sous-libellé « Pintado : No », 8 + 7 photos).
 */
import type { FycReportFields, FycDamage } from './fycReport';
import { shortModel } from './fycReport';
import type { FycTranslation } from './fycTranslation';

/** « Acceptable » dans les 7 langues DEKRA : trace d'usage tolérée, pas une dévaluation. */
const ACCEPTABLE = /^(?:acceptable|ter info|akzeptabel|accettabile|aceptable|aceit[aá]vel|for information|acceptabel)$/i;

/** LES AUTRES LANGUES DU RAPPORT (11/11, Channing : « il y a les liens pour traduction dans les langues, s'en servir ») :
 *  le sélecteur de la page pointe sur l'API DEKRA (inspection-report?reportId=…&language=xx-YY), qui répond sans
 *  jeton. Retourne { fr: url, nl: url, … }. */
export function dekraLanguageUrls(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<option[^>]*value="([^"]*language=([a-z]{2})-[A-Z]{2}[^"]*)"/gi)) out[m[2].toLowerCase()] = decode(m[1]);
  return out;
}

/** Libellés par champ, toutes langues (comparés par norm()). */
const L = {
  firstReg: ['Date de 1ère immatriculation', 'Date de 1re immatriculation', 'Date de première immatriculation', 'First registration date', 'First registration', 'Fecha de matriculación', 'Fecha de primera matriculación', 'Erstzulassung', 'Datum eerste toelating', 'Eerste toelating', 'Data di immatricolazione', 'Prima immatricolazione', 'Data de matrícula', 'Data da primeira matrícula'],
  km: ['Odomètre', 'Kilométrage', 'Odometer', 'Mileage', 'Kilometraje', 'Cuentakilómetros', 'Kilometerstand', 'Chilometraggio', 'Quilometragem'],
  modelYear: ['Année modèle', 'Année', 'Model year', 'Año', 'Año modelo', 'Modelljahr', 'Baujahr', 'Bouwjaar', 'Modeljaar', 'Anno', 'Anno modello', 'Ano'],
  color: ['Couleur', 'Colour', 'Color', 'Farbe', 'Kleur', 'Colore', 'Cor'],
  doors: ['Nombre de portes', 'Number of doors', 'Doors', 'Numero de puertas', 'Número de puertas', 'Anzahl Türen', 'Türen', 'Aantal deuren', 'Numero di porte', 'Número de portas'],
  seats: ['Nombre de sièges', 'Number of seats', 'Seats', 'Número de asientos', 'Numero de asientos', 'Anzahl Sitze', 'Sitze', 'Aantal zitplaatsen', 'Numero di posti', 'Número de lugares'],
  body: ['Type de carrosserie', 'Carrosserie', 'Body type', 'Body', 'Tipo de carrocería', 'Carrocería', 'Karosserie', 'Karosserieform', 'Carrosserietype', 'Tipo di carrozzeria', 'Tipo de carroçaria'],
  gearbox: ['Boîte de vitesses', 'Transmission', 'Gearbox', 'Transmisión', 'Cambio', 'Getriebe', 'Transmissie', 'Versnellingsbak', 'Trasmissione', 'Caixa de velocidades'],
  fuel: ['Type de carburant', 'Carburant', 'Énergie', 'Fuel type', 'Fuel', 'Tipo de combustible', 'Combustible', 'Kraftstoff', 'Kraftstoffart', 'Brandstof', 'Brandstoftype', 'Carburante', 'Tipo di carburante', 'Combustível'],
  power: ['Puissance maximale', 'Puissance', 'Maximum power', 'Power', 'Potencia Máxima', 'Potencia', 'Leistung', 'Maximale Leistung', 'Vermogen', 'Maximaal vermogen', 'Potenza', 'Potenza massima', 'Potência'],
  plate: ['N° d’immatriculation', "N° d'immatriculation", 'Immatriculation', 'Registration number', 'Registration', 'Plate', 'Matrícula', 'Kennzeichen', 'Kenteken', 'Targa'],
  place: ["Lieu de l'inspection", 'Inspection location', 'Inspection place', 'Localización de la Inspección', 'Lugar de la inspección', 'Inspektionsort', 'Ort der Inspektion', 'Inspectielocatie', 'Luogo dell’ispezione', 'Luogo ispezione', 'Local da inspeção'],
  inspDate: ["Date de l'inspection", 'Inspection date', 'Fecha de inspeccion', 'Fecha de inspección', 'Inspektionsdatum', 'Datum der Inspektion', 'Inspectiedatum', 'Data ispezione', 'Data dell’ispezione', 'Data da inspeção'],
  displacement: ['Cylindrée', 'Engine displacement', 'Displacement', 'Desplazamiento de motor', 'Cilindrada', 'Hubraum', 'Cilinderinhoud', 'Cilindrata'],
  upholstery: ['Sellerie', 'Upholstery', 'Tapicería', 'Polsterung', 'Bekleding', 'Tappezzeria', 'Estofos', 'Capitonnage'],
};
/** « 115 KW » → 156 ch ; « 150 CV / ch / PS / hp » → 150. */
function powerCh(raw: string | null): number | null {
  const m = (raw ?? '').match(/(\d+(?:[.,]\d+)?)\s*(kw|cv|ch|ps|hp|pk)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return (m[2] ?? '').toLowerCase() === 'kw' ? Math.round(n * 1.35962) : Math.round(n);
}
/** « Bigster hybrid 155 » → « Bigster » : coupé au premier mot moteur / motorisation / nombre (le libellé complet va en version). */
function cutModel(model: string | null, brand: string | null): string | null {
  const m = shortModel(model, brand);
  if (!m) return null;
  const out: string[] = [];
  for (const w of m.split(/\s+/)) {
    if (out.length && (/^\d/.test(w) || /^(?:hybrid|hybride|híbrido|ibrido|e-tech|tce|dci|tdi|tsi|tfsi|hdi|puretech|bluehdi|ecoboost|mhev|phev|hev|cv|ch|kw)$/i.test(w))) break;
    out.push(w);
  }
  return out.join(' ') || m;
}

export interface DekraPhoto { url: string; caption: string; list: 'devaluation' | 'usage' | null; idx: number | null }
/** Photo d'un dommage rangée dans le storage (colonne defect_photos) : le chemin, la légende du rapport et le dommage
 *  qu'elle illustre (liste et rang dans damages.devaluation / usage), pour la légender traduite dans la fiche. */
export interface FycDefectPhoto { path: string; caption: string; list: 'devaluation' | 'usage' | null; idx: number | null }

export const isDekraReport = (html: string): boolean => /dekra-starfleet|class="table-defects"|class="legend-pictures"/i.test(html);

const strip = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const dash = (s: string | undefined) => { const v = (s ?? '').trim(); return !v || v === '-' ? null : v; };
const isoDate = (s: string | null) => { const m = (s ?? '').match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const intOf = (s: string | null) => { const m = (s ?? '').replace(/[\s\u202f\u00a0]/g, '').match(/\d+/); return m ? Number(m[0]) : null; };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface DekraParsed { fields: FycReportFields; photos: DekraPhoto[]; /** Les dommages dans l'ordre du tableau (liste et rang), pour aligner deux langues. */ rows: Array<{ list: 'devaluation' | 'usage'; idx: number }> }

/** Traduction d'un rapport par le MÊME rapport dans une autre langue : dommages alignés par rang dans le tableau
 *  (la liste dévaluation / usage est celle de la source, pas celle que la langue cible déduirait), pneus rang à rang ;
 *  null si les deux pages n'ont pas la même structure. Pas d'équipements chez DEKRA. */
export function dekraTranslationFrom(src: DekraParsed, tr: DekraParsed): FycTranslation | null {
  if (src.rows.length !== tr.rows.length || src.fields.tyres.length !== tr.fields.tyres.length) return null;
  const dev: string[] = new Array(src.fields.damages.devaluation.length).fill('');
  const use: string[] = new Array(src.fields.damages.usage.length).fill('');
  for (let i = 0; i < src.rows.length; i++) {
    const s = src.rows[i]; const t = tr.rows[i];
    const raw = tr.fields.damages[t.list][t.idx]?.raw;
    if (raw == null) return null;
    (s.list === 'devaluation' ? dev : use)[s.idx] = raw;
  }
  if (dev.some((x) => !x) || use.some((x) => !x)) return null;
  const f = tr.fields;
  return { fuel: f.fuel, gearbox: f.gearbox, body: f.body, color: f.color, equipment: [], tyres: [...f.tyres], devaluation: dev, usage: use };
}

export function parseDekraReport(html: string): DekraParsed {
  const h = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '');
  // Libellés « <span class="label">X</span><span>Y</span> ».
  const labels: Record<string, string> = {};
  for (const m of h.matchAll(/<span class="label">([\s\S]*?)<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/gi)) labels[norm(strip(m[1]))] = strip(m[2]);
  const lab = (keys: string[]) => { for (const k of keys) { const v = labels[norm(k)]; if (v != null) return dash(v); } return null; };
  const brand = dash(strip(h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ''));
  const fullModel = dash(strip(h.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? ''));
  const model = cutModel(fullModel, brand);
  const vin = (strip(h.match(/class="logo-vin"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '').match(/[A-HJ-NPR-Z0-9]{17}/) ?? [null])[0];
  const firstReg = isoDate(lab(L.firstReg));
  const km = intOf(lab(L.km));
  const modelYear = intOf(lab(L.modelYear));
  // Énergie : celle du rapport ; un modèle nommé « hybrid » / « E-Tech » avec une énergie « essence » est une hybride.
  let fuel = lab(L.fuel);
  if (fuel && /hybrid|hybride|híbrido|e-tech/i.test(fullModel ?? '') && !/hybr|ibrid/i.test(fuel)) fuel = `${fuel} hybrid`;

  // Dommages et corrections : élément / position · dommage · correction (+ photo dans la ligne « show » suivante).
  const devaluation: FycDamage[] = []; const usage: FycDamage[] = [];
  const photos: DekraPhoto[] = [];
  const table = h.match(/<table class="table-defects">([\s\S]*?)<\/table>/i)?.[1] ?? '';
  const trs = [...table.matchAll(/<tr class="collapse[^"]*">([\s\S]*?)<\/tr>(?:\s*<tr class="show">([\s\S]*?)<\/tr>)?/gi)];
  const byCaption = new Map<string, { list: 'devaluation' | 'usage'; idx: number }>();
  const rows: DekraParsed['rows'] = [];
  for (const r of trs) {
    const tds = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (tds.length < 3 || !/^\d+$/.test(strip(tds[0]))) continue;
    // Élément : « Spoiler / Trasero » + sous-libellé éventuel (« Pintado : No », classe defects-feature) gardé en note.
    const feature = strip((tds[1].match(/<span class="defects-feature">([\s\S]*?)<\/span>\s*<\/span>/i)?.[1] ?? '').replace(/<\/span>\s*<span[^>]*>/gi, ' · '));
    const element = strip(tds[1].replace(/<span class="defects-feature">[\s\S]*$/i, ''));
    const damage = strip(tds[2]); const correction = strip(tds[3] ?? '');
    const parts = element.split(/\s*\/\s*/).filter(Boolean);
    const where = parts.filter((p) => p !== '-').join(' / ') || element;
    const d: FycDamage = { zone: where, kind: damage, action: correction, raw: `${where} : ${damage}${feature ? ` (${feature})` : ''}${correction ? ` → ${correction}` : ''}` };
    // « Acceptable » = trace d'usage tolérée ; le reste est à prévoir (dévaluation).
    const list: 'devaluation' | 'usage' = ACCEPTABLE.test(correction) ? 'usage' : 'devaluation';
    const target = list === 'devaluation' ? devaluation : usage;
    target.push(d);
    const ref = { list, idx: target.length - 1 };
    rows.push(ref);
    byCaption.set(norm(`${element} / ${damage}`), ref);
    for (const im of (r[2] ?? '').matchAll(/<img[^>]*src="([^"]+)"/gi)) if (!/^data:/i.test(im[1])) photos.push({ url: decode(im[1]), caption: `${where} / ${damage}`, ...ref });
  }

  // Galerie légendée de fin de page (toutes les photos : voiture puis dommages) ; sinon la galerie de description.
  const gallery = [...h.matchAll(/<div class="pdf--div-picture">\s*<img[^>]*src="([^"]+)"[^>]*>\s*<div class="pdf--div-legend">([\s\S]*?)<\/div>/gi)];
  const legend = gallery.length ? gallery : [...h.matchAll(/<li class="gallery_img[^"]*">\s*<img[^>]*src="([^"]+)"[^>]*>\s*<div class="legend-pictures">([\s\S]*?)<\/div>/gi)];
  const seen = new Set(photos.map((p) => p.url.split('?')[0]));
  const mains: DekraPhoto[] = [];
  for (const g of legend) {
    const url = decode(g[1]); const key = url.split('?')[0];
    if (/^data:/i.test(url) || seen.has(key)) continue;
    seen.add(key);
    const caption = strip(g[2]);
    const ref = byCaption.get(norm(caption));
    if (ref) photos.push({ url, caption, ...ref }); else mains.push({ url, caption, list: null, idx: null });
  }

  // Pneus : position · marque · dimension saison · profondeur.
  const tyres: string[] = [];
  for (const r of (h.match(/<table class="table-tyres">([\s\S]*?)<\/table>/i)?.[1] ?? '').matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1].replace(/<span class="tyre-usage">/gi, ' ')));
    if (cells.length >= 2) tyres.push(`${cells[0]} : ${cells.slice(1).filter(Boolean).join(' · ')}`);
  }

  const raw: Record<string, string> = {};
  const plate = lab(L.plate);
  if (plate) raw.plate = plate;
  const disp = lab(L.displacement); if (disp) raw.displacement = disp;
  const uph = lab(L.upholstery); if (uph) raw.upholstery = uph;
  const powerRaw = lab(L.power); if (powerRaw) raw.power = powerRaw;
  for (const [k, v] of Object.entries(labels)) if (v && v !== '-') raw[k] = v;
  const checks = [...h.matchAll(/<li[^>]*>\s*<span[^>]*>([^<]+)<\/span>(?:(?!<\/li>)[\s\S])*?class="mechanical-value">([^<]+)<\/span>/gi)].map((m) => `${strip(m[1])} : ${strip(m[2])}`);
  if (checks.length) raw.checks = checks.join(' ; ');
  const loose = [...(h.match(/<ul class="ul-loose-items">([\s\S]*?)<\/ul>/i)?.[1] ?? '').matchAll(/<li>[\s\S]*?<span>([^<]+)<\/span>\s*<\/li>/gi)].map((m) => strip(m[1]));
  if (loose.length) raw.loose_items = loose.join(' ; ');
  const place = lab(L.place); if (place) raw.inspection_place = place;
  const inspDate = isoDate(lab(L.inspDate));
  const inspector = 'DEKRA';
  raw.inspector = inspector;

  const fields: FycReportFields = {
    report_number: null, report_date: inspDate, vin: vin ?? null,
    brand, model, version: fullModel && fullModel !== model ? fullModel : null, body: lab(L.body),
    first_registration: firstReg, year: modelYear ?? (firstReg ? Number(firstReg.slice(0, 4)) : null), km,
    asking_price: null, repair_cost: null,
    fuel, gearbox: lab(L.gearbox), power_ch: powerCh(powerRaw), color: lab(L.color),
    doors: intOf(lab(L.doors)), seats: intOf(lab(L.seats)), repainted: null,
    damages: { devaluation, usage }, equipment: [], tyres, raw_fields: raw,
  };
  return { fields, photos: [...mains, ...photos], rows };
}
