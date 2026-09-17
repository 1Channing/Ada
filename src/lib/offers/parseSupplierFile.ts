/**
 * OFFRES FOURNISSEUR — lecture et NORMALISATION d'un fichier fournisseur
 * (décision Channing 14/09 : « chaque fichier est différent, il faut pouvoir
 * normaliser naturellement pour y remettre notre DA, nos marges, notre logo »).
 *
 * Deux jeux d'essai réels du 14/09 :
 *   - fournisseur allemand : un tableau plat, une ligne par voiture, VIN,
 *     marque/modèle/version en colonnes, prix « Proposal » HT ;
 *   - MeltingCars : 13 blocs par marque (une cellule seule en majuscules),
 *     en-tête répétée et VARIABLE d'un bloc à l'autre (PRIX HT absent de
 *     certains blocs), modèle + motorisation + finition + boîte dans UNE
 *     cellule libre, prix TTC, colonnes TVA / IMPORT / frais de remise en état.
 *
 * Principe : tout est DÉTERMINISTE et visible. Les colonnes sont reconnues
 * par synonymes, l'utilisateur voit et corrige la correspondance ; la ligne
 * libre « MODELE » est décomposée par des règles lisibles (puissance, boîte,
 * carburant) et le modèle est rapproché du référentiel ADA quand il existe.
 * Rien n'est inventé : ce qui n'est pas lu reste vide et se voit.
 */
import * as XLSX from 'xlsx';

export type OfferField =
  | 'vin' | 'brand' | 'model' | 'version' | 'reg_date' | 'km' | 'color' | 'fuel' | 'engine' | 'power'
  | 'gearbox' | 'co2' | 'damages' | 'report_url' | 'location' | 'price_ht' | 'price_ttc' | 'vat' | 'import' | 'plate' | 'ignore';

export const OFFER_FIELD_LABELS: Record<OfferField, string> = {
  vin: 'VIN / châssis', brand: 'Marque', model: 'Modèle', version: 'Version / ligne libre', reg_date: '1re immatriculation',
  km: 'Kilométrage', color: 'Couleur', fuel: 'Énergie', engine: 'Motorisation', power: 'Puissance (ch)', gearbox: 'Boîte',
  co2: 'CO₂ (g/km)', damages: 'Dommages / frais (€)', report_url: 'Rapport (lien)', location: 'Lieu de stockage',
  price_ht: 'Prix fournisseur HT (€)', price_ttc: 'Prix fournisseur TTC (€)', vat: 'TVA récupérable', import: 'Import', plate: 'Immatriculation (plaque)', ignore: '— ignorer —',
};

/** En-tête normalisé : minuscules, sans diacritiques ni ponctuation superflue. */
const normHeader = (h: string) => h.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[()€:.]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Synonymes d'en-tête → champ, testés sur l'en-tête normalisé et en
 * « contient » (troisième fichier réel, FCM Export 14/09 : « No. de
 * chassis », « 1ière immatriculation », « Wholesale local (ttc) »,
 * « Exportation Netto € », « Site de stockage » n'étaient pas reconnus par
 * des règles en « commence par »). Ordre = priorité, le premier gagne.
 */
const HEADER_RULES: Array<[OfferField, RegExp]> = [
  ['vin', /\b(vin|vh ?code|ch[aâ]ssis|chassis|fahrgestell|serial|n[o°] ?de ?serie)\b/],
  ['reg_date', /(reg ?date|date ?mec|\bmec\b|mise en circ|1 ?i?[eè]?re? ?immat|first ?reg|erstzulassung|\bez\b|immatriculation)/],
  ['plate', /(\bimmat|plaque|\bplate\b|kennzeichen|registration)/],
  ['km', /(\bkm\b|kilom|mileage|kilometer)/],
  ['co2', /co2/],
  // Dommages AVANT les prix : « ESTIMATION FRE HT » (MeltingCars) contient « ht ».
  ['damages', /(damage|dommage|\bfre\b|frais|remise en etat|schaden)/],
  ['price_ht', /(proposal|\bht\b|\bnett?o?\b|export)/],
  ['price_ttc', /(\bttc\b|wholesale|public|gross|\bprix\b|\bprice\b|\bpreis\b)/],
  ['report_url', /(appraisal|rapport|report|inspection|expertise|dekra|\burl\b|\blien\b)/],
  ['color', /(colou?r|couleur|farbe|teinte)/],
  ['fuel', /(energy|energie|carburant|fuel|kraftstoff)/],
  ['engine', /^(engine|moteur|motorisation|motor)$/],
  ['power', /(power|puissance|^ch$|^cv$|^kw$|^hp$|^ps$|leistung)/],
  ['gearbox', /(gearbox|boite|transmission|getriebe|^bv$)/],
  ['location', /(location|\blieu\b|stock|storage|standort|depot|\bparc\b|\bsite\b)/],
  ['vat', /(\btva\b|\bvat\b|mwst)/],
  ['import', /(\bimport|origine|origin)/],
  ['brand', /(brand|marque|\bmake\b|\bmarke\b|constructeur)/],
  ['model', /^(model|modele)$/],
  ['version', /(version|modele|designation|description|variante|ausfuhrung|vehicule|vehicle)/],
];

/** Énergies telles qu'ADA les nomme (les fichiers parlent anglais, allemand, français). */
const FUEL_CANON: Array<[RegExp, string]> = [
  [/plug|rechargeable|phev|e-?tense 4x4/i, 'HYBRIDE RECHARGEABLE'],
  [/hybr|mhev|bsg/i, 'HYBRIDE'],
  [/electr|elektr|\bev\b|bev/i, 'ELECTRIQUE'],
  [/diesel|gasoil|gazole/i, 'DIESEL'],
  [/petrol|essence|benzin|gasoline|super/i, 'ESSENCE'],
  [/gpl|lpg/i, 'GPL'],
];
export function canonFuel(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  for (const [re, canon] of FUEL_CANON) if (re.test(s)) return canon;
  return s.toUpperCase();
}

export interface OfferVehicle {
  id: string;                 // stable dans le fichier (VIN sinon rang)
  vin: string | null;
  brand: string;
  model: string;
  version: string;            // ligne libre d'origine (jamais perdue)
  reg_date: string | null;    // ISO AAAA-MM-JJ
  year: number | null;
  km: number | null;
  color: string | null;
  fuel: string | null;
  engine: string | null;
  power_ch: number | null;
  gearbox: string | null;
  co2: number | null;
  damages: number | null;
  report_url: string | null;
  location: string | null;
  price_ht: number | null;
  price_ttc: number | null;
  vat_recoverable: boolean | null;
  imported: boolean | null;
  extras: Record<string, string>;   // colonnes non reconnues, gardées telles quelles
  selected: boolean;
  sale_price: number | null;        // prix MC Export HT (règle appliquée, modifiable)
}

export interface ColumnMapping { header: string; field: OfferField; sample: string }

export interface ParsedSupplierFile {
  sheet: string;
  layout: 'flat' | 'blocks';
  mappings: ColumnMapping[];          // union des en-têtes vues (blocs compris)
  vehicles: OfferVehicle[];
  warnings: string[];
  /** Grille brute de la feuille (cellules JSON : dates en ISO) — conservée
   *  dans l'offre pour que la correspondance des colonnes reste modifiable
   *  après réouverture (constat Channing 17/09 : « rien ne se passe »). */
  grid: unknown[][];
}

/** Grille JSON-sûre : dates → « AAAA-MM-JJ », lignes vides de fin retirées. */
export function readSupplierGrid(buf: ArrayBuffer): { sheet: string; grid: unknown[][] } {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.SheetNames[0];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null }) as unknown[][];
  const grid = raw.map((r) => r.map((c) => (c instanceof Date ? (Number.isNaN(c.getTime()) ? null : c.toISOString().slice(0, 10)) : c)));
  while (grid.length && grid[grid.length - 1].every((c) => c == null || c === '')) grid.pop();
  return { sheet, grid };
}

const cell = (v: unknown): string => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/\s|€| /g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '');
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && s !== '' ? n : null;
}

function toIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})[/.-](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-01`;
  return null;
}

const yesNo = (v: unknown): boolean | null => {
  const s = cell(v).toLowerCase();
  if (!s) return null;
  if (/^(oui|yes|ja|y|o|true|1|x)$/.test(s)) return true;
  if (/^(non|no|nein|n|false|0)$/.test(s)) return false;
  return null;
};

export function guessField(header: string): OfferField {
  const h = normHeader(header);
  if (!h) return 'ignore';
  for (const [field, re] of HEADER_RULES) if (re.test(h)) return field;
  return 'ignore';
}

/**
 * Marque depuis une ligne libre qui commence par elle (« BMW SERIE 2 218i… »,
 * « CITROËN C3 Aircross… », « ALFA ROMEO TONALE… ») : la plus longue marque
 * connue du référentiel qui ouvre la ligne ; sinon le premier mot. Rend la
 * marque et le reste de la ligne.
 */
export function splitBrand(line: string, knownBrands: string[]): { brand: string; rest: string } {
  const norm = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const up = norm(line);
  const candidates = [...new Set(knownBrands.map(norm).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const b of candidates) {
    if (up === b || up.startsWith(`${b} `) || up.startsWith(`${b}-`)) return { brand: b, rest: line.trim().slice(b.length).replace(/^[\s-]+/, '') };
  }
  const first = up.split(' ')[0] ?? '';
  return { brand: first, rest: line.trim().split(/\s+/).slice(1).join(' ') };
}

/** Décomposition d'une ligne libre « 600 T-GEN3 1.2 HYBRID TURBO 145CH PACK BVA » — règles lisibles, rien de deviné au-delà. */
export function parseFreeLine(line: string): { power_ch: number | null; gearbox: string | null; fuel: string | null; engine: string | null } {
  const s = ` ${line} `;
  const p = s.match(/(\d{2,3})\s?(?:ch|cv|hp|ps)\b/i);
  const kw = s.match(/(\d{2,3})\s?kw\b/i);
  const power_ch = p ? Number(p[1]) : kw ? Math.round(Number(kw[1]) * 1.36) : null;
  // « AT-8 » / « MT-6 » (fichiers allemands), « Automatik », « BVA »…
  const gearbox = /\b(bva|automati(que|c|k)|automaat|dct\d?|eat\d|e-?dcs?\d?|edc|cvt|dsg|s-?tronic|steptronic|multitronic|xtronic|automat|at-?\d)\b/i.test(s) ? 'AUTOMATIQUE'
    : /\b(bvm\d?|manuel(le)?|manual|schalt|mt-?\d)\b/i.test(s) ? 'MANUELLE' : null;
  const fuel = /\b(phev|plug-?in|e-?tense 4x4|rechargeable)\b/i.test(s) ? 'HYBRIDE RECHARGEABLE'
    : /\b(hybrid|hybride|e-?tech|e-?power|mhev|bsg)\b/i.test(s) ? 'HYBRIDE'
    : /\b([ée]lectri(que|c)|ev|e-?208|e-?2008|electric|kwh)\b/i.test(s) ? 'ELECTRIQUE'
    : /\b(diesel|hdi|bluehdi|dci|tdi|cdi|crdi|d\b|multijet)/i.test(s) ? 'DIESEL'
    : /\b(essence|petrol|benzin|puretech|tce|tsi|tfsi|turbo|1\.[0-9]|dig-t)\b/i.test(s) ? 'ESSENCE' : null;
  const e = s.match(/\b(\d\.\d\s?(?:turbo|puretech|tce|tsi|hybrid|hdi|bluehdi|dci|e-?hybrid|t\d)?[^,|]{0,20}?)(?=\s\d{2,3}\s?(?:ch|cv|kw)|$)/i);
  return { power_ch, gearbox, fuel, engine: e ? e[1].trim() : null };
}

/**
 * Marqueur de GÉNÉRATION en fin de modèle fournisseur (constat Channing 17/09 :
 * « ASTRA L » cherché tel quel → page introuvable, lot faussé) : lettre seule
 * (Astra J/K/L, Corsa F, Mokka B), chiffre romain (Clio V, Golf VIII, 308 III)
 * ou chiffre seul (Golf 8, Polo 6). Jamais quand le premier mot est un
 * préfixe de gamme où ce jeton EST le modèle (Classe A, Model 3, Série 1,
 * DS 7, ID 3), ni sur un modèle d'un seul jeton (X1, Q5, 308).
 */
const RANGE_PREFIXES = new Set(['CLASSE', 'CLASS', 'KLASSE', 'MODEL', 'SERIE', 'SERIES', 'DS', 'ID', 'TYPE', 'TYPO', 'RANGE']);
export function stripGenerationSuffix(model: string): string {
  const tokens = model.toUpperCase().replace(/\s+/g, ' ').trim().split(' ');
  if (tokens.length < 2 || RANGE_PREFIXES.has(tokens[0])) return tokens.join(' ');
  const last = tokens[tokens.length - 1];
  if (/^[A-Z]$/.test(last) || /^(I{1,3}|IV|VI{0,3}|IX|X)$/.test(last) || /^[1-9]$/.test(last)) return tokens.slice(0, -1).join(' ');
  return tokens.join(' ');
}

/**
 * Modèle depuis une ligne libre, rapproché des modèles connus de la marque
 * (référentiel ADA + taxonomie moissonnée) — le plus long libellé qui
 * commence la ligne gagne ; sans référentiel, les premiers jetons avant la
 * cylindrée/puissance, marqueur de génération retiré.
 */
export function guessModel(_brand: string, line: string, knownModels: string[]): string {
  const up = line.toUpperCase().replace(/\s+/g, ' ').trim();
  const candidates = [...knownModels].map((m) => m.toUpperCase()).sort((a, b) => b.length - a.length);
  for (const m of candidates) {
    if (up === m || up.startsWith(`${m} `)) return m;
  }
  // « NOUVEAU 5008 … », « NEW DOBLO … » : sauter le mot de nouveauté.
  const stripped = up.replace(/^(NOUVEAU|NOUVELLE|NEW|NEUE?)\s+/, '');
  for (const m of candidates) if (stripped.startsWith(`${m} `) || stripped === m) return m;
  const tokens = stripped.split(' ');
  const out: string[] = [];
  for (const t of tokens) {
    if (/^\d\.\d$/.test(t) || /^\d{2,3}(CH|CV|KW)$/.test(t) || /^(HYBRID|HYBRIDE|PHEV|DIESEL|ESSENCE|TURBO|PURETECH|TCE|TSI|BLUEHDI|HDI|DCI|E-TECH|MILD|ELECTRIQUE)/.test(t)) break;
    out.push(t);
    if (out.length >= 2) break;
  }
  const guess = out.join(' ') || up.split(' ')[0];
  const base = stripGenerationSuffix(guess);
  // Génération retirée seulement si le résultat est connu, ou si rien n'est connu de la marque.
  return base !== guess && (candidates.length === 0 || candidates.includes(base)) ? base : guess;
}

/** Lit un classeur (ArrayBuffer) ou une grille déjà conservée, et rend les véhicules normalisés. */
export function parseSupplierWorkbook(input: ArrayBuffer | { sheet: string; grid: unknown[][] }, knownModelsByBrand: Record<string, string[]> = {}, mappingOverride?: Record<string, OfferField>): ParsedSupplierFile {
  const { sheet: sheetName, grid } = input instanceof ArrayBuffer ? readSupplierGrid(input) : input;
  const warnings: string[] = [];
  const isHeaderRow = (r: unknown[]) => r.filter((c) => typeof c === 'string' && c.trim()).length >= 5
    && r.filter((c) => c != null && c !== '').every((c) => typeof c === 'string');
  const isBlockTitle = (r: unknown[]) => {
    const filled = r.filter((c) => c != null && c !== '');
    return filled.length === 1 && typeof r[0] === 'string' && r[0].trim() === r[0].trim().toUpperCase() && r[0].trim().length <= 30 && /[A-Z]/.test(r[0]);
  };

  // Détection de structure : plusieurs en-têtes = blocs.
  const headerRows = grid.map((r, i) => (isHeaderRow(r) ? i : -1)).filter((i) => i >= 0);
  const layout: ParsedSupplierFile['layout'] = headerRows.length > 1 ? 'blocks' : 'flat';
  if (headerRows.length === 0) {
    return { sheet: sheetName, layout, mappings: [], vehicles: [], warnings: ["Aucune ligne d'en-tête reconnue (il faut au moins 5 intitulés de colonnes sur une ligne)."], grid };
  }

  const mappingsByHeader = new Map<string, ColumnMapping>();
  const vehicles: OfferVehicle[] = [];
  let currentBrand = '';
  let header: string[] | null = null;
  let fields: OfferField[] = [];

  for (let i = 0; i < grid.length; i++) {
    const r = grid[i] ?? [];
    if (isBlockTitle(r)) { currentBrand = String(r[0]).trim(); continue; }
    if (isHeaderRow(r)) {
      header = r.map((c) => cell(c));
      fields = header.map((h) => (mappingOverride && h in mappingOverride ? mappingOverride[h] : guessField(h)));
      continue;
    }
    if (!header) continue;
    const filled = r.filter((c) => c != null && c !== '');
    if (filled.length < 2) continue;
    // Une ligne de données : au moins une valeur dans une colonne reconnue.
    const rec: Partial<Record<OfferField, unknown>> = {};
    const extras: Record<string, string> = {};
    header.forEach((h, ci) => {
      const v = r[ci];
      if (v == null || v === '') return;
      const f = fields[ci];
      if (!h) return;
      if (!mappingsByHeader.has(h)) mappingsByHeader.set(h, { header: h, field: f, sample: cell(v).slice(0, 40) });
      if (f === 'ignore' || f === 'plate') { extras[h] = cell(v); return; }
      // Deux colonnes pour le même champ : la PREMIÈRE gagne (« Version » avant
      // « Trim »), la seconde est gardée en extras — rien n'est perdu.
      if (rec[f] != null) { extras[h] = cell(v); return; }
      rec[f] = v;
    });
    if (Object.keys(rec).length === 0) continue;
    if (layout === 'flat' && rec.brand == null && rec.model == null && rec.version == null && rec.vin == null) continue;

    let versionLine = cell(rec.version) || cell(rec.model) || '';
    let brand = cell(rec.brand) || currentBrand;
    if (!brand && versionLine) {
      const sp = splitBrand(versionLine, Object.keys(knownModelsByBrand));
      brand = sp.brand; versionLine = sp.rest || versionLine;
    }
    const known = knownModelsByBrand[brand.toUpperCase()] ?? knownModelsByBrand[brand.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()] ?? [];
    let model = cell(rec.model);
    // Colonne modèle du fournisseur (« ASTRA L », « DS 7 CROSSBACK / DS 7 »)
    // rapprochée des modèles connus (référentiel + taxonomie) et débarrassée
    // de son marqueur de génération ; sans colonne, la ligne libre est décomposée.
    if (!model || model === versionLine) model = guessModel(brand, versionLine || model, known);
    else model = guessModel(brand, model, known);
    const free = parseFreeLine(`${versionLine} ${cell(rec.engine)} ${cell(rec.gearbox)}`);
    const reg = toIsoDate(rec.reg_date);
    const power = toNumber(rec.power);
    const vin = cell(rec.vin) || null;
    if (!brand) warnings.push(`Ligne ${i + 1} : marque introuvable (${versionLine.slice(0, 40)}).`);
    if (warnings.length > 12) { warnings.length = 12; warnings.push('… (avertissements suivants masqués)'); }
    vehicles.push({
      id: vin ?? `row-${i + 1}`,
      vin,
      brand: brand.toUpperCase(),
      model: model.toUpperCase(),
      version: versionLine,
      reg_date: reg,
      year: reg ? Number(reg.slice(0, 4)) : null,
      km: toNumber(rec.km),
      color: cell(rec.color) || null,
      fuel: canonFuel(cell(rec.fuel)) ?? free.fuel,
      engine: cell(rec.engine) || free.engine,
      power_ch: power != null ? Math.round(power) : free.power_ch,
      gearbox: (cell(rec.gearbox) ? parseFreeLine(cell(rec.gearbox)).gearbox ?? cell(rec.gearbox).toUpperCase() : free.gearbox),
      co2: toNumber(rec.co2),
      damages: toNumber(rec.damages),
      report_url: cell(rec.report_url).startsWith('http') ? cell(rec.report_url) : null,
      location: cell(rec.location) || null,
      price_ht: toNumber(rec.price_ht),
      price_ttc: toNumber(rec.price_ttc),
      vat_recoverable: yesNo(rec.vat),
      imported: yesNo(rec.import),
      extras,
      selected: true,
      sale_price: null,
    });
  }
  if (vehicles.length === 0) warnings.push('Aucune ligne de véhicule lue sous les en-têtes reconnus.');
  const noPrice = vehicles.filter((v) => v.price_ht == null && v.price_ttc == null).length;
  if (noPrice) warnings.push(`${noPrice} véhicule(s) sans prix fournisseur (ni HT ni TTC) — à vérifier dans la correspondance des colonnes.`);
  return { sheet: sheetName, layout, mappings: [...mappingsByHeader.values()], vehicles, warnings, grid };
}

/** Prix fournisseur HT de référence : HT si présent, sinon TTC / (1 + TVA) quand la TVA est récupérable. */
export function supplierHt(v: OfferVehicle, vatRate = 0.2): number | null {
  if (v.price_ht != null) return Math.round(v.price_ht);
  if (v.price_ttc != null && v.vat_recoverable !== false) return Math.round(v.price_ttc / (1 + vatRate));
  return null;
}
