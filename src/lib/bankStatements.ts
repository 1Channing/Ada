/**
 * RELEVÉS DE COMPTE → LIGNES (02/10, demande Channing : « prendre les lignes
 * de chaque relevé et en faire un tableau de frais mensuel, les classer, puis
 * faire le lien avec les achats du tableau de ventes »).
 *
 * Module PUR (pas de DOM, pas de Supabase) : il reçoit les lignes de texte
 * d'un PDF telles que pdf.js les rend (une ligne = les fragments de même
 * hauteur, triés de gauche à droite) et rend des mouvements normalisés.
 *
 * Deux formats PROUVÉS sur les relevés réels de MC Export (juin → août 2026) :
 *   - Revolut Business : « 31 Aug 2026 MOS To Essalhi boussif • Achat yaris
 *     cross HC- €26 300.00 €14 212.33 » puis la suite de la description sur
 *     la ligne d'après (« 319-LZ »). Codes : MOS/CAR/FEE/ATM/EXO = sorties,
 *     MOA/MOR/EXI = entrées. Lignes du plus récent au plus ancien.
 *   - Airwallex : une ligne « Card » / « Deposit » / « Adjustment »…, puis la
 *     ligne « Jun 01 2026 20.02 EUR 985.35 EUR » (montant, solde), les détails
 *     autour. Chronologique ; le sens est VÉRIFIÉ par le solde (solde = solde
 *     précédent + crédit − débit), le type ne sert que de repli.
 *
 * Classement : une catégorie par ligne, par motifs sur le libellé (carburant,
 * péage, train, repas, courses, achat / acompte véhicule, vente encaissée,
 * transfert interne, impôts, frais bancaires, factures prestataires…). La
 * catégorie reste modifiable à la main dans ADA.
 */

export type BankAccount = 'revolut' | 'airwallex';

export interface BankLine {
  booked_on: string;            // YYYY-MM-DD
  kind: string;                 // MOS, CAR, Card, Deposit…
  counterparty: string;
  description: string;
  amount_out: number | null;
  amount_in: number | null;
  balance: number | null;
  currency: string;
  plate: string | null;         // AB123CD (normalisée)
  vin: string | null;
  category: BankCategory;
  line_no: number;
}

export interface ParsedStatement {
  account: BankAccount;
  period_month: string;         // YYYY-MM
  opening_balance: number | null;
  closing_balance: number | null;
  currency: string;
  lines: BankLine[];
  warnings: string[];
}

export const BANK_CATEGORIES = [
  'achat_vehicule', 'acompte_vehicule', 'vente_encaissee', 'transfert_interne', 'impots_tva', 'frais_bancaires',
  'carburant', 'peage', 'train_transport', 'repas', 'courses', 'logistique', 'facture_fournisseur', 'assurance',
  'logiciel_abonnement', 'entretien_vehicule', 'retrait_especes', 'autre',
] as const;
export type BankCategory = typeof BANK_CATEGORIES[number];

export const CATEGORY_LABEL: Record<BankCategory, string> = {
  achat_vehicule: 'Achat véhicule', acompte_vehicule: 'Acompte véhicule', vente_encaissee: 'Vente encaissée', transfert_interne: 'Transfert interne',
  impots_tva: 'Impôts / TVA', frais_bancaires: 'Frais bancaires', carburant: 'Carburant', peage: 'Péages', train_transport: 'Train / transports',
  repas: 'Repas', courses: 'Courses', logistique: 'Logistique (poste, colis, dépannage)', facture_fournisseur: 'Factures prestataires', assurance: 'Assurance',
  logiciel_abonnement: 'Logiciels / abonnements', entretien_vehicule: 'Entretien véhicule', retrait_especes: 'Retraits', autre: 'Autre',
};
/** Catégories qui ne sont PAS des frais : véhicules (capital), transferts entre nos comptes, encaissements. */
export const NON_EXPENSE: ReadonlySet<BankCategory> = new Set<BankCategory>(['achat_vehicule', 'acompte_vehicule', 'vente_encaissee', 'transfert_interne']);

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ymd = (d: string, mon: string, y: string) => `${y}-${String(MONTHS[mon.toLowerCase().slice(0, 3)] ?? 0).padStart(2, '0')}-${d.padStart(2, '0')}`;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** « €26 300.00 » / « 1,005.37 » → 26300 / 1005.37 */
const money = (s: string) => Number(s.replace(/[€$£,\s  ]/g, ''));

// ── Détection ───────────────────────────────────────────────────────────────
export function detectBank(lines: string[]): BankAccount | null {
  const head = lines.slice(0, 60).join('\n');
  if (/Revolut Bank UAB|REVOFRP2/.test(head)) return 'revolut';
  if (/airwallex\.com|Airwallex \(Netherlands\)/i.test(head)) return 'airwallex';
  return null;
}

export function parseStatement(lines: string[]): ParsedStatement {
  const account = detectBank(lines);
  if (account === 'revolut') return parseRevolut(lines);
  if (account === 'airwallex') return parseAirwallex(lines);
  throw new Error('relevé non reconnu (ni Revolut, ni Airwallex) — formats connus : relevés PDF Revolut Business et Airwallex');
}

// ── Revolut ─────────────────────────────────────────────────────────────────
const REV_ROW = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) ([A-Z]{3}) (.*)$/;
const REV_STOP = /^(Transaction types|Report lost or stolen card|Account statement|Generated on the|©|Balance summary|Your funds are held|Account name|There were no transactions|For transactions to and from)/;
const REV_NOISE = /^(\+370|Get help directly|Scan the QR code|out to us via|Konstitucijos|Authority and whose|\d+\/\d+$|FX Rate |[$£]\s?[\d ,.]+$)/;
const EUR_TOKEN = /€\s?[\d   ]*\d\.\d{2}/g;
const REV_OUT = new Set(['MOS', 'CAR', 'FEE', 'ATM', 'EXO']);

function parseRevolut(lines: string[]): ParsedStatement {
  const warnings: string[] = [];
  let currency = 'EUR';
  let opening: number | null = null, closing: number | null = null;
  let period: string | null = null;
  type Row = { date: string; kind: string; text: string; amounts: number[]; currency: string };
  const rows: Row[] = [];
  let cur: Row | null = null;
  let inTable = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const curM = line.match(/^Currency ([A-Z]{3})$/) ?? line.match(/Currency ([A-Z]{3})$/);
    if (curM) { currency = curM[1]; cur = null; inTable = false; continue; }
    const per = line.match(/^Transactions from (\d{1,2}) ([A-Z][a-z]+) (\d{4}) to/);
    if (per) { if (!period) period = ymd(per[1], per[2], per[3]).slice(0, 7); inTable = true; cur = null; continue; }
    if (currency === 'EUR') {
      const ob = line.match(/^Opening balance €([\d ,.]+)$/); if (ob) opening = money(ob[1]);
      const cb = line.match(/^Closing balance €([\d ,.]+)$/); if (cb) closing = money(cb[1]);
    }
    if (/^Date \(UTC\) Description/.test(line)) { inTable = true; cur = null; continue; }
    if (REV_STOP.test(line)) { cur = null; if (/^Transaction types/.test(line)) inTable = false; continue; }
    if (!inTable) continue;
    const m = line.match(REV_ROW);
    if (m) {
      const [, d, mon, y, kind, rest] = m;
      const amounts = (rest.match(EUR_TOKEN) ?? []).map(money);
      cur = { date: ymd(d, mon, y), kind, text: rest.replace(EUR_TOKEN, ' ').replace(/\s+/g, ' ').trim(), amounts, currency };
      rows.push(cur);
      continue;
    }
    if (REV_NOISE.test(line)) continue;
    if (cur) {
      const amounts = (line.match(EUR_TOKEN) ?? []).map(money);
      if (amounts.length && cur.amounts.length === 0) cur.amounts = amounts;
      const txt = line.replace(EUR_TOKEN, ' ').replace(/\s+/g, ' ').trim();
      if (txt) cur.text = `${cur.text} ${txt}`.trim();
    }
  }
  if (!period && rows.length) period = rows[0].date.slice(0, 7);
  const out: BankLine[] = [];
  rows.forEach((r, i) => {
    if (r.amounts.length < 2) { warnings.push(`${r.date} ${r.kind} « ${r.text.slice(0, 40)} » : montant ou solde illisible`); }
    const amount = r.amounts[0] ?? null;
    const balance = r.amounts.length >= 2 ? r.amounts[r.amounts.length - 1] : null;
    const isOut = REV_OUT.has(r.kind);
    // Description « To X • motif » / « Money added from X • motif »
    let counterparty = '', description = r.text;
    const sep = r.text.indexOf('•');
    if (sep >= 0) { counterparty = r.text.slice(0, sep).replace(/^(To|Money added from|From)\s+/i, '').trim(); description = r.text.slice(sep + 1).trim(); }
    else if (r.kind === 'CAR') { counterparty = r.text.trim(); description = ''; }
    else { counterparty = r.text.replace(/^(To|Money added from|From)\s+/i, '').trim(); description = ''; }
    const full = `${counterparty} ${description}`;
    out.push({
      booked_on: r.date, kind: r.kind, counterparty, description, amount_out: isOut ? amount : null, amount_in: isOut ? null : amount,
      balance, currency: r.currency, plate: extractPlate(full), vin: extractVin(full), category: classify(r.kind, counterparty, description, isOut ? amount : null, isOut ? null : amount), line_no: i + 1,
    });
  });
  // Contrôle par le solde : lignes du plus récent au plus ancien.
  let bad = 0;
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i], b = out[i + 1];
    if (a.currency !== b.currency || a.balance == null || b.balance == null) continue;
    const expect = round2(b.balance + (a.amount_in ?? 0) - (a.amount_out ?? 0));
    if (Math.abs(expect - a.balance) > 0.011) bad++;
  }
  if (bad > 0) warnings.push(`${bad} ligne(s) dont le solde ne suit pas le mouvement précédent — à vérifier`);
  return { account: 'revolut', period_month: period ?? '', opening_balance: opening, closing_balance: closing, currency: 'EUR', lines: out, warnings };
}

// ── Airwallex ───────────────────────────────────────────────────────────────
const AWX_KINDS = ['Card', 'Deposit', 'Payout', 'Adjustment', 'Fee', 'Transfer', 'Conversion', 'Charge', 'Purchase', 'Direct Debit', 'Batch Payout', 'Credit', 'Payin', 'Prepayment', 'Refund'];
const AWX_DATE = /^([A-Z][a-z]{2}) (\d{2}) (\d{4}) ([\d,]+\.\d{2}) ([A-Z]{3}) ([\d,]+\.\d{2}) [A-Z]{3}$/;
const AWX_NOISE = /^(Web: airwallex|Email: support|Rivvia,|Account Holder|MC EXPORT IBAN|IBAN: |Airwallex \(Netherlands\)|88 B AVENUE|LA LOIRE|EUR Account Activity|Date Details Credit Debit Balance|Page \d+ of \d+)/;
const AWX_IN = new Set(['Deposit', 'Credit', 'Payin', 'Refund']);

function parseAirwallex(lines: string[]): ParsedStatement {
  const warnings: string[] = [];
  let opening: number | null = null, closing: number | null = null, period: string | null = null;
  type Row = { kind: string; date: string | null; amount: number | null; balance: number | null; currency: string; details: string[] };
  const rows: Row[] = [];
  let cur: Row | null = null;
  let started = false, ended = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || ended) continue;
    const sb = line.match(/^Starting balance on ([A-Z][a-z]{2}) (\d{2}) (\d{4}) ([\d,]+\.\d{2}) [A-Z]{3}/);
    if (sb) { opening = money(sb[4]); period = ymd(sb[2], sb[1], sb[3]).slice(0, 7); continue; }
    const eb = line.match(/^Ending balance on [A-Z][a-z]{2} \d{2} \d{4} ([\d,]+\.\d{2}) [A-Z]{3}/);
    if (eb) { closing = money(eb[1]); continue; }
    if (/^Starting balance [\d,]+\.\d{2} [A-Z]{3}$/.test(line)) { started = true; cur = null; continue; }
    if (/^Ending balance [\d,]+\.\d{2} [A-Z]{3}$/.test(line) || /^Important information/.test(line)) { ended = true; cur = null; continue; }
    if (!started) continue;
    if (AWX_NOISE.test(line)) continue;
    if (AWX_KINDS.includes(line)) { cur = { kind: line, date: null, amount: null, balance: null, currency: 'EUR', details: [] }; rows.push(cur); continue; }
    if (!cur) continue;
    const dm = line.match(AWX_DATE);
    if (dm && cur.date == null) { cur.date = ymd(dm[2], dm[1], dm[3]); cur.amount = money(dm[4]); cur.currency = dm[5]; cur.balance = money(dm[6]); continue; }
    cur.details.push(line);
  }
  const out: BankLine[] = [];
  let prev = opening;
  let byKind = 0;
  rows.forEach((r, i) => {
    if (!r.date || r.amount == null) { warnings.push(`mouvement « ${r.kind} » n° ${i + 1} sans date ou montant lisible`); return; }
    const text = r.details.join(' ').replace(/\(.*?card, \*\*\d{4}\):? [A-Z]{3} [\d,]+\.\d{2}/g, ' ').replace(/\s+/g, ' ').trim();
    let isIn: boolean;
    if (prev != null && r.balance != null && Math.abs(round2(prev + r.amount) - r.balance) < 0.011) isIn = true;
    else if (prev != null && r.balance != null && Math.abs(round2(prev - r.amount) - r.balance) < 0.011) isIn = false;
    else { isIn = AWX_IN.has(r.kind); byKind++; }
    prev = r.balance;
    let counterparty = '', description = '';
    if (r.kind === 'Card') { const parts = text.split(','); counterparty = parts[0].trim(); description = parts.slice(1).join(',').replace(/\bFRA\b,?/g, '').replace(/\s+/g, ' ').trim(); }
    else if (text.includes('|')) { const seg = text.split('|').map((s) => s.trim()); counterparty = seg[0]; description = seg.slice(1).filter((s) => !/^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/.test(s) && !/^[0-9a-f-]{20,}$/i.test(s)).join(' · ').replace(/^Ref: /, ''); }
    else { counterparty = r.kind; description = text.replace(/^Reason: /, ''); }
    const full = `${counterparty} ${description}`;
    out.push({
      booked_on: r.date, kind: r.kind, counterparty, description, amount_out: isIn ? null : r.amount, amount_in: isIn ? r.amount : null, balance: r.balance,
      currency: r.currency, plate: extractPlate(full), vin: extractVin(full), category: classify(r.kind, counterparty, description, isIn ? null : r.amount, isIn ? r.amount : null), line_no: i + 1,
    });
  });
  if (byKind > 0) warnings.push(`${byKind} ligne(s) dont le sens (crédit / débit) n'a pas pu être vérifié par le solde`);
  if (!period && out.length) period = out[0].booked_on.slice(0, 7);
  return { account: 'airwallex', period_month: period ?? '', opening_balance: opening, closing_balance: closing, currency: 'EUR', lines: out, warnings };
}

// ── Plaque / VIN ────────────────────────────────────────────────────────────
/** « HC-319-LZ », « gf922wt », « GB- 872-JA » (coupée par un retour à la ligne) → HC319LZ. */
export function extractPlate(text: string): string | null {
  const m = text.match(/\b([A-Za-z]{2})\s?-?\s?(\d{3})\s?-?\s?([A-Za-z]{2})\b/);
  if (!m) return null;
  const p = `${m[1]}${m[2]}${m[3]}`.toUpperCase();
  // SIV : pas de I, O, U dans les lettres ; « SAS 123 » etc. exclus par la forme.
  return /^[A-HJ-NP-TV-Z]{2}\d{3}[A-HJ-NP-TV-Z]{2}$/.test(p) ? p : null;
}
export function extractVin(text: string): string | null {
  const m = text.toUpperCase().match(/\b([A-Z0-9]{17})\b/);
  return m && /\d/.test(m[1]) && /[A-Z]/.test(m[1]) ? m[1] : null;
}

// ── Classement ──────────────────────────────────────────────────────────────
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function classify(kind: string, counterparty: string, description: string, out: number | null, inn: number | null): BankCategory {
  const cp = norm(counterparty), ds = norm(description), all = `${cp} ${ds}`;
  if (/transfert interne/.test(all) || /^mc export$/.test(cp.trim())) return 'transfert_interne';
  if (kind === 'ATM') return 'retrait_especes';
  if (kind === 'FEE' || kind === 'Fee' || (kind === 'Adjustment' && /fees|invoice number/.test(all)) || /revolut business fee|airwallex/.test(all)) return 'frais_bancaires';
  if (/impots|impot |dgfip|tresor public|\btva\b|urssaf|93033811600013|douane/.test(all)) return 'impots_tva';
  if (inn != null && (kind === 'MOA' || kind === 'MOR' || kind === 'Deposit')) {
    if (/acquisto|achat|fattura|facture|saldo|vente|solde|acompte|anticipo|invoice/.test(all) || inn >= 3000) return 'vente_encaissee';
    return 'autre';
  }
  if (out != null && (kind === 'MOS' || kind === 'Payout' || kind === 'Transfer')) {
    if (/acompte|anticipo|arrhes|deposit/.test(ds)) return 'acompte_vehicule';
    if (/achat|acquisto|solde|vehicule|voiture|\b(yaris|ignis|kona|tucson|sprinter|transit|transporter|porsche|rav ?4|elroq|enyaq|corolla|swift|aygo|tge|crafter|vito|id\.?3|911|997)\b/.test(ds) || extractPlate(description)) return 'achat_vehicule';
    if (/assur/.test(all)) return 'assurance';
    if (/convoy|transport|livraison|plaque|carte grise|immat|w garage|depann|remorqu/.test(all)) return 'logistique';
    if (/facture|invoice|fac\d|\beurl\b|\bsarl\b|\bsas\b|\bsrl\b|\bbv\b/.test(all)) return 'facture_fournisseur';
    return out >= 5000 ? 'achat_vehicule' : 'autre';
  }
  // Paiements carte (Revolut CAR, Airwallex Card)
  if (/\b(total|shell|esso|avia|eni\d*|bp|agip|q8|station|dac\b|le plein|carburant|petrol|tankstation|tinq|intermarche sta|hyper u statio|super u sta|leclerc.*(dac|statio)|carrefour dac|e\.leclerc dac|relais.*(total|carb))/.test(all) && !/boutique|restau/.test(all)) return 'carburant';
  if (/autoroute|cofiroute|aprr|sanef|escota|vinci|aliae|peage|eiffag|asf\b|area\b|atmb|sftrf|\bbip\b|ulys|tolls?/.test(all) && !/areas/.test(all)) return 'peage';
  if (/sncf|ratp|semitan|fil bleu|ouigo|blablacar|flix|\btbm\b|tisseo|\brtm\b|\btram\b|metro|navigo|trenitalia|\bns\b|nmbs|sepem|transdev|keolis|ilevia|\btan\b|irigo|wagons-lits|taxi|uber|bolt|velib|parking|indigo|q-park|effia|saemes/.test(all)) return 'train_transport';
  if (/mc ?donald|burger king|boulangerie|brioche|restau|resto|pizza|cafe|coffee|newrest|areas|relais|marie blachere|\bpaul\b|kfc|subway|sushi|\bbar\b|tabac|epicerie|bistro|brasserie|la pala|\bange\b|koel|bakker|snack|kebab|deliveroo|uber eats|just eat|boulang|patisserie|traiteur|cantine|crep|sandwich|starbucks|columbus|levgada|soliodis|pyradis|maison|autogrill|relay|gourmandine|rocadis|tribs|ik exploitation|shell boutique|a\.r\.e\.a|\b\d{7}\b.*\b855\b/.test(all)) return 'repas';
  if (/leclerc|carrefour|super u|hyper u|auchan|intermarche|lidl|aldi|monoprix|casino|franprix|station u|albert heijn|jumbo|action\b|bureau vallee|ikea|amazon|cdiscount|fnac|darty|boulanger|decathlon/.test(all)) return 'courses';
  if (/laposte|la poste|\bdhl\b|chronopost|\bups\b|fedex|colissimo|mondial relay|postnl|depann|remorqu|speed depanne|lavage|\blav\b|wash/.test(all)) return 'logistique';
  if (/assur|\baxa\b|allianz|hiscox|maif|macif|matmut|groupama/.test(all)) return 'assurance';
  if (/apple|google|anthropic|openai|microsoft|adobe|notion|carvertical|histovec|autoviza|railway|supabase|zyte|\bovh\b|github|canva|linkedin|dropbox|slack|zoom|free mobile|orange|\bsfr\b|bouygues|sosh|spotify|netflix|revolut|qonto|airwallex/.test(all)) return 'logiciel_abonnement';
  if (/garage|pneu|norauto|feu vert|speedy|midas|controle technique|dekra|autovision|autosur|securitest|carglass|volvo|toyota|peugeot|renault|citroen|mecanic|autom\b|automobile|carrosserie|vidange|oscaro|mister auto|pieces auto/.test(all)) return 'entretien_vehicule';
  return 'autre';
}

// ── Rapprochement avec les dossiers de vente ────────────────────────────────
/** Dossier de vente vu par le rapprochement. */
export interface DealLite {
  id: string; reference: string | null; purchase_price: number | null; sale_price: number | null; fees: number | null; commission_ht: number | null;
  transaction_date: string | null; status: string | null; commercial: string | null; notes: string | null;
  plate: string | null; vin: string | null; brand: string | null; model: string | null; vehicle_label: string | null; tab_month: string | null;
}

/**
 * RAPPROCHEMENT ligne ↔ dossier (règle prouvée 02/10 : REF = lettres du
 * modèle + 3 chiffres de la plaque, YC328 ↔ GK-328-EJ, PC440 ↔ ER-440-BB) :
 *   1. plaque de la ligne = plaque du véhicule du dossier ;
 *   2. 3 chiffres de la plaque = chiffres de la REF, un seul dossier candidat
 *      (ou plusieurs : celui dont le modèle est cité dans le libellé) ;
 *   3. VIN de la ligne = VIN du dossier, ou ses 3 derniers caractères = « VIN
 *      (fin) » du tableur avec un montant proche du prix de vente (±10 %).
 */
const MODEL_PREFIX: Array<[RegExp, string[]]> = [
  [/yaris cross/i, ['YC']], [/\byaris\b/i, ['Y', 'YC']], [/ignis/i, ['I']], [/kona/i, ['K']], [/tucson/i, ['T']], [/transporter|transporteur/i, ['T']],
  [/sprinter/i, ['S']], [/porsche|911|997|cayenne|macan/i, ['PC', 'P']], [/transit custom/i, ['TC']], [/transit/i, ['FT', 'TC', 'T']], [/\btge\b|\bman\b/i, ['TGE']],
  [/rav ?4/i, ['RV']], [/elroq/i, ['E']], [/enyaq/i, ['E', 'EN']], [/corolla/i, ['C']], [/swift/i, ['SW']], [/aygo/i, ['AX']], [/ds ?7/i, ['DS']],
  [/id\.? ?3/i, ['ID']], [/mach/i, ['M']], [/c-?hr/i, ['CHR']], [/vitara/i, ['V']], [/panda/i, ['FP']], [/bz4x/i, ['B']], [/q4/i, ['QF']], [/model 3|tesla/i, ['T']], [/\bnx\b/i, ['NX']], [/astra/i, ['A']],
];
export function matchLine(line: { plate: string | null; vin: string | null; counterparty: string; description: string; amount_out: number | null; amount_in: number | null; category: string }, deals: DealLite[]): { id: string; how: string } | null {
  if (!['achat_vehicule', 'acompte_vehicule', 'vente_encaissee'].includes(line.category)) return null;
  const text = `${line.counterparty} ${line.description}`;
  const plate = line.plate ?? extractPlate(text);
  if (plate) {
    const exact = deals.find((d) => d.plate && d.plate === plate);
    if (exact) return { id: exact.id, how: 'plaque' };
    const digits = plate.slice(2, 5);
    const cands = deals.filter((d) => d.reference && d.reference.replace(/\D/g, '') === digits);
    if (cands.length === 1) return { id: cands[0].id, how: 'ref' };
    if (cands.length > 1) {
      const prefixes = MODEL_PREFIX.filter(([re]) => re.test(text)).flatMap(([, p]) => p);
      const byModel = cands.filter((d) => prefixes.includes((d.reference ?? '').replace(/\d.*$/, '').toUpperCase()));
      if (byModel.length === 1) return { id: byModel[0].id, how: 'ref+modèle' };
      // Même REF en double dans ADA (YC665 ×2, 02/10) : celui qui porte un
      // véhicule et des prix, sinon le premier.
      if (byModel.length > 1 && new Set(byModel.map((d) => d.reference)).size === 1) {
        const best = byModel.find((d) => d.plate && d.purchase_price != null) ?? byModel.find((d) => d.purchase_price != null) ?? byModel[0];
        return { id: best.id, how: 'ref (doublon)' };
      }
    }
  }
  // Numéro de facture (NENA S.R.L. « Saldo fattura FAC00000517 » ↔ dossier
  // « Facture : FAC517 » du tableur) : les zéros de tête ne comptent pas.
  const fac = text.match(/\bFAC0*(\d{2,})\b/i);
  if (fac) {
    const re = new RegExp(`Facture : FAC0*${fac[1]}\\b`, 'i');
    const cands = deals.filter((d) => d.notes && re.test(d.notes));
    if (cands.length === 1) return { id: cands[0].id, how: 'facture' };
    if (cands.length > 1 && new Set(cands.map((d) => d.reference)).size === 1) {
      const best = cands.find((d) => d.plate && d.sale_price != null) ?? cands[0];
      return { id: best.id, how: 'facture (doublon)' };
    }
  }
  if (line.vin) {
    const full = deals.find((d) => d.vin && d.vin === line.vin);
    if (full) return { id: full.id, how: 'vin' };
    const tail = line.vin.slice(-3);
    const amt = line.amount_in ?? line.amount_out ?? 0;
    const cands = deals.filter((d) => d.notes && new RegExp(`VIN \\(fin\\) : [^\\n]*${tail}\\s*$`, 'm').test(d.notes) && d.sale_price && Math.abs(d.sale_price - amt) <= d.sale_price * 0.1);
    if (cands.length === 1) return { id: cands[0].id, how: 'vin (fin) + montant' };
  }
  return null;
}

