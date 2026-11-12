/**
 * FYC — LECTURE D'UN RAPPORT D'INSPECTION (10/11). Partie pure : des lignes de texte (PDF VTI / Macadam, en
 * français ou en anglais) → les champs de la voiture et les dommages. Testée hors navigateur sur le rapport
 * Cupra Born n° 11145241 (texte anglais du PDF et texte français de la visionneuse).
 *
 * Les rapports mettent l'intitulé et la valeur sur la même ligne (« Make: Cupra ») ou sur deux lignes
 * (« Marque » puis « Cupra ») : les deux formes sont lues.
 */
export interface FycDamage { zone: string; kind: string; action: string; raw: string }
/** Une ligne de texte avec, si on l'a, ses morceaux et leur abscisse (pdfjs) : sert à séparer deux colonnes. */
export type FycLine = string | { text: string; frags?: Array<{ x: number; s: string }> };
export interface FycReportFields {
  report_number: string | null; report_date: string | null; vin: string | null;
  brand: string | null; model: string | null; version: string | null; body: string | null;
  first_registration: string | null; year: number | null; km: number | null;
  /** Prix demandé par la plateforme (VWFS « Prix de vente ») et frais de remise en état chiffrés, s'ils figurent. */
  asking_price: number | null; repair_cost: number | null;
  fuel: string | null; gearbox: string | null; power_ch: number | null; color: string | null;
  doors: number | null; seats: number | null; repainted: boolean | null;
  damages: { devaluation: FycDamage[]; usage: FycDamage[] };
  /** Équipements listés par le rapport (section « Vehicle Equipment »), un libellé par entrée. */
  equipment: string[];
  /** Pneus montés : une ligne par roue (« Continental Front Left Summer … 215/50 R 19 93 T 3.7 mm »). */
  tyres: string[];
  raw_fields: Record<string, string>;
}

type Rule = { key: keyof FycReportFields | 'order_date' | 'power_raw' | 'repaint_raw' | 'model_type' | 'asking_raw' | 'repair_raw' | 'model_year'; re: RegExp };
const RULES: Rule[] = [
  { key: 'report_number', re: /^(?:Report number|N[°o]\s*de rapport|Assessment Number)\s*:?/i },
  { key: 'order_date', re: /^(?:Order completed|Inspecté le|Date d'inspection)\s*:?/i },
  { key: 'vin', re: /^(?:VIN|N[°o]\s*de ch[aâ]ssis|Chassis number|Fahrgestellnummer|Numéro d'identification du véhicule|Vehicle identification number)\s*:?/i },
  // GIS@WEB (VWFS, export .docx, 10/11 soir) : prix demandé par la plateforme et frais de remise en état chiffrés.
  { key: 'asking_raw', re: /^(?:Prix de vente|Sale price|Verkaufspreis|Prijs)\s*:?/i },
  { key: 'repair_raw', re: /^(?:Frais remise en état|Frais de remise en état|Repair costs?|Instandsetzungskosten|Reconditioning costs?)\s*:?/i },
  { key: 'model_year', re: /^(?:Année modèle|Model year|Modelljahr)\s*:?/i },
  { key: 'brand', re: /^(?:Make|Marque|Merk|Marke)\s*:?/i },
  { key: 'model', re: /^(?:Model|Modèle|Modell)\s*:?/i },
  { key: 'model_type', re: /^(?:Manufacturers and type code|HSN\s*\/\s*TSN)\s*:?/i },
  { key: 'body', re: /^(?:Vehicle type|Type de carrosserie|Body type|Carrosserie)\s*:?/i },
  { key: 'first_registration', re: /^(?:Date of first registration|Date de 1[èe]re immatriculation|Première immatriculation|First registration|1[èe]re MEC|Erstzulassung)\s*:?/i },
  { key: 'km', re: /^(?:Mileage|Kilométrage(?: selon le compteur)?|Kilometerstand)(?!\s*estim)\s*:?/i },
  { key: 'fuel', re: /^(?:Fuel|Carburant|Énergie|Energie|Brandstof)\s*:?/i },
  { key: 'gearbox', re: /^(?:Gearbox|Boîte de vitesses?|Transmission|Getriebe)\s*:?/i },
  { key: 'power_raw', re: /^(?:Performance|Puissance(?: CV DIN)?|Power|Leistung)\s*:?/i },
  { key: 'color', re: /^(?:Exterior colou?r|Couleur extérieure|Couleur du fabricant|Manufacturer colou?r)\s*:?/i },
  { key: 'doors', re: /^(?:Number of doors|Nombre de portes|Nb\.? portes)\s*:?/i },
  { key: 'seats', re: /^(?:Number of seats|Nombre de sièges|Nombre de places|Nb\.? Places)\s*:?/i },
  { key: 'repaint_raw', re: /^(?:Repainting present|Peinture refaite|Repeinte|Présence de repeinture|Traces de peinture)\s*:?/i },
];
const ANY_LABEL = /^[A-Za-zÀ-ÿ'’/ ()°.-]{3,60}\s*:\s*$/;
const SECTION = /^»\s*(.+)$/;
const DEVAL_HEAD = /^(?:DEVALUATION FACTORS|Devaluation Damages|FACTEURS DE DÉVALUATION|Dommages de dévaluation|Dégâts de dévaluation)/i;
const USAGE_HEAD = /^(?:USAGE DAMAGES|Usage damages|DOMMAGES D'USAGE|Dommages d'usage|Dégâts d'usage)/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const num = (s: string | null): number | null => { if (!s) return null; const m = s.replace(/[\s  .,](?=\d{3}\b)/g, '').match(/\d+/); return m ? Number(m[0]) : null; };
const isoDate = (s: string | null): string | null => { const m = (s ?? '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };

const PAGE_NOISE = /^(Page \d+ of \d+|Macadam|Assessment Number|From:|- Vehicle Inspection Report|Rapport d'inspection|N[°o] de rapport|Du:|VIN:)/i;
// La section équipements n'a pas toujours son titre « » » dans le texte du PDF : la ligne « "Basic" Equipment options
// subset for … » (ou « Équipement du véhicule ») l'ouvre aussi.
const EQUIP_HEAD = /^(?:»\s*)?(?:Vehicle Equipment|Équipement du véhicule|Equipement du vehicule|Ausstattung|"?(?:Basic|Base|Standard)"?\s+Equipment options subset|Options VO|Équipements de série|Serienausstattung)$/i;
const TYRES_HEAD = /^(?:»\s*)?(Tyres|Pneus|Pneumatiques|Reifen|Banden)$/i;
const ANY_SECTION = /^(?:»|Données générales|Emissions|Frais remise en état|Remarques|Prix de vente|Options VO|Pneus$)/i;

export function parseFycReport(input: FycLine[]): FycReportFields {
  const src = input.map((l) => (typeof l === 'string' ? { text: clean(l), frags: undefined } : { text: clean(l.text), frags: l.frags })).filter((l) => l.text);
  const lines = src.map((l) => l.text);
  // Équipements : la section est sur DEUX colonnes ; avec les abscisses (pdfjs) chaque morceau va dans sa colonne,
  // une ligne qui commence en minuscule prolonge l'entrée précédente de sa colonne.
  const equipment: string[] = [];
  const tyres: string[] = [];
  { let inEq = false, inTy = false; const cols: [string[], string[]] = [[], []]; let mid: number | null = null;
    let lastHead = '';
    for (const l of src) {
      if (/^»/.test(l.text) || EQUIP_HEAD.test(l.text) || TYRES_HEAD.test(l.text) || ANY_SECTION.test(l.text)) { inEq = EQUIP_HEAD.test(l.text); inTy = TYRES_HEAD.test(l.text); lastHead = l.text; continue; }
      if (PAGE_NOISE.test(l.text)) continue;
      // ÉQUIPEMENTS SANS EN-TÊTE (12/11, Audi Q5 VTI 11247824) : certains rapports enchaînent la liste sur deux colonnes
      // juste après « Documents & Maintenance », sans « » Vehicle Equipment » — une ligne à deux morceaux sans « : »
      // à cet endroit ouvre la section.
      if (!inEq && !inTy && /Documents|Maintenance|Vehicle Data/i.test(lastHead) && (l.frags ?? []).filter((f) => f.s.trim()).length === 2 && !l.text.includes(':')) inEq = true;
      if (inTy) {
        if (/^(Permitted|Roadworthy|SPARE|Toolkit|Autoris|Roulable|Trousse)/i.test(l.text)) { inTy = false; continue; }
        if (/\d{3}\/\d{2}\s*R\s*\d{2}/.test(l.text) && /\d+([.,]\d)?\s*mm\b/.test(l.text)) tyres.push(l.text);
        continue;
      }
      if (!inEq) continue;
      if (/^"?(Basic|Base|Standard)"?\s|Equipment options subset|^"CARGO"|^"Base"|^NaN$/i.test(l.text)) continue;
      const frags = (l.frags ?? []).filter((f) => f.s.trim());
      if (frags.length >= 1) {
        if (mid == null) { const xs = src.filter((m) => m.frags).flatMap((m) => m.frags!.map((f) => f.x)); const lo = Math.min(...xs), hi = Math.max(...xs); mid = lo + (hi - lo) * 0.45; }
        for (const f of frags) {
          const col = f.x < mid ? 0 : 1; const t = f.s.trim();
          if (/^[a-zà-ÿ(]/.test(t) && cols[col].length) cols[col][cols[col].length - 1] += ` ${t}`; else cols[col].push(t);
        }
      } else if (/^[a-zà-ÿ(]/.test(l.text) && cols[0].length) cols[0][cols[0].length - 1] += ` ${l.text}`; else cols[0].push(l.text);
    }
    equipment.push(...cols[0], ...cols[1]);
    // Tableau de pneus à une valeur par ligne (export VWFS) : une taille suivie d'une profondeur de gomme.
    if (tyres.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        if (!/^\d{3}\/\d{2}\s*R\s*\d{2}/.test(lines[i]) || !/^\d+([.,]\d+)?\s*mm$/i.test(lines[i + 1] ?? '')) continue;
        const before = lines.slice(Math.max(0, i - 2), i).filter((x) => /^(Avant|Arrière|Front|Rear|Gauche|Droite?|Left|Right|Vorne|Hinten|Links|Rechts)$/i.test(x));
        const after = lines.slice(i + 2, i + 5).filter((x) => x && x !== 'NaN' && !/^\d{3}\/\d{2}/.test(x) && !/^(Avant|Arrière|Front|Rear|Gauche|Droite?|Left|Right)$/i.test(x));
        tyres.push([...before, lines[i], lines[i + 1], ...after].join(' '));
      }
    }
  }
  const L = lines;
  const raw: Record<string, string> = {};
  const got: Partial<Record<Rule['key'], string>> = {};
  const NUMERIC = new Set(['km', 'power_raw', 'doors', 'seats', 'asking_raw', 'repair_raw', 'model_year']);
  const valueAt = (i: number, re: RegExp, key?: Rule['key']): string => {
    const same = L[i].replace(re, '').trim();
    if (same && !(key && NUMERIC.has(key) && !/\d/.test(same))) return same;
    // Prix affiché AVANT son libellé (export VWFS : « 25 820,00 € » puis « Prix de vente »).
    if (key === 'asking_raw' && /\d/.test(L[i - 1] ?? '') && /€|EUR/i.test(L[i - 1] ?? '')) return L[i - 1];
    // Valeur sur la ligne suivante, sauf si c'est un autre intitulé.
    const next = L[i + 1] ?? '';
    if (!next || ANY_LABEL.test(next) || RULES.some((r) => r.re.test(next)) || SECTION.test(next) || /^Page \d+ of \d+/i.test(next)) return '';
    return next;
  };
  let section = '';
  const dev: FycDamage[] = []; const use: FycDamage[] = [];
  let list: FycDamage[] | null = null;
  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    const sec = line.match(SECTION);
    if (sec) { section = sec[1]; list = /Devaluation Damages|dévaluation/i.test(section) ? dev : null; continue; }
    if (DEVAL_HEAD.test(line)) { list = dev; continue; }
    if (USAGE_HEAD.test(line)) { list = use; continue; }
    if (list) {
      const d = line.match(/^(\d{1,3})\s*-\s*(.+)$/);
      if (d) {
        const parts = d[2].split(/\s+-\s+/).map((x) => x.trim());
        list.push({ zone: parts[0] ?? '', kind: parts[1] ?? '', action: parts.slice(2).join(' - '), raw: d[2] });
        continue;
      }
      if (/^Page \d+ of \d+/i.test(line) || /^Macadam|^Assessment Number|^From:|^- Vehicle Inspection Report|^Rapport d'inspection|^N[°o] de rapport|^Du:/i.test(line)) continue;
    }
    for (const r of RULES) {
      if (got[r.key] != null) continue;
      if (r.re.test(line)) {
        const v = valueAt(i, r.re, r.key);
        // Un kilométrage ou une puissance sans chiffre n'est pas une valeur (légende de photo « Kilométrage »).
        if (v && !((r.key === 'km' || r.key === 'power_raw' || r.key === 'doors' || r.key === 'seats') && !/\d/.test(v))) { got[r.key] = v; raw[r.key] = v; }
        break;
      }
    }
  }
  const power = got.power_raw ?? '';
  const ps = power.match(/(\d{2,4})\s*(?:PS|CV|ch|hp)/i)?.[1];
  const kw = power.match(/(\d{2,4})\s*kW/i)?.[1];
  const reg = isoDate(got.first_registration ?? null);
  const money = (v: string | undefined): number | null => { if (!v) return null; const m = v.replace(/\s|\u202f|\u00a0/g, '').match(/\d[\d.]*(?:,\d{1,2})?/); if (!m) return null; const n = Number(m[0].replace(/\.(?=\d{3})/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
  const modelYear = num(got.model_year ?? null);
  const repaint = got.repaint_raw ?? null;
  const titleish = `${got.model ?? ''} ${got.model_type ?? ''}`;
  const gearboxGuess = got.gearbox ?? (/s[- ]?tronic|dsg|automat|tiptronic|multitronic|steptronic|cvt|edc|dct|eat\d|bva/i.test(titleish) ? 'Automatique' : /manual|manuelle|schalt|bvm/i.test(titleish) ? 'Manuelle' : null);
  const firstLine = L[0] ?? '';
  return {
    report_number: got.report_number ?? (/^\d{6,12}$/.test(firstLine) ? firstLine : null),
    report_date: isoDate(got.order_date ?? null),
    vin: (got.vin ?? '').match(/[A-HJ-NPR-Z0-9]{17}/i)?.[0]?.toUpperCase() ?? null,
    brand: got.brand ?? null,
    model: shortModel(got.model ?? null, got.brand ?? null),
    version: got.model_type ?? null,
    body: got.body ?? null,
    first_registration: reg,
    year: reg ? Number(reg.slice(0, 4)) : (modelYear != null && modelYear >= 1980 && modelYear <= 2100 ? modelYear : null),
    asking_price: money(got.asking_raw), repair_cost: money(got.repair_raw),
    km: num(got.km ?? null),
    fuel: got.fuel ?? null,
    gearbox: gearboxGuess,
    power_ch: ps ? Number(ps) : kw ? Math.round(Number(kw) * 1.36) : null,
    color: got.color ?? null,
    doors: num(got.doors ?? null),
    seats: num(got.seats ?? null),
    repainted: repaint == null ? null : /^(yes|oui|ja)/i.test(repaint) ? true : /^(no|non|nein)/i.test(repaint) ? false : null,
    damages: { devaluation: dev, usage: use },
    equipment: equipment.map((e) => e.replace(/\s+/g, ' ').trim()).filter((e) => e.length > 2),
    tyres,
    raw_fields: raw,
  };
}

/** « Audi Audi Q3 Sportback S line 1.4 45 TFSI e 180kW … » (VWFS) → « Q3 Sportback » : la marque répétée est retirée,
 *  le modèle s'arrête avant la finition / motorisation (chiffre, kW, TFSI…), 3 mots au plus. */
export function shortModel(model: string | null, brand: string | null): string | null {
  if (!model) return null;
  let m = model.trim();
  const b = (brand ?? '').trim();
  if (b) { const re = new RegExp(`^(?:${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+)+`, 'i'); m = m.replace(re, ''); }
  if (m.split(/\s+/).length <= 3) return m;
  const words = m.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (out.length && (/^\d/.test(w) || /kw|tfsi|tsi|tdi|hdi|dci|e-tech|hybrid|line$|edition|sport$|business/i.test(w) || (/^(S|RS|R|GT|N)$/i.test(w) && /^line$/i.test(words[i + 1] ?? '')))) break;
    out.push(w);
    if (out.length === 3) break;
  }
  return out.join(' ') || m;
}

/** Résumé court des dommages (pastilles) : « 4 pneus à remplacer », « 1 jante à retoucher »… */
export function damageSummary(d: FycReportFields['damages']): string[] {
  const out: string[] = [];
  const tyres = d.devaluation.filter((x) => /tyre|pneu|reifen|band/i.test(x.zone)).length;
  const rims = d.devaluation.filter((x) => /\b(rims?|jantes?|felgen?|velgen?)\b/i.test(x.zone)).length; // \b : « Wing trim » n'est pas une jante
  const bodyDev = d.devaluation.length - tyres - rims;
  if (tyres) out.push(`${tyres} pneu${tyres > 1 ? 's' : ''} à remplacer`);
  if (rims) out.push(`${rims} jante${rims > 1 ? 's' : ''} à retoucher`);
  if (bodyDev > 0) out.push(`${bodyDev} dommage${bodyDev > 1 ? 's' : ''} de dévaluation`);
  if (d.usage.length) out.push(`${d.usage.length} trace${d.usage.length > 1 ? 's' : ''} d'usage`);
  if (!out.length) out.push('rien à signaler');
  return out;
}
