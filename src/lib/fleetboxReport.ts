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
 * Vérifié sur la Peugeot 408 VR3F3DGY6SY577168 dans les 7 langues (3 dommages « jante usinée », 4 pneus).
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

const isoDate = (s: string | null) => { const m = (s ?? '').match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const dash = (s: string | undefined | null) => { const v = (s ?? '').trim(); return !v || v === '-' ? null : v; };
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
  const fuel = /plug-?in|phev|e-eat8|e-dct|recharge/.test(t) ? 'Hybride rechargeable' : /hybrid|hybride|ibrid|hev\b|e-tech/.test(t) ? 'Hybride' : /electri|elektr|\bev\b|e-208|e-2008|kwh/.test(t) ? 'Électrique' : /diesel|hdi|tdi|dci|cdi|crdi|\bd\b/.test(t) ? 'Diesel' : /puretech|tce|tsi|tfsi|essence|benzin|gasolin|petrol|\bvti\b/.test(t) ? 'Essence' : null;
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
    const pairs = pairsOf(line);
    if (!pairs.length) continue;
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
  const modelLine = dash(v.model) ?? '';
  const [modelPart, ...restParts] = modelLine.split(/\s+-\s+/);
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
  const tyres = (['AS', 'AD', 'PS', 'PD'] as const).filter((k) => raw[`tyre_${k}`]).map((k) => `${TYRE_POS[k]} : ${raw[`tyre_${k}`]}`);
  const fields: FycReportFields = {
    report_number: null, report_date: null, vin,
    brand: dash(v.brand) ? v.brand.trim() : null, model: dash(modelPart) ? modelPart.trim() : null, version: engine || null, body: null,
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
