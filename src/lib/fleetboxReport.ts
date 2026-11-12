/**
 * RAPPORT D'ÉVALUATION DEKRA « FLEETBOX » (PDF, fleetbox.dekra-automotivesolutions.com/…/PDFDownloadHandlerSFT.ashx
 * ?PLID=…&l=it, 11/11, Channing : « apprends à lire ces inspections dans le FYC »). Module pur, partagé navigateur /
 * worker ; entrée = lignes pdf.js avec l'abscisse de leurs morceaux (src/lib/pdfText.ts).
 *
 * Deux pages : « dettagli veicolo » en trois colonnes libellé → valeur (VIN, 1re immatriculation, couleur, marque,
 * plaque, compteur, modèle + motorisation, état, pré-dommage et son montant), lieu d'inspection, dommages extérieurs
 * numérotés (élément / position / dommage / commentaire, deux par rangée), pneus (« PneumaticoPS Michelin 205/55/19"
 * V 5.0 Mm », code non traduit : P/A arrière/avant, S/D gauche/droite). Le paramètre l= sert la même page en it, fr,
 * en, de, es, nl, pt : le worker s'en sert pour traduire. Photos : vignettes 200×150 (extraites par pdfImages.ts).
 * Ni puissance ni énergie en clair : déduites de la ligne modèle (« 408 - Hybrid 225 e-EAT8 GT » → 408, hybride
 * rechargeable, 225 ch, automatique), marquées comme telles dans raw_fields.
 * Vérifié sur la Peugeot 408 VR3F3DGY6SY577168 dans les 7 langues (3 dommages « jante usinée », 4 pneus) et sur
 * l'Alfa Tonale ZARPATAW8S3100628 (12/11) : modèle sur deux lignes, pneus en grille 2 × 2 (« Goodyear 235/50/18 V
 * Estate 6.0 » + « mm » dessous), date « 01/01/1900 » et couleur « Inconnu » = absentes, dommage sans position ignoré.
 */
import type { FycReportFields, FycDamage, FycLine } from './fycReport';

type Line = { text: string; frags: Array<{ x: number; s: string }> };
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const asLines = (input: FycLine[]): Line[] => input.map((l) => (typeof l === 'string' ? { text: l, frags: [{ x: 0, s: l }] } : { text: l.text, frags: l.frags?.length ? l.frags : [{ x: 0, s: l.text }] }));

const L: Record<string, string[]> = {
  vin: ['VIN', 'Fahrgestell-Nr.', 'NIV', 'Chassisnr.'],
  reg: ['Data Immat.', 'Date', 'Registration date', 'Erstzulassung', 'Fecha matriculación', 'Inschrijvingsdatum', 'Data de matrícula'],
  color: ['Colore esterno', 'Couleur', 'Exterior Color', 'Außenfarbe', 'Color', 'Kleur', 'Cor exterior'],
  brand: ['Marca', 'Marque', 'Brand', 'Hersteller', 'Merk'],
  plate: ['Targa', 'Immatriculation', 'Licence Plate', 'Kennzeichen', 'Matrícula', 'Kenteken', 'Placa de matrícula'],
  km: ['Contachilometri', 'Odometre', 'Odometer', 'Laufleistung', 'Cuentakilómetros', 'Km stand', 'Conta-quilómetros'],
  model: ['Modello', 'Modèle', 'Model', 'Modell', 'Modelo'],
  condition: ['Condition of the car', 'Etat du véhicule', 'Fahrzeugzustand'],
  predamage: ['Pre-damage', 'Pré-dommage', 'Vorschaden'],
  amount: ['Montant pré-', 'Höhe Vorschaden'],
  comments: ['Commenti', 'Commentaires', 'Comments', 'Anmerkungen', 'Comentarios', 'Opmerkingen', 'Comentários', 'Commentaires pré-'],
  place: ['Ispezione loc.', 'Parc', 'Inspection loc.', 'Lagerplatz', 'Parque', 'Terminal', 'Local inspecção'],
  component: ['Componente', 'Elément', 'Part', 'Bauteil', 'Elemento', 'Onderdeel'],
  position: ['Posizione', 'Position', 'Posición', 'Positie', 'Posição'],
  damage: ['Danno', 'Dommages', 'Damages', 'Beschreibung', 'Daños', 'Type', 'Dano'],
};
const LABELS: Array<{ key: string; n: string }> = Object.entries(L).flatMap(([key, ls]) => ls.map((l) => ({ key, n: norm(l) }))).sort((a, b) => b.n.length - a.n.length);
/** Le libellé au début d'un morceau de texte, et ce qui le suit. */
function labelOf(s: string): { key: string; rest: string } | null {
  const n = norm(s);
  for (const l of LABELS) if (n === l.n || n.startsWith(`${l.n} `)) return { key: l.key, rest: s.trim().slice(l.n.length).trim() };
  return null;
}
/** Une ligne → ses paires libellé → valeur (un libellé ouvre une valeur, les morceaux suivants la complètent). */
function pairsOf(line: Line): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const f of line.frags) {
    const l = labelOf(f.s);
    if (l) out.push({ key: l.key, value: l.rest });
    else if (out.length) out[out.length - 1].value = `${out[out.length - 1].value} ${f.s}`.trim();
  }
  return out;
}

export function isFleetboxReport(input: FycLine[]): boolean {
  const t = asLines(input).map((l) => l.text).join('\n');
  return /Pre-damage|Pr[ée]-dommage|Vorschaden/i.test(t) && (/Pneumatico(?:PS|PD|AS|AD)\b/.test(t) || /Condition of the car|Etat du v[ée]hicule|Fahrzeugzustand/i.test(t));
}

const isoDate = (s: string | null) => { const m = (s ?? '').match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); if (!m || Number(m[3]) < 1980) return null; return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
const dash = (s: string | undefined | null) => { const v = (s ?? '').trim(); return !v || v === '-' || /^(inconnu|unknown|sconosciuto|desconocido|unbekannt|onbekend|desconhecido)$/i.test(v) ? null : v; };
const TYRE_POS: Record<string, string> = { AS: 'Avant gauche', AD: 'Avant droit', PS: 'Arrière gauche', PD: 'Arrière droit' };
/** Les positions de pneus dans la langue de la fiche (le PDF ne les traduit pas). */
export const FLEETBOX_TYRE_POS: Record<string, Record<string, string>> = {
  fr: TYRE_POS, en: { AS: 'Front left', AD: 'Front right', PS: 'Rear left', PD: 'Rear right' }, nl: { AS: 'Linksvoor', AD: 'Rechtsvoor', PS: 'Linksachter', PD: 'Rechtsachter' },
  de: { AS: 'Vorne links', AD: 'Vorne rechts', PS: 'Hinten links', PD: 'Hinten rechts' }, es: { AS: 'Delantero izquierdo', AD: 'Delantero derecho', PS: 'Trasero izquierdo', PD: 'Trasero derecho' },
  it: { AS: 'Anteriore sinistro', AD: 'Anteriore destro', PS: 'Posteriore sinistro', PD: 'Posteriore destro' }, pt: { AS: 'Frente esquerda', AD: 'Frente direita', PS: 'Trás esquerda', PD: 'Trás direita' },
  da: { AS: 'Forrest venstre', AD: 'Forrest højre', PS: 'Bagerst venstre', PD: 'Bagerst højre' }, sv: { AS: 'Fram vänster', AD: 'Fram höger', PS: 'Bak vänster', PD: 'Bak höger' },
};

/** Énergie, puissance et boîte lues dans la ligne modèle / motorisation (jamais inventées : null si rien ne le dit). */
export function engineHints(s: string): { fuel: string | null; power_ch: number | null; gearbox: string | null } {
  const t = s.toLowerCase();
  const fuel = /plug-?in|phev|e-eat8|e-dct|recharge|ibrida plug/.test(t) ? 'Hybride rechargeable' : /hybrid|hybride|ibrid|hev\b|e-tech/.test(t) ? 'Hybride' : /electri|elektr|\bev\b|e-208|e-2008|kwh/.test(t) ? 'Électrique' : /diesel|hdi|tdi|dci|cdi|crdi|\bd\b/.test(t) ? 'Diesel' : /puretech|tce|tsi|tfsi|essence|benzin|gasolin|petrol|\bvti\b/.test(t) ? 'Essence' : null;
  const p = t.match(/(\d{2,3})\s*(?:cv|ch|ps|hp)\b/) ?? t.match(/hybrid\s+(\d{3})\b/) ?? t.match(/\b(\d{2,3})\s*kw/);
  const power_ch = p ? (/kw/.test(p[0]) ? Math.round(Number(p[1]) * 1.35962) : Number(p[1])) : null;
  const gearbox = /e-?eat\d|eat\d|dsg|dct|edc|cvt|automat|automatico|automatique|\bauto\b|s[- ]?tronic|tiptronic|steptronic|bva/.test(t) ? 'Automatique' : /manual|manuel|bvm|\bmt\b/.test(t) ? 'Manuelle' : null;
  return { fuel, power_ch, gearbox };
}

export interface FleetboxParsed { fields: FycReportFields; /** Dommages dans l'ordre du rapport (pour aligner deux langues). */ order: number }

export function parseFleetboxReport(input: FycLine[]): FleetboxParsed {
  const lines = asLines(input);
  const v: Record<string, string> = {};
  const raw: Record<string, string> = {};
  const devaluation: FycDamage[] = [];
  // Bloc dommages : une rangée = lignes élément / position / dommage / commentaires, deux colonnes à la fois.
  let pending: Array<Partial<{ component: string; position: string; damage: string; comment: string }>> = [];
  let lastKey: string | null = null; // libellé de la dernière paire lue (suite d'une valeur sur la ligne d'après)
  const gridTyres: string[] = [];     // pneus en grille (« Goodyear 235/50/18 V Estate 6.0 » puis « mm »)
  const flush = () => {
    for (const d of pending) {
      if (!dash(d.position)) continue; // un « élément » sans position (en-têtes « Elemento rimovibile », « Daños externos ») n'est pas un dommage
      const where = [d.component, dash(d.position)].filter(Boolean).join(' / ');
      const comment = dash(d.comment);
      devaluation.push({ zone: where, kind: d.damage ?? '', action: '', raw: `${where} : ${d.damage ?? '?'}${comment ? ` (${comment})` : ''}` });
    }
    pending = [];
  };
  for (const line of lines) {
    const tyre = line.text.match(/^Pneumatico(PS|PD|AS|AD)\s+(.+)$/);
    if (tyre) { raw[`tyre_${tyre[1]}`] = tyre[2].replace(/\s*Mm$/i, ' mm').trim(); continue; }
    // Grille de pneus : chaque morceau « Marque 235/50/18 … 6.0 » est un pneu ; la ligne « mm · mm » qui suit le complète.
    const gridFrags = line.frags.filter((f) => /^\S+\s+\d{3}\/\d{2}\/\d{2}\b/.test(f.s.trim()));
    if (gridFrags.length) { for (const f of gridFrags) gridTyres.push(f.s.trim()); continue; }
    if (/^(mm\s*)+$/i.test(line.text) && gridTyres.length) { for (let i = gridTyres.length - line.frags.length; i < gridTyres.length; i++) if (i >= 0 && !/mm$/i.test(gridTyres[i])) gridTyres[i] += ' mm'; continue; }
    const pairs = pairsOf(line);
    if (!pairs.length) {
      // Suite du modèle sur la ligne d'après (« ALFA TONALE IBRIDA PLUG- » puis « IN MY25 Q4 280CV »).
      if (lastKey === 'model' && line.frags.length === 1 && line.frags[0].x > 60 && line.frags[0].x < 200 && v.model != null) v.model = /-$/.test(v.model) ? `${v.model}${line.text.trim()}` : `${v.model} ${line.text.trim()}`;
      continue;
    }
    lastKey = pairs.some((p) => p.key === 'model') ? 'model' : pairs[pairs.length - 1].key;
    const keys = pairs.map((p) => p.key);
    if (keys.includes('component')) { flush(); pending = pairs.filter((p) => p.key === 'component').map((p) => ({ component: dash(p.value) ?? undefined })); continue; }
    if (pending.length && (keys.includes('position') || keys.includes('damage') || keys.includes('comments'))) {
      const k = keys.includes('position') ? 'position' : keys.includes('damage') ? 'damage' : 'comments';
      pairs.filter((p) => p.key === k).forEach((p, i) => { if (pending[i]) pending[i][k === 'comments' ? 'comment' : k] = p.value.trim(); });
      if (k === 'comments') flush();
      continue;
    }
    for (const p of pairs) {
      if (p.key === 'predamage') {
        // « Pre-damage · Pre-damage · - · Commenti » : la 2e occurrence porte le montant (hors taxes), la 3e le commentaire.
        const vals = pairs.filter((q) => q.key === 'predamage').map((q) => q.value.trim());
        if (vals[0] && v.predamage == null) v.predamage = vals[0];
        if (vals.length > 1 && v.predamage_amount == null) v.predamage_amount = vals[1];
        continue;
      }
      if (v[p.key] == null) v[p.key] = p.value.trim();
    }
  }
  flush();
  const vin = (v.vin ?? '').replace(/\s+/g, '').match(/[A-HJ-NPR-Z0-9]{17}/)?.[0] ?? null;
  const brandRaw = dash(v.brand) ? v.brand.trim() : null;
  // « ALFA » seul = Alfa Romeo (c'est ce qu'écrit fleetbox) ; sinon la marque telle quelle.
  const brand = brandRaw && /^alfa$/i.test(brandRaw) ? 'Alfa Romeo' : brandRaw;
  let modelLine = dash(v.model) ?? '';
  // Ligne modèle qui répète la marque (« ALFA TONALE IBRIDA PLUG-IN MY25 Q4 280CV ») : marque retirée.
  if (brandRaw) modelLine = modelLine.replace(new RegExp(`^(?:${brandRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+romeo)?)\\s+`, 'i'), '');
  let [modelPart, ...restParts] = modelLine.split(/\s+-\s+/);
  // Sans « - » : le modèle est le premier mot, le reste est la motorisation (« TONALE | IBRIDA PLUG-IN MY25 Q4 280CV »).
  if (!restParts.length && /\s/.test(modelPart)) { const [first, ...rest] = modelPart.split(/\s+/); modelPart = first; restParts = [rest.join(' ')]; }
  const engine = restParts.join(' - ').trim();
  const hints = engineHints(modelLine);
  const km = v.km ? Number((v.km.match(/[\d .]+(?=\s*km)/i)?.[0] ?? v.km).replace(/[^\d]/g, '')) : null;
  const firstReg = isoDate(v.reg ?? null);
  const amountRaw = dash(v.predamage_amount ?? v.amount);
  const amount = amountRaw ? Number(amountRaw.replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : NaN;
  if (dash(v.plate)) raw.plate = v.plate.trim();
  if (dash(v.condition)) raw.condition = v.condition.trim();
  if (dash(v.predamage)) raw.predamage = v.predamage.trim();
  if (dash(v.comments)) raw.comments = v.comments.trim();
  if (dash(v.place)) raw.inspection_place = v.place.trim();
  if (engine) raw.engine = engine;
  if (hints.fuel || hints.power_ch || hints.gearbox) raw.engine_hints = 'énergie, puissance et boîte déduites de la ligne modèle';
  raw.inspector = 'DEKRA (fleetbox)';
  // Grille 2 × 2 lue dans l'ordre avant gauche, avant droit, arrière gauche, arrière droit.
  (['AS', 'AD', 'PS', 'PD'] as const).forEach((k, i) => { if (gridTyres[i] && !raw[`tyre_${k}`]) raw[`tyre_${k}`] = gridTyres[i]; });
  const tyres = (['AS', 'AD', 'PS', 'PD'] as const).filter((k) => raw[`tyre_${k}`]).map((k) => `${TYRE_POS[k]} : ${raw[`tyre_${k}`]}`);
  const fields: FycReportFields = {
    report_number: null, report_date: null, vin,
    brand, model: dash(modelPart) ? modelPart.trim() : null, version: engine || null, body: null,
    first_registration: firstReg, year: firstReg ? Number(firstReg.slice(0, 4)) : null, km: Number.isFinite(km) && km ? km : null,
    asking_price: null, repair_cost: Number.isFinite(amount) && amount > 0 ? amount : null,
    fuel: hints.fuel, gearbox: hints.gearbox, power_ch: hints.power_ch, color: dash(v.color) ? v.color.trim() : null,
    doors: null, seats: null, repainted: null,
    damages: { devaluation, usage: [] }, equipment: [], tyres, raw_fields: raw,
  };
  return { fields, order: devaluation.length };
}

/** Traduction par le MÊME rapport dans une autre langue (paramètre l=) : dommages rang à rang, pneus avec les positions
 *  de la langue cible ; null si la structure diffère. */
export function fleetboxTranslationFrom(src: FleetboxParsed, tr: FleetboxParsed, lang: string): { fuel: string | null; gearbox: string | null; body: string | null; color: string | null; equipment: string[]; tyres: string[]; devaluation: string[]; usage: string[] } | null {
  if (src.fields.damages.devaluation.length !== tr.fields.damages.devaluation.length) return null;
  const pos = FLEETBOX_TYRE_POS[lang] ?? TYRE_POS;
  const tyres = (['AS', 'AD', 'PS', 'PD'] as const).filter((k) => src.fields.raw_fields[`tyre_${k}`]).map((k) => `${pos[k]} : ${src.fields.raw_fields[`tyre_${k}`]}`);
  if (tyres.length !== src.fields.tyres.length) return null;
  return { fuel: src.fields.fuel, gearbox: src.fields.gearbox, body: null, color: tr.fields.color ?? src.fields.color, equipment: [], tyres, devaluation: tr.fields.damages.devaluation.map((d) => d.raw), usage: [] };
}
