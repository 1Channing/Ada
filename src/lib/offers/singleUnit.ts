/**
 * SINGLE UNITS (12/11, Channing : « ajouter des single units sur nos listes, et en même temps créer l'inspection
 * façon MC Export. Les options on les met dans l'inspection, et les critères (1st reg, VIN…) dans la liste »).
 *
 * Une unité arrive en texte libre, toujours dans le même esprit :
 *
 *   SUZUKI IGNIS 1.2 DUALJET 83ps
 *   27/03/2023 · 30 000 km · 122g/km
 *   VIN: JSAMFH91S00247063
 *   Cruise control / Automatic AC / Camera / Heated seats      ← options, une par ligne
 *   Service history Suzuki
 *   Default (pictures attached)
 *   14 000 netto delivered
 *
 * Ce module est PUR (pas de navigateur, pas de Supabase) : testable sous tsx. Il reconnaît ce qu'il peut, ne perd
 * rien (la ligne de titre entière reste en `version`, les lignes inconnues deviennent des options) et laisse vide
 * ce qu'il ne sait pas — tout se corrige ensuite au crayon dans l'offre ou dans le FYC.
 */
import { parseFreeLine, type OfferVehicle } from './parseSupplierFile';
import type { FycReportFields } from '../fycReport';

export interface SingleUnit {
  /** Ligne de titre telle quelle (« SUZUKI IGNIS 1.2 DUALJET 83ps »). */
  title: string;
  brand: string; model: string;
  /** Reste du titre après marque et modèle (« 1.2 DUALJET 83ps »). */
  version: string;
  reg_date: string | null; year: number | null; km: number | null; co2: number | null; vin: string | null;
  color: string | null; fuel: string | null; gearbox: string | null; power_ch: number | null; engine: string | null;
  /** Options et équipements (une entrée par ligne, ou par virgule sur une ligne). */
  options: string[];
  /** « Service history Suzuki », « Carnet d'entretien complet »… */
  service: string | null;
  /** « Default (pictures attached) », « Scratch rear bumper »… */
  defects: string[];
  /** Prix lu sur la dernière ligne (« 14 000 netto delivered ») et ce qui l'accompagne. */
  price: number | null; price_ttc: boolean; price_note: string | null;
  /** Lignes sur lesquelles rien n'a été reconnu après le prix (rares) : gardées pour l'aperçu. */
  rest: string[];
}

/** Marques en deux mots : le modèle commence au troisième jeton. */
const TWO_WORD_BRANDS = ['LAND ROVER', 'ALFA ROMEO', 'ASTON MARTIN', 'MERCEDES BENZ', 'MERCEDES-BENZ', 'ROLLS ROYCE', 'GREAT WALL', 'LYNK & CO', 'DS AUTOMOBILES'];
/** Marques en un mot dont le modèle est en deux jetons (« RANGE ROVER EVOQUE », « MODEL 3 », « CLASSE A », « SERIE 1 »). */
const TWO_WORD_MODEL_HEADS = new Set(['RANGE', 'MODEL', 'CLASSE', 'CLASS', 'KLASSE', 'SERIE', 'SERIES', 'GRAND', 'GRANDE', 'NEW', 'SANTA', 'ID.', 'ID', 'DS', 'TYPE', 'E-']);

const num = (s: string): number => Number(s.replace(/[^\d]/g, ''));
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

const DATE_RE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/;
const MONTH_YEAR_RE = /^(\d{1,2})[/.-](\d{4})$/;
const KM_RE = /(\d{1,3}(?:[\s.,\u202f\u00a0]?\d{3})*|\d+)\s*(?:km|kms|kilometers|kilomètres|kilometres|miles|mi)\b/i;
const CO2_RE = /(\d{1,3})\s*g\s*(?:\/|par|per)?\s*km\b/i;
const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
const PRICE_RE = /(\d{1,3}(?:[\s.,\u202f\u00a0]?\d{3})+|\d{4,6})(?:[.,]\d{1,2})?\s*(?:€|eur|euros?|k€)?/i;
const PRICE_WORDS = /\b(netto?|net|brutto|delivered|livr[ée]e?|franco|ex\s?works|exw|h\.?t\.?|t\.?t\.?c\.?|excl|incl|price|prix|preis|prijs|€|eur|euros?)\b/i;
const SERVICE_RE = /\b(service\s?(history|book|record|carnet)?|carnet|entretien|historique|maintenance|wartung|onderhoud|scheckheft|tagliand)/i;
const DEFECT_RE = /\b(defaults?|defects?|d[ée]fauts?|damages?|dommages?|schade|sch[äa]den|scratch|scratches|rayures?|dents?|bosses?|chocs?|hail|gr[êe]le|cracked?|fissur|pictures? attached|photos? attached|voir photos|see pictures)/i;
const COLOR_RE = /^(colou?r|couleur|farbe|kleur|colore)\s*[:=]\s*(.+)$/i;
const FUEL_ALONE = /^(diesel|essence|petrol|benzin|benzine|gasolina|hybride?|hybrid|phev|plug-?in hybrid|hybride rechargeable|[ée]lectrique|electric|ev|gpl|lpg)$/i;
const GEARBOX_LINE = /\b(automatic|automatique|automaat|automatik|auto)\s*(gearbox|transmission|bo[iî]te|getriebe|versnellingsbak|cambio)?\b|\b(dsg|dct|cvt|e-?cvt|bva|eat\d|edc|s-?tronic|steptronic|tiptronic|powershift)\b/i;
const GEARBOX_MANUAL_LINE = /\b(manual|manuelle?|manueel|schalt|handgeschakeld)\s*(gearbox|transmission|bo[iî]te|getriebe|versnellingsbak|cambio)?\b|\bbvm\d?\b/i;
/** Un mot de boîte qui qualifie autre chose (« Automatic AC », « Auto lights ») n'est pas la boîte de vitesses. */
const GEARBOX_FALSE = /\b(ac|a\/c|air|clim|climate|climatisation|lights?|headlights?|phares|wipers|essuie|parking|park|hold|brake|braking|dimming|high beam|tailgate|hayon|mirror|r[ée]tro|start|stop|door|folding|lock)\b/i;

function titleParts(title: string): { brand: string; model: string; version: string } {
  const t = clean(title);
  const up = t.toUpperCase();
  let brandLen = 1;
  for (const b of TWO_WORD_BRANDS) if (up.startsWith(b + ' ') || up === b) { brandLen = b.split(' ').length; break; }
  const tokens = t.split(' ');
  const brand = tokens.slice(0, brandLen).join(' ').toUpperCase();
  const after = tokens.slice(brandLen);
  let modelLen = after.length >= 2 && TWO_WORD_MODEL_HEADS.has(after[0].toUpperCase()) ? 2 : 1;
  // « RANGE ROVER EVOQUE / VELAR / SPORT » : trois jetons.
  if (modelLen === 2 && after.length >= 3 && after[0].toUpperCase() === 'RANGE' && /^(EVOQUE|VELAR|SPORT)$/i.test(after[2])) modelLen = 3;
  const model = after.slice(0, modelLen).join(' ').toUpperCase();
  return { brand, model, version: after.slice(modelLen).join(' ') };
}

const isPriceLine = (line: string): boolean => {
  if (!PRICE_WORDS.test(line) && !/€/.test(line)) return false;
  const m = line.match(PRICE_RE);
  return !!m && num(m[1]) >= 500 && !KM_RE.test(line) && !CO2_RE.test(line) && !DATE_RE.test(line);
};

/** Un bloc = une unité. Le prix clôt l'unité : plusieurs unités collées à la suite sont séparées là. */
export function splitUnits(text: string): string[][] {
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = clean(raw);
    if (!line) continue;
    cur.push(line);
    if (isPriceLine(line)) { blocks.push(cur); cur = []; }
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

export function parseSingleUnit(lines: string[] | string): SingleUnit | null {
  const ls = (Array.isArray(lines) ? lines : lines.replace(/\r/g, '').split('\n')).map(clean).filter(Boolean);
  if (!ls.length) return null;
  const title = ls[0];
  const { brand, model, version } = titleParts(title);
  const free = parseFreeLine(title);
  const u: SingleUnit = {
    title, brand, model, version, reg_date: null, year: null, km: null, co2: null, vin: null, color: null,
    fuel: free.fuel, gearbox: free.gearbox, power_ch: free.power_ch, engine: free.engine,
    options: [], service: null, defects: [], price: null, price_ttc: false, price_note: null, rest: [],
  };
  // Marques 100 % électriques : énergie et boîte connues d'avance (comme dans les listes fournisseur).
  if (/^(TESLA|POLESTAR|LUCID|RIVIAN|NIO|XPENG|ZEEKR|SMART)$/.test(brand) && !u.fuel) { u.fuel = 'ELECTRIQUE'; u.gearbox = u.gearbox ?? 'AUTOMATIQUE'; }
  let priced = false;
  for (const line of ls.slice(1)) {
    if (priced) { u.rest.push(line); continue; }
    let rem = line;
    // 1. Critères (date, km, CO2, VIN) : une ligne peut en porter plusieurs (« 27/03/2023 · 30 000 km · 122g/km »).
    const vin = rem.match(/\bVIN\b\s*[:=]?\s*([A-HJ-NPR-Z0-9]{17})\b/i) ?? rem.match(VIN_RE);
    if (vin && !u.vin) { u.vin = vin[1].toUpperCase(); rem = rem.replace(vin[0], ' '); }
    const co2 = rem.match(CO2_RE);
    if (co2 && u.co2 == null) { u.co2 = Number(co2[1]); rem = rem.replace(co2[0], ' '); }
    const km = rem.match(KM_RE);
    if (km && u.km == null) { u.km = /\b(miles|mi)\b/i.test(km[0]) ? Math.round(num(km[1]) * 1.609) : num(km[1]); rem = rem.replace(km[0], ' '); }
    const d = rem.match(DATE_RE);
    if (d && !u.reg_date) {
      const [, dd, mm, yy] = d;
      u.reg_date = `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`; u.year = Number(yy); rem = rem.replace(d[0], ' ');
    }
    rem = clean(rem.replace(/^[\s·•|,;/-]+|[\s·•|,;/-]+$/g, ''));
    if (!d) {
      const my = rem.match(MONTH_YEAR_RE);
      if (my && !u.reg_date) { u.reg_date = `${my[2]}-${my[1].padStart(2, '0')}-01`; u.year = Number(my[2]); rem = ''; }
      else if (/^(19|20)\d{2}$/.test(rem) && u.year == null) { u.year = Number(rem); rem = ''; }
    }
    if (!rem) continue;
    // 2. Prix : clôt l'unité.
    if (isPriceLine(rem)) {
      const m = rem.match(PRICE_RE)!;
      u.price = num(m[1]); u.price_ttc = /\b(t\.?t\.?c\.?|brutto|incl)/i.test(rem);
      const note = clean(rem.replace(m[0], ' '));
      u.price_note = note || null; priced = true; continue;
    }
    // 3. Couleur, énergie seule, boîte seule, entretien, défauts.
    const col = rem.match(COLOR_RE);
    if (col) { u.color = clean(col[2]); continue; }
    if (FUEL_ALONE.test(rem)) { u.fuel = parseFreeLine(rem).fuel ?? u.fuel; if (!u.fuel) u.options.push(rem); continue; }
    if (SERVICE_RE.test(rem) && !DEFECT_RE.test(rem)) { u.service = u.service ? `${u.service} ; ${rem}` : rem; continue; }
    if (DEFECT_RE.test(rem)) { u.defects.push(rem); continue; }
    if (!GEARBOX_FALSE.test(rem)) {
      if (GEARBOX_LINE.test(rem)) { u.gearbox = 'AUTOMATIQUE'; if (/\b(dsg|dct|cvt|e-?cvt|eat\d|edc|s-?tronic|steptronic|tiptronic|powershift)\b/i.test(rem)) u.options.push(rem); continue; }
      if (GEARBOX_MANUAL_LINE.test(rem)) { u.gearbox = 'MANUELLE'; continue; }
    }
    // 4. Le reste : options (une par ligne ; une ligne à virgules en porte plusieurs).
    const parts = rem.includes(',') ? rem.split(',').map(clean).filter(Boolean) : [rem];
    u.options.push(...parts);
  }
  if (!u.brand) return null;
  return u;
}

/** Toutes les unités d'un texte collé (une ou plusieurs à la suite). */
export function parseSingleUnits(text: string): SingleUnit[] {
  return splitUnits(text).map(parseSingleUnit).filter((u): u is SingleUnit => !!u);
}

export const UNIT_SERVICE_KEY = 'Entretien';
export const UNIT_DEFECTS_KEY = 'Défauts';
export const UNIT_CONDITIONS_KEY = 'Conditions';
export const UNIT_OPTIONS_KEY = 'Options';

/** Ligne de l'offre : les critères (marque, modèle, 1re immat., km, VIN, CO2, prix) et les options en colonne libre. */
export function unitToVehicle(u: SingleUnit, id?: string): OfferVehicle {
  const extras: Record<string, string> = {};
  // Options en colonne libre (12/11 : plus d'inspection MC Export pour les unités, le dossier photos suffit).
  if (u.options.length) extras[UNIT_OPTIONS_KEY] = u.options.join(' · ');
  if (u.service) extras[UNIT_SERVICE_KEY] = u.service;
  if (u.defects.length) extras[UNIT_DEFECTS_KEY] = u.defects.join(' ; ');
  if (u.price_note) extras[UNIT_CONDITIONS_KEY] = u.price_note;
  return {
    id: id ?? (u.vin ? `unit-${u.vin}` : `unit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
    vin: u.vin, brand: u.brand, model: u.model, version: u.title, reg_date: u.reg_date, year: u.year, km: u.km, color: u.color,
    fuel: u.fuel, engine: u.engine, power_ch: u.power_ch, gearbox: u.gearbox, co2: u.co2, damages: null, report_url: null, location: null,
    // Le prix annoncé est NOTRE prix (unité présentée au client) : prix de vente MC Export, pas prix fournisseur.
    price_ht: null, price_ttc: null, vat_recoverable: null, imported: null, extras, selected: true,
    sale_price: u.price, quantity: 1,
  };
}

/** Champs de l'inspection « façon MC Export » : la fiche montre les options (équipements), l'entretien, les défauts. */
export function unitToInspectionFields(u: SingleUnit): FycReportFields {
  const raw: Record<string, string> = { source: 'single unit', title: u.title };
  if (u.co2 != null) raw.co2 = `${u.co2} g/km`;
  if (u.service) raw.service_history = u.service;
  if (u.price_note) raw.price_note = u.price_note;
  return {
    report_number: null, report_date: new Date().toISOString().slice(0, 10), vin: u.vin,
    brand: u.brand, model: u.model, version: u.version || null, body: null,
    first_registration: u.reg_date, year: u.year, km: u.km, asking_price: null, repair_cost: null,
    fuel: u.fuel, gearbox: u.gearbox, power_ch: u.power_ch, color: u.color, doors: null, seats: null, repainted: null,
    damages: { devaluation: u.defects.map((raw) => ({ zone: '', kind: '', action: '', raw })), usage: [] },
    equipment: [...u.options], tyres: [], raw_fields: raw,
  };
}
