/**
 * RAPPORT D'INSPECTION MACADAM (www4.macadam.eu, 12/11, Channing : liste Drivalia « lien macadam » sur 52 voitures).
 * Module pur, partagé navigateur / worker. Deux pages publiques pour un même assessmentFileId :
 *   - AppraisalWebview?assessmentFileId=…&language=fr-FR : la fiche (VIN, 1re immat., compteur, carrosserie, boîte,
 *     énergie, portes, places, couleur, options, pneus, dommages chiffrés avec « Coût total hors TVA », photos de
 *     dommages) ; les identifiants des blocs (Vinnumber, Expertise Mileage, Gearbox…) ne changent pas avec la langue,
 *     les libellés « checks_… » si — on lit la page française.
 *   - Report17Pdf_OLD?assessmentFileId=…&language=fr-FR : les photos générales (« General Picture - n »).
 * Les photos pleine taille (2048 × 1536) sont derrière picture/<id>.jpg?originalpicture=true (redirection vers Azure).
 * Les liens « ShowSelectedReport » et « Report17Pdf_OLD » des listes portent le même assessmentFileId.
 * Vérifié sur le Land Rover Discovery Sport SALCA2BT5PH328757 (5 dommages, 4 pneus, 21 photos de dommages) et le
 * Ford Kuga WF0FXXWPMHPJ74563 (17 photos générales).
 */
import type { FycReportFields, FycDamage } from './fycReport';
import type { DekraPhoto } from './dekraReport';

export const isMacadamReport = (html: string): boolean => /macadam\.eu/i.test(html) && /dynamicLabel/.test(html) && /assessmentFileId|vehicleTitle/i.test(html);

/** L'identifiant du rapport dans un lien Macadam, tel qu'écrit (encodé) ; null si ce n'est pas un lien Macadam. */
export function macadamAssessmentId(url: string): string | null {
  if (!/macadam\.eu/i.test(url)) return null;
  return url.match(/[?&]assessmentFileId=([^&#\s]+)/i)?.[1] ?? null;
}
export const macadamUrls = (id: string) => ({
  webview: `https://www4.macadam.eu/Manager/SinglePage/AppraisalWebview?assessmentFileId=${id}&language=fr-FR`,
  pictures: `https://www4.macadam.eu/Manager/SinglePage/Report17Pdf_OLD?assessmentFileId=${id}&language=fr-FR`,
});

const decode = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
const dash = (s: string | null | undefined) => { const v = (s ?? '').trim(); return v && v !== '-' ? v : null; };
const isoDate = (s: string | null) => { const m = (s ?? '').match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); return m && Number(m[3]) >= 1980 ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const num = (s: string | null | undefined) => { const t = (s ?? '').replace(/\s/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/); return t ? Number(t[0]) : null; };
const WHEEL: Record<string, string> = { AVG: 'Avant gauche', AVD: 'Avant droit', ARG: 'Arrière gauche', ARD: 'Arrière droit' };
const BRAND_FIX: Record<string, string> = { 'LAND-ROVER': 'Land Rover', 'ALFA-ROMEO': 'Alfa Romeo', 'ASTON-MARTIN': 'Aston Martin', 'ROLLS-ROYCE': 'Rolls-Royce', 'MERCEDES-BENZ': 'Mercedes-Benz' };

type Entry = { id: string; label: string; value: string | null; section: string };

/** Les blocs libellé → valeur dans l'ordre, avec la section (en-têtes « Options », « Pneu », « Matériel de secours »). */
function entriesOf(html: string): Entry[] {
  const out: Entry[] = [];
  const re = /<th class='x-panel-header[^']*'>([^<]{2,40})<\/th>|<div id='([^']*)'><table[^>]*><tr><td(?:><tr><td)? class='dynamicLabel'[^>]*>([^<]*)<\/td>(?:<td class='dynamicValue[^']*'[^>]*>([\s\S]*?)<\/td>)?/g;
  let section = 'data';
  for (const m of html.matchAll(re)) {
    if (m[1]) { section = decode(m[1]); continue; }
    out.push({ id: m[2], label: decode(m[3]).replace(/:$/, '').trim(), value: dash(decode(m[4] ?? '')), section });
  }
  return out;
}

export interface MacadamParsed { fields: FycReportFields; photos: DekraPhoto[]; rows: Array<{ list: 'devaluation' | 'usage'; idx: number }> }

export function parseMacadamReport(html: string): MacadamParsed {
  const entries = entriesOf(html);
  const byId = (id: string) => entries.find((e) => e.id === id)?.value ?? null;
  const byLabel = (re: RegExp, section?: string) => entries.find((e) => re.test(e.label) && (!section || e.section === section))?.value ?? null;
  const raw: Record<string, string> = {};
  // Titre « LAND-ROVER Discovery Sport: GN649NA ».
  const title = decode(html.match(/id='vehicleTitle'[\s\S]*?class='x-panel-header[^']*'>([^<]*)</)?.[1] ?? '');
  const tm = title.match(/^(\S+)\s+(.*?)(?::\s*([A-Z0-9-]+))?$/);
  const brandRaw = tm?.[1] ?? null;
  const brand = brandRaw ? (BRAND_FIX[brandRaw.toUpperCase()] ?? brandRaw) : null;
  const model = dash(tm?.[2] ?? null);
  if (tm?.[3]) raw.plate = tm[3];
  const kw = num(byId('Power Kw'));
  const fiscal = byId('Fiscalpower'); if (fiscal) raw.fiscal_power = fiscal;
  const transmission = byId('Transmission'); if (transmission) raw.transmission = transmission;
  for (const e of entries) if (e.section === 'data' && e.id.startsWith('checks_') && e.value && !/portes|si[èe]ges|Couleur carrosserie/i.test(e.label)) raw[e.label] = e.value;
  // Options : un libellé seul = présent ; avec valeur = « libellé : valeur ».
  const equipment = entries.filter((e) => e.section === 'Options').map((e) => (e.value ? `${e.label} : ${e.value}` : e.label));
  // Pneus : dimension, type, profondeur par roue ; marque et usure dans le petit tableau.
  const wear = Object.fromEntries([...html.matchAll(/<td class='dynamicLabel' width='50px'>(AVG|AVD|ARG|ARD)<\/td><td class='dynamicValueLeft'>([^<]*)<\/td>/g)].map((m) => [m[1], decode(m[2])]));
  const tyres: string[] = [];
  for (const w of ['AVG', 'AVD', 'ARG', 'ARD']) {
    const size = byLabel(new RegExp(`^Taille de pneu ${w}$`)); const type = byLabel(new RegExp(`^Type de pneu ${w}$`)); const depth = byLabel(new RegExp(`^Profondeur de pneu ${w}$`));
    if (!size && !depth) continue;
    const brandWear = wear[w] ?? '';
    const tyreBrand = brandWear.split(':')[0].trim(); const pct = brandWear.match(/\d+\s*%/)?.[0];
    tyres.push(`${WHEEL[w]} : ${[tyreBrand, size, type, depth ? `${depth} mm` : null, pct ? `(${pct.replace(/\s/g, '')} restant)` : null].filter(Boolean).join(' ')}`);
  }
  // Dommages : « Élément, Dommage, Action | montant » après « Coût total hors TVA | total ».
  const devaluation: FycDamage[] = []; const usage: FycDamage[] = [];
  const rows: MacadamParsed['rows'] = [];
  const lines = [...html.matchAll(/align='left'>([^<]*)<\/div><\/td><td><div[^>]*align='right'>([^<]*)<\/div>/g)].map((m) => ({ text: decode(m[1]), amount: num(decode(m[2])) }));
  let repair_cost: number | null = null;
  for (const l of lines) {
    if (/Co[uû]t total/i.test(l.text)) { repair_cost = l.amount; continue; }
    const parts = l.text.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean);
    const [element, damage, ...rest] = parts;
    const action = rest.join(', ');
    const acceptable = /^acceptable$/i.test(action) || (l.amount === 0 && /acceptable/i.test(l.text));
    const d: FycDamage = { zone: element ?? l.text, kind: damage ?? '', action, raw: `${element ?? l.text}${damage ? ` : ${damage}` : ''}${action ? ` → ${action}` : ''}${l.amount ? ` (${l.amount.toLocaleString('fr-FR')} € HT)` : ''}` };
    const list = acceptable ? usage : devaluation;
    list.push(d); rows.push({ list: acceptable ? 'usage' : 'devaluation', idx: list.length - 1 });
  }
  // Photos de dommages : <div id='reviewPictures<k>_…'> … ShowPicture("pleine taille") — k = rang du dommage.
  const photos: DekraPhoto[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<div id='reviewPictures(\d+)_\d+'>[\s\S]*?ShowPicture\("([^"]+)"/g)) {
    const k = Number(m[1]); const url = m[2];
    if (seen.has(url)) continue; seen.add(url);
    const r = rows[k];
    const caption = r ? (r.list === 'devaluation' ? devaluation : usage)[r.idx].raw.replace(/\s*\([^()]*€ HT\)$/, '') : `Dommage ${k + 1}`;
    photos.push({ url, caption, list: r?.list ?? null, idx: r?.idx ?? null });
  }
  raw.inspector = 'Macadam';
  const fields: FycReportFields = {
    report_number: null, report_date: null, vin: dash(byId('Vinnumber'))?.replace(/\s+/g, '') ?? null,
    brand, model, version: dash(byId('Versionname')), body: dash(byId('Bodytype')),
    first_registration: isoDate(byId('First Registrationdate')), year: null, km: num(byId('Expertise Mileage')),
    asking_price: null, repair_cost,
    fuel: dash(byId('Fueltype')), gearbox: dash(byId('Gearbox')), power_ch: kw ? Math.round(kw * 1.35962) : null,
    color: byLabel(/^Couleur carrosserie$/, 'data'),
    doors: num(byLabel(/^Nbre portes$/, 'data')), seats: num(byLabel(/^Nbre si[èe]ges$/, 'data')), repainted: null,
    damages: { devaluation, usage }, equipment, tyres, raw_fields: raw,
  };
  fields.year = fields.first_registration ? Number(fields.first_registration.slice(0, 4)) : null;
  return { fields, photos, rows };
}

/** Photos générales de la page Report17Pdf_OLD (pleine taille, dédoublonnées, dans l'ordre). */
export function macadamGeneralPhotos(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/title='General Picture - \d+'[^>]*onclick='[^']*ShowPicture\("([^"]+)"/g)) if (!out.includes(m[1])) out.push(m[1]);
  if (!out.length) for (const m of html.matchAll(/ShowPicture\("([^"]+)"/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
