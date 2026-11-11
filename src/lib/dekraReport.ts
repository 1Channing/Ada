/**
 * RAPPORT D'INSPECTION DEKRA (Starfleet « iop-bli », page HTML partagée, 11/11, Channing : « apprends à lire cette
 * inspection, il nous faut toutes les infos, les photos, les défauts »). Module pur, partagé navigateur / worker.
 *
 * La page porte : marque (h1), modèle (h2), VIN, immatriculation, 1re immatriculation, compteur, couleur, portes,
 * places ; lieu et dates d'inspection ; contrôles (Ok) ; le tableau « Dommages et corrections » (élément /
 * position, dommage, correction, une photo par dommage) ; éléments amovibles ; pneus (position, marque, dimension,
 * saison, profondeur) ; la galerie des photos légendées (voiture puis dommages). Ni énergie, ni boîte, ni
 * puissance, ni équipements : ils restent vides. Libellés français et anglais.
 * Vérifié sur le rapport Renault Captur VF1RJB00876818100 (7 dommages, 8 photos + 4 photos de dommages).
 */
import type { FycReportFields, FycDamage } from './fycReport';

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

export function parseDekraReport(html: string): { fields: FycReportFields; photos: DekraPhoto[] } {
  const h = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '');
  // Libellés « <span class="label">X</span><span>Y</span> ».
  const labels: Record<string, string> = {};
  for (const m of h.matchAll(/<span class="label">([\s\S]*?)<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/gi)) labels[norm(strip(m[1]))] = strip(m[2]);
  const lab = (...keys: string[]) => { for (const k of keys) { const v = labels[norm(k)]; if (v != null) return dash(v); } return null; };
  const brand = dash(strip(h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ''));
  const model = dash(strip(h.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? ''));
  const vin = (strip(h.match(/class="logo-vin"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '').match(/[A-HJ-NPR-Z0-9]{17}/) ?? [null])[0];
  const firstReg = isoDate(lab('Date de 1ère immatriculation', 'Date de 1ere immatriculation', 'First registration date', 'First registration'));
  const km = intOf(lab('Odomètre', 'Odometer', 'Kilométrage', 'Mileage'));
  const modelYear = intOf(lab('Année modèle', 'Model year'));

  // Dommages et corrections : élément / position · dommage · correction (+ photo dans la ligne « show » suivante).
  const devaluation: FycDamage[] = []; const usage: FycDamage[] = [];
  const photos: DekraPhoto[] = [];
  const table = h.match(/<table class="table-defects">([\s\S]*?)<\/table>/i)?.[1] ?? '';
  const rows = [...table.matchAll(/<tr class="collapse[^"]*">([\s\S]*?)<\/tr>(?:\s*<tr class="show">([\s\S]*?)<\/tr>)?/gi)];
  const byCaption = new Map<string, { list: 'devaluation' | 'usage'; idx: number }>();
  for (const r of rows) {
    const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1]));
    if (cells.length < 3 || !/^\d+$/.test(cells[0])) continue;
    const [, element, damage, correction = ''] = cells;
    const [zone, pos] = element.split(/\s*\/\s*/);
    const where = dash(pos) ? `${zone} / ${pos}` : zone;
    const d: FycDamage = { zone: where, kind: damage, action: correction, raw: `${where} : ${damage}${correction ? ` → ${correction}` : ''}` };
    // « Acceptable » = trace d'usage tolérée ; le reste est à prévoir (dévaluation).
    const list: 'devaluation' | 'usage' = /^acceptable$/i.test(correction) ? 'usage' : 'devaluation';
    const target = list === 'devaluation' ? devaluation : usage;
    target.push(d);
    const ref = { list, idx: target.length - 1 };
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
  const plate = lab('N° d’immatriculation', "N° d'immatriculation", 'Registration number', 'Plate');
  if (plate) raw.plate = plate;
  for (const [k, v] of Object.entries(labels)) if (v && v !== '-') raw[k] = v;
  const checks = [...h.matchAll(/<li[^>]*>\s*<span[^>]*>([^<]+)<\/span>(?:(?!<\/li>)[\s\S])*?class="mechanical-value">([^<]+)<\/span>/gi)].map((m) => `${strip(m[1])} : ${strip(m[2])}`);
  if (checks.length) raw.checks = checks.join(' ; ');
  const loose = [...(h.match(/<ul class="ul-loose-items">([\s\S]*?)<\/ul>/i)?.[1] ?? '').matchAll(/<li>[\s\S]*?<span>([^<]+)<\/span>\s*<\/li>/gi)].map((m) => strip(m[1]));
  if (loose.length) raw.loose_items = loose.join(' ; ');
  const place = lab("Lieu de l'inspection", 'Inspection location', 'Inspection place'); if (place) raw.inspection_place = place;
  const inspDate = isoDate(lab("Date de l'inspection", 'Inspection date'));
  const inspector = 'DEKRA';
  raw.inspector = inspector;

  const fields: FycReportFields = {
    report_number: null, report_date: inspDate, vin: vin ?? null,
    brand, model, version: null, body: null,
    first_registration: firstReg, year: modelYear ?? (firstReg ? Number(firstReg.slice(0, 4)) : null), km,
    asking_price: null, repair_cost: null,
    fuel: null, gearbox: null, power_ch: null, color: lab('Couleur', 'Colour', 'Color'),
    doors: intOf(lab('Nombre de portes', 'Number of doors', 'Doors')), seats: intOf(lab('Nombre de sièges', 'Number of seats', 'Seats')), repainted: null,
    damages: { devaluation, usage }, equipment: [], tyres, raw_fields: raw,
  };
  return { fields, photos: [...mains, ...photos] };
}
