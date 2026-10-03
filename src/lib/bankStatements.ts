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

export type BankAccount = 'revolut' | 'airwallex' | 'shine' | 'pennylane' | 'cic' | 'caisse_epargne' | 'finom' | 'bpgo';
export const ACCOUNT_LABEL: Record<BankAccount, string> = { revolut: 'Revolut', airwallex: 'Airwallex', shine: 'Shine', pennylane: 'Pennylane / Swan', cic: 'CIC', caisse_epargne: "Caisse d'Épargne", finom: 'Finom', bpgo: 'Banque Populaire' };

/** Une ligne de texte d'un PDF : texte reconstitué, page, hauteur, fragments avec leur abscisse (colonnes Débit / Crédit). */
export interface TextLine { text: string; page: number; y: number; frags: Array<{ x: number; s: string }> }
export const toTextLines = (lines: string[]): TextLine[] => lines.map((text, i) => ({ text, page: 1, y: -i, frags: [{ x: 0, s: text }] }));

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
  /** Numéro de compte (fin d'IBAN ou n° de compte) : deux comptes d'une même banque cohabitent (Shine principal / secondaire). */
  account_ref?: string;
  account_name?: string | null;
  period_month: string;         // YYYY-MM
  opening_balance: number | null;
  closing_balance: number | null;
  currency: string;
  lines: BankLine[];
  warnings: string[];
  /** Export couvrant plusieurs mois (Revolut « Relevé de transactions ») : à découper par mois au dépôt,
   *  les mois déjà déposés par un relevé mensuel sont laissés tels quels. */
  split_by_month?: boolean;
  period_start?: string | null; period_end?: string | null;
}

export const BANK_CATEGORIES = [
  'achat_vehicule', 'acompte_vehicule', 'vente_encaissee', 'transfert_interne', 'impots_tva', 'frais_bancaires',
  'carburant', 'peage', 'train_transport', 'hebergement', 'repas', 'courses', 'logistique', 'facture_fournisseur', 'assurance',
  'logiciel_abonnement', 'entretien_vehicule', 'salaire', 'loyer', 'comptable', 'remboursement_client', 'remboursement_recu', 'retrait_especes', 'autre',
] as const;
export type BankCategory = typeof BANK_CATEGORIES[number];

export const CATEGORY_LABEL: Record<BankCategory, string> = {
  achat_vehicule: 'Achat véhicule', acompte_vehicule: 'Acompte véhicule', vente_encaissee: 'Vente encaissée', transfert_interne: 'Transfert interne',
  impots_tva: 'Impôts / TVA', frais_bancaires: 'Frais bancaires', carburant: 'Carburant', peage: 'Péages', train_transport: 'Train / transports',
  hebergement: 'Hébergement', repas: 'Repas', courses: 'Courses', logistique: 'Transport / convoyage / logistique', facture_fournisseur: 'Factures prestataires', assurance: 'Assurance',
  logiciel_abonnement: 'Logiciels / abonnements', entretien_vehicule: 'Entretien véhicule', salaire: 'Salaires et charges sociales', loyer: 'Loyer (GF Holding)', comptable: 'Comptable (Geo Conseils)', remboursement_client: 'Remboursement à un client (avoir)', remboursement_recu: 'Remboursement reçu d\'un vendeur (geste, annulation)', retrait_especes: 'Retraits', autre: 'Autre',
};
/** Frais de fonctionnement (ce que le tableur ne compte PAS dans sa case frais, Channing 03/10 soir). */
export const OVERHEAD: ReadonlySet<BankCategory> = new Set<BankCategory>(['loyer', 'comptable', 'salaire', 'logiciel_abonnement', 'frais_bancaires']);
/** Frais véhicules = la case frais du tableur (définition Channing 03/10 soir, confirmée le 04/10 : entretien véhicule,
 *  logistique / convoyage, transport / train, repas, péage, carburant, assurance — rien d'autre). */
export const VEHICLE_COSTS: ReadonlySet<BankCategory> = new Set<BankCategory>(['peage', 'carburant', 'repas', 'train_transport', 'logistique', 'entretien_vehicule', 'assurance']);
/** Prestataires et factures (commissions apporteurs, préparation, services) : hors case frais du tableur. */
export const CONTRACTORS: ReadonlySet<BankCategory> = new Set<BankCategory>(['facture_fournisseur']);
/** Catégories qui ne sont PAS des frais : véhicules (capital), transferts entre nos comptes, encaissements. */
export const NON_EXPENSE: ReadonlySet<BankCategory> = new Set<BankCategory>(['achat_vehicule', 'acompte_vehicule', 'vente_encaissee', 'transfert_interne', 'remboursement_client', 'remboursement_recu']);
/** Flux véhicules : ce qui se rapproche d'un dossier. */
export const FLOW_CATS: ReadonlyArray<BankCategory> = ['achat_vehicule', 'acompte_vehicule', 'vente_encaissee', 'remboursement_client', 'remboursement_recu'];

const MONTHS: Record<string, number> = { jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, avr: 4, may: 5, mai: 5, jun: 6, jui: 6, jul: 7, aug: 8, aou: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** « Aug » / « août » / « juil. » → numéro de mois (anglais et français, accents retirés ; « juil » ≠ « juin »). */
const monthNo = (mon: string) => { const m = mon.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\.$/, ''); if (m.startsWith('juil')) return 7; if (m.startsWith('juin')) return 6; return MONTHS[m.slice(0, 3)] ?? 0; };
const ymd = (d: string, mon: string, y: string) => `${y}-${String(monthNo(mon)).padStart(2, '0')}-${d.padStart(2, '0')}`;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** « €26 300.00 » / « 1,005.37 » → 26300 / 1005.37 */
const money = (s: string) => Number(s.replace(/[€$£,\s  ]/g, ''));

/** « 3.182,10 » / « 61 000,00 » / « 1 600,00 » → nombre (format français). */
const moneyFr = (s: string) => Number(s.replace(/[€\s\u00a0\u202f.]/g, '').replace(',', '.'));
const FR_AMOUNT = /^[\d\s\u00a0\u202f.]*\d,\d{2}$/;
const frDate = (d: string) => { const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
/** Clé de période : le mois si le relevé le couvre en entier, sinon « 2026-06~01-15 » (relevés en plusieurs parties). */
// Le mois du relevé est celui de son DERNIER MOUVEMENT : CIC et Caisse
// d'Épargne ouvrent sur le solde du dernier jour du mois précédent (« SOLDE
// AU 30/05 » pour juin) et CIC date parfois sa clôture au 1er du mois
// suivant (constat 02/10 : relevés rangés dans le mauvais mois de la
// grille). Partiel (« 2026-06~01-15 ») seulement quand début et fin sont
// dans le même mois et que la fin tombe avant le 28 (relevés en deux parties).
const periodKey = (start: string | null, end: string | null, lines: Array<{ booked_on: string }>) => {
  const last = lines.reduce<string | null>((m, l) => (m == null || l.booked_on > m ? l.booked_on : m), null);
  const month = (last ?? end ?? start ?? '').slice(0, 7);
  if (start && end && start.slice(0, 7) === end.slice(0, 7) && Number(end.slice(8)) < 28) return `${month}~${start.slice(8)}-${end.slice(8)}`;
  return month;
};

// ── Détection ───────────────────────────────────────────────────────────────
export function detectBank(lines: TextLine[]): BankAccount | null {
  const head = lines.slice(0, 80).map((l) => l.text).join('\n');
  if (/CCBPFRPP|Banque Populaire Grand Ouest/.test(head)) return 'bpgo';
  if (/FNOMFRP2|^finom$/m.test(head)) return 'finom'; // avant Revolut : les IBAN / BIC des tiers (REVOFRP2) y figurent
  if (/Revolut Bank UAB|REVOFRP2/.test(head)) return 'revolut';
  if (/airwallex\.com|Airwallex \(Netherlands\)/i.test(head)) return 'airwallex';
  if (/Shine \(www\.shine\.fr\)|SNNNFR22/.test(head)) return 'shine';
  if (/SWNBFR22|support\.swan\.io|CONTACTEZ SWAN/.test(head)) return 'pennylane';
  if (/CMCIFRPP|CIC (OUEST|MAINE)|cic\.fr/i.test(head)) return 'cic';
  if (/CEPAFRPP|CAISSE D'EPARGNE|caisse-epargne\.fr/i.test(head)) return 'caisse_epargne';
  return null;
}

export function parseStatement(lines: TextLine[]): ParsedStatement {
  if (lines.length === 0) throw new Error('ce PDF ne contient aucun texte (relevé scanné en image) — exporter le relevé depuis la banque en PDF natif ou en CSV');
  const account = detectBank(lines);
  const texts = lines.map((l) => l.text);
  let st: ParsedStatement;
  if (account === 'revolut') st = texts.some((t) => /^(Relevé de transactions|Transaction statement)\b/.test(t)) ? parseRevolutExport(lines) : parseRevolut(texts);
  else if (account === 'airwallex') st = parseAirwallex(texts);
  else if (account === 'shine') st = parseShine(lines);
  else if (account === 'pennylane') st = parseSwan(texts);
  else if (account === 'cic') st = parseCic(lines);
  else if (account === 'caisse_epargne') st = parseCaisseEpargne(texts);
  else if (account === 'finom') st = parseFinom(texts);
  else if (account === 'bpgo') st = parseBpgo(lines);
  else throw new Error("relevé non reconnu — formats connus : Revolut Business, Airwallex, Shine, Pennylane (Swan), CIC, Caisse d'Épargne, Finom, Banque Populaire");
  const id = accountIdentity(texts);
  st.account_ref = id.ref; st.account_name = id.name;
  return st;
}

/** Numéro de compte du relevé : 5 derniers caractères de l'IBAN (toutes banques), sinon du n° de compte (CIC) ; nom du compte quand il est écrit (Shine, Revolut).
 *  Lu LIGNE PAR LIGNE (02/10 soir : « 411 » + « BIC REVO » de la ligne suivante donnaient « CREVO », « 2377 » + « 88 B AVENUE » donnaient « 37788 »). */
export function accountIdentity(texts: string[]): { ref: string; name: string | null } {
  const head = texts.slice(0, 120);
  let iban: string | null = null;
  // L'IBAN peut être en pied de page (CIC : « IBAN : FR76 3004 7142 9300 0205
  // 3370 287 » tout en bas, constat 02/10 soir — lu sur les relevés courts
  // seulement, d'où deux clés pour un même compte) : cherché sur TOUT le texte.
  for (let i = 0; i < texts.length && !iban; i++) {
    if (!/\bIBAN\b/.test(texts[i])) continue;
    const src = /[A-Z]{2}\d{2}/.test(texts[i].replace(/^.*IBAN\s*:?\s*/, '')) ? texts[i] : (texts[i + 1] ?? '');
    const m = src.replace(/^.*IBAN\s*:?\s*/, '').match(/^([A-Z]{2}\d{2}(?: ?[A-Z0-9]{2,4})+)/);
    if (!m) continue;
    const groups = m[1].split(' ');
    while (groups.length > 1 && /^[A-Z]+$/.test(groups[groups.length - 1])) groups.pop(); // « BIC », « BIC CEPAFRPP » collés à la fin
    iban = groups.join('');
  }
  const joined = head.join('\n');
  const num = joined.match(/N°\s*(\d{11})\b/)?.[1] ?? joined.match(/COMPTE[^\n]*N°\s*([\d ]{8,}?)\s{2,}/i)?.[1]?.replace(/\s/g, '') ?? joined.match(/N°\s*(\d{8,})/)?.[1];
  const ref = (iban ?? num ?? '').slice(-5);
  const name = joined.match(/Nom du compte\s*:?\s*([^\n]+?)(?:\s+(?:Currency|Devise)|$)/m)?.[1]?.trim() ?? joined.match(/Account name\s+([^\n]+?)(?:\s+Currency|$)/m)?.[1]?.trim() ?? null;
  return { ref, name };
}

/** Abscisse de la colonne Crédit sur la ligne d'en-tête : un montant à droite de ce repère est un crédit. */
function columnX(lines: TextLine[], headerRe: RegExp, fragRe: RegExp): number | null {
  const h = lines.find((l) => headerRe.test(l.text));
  const f = h?.frags.find((fr) => fragRe.test(fr.s));
  return f ? f.x : null;
}
const creditColumnX = (lines: TextLine[], headerRe: RegExp) => columnX(lines, headerRe, /cr[ée]dit/i);
const isAmountFrag = (s: string) => FR_AMOUNT.test(s.trim());

// ── Shine (compte principal, preuve 02/10) ──────────────────────────────────
// Un mouvement = un paquet de lignes serrées (≤ 8 pt) : la ligne qui porte la
// date, et autour d'elle le type qui déborde (« Virement » / « instantané »),
// le libellé qui déborde, « De : … ». Colonnes Débit / Crédit distinguées par
// l'abscisse du montant. Lignes du plus ancien à plus récent.
// Colonne « Type » : mots du vocabulaire Shine seulement (constat 03/10 : sur
// les relevés de juillet à septembre, tout le libellé tombait à gauche de
// l'abscisse fixe 170 et finissait dans le type ; « REMB. DGFiP … De : SIE
// ANGERS » devenait une vente sans libellé). La frontière est lue sur
// l'en-tête (« Opération ») et un mot n'est un type que s'il en a l'air.
const SHINE_TYPE_WORD = /^(Virement|instantané|Carte|Prélèvement|Retrait|Dépôt|Chèque)$/i;
/** Libellé Shine → tiers + description (« X - Y », « … De : Z », carte = tiers seul). */
export function splitShineOp(kind: string, opText: string): { counterparty: string; description: string } {
  let counterparty = '', description = opText;
  const de = opText.match(/De : (.+)$/);
  if (de) { counterparty = de[1].trim(); description = opText.slice(0, de.index).trim(); }
  else if (/^Carte$/i.test(kind)) { counterparty = opText; description = ''; }
  else { const sep = opText.indexOf(' - '); if (sep > 0) { counterparty = opText.slice(0, sep).trim(); description = opText.slice(sep + 3).trim(); } else { counterparty = opText; description = ''; } }
  description = description.replace(/ - Creditor Name SEPA : .*$/i, '').trim();
  return { counterparty, description };
}
/** Ligne Shine déjà en base dont le libellé est parti dans le type (tiers et
 *  description vides) : sépare les mots du type du libellé. null = rien à réparer. */
export function repairShineKind(kind: string): { kind: string; counterparty: string; description: string } | null {
  const words = kind.split(/\s+/).filter(Boolean);
  const type = words.filter((w) => SHINE_TYPE_WORD.test(w)), op = words.filter((w) => !SHINE_TYPE_WORD.test(w));
  if (op.length === 0) return null;
  const k = type.join(' ') || 'Virement';
  return { kind: k, ...splitShineOp(k, op.join(' ').replace(/\s+/g, ' ').trim()) };
}
function parseShine(lines: TextLine[]): ParsedStatement {
  const warnings: string[] = [];
  const texts = lines.map((l) => l.text);
  const per = texts.find((t) => /^De \d{2}\/\d{2}\/\d{4} à \d{2}\/\d{2}\/\d{4}/.test(t))?.match(/De (\S+) à (\S+)/);
  const start = per ? frDate(per[1]) : null, end = per ? frDate(per[2]) : null;
  const ob = texts.map((t) => t.match(/^Solde au \d{2}\/\d{2}\/\d{4} ([\d\s\u00a0]+,\d{2}) €$/)).find(Boolean);
  const opening = ob ? moneyFr(ob[1]) : null;
  let closing: number | null = null;
  const ns = texts.findIndex((t) => /^Nouveau solde/.test(t));
  if (ns >= 0) { const m = texts.slice(ns, ns + 3).join(' ').match(/([\d\s\u00a0]+,\d{2}) €/); if (m) closing = moneyFr(m[1]); }
  const creditX = creditColumnX(lines, /^Date Type Opération Débit/);
  const opX = columnX(lines, /^Date Type Opération Débit/, /^Op[ée]ration$/i);
  const typeMaxX = opX != null ? opX - 4 : 170;
  // Lignes du tableau : entre chaque en-tête et le pied de page.
  type Row = { date: string; type: string[]; op: string[]; amount: number | null; credit: boolean };
  const rows: Row[] = [];
  let inTable = false, cluster: TextLine[] = [], prev: TextLine | null = null;
  const flush = () => {
    if (cluster.length === 0) return;
    const dateFrag = cluster.flatMap((l) => l.frags).find((f) => f.x < 100 && /^\d{2}\/\d{2}\/\d{4}$/.test(f.s));
    if (dateFrag) {
      const type: string[] = [], op: string[] = [];
      let amount: number | null = null, credit = false;
      for (const l of cluster) for (const f of l.frags) {
        if (f === dateFrag) continue;
        if (isAmountFrag(f.s) && f.x > 400) { amount = moneyFr(f.s); credit = creditX != null ? f.x >= creditX - 12 : false; }
        else if (f.x < typeMaxX && SHINE_TYPE_WORD.test(f.s.trim())) type.push(f.s);
        else op.push(f.s);
      }
      rows.push({ date: frDate(dateFrag.s)!, type, op, amount, credit });
    }
    cluster = [];
  };
  for (const l of lines) {
    if (/^Date Type Opération/.test(l.text)) { inTable = true; cluster = []; prev = null; continue; }
    if (/^(Total des commissions|Les opérations écrites|Shine France,|Relevé d’opérations|Relevé d'opérations)/.test(l.text)) { flush(); inTable = false; prev = null; continue; }
    if (!inTable) continue;
    if (prev && (prev.page !== l.page || prev.y - l.y > 8)) flush();
    cluster.push(l); prev = l;
  }
  flush();
  const out: BankLine[] = [];
  rows.forEach((r, i) => {
    if (r.amount == null) { warnings.push(`${r.date} : montant illisible (« ${r.op.join(' ').slice(0, 40)} »)`); return; }
    const kind = r.type.join(' ').trim() || 'Virement';
    const opText = r.op.join(' ').replace(/\s+/g, ' ').trim();
    const { counterparty, description } = splitShineOp(kind, opText);
    const flow = /^Carte/i.test(kind) ? 'card' : r.credit ? 'transfer_in' : 'transfer_out';
    const full = `${counterparty} ${description}`;
    out.push({ booked_on: r.date, kind, counterparty, description, amount_out: r.credit ? null : r.amount, amount_in: r.credit ? r.amount : null, balance: null, currency: 'EUR',
      plate: extractPlate(full), vin: extractVin(full), category: classify(flow, counterparty, description, r.credit ? null : r.amount, r.credit ? r.amount : null), line_no: i + 1 });
  });
  const sumIn = out.reduce((s, l) => s + (l.amount_in ?? 0), 0), sumOut = out.reduce((s, l) => s + (l.amount_out ?? 0), 0);
  if (opening != null && closing != null && Math.abs(round2(opening + sumIn - sumOut) - closing) > 0.011) warnings.push(`solde d'ouverture + entrées − sorties ≠ solde de clôture (écart ${round2(opening + sumIn - sumOut - closing)} €) — une ligne mal lue`);
  return { account: 'shine', period_month: periodKey(start, end, out), opening_balance: opening, closing_balance: closing, currency: 'EUR', lines: out, warnings };
}

// ── Pennylane / Swan (preuve 02/10) : une ligne par mouvement ───────────────
// « 01/04/2026 Carte VINCI Autoroutes - Channing Sullivan Cloirec **4980 0,00 3,50 »
// (colonnes Crédit puis Débit, toutes deux présentes).
function parseSwan(texts: string[]): ParsedStatement {
  const warnings: string[] = [];
  // Français (« Du 01/04/2026 au 30/04/2026 41 124,57 », dates JJ/MM) ou anglais
  // (mai 2026 : « From 05/01/2026 to 05/22/2026 3,701.01 », dates MM/JJ, « Credit Transfer »).
  const perFr = texts.map((t) => t.match(/^Du (\d{2}\/\d{2}\/\d{4}) au (\d{2}\/\d{2}\/\d{4})(?: ([\d\s\u00a0]+,\d{2}))?/)).find(Boolean);
  const perEn = texts.map((t) => t.match(/^From (\d{2}\/\d{2}\/\d{4}) to (\d{2}\/\d{2}\/\d{4})(?: ([\d,]+\.\d{2}))?/)).find(Boolean);
  const en = !perFr && !!perEn;
  const per = perFr ?? perEn;
  const usDate = (d: string) => { const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };
  const toDate = en ? usDate : frDate;
  const toMoney = en ? money : moneyFr;
  const start = per ? toDate(per[1]) : null, end = per ? toDate(per[2]) : null;
  const opening = per?.[3] ? toMoney(per[3]) : null;
  const cl = texts.map((t) => t.match(en ? /^Closing balance ([\d,-]+\.\d{2})$/ : /^Solde de clôture ([\d\s\u00a0-]+,\d{2})$/)).find(Boolean);
  const closing = cl ? toMoney(cl[1]) : null;
  const out: BankLine[] = [];
  const ROW = en
    ? /^(\d{2}\/\d{2}\/\d{4}) (Card|Credit Transfer|Direct Debit|Fee|Fees|Check|\S+) (.*?) ([\d,]+\.\d{2}) ([\d,]+\.\d{2})$/
    : /^(\d{2}\/\d{2}\/\d{4}) (\S+) (.*?) ([\d\s\u00a0.]+,\d{2}) ([\d\s\u00a0.]+,\d{2})$/; // « 32.000,00 » (OCR) accepté
  const KIND_FR: Record<string, string> = { Card: 'Carte', 'Credit Transfer': 'Virement', 'Direct Debit': 'Prélèvement', Fee: 'Frais', Fees: 'Frais' };
  let inTable = false;
  for (const t of texts) {
    if (/^Date Type Description/.test(t)) { inTable = true; continue; }
    if (/^(Frais|Fees|Total|Solde de clôture|Closing balance)\b/.test(t)) { inTable = false; continue; }
    if (!inTable) continue;
    const m = t.match(ROW);
    if (!m) continue;
    const [, d, typeRaw, desc, cr, db] = m;
    const type = KIND_FR[typeRaw] ?? typeRaw;
    const credit = toMoney(cr), debit = toMoney(db);
    const isIn = credit > 0 && debit === 0;
    let counterparty = desc.trim(), description = '';
    const card = desc.match(/^(.*?) - Channing/);
    if (card) counterparty = card[1].trim();
    else if (!/^Carte$/i.test(type)) { counterparty = ''; description = desc.trim(); }
    const flow = /^Carte/i.test(type) ? 'card' : isIn ? 'transfer_in' : 'transfer_out';
    const full = `${counterparty} ${description}`;
    out.push({ booked_on: toDate(d)!, kind: type, counterparty, description, amount_out: isIn ? null : debit, amount_in: isIn ? credit : null, balance: null, currency: 'EUR',
      plate: extractPlate(full), vin: extractVin(full), category: classify(flow, counterparty, description, isIn ? null : debit, isIn ? credit : null), line_no: out.length + 1 });
  }
  const sumIn = out.reduce((s, l) => s + (l.amount_in ?? 0), 0), sumOut = out.reduce((s, l) => s + (l.amount_out ?? 0), 0);
  // Ligne « Total <crédits> <débits> » : si les lignes lues la recoupent au
  // centime, elles sont justes et c'est le solde de clôture qui est mal lu
  // (OCR : « 4124,57 » pour 41 124,57, constat 02/10 soir) → recalculé.
  const tot = texts.map((t) => t.match(en ? /^Total ([\d,]+\.\d{2}) ([\d,]+\.\d{2})$/ : /^Total ([\d\s\u00a0.]+,\d{2}) ([\d\s\u00a0.]+,\d{2})$/)).find(Boolean);
  const totalsOk = !!tot && Math.abs(toMoney(tot[1]) - sumIn) < 0.011 && Math.abs(toMoney(tot[2]) - sumOut) < 0.011;
  let closingOut = closing;
  if (opening != null && closing != null && Math.abs(round2(opening + sumIn - sumOut) - closing) > 0.011) {
    if (totalsOk) { closingOut = round2(opening + sumIn - sumOut); warnings.push(`solde de clôture lu « ${closing} » mais les lignes recoupent les totaux du relevé au centime : clôture recalculée à ${closingOut} €`); }
    else warnings.push(`solde d'ouverture + entrées − sorties ≠ solde de clôture (écart ${round2(opening + sumIn - sumOut - closing)} €) — une ligne mal lue`);
  }
  return { account: 'pennylane', period_month: periodKey(start, end, out), opening_balance: opening, closing_balance: closingOut, currency: 'EUR', lines: out, warnings };
}

// ── CIC (preuve 02/10) ──────────────────────────────────────────────────────
// « 05/06/2026 05/06/2026 PAIEMENT CB 0406 CHATEAU RENAU 24,30 » puis la
// ligne « CRF CH RENAULT CARTE 6977 » en dessous ; Débit / Crédit par
// l'abscisse du montant ; marques de marge (« 2 », « 0 », « X ») ignorées.
function parseCic(lines: TextLine[]): ParsedStatement {
  const warnings: string[] = [];
  const creditX = creditColumnX(lines, /^Date Date valeur Opération/);
  let opening: number | null = null, closing: number | null = null, start: string | null = null, end: string | null = null;
  type Row = { date: string; head: string; amount: number; credit: boolean; more: string[] };
  const rows: Row[] = [];
  let cur: Row | null = null, inTable = false;
  for (const l of lines) {
    const t = l.text;
    const sold = t.match(/^(?:Réf : \d+ )?SOLDE (CREDITEUR|DEBITEUR) AU (\d{2}\/\d{2}\/\d{4}) ([\d\s\u00a0.]+,\d{2})$/);
    if (sold) { const v = moneyFr(sold[3]) * (sold[1] === 'DEBITEUR' ? -1 : 1); if (opening == null) { opening = v; start = frDate(sold[2]); } else { closing = v; end = frDate(sold[2]); } cur = null; continue; }
    if (/^Date Date valeur Opération/.test(t)) { inTable = true; cur = null; continue; }
    if (/^(Total des mouvements|<<Suite au verso>>|Information sur la protection|UN\.\d|www\.garantiedesdepots|Sous réserve des extournes|Page \d+|Banque CIC|2, avenue|Médiateur du CIC|Pour les opérations|Pour toute demande|RELEVE ET INFORMATIONS|COMPTE SERVICE|Ouest$|CIC MAINE|21 RUE DE LA|02 41 25|% \)|30047$|14293$|MC EXPORT$|88 B AVENUE|49130 LES PONTS|VOTRE CONSEILLER|\( G[ED] \)|\d{1,2} [a-zéû]+ \d{4}$|\.{10,})/.test(t)) { if (/^Total des mouvements/.test(t)) inTable = false; continue; }
    if (!inTable) continue;
    if (t.length <= 1) continue;
    const dateFrag = l.frags.find((f) => /^\d{2}\/\d{2}\/\d{4}$/.test(f.s));
    const dateFrags = l.frags.filter((f) => /^\d{2}\/\d{2}\/\d{4}$/.test(f.s));
    if (dateFrag && dateFrags.length >= 2 && dateFrags[0].x < 80) {
      const amtFrag = [...l.frags].reverse().find((f) => isAmountFrag(f.s) && f.x > 380);
      if (!amtFrag) { warnings.push(`${dateFrag.s} : montant illisible`); cur = null; continue; }
      const head = l.frags.filter((f) => f !== amtFrag && !/^\d{2}\/\d{2}\/\d{4}$/.test(f.s)).map((f) => f.s).join(' ').trim();
      cur = { date: frDate(dateFrag.s)!, head, amount: moneyFr(amtFrag.s), credit: creditX != null ? amtFrag.x >= creditX - 15 : false, more: [] };
      rows.push(cur);
      continue;
    }
    if (cur) cur.more.push(t);
  }
  const out: BankLine[] = rows.map((r, i) => {
    const detail = r.more.join(' ').replace(/\s+CARTE \d{4}$/, '').replace(/\s+/g, ' ').trim();
    const km = r.head.match(/^((?:\d+ )?PAIEMENTS?(?: CB| PSC)?|VIR(?:EMENT)? \w+|PRLV(?: SEPA)?|REM(?:ISE)? \w+|FRAIS \w*|COMMISSIONS?|RETRAIT \w*|COTIS\w*)\b\s*(\d{4})?\s*(.*)$/i);
    const kind = km ? km[1].trim() : r.head.split(' ').slice(0, 2).join(' ');
    const place = km ? km[3].trim() : r.head;
    const card = /PAIEMENT|RETRAIT/i.test(kind);
    const counterparty = card ? (detail || place) : (detail ? `${place} ${detail}`.trim() : place);
    const description = card ? place : '';
    const flow = card ? 'card' : /FRAIS|COMMISSION|COTIS/i.test(kind) ? 'fee' : r.credit ? 'transfer_in' : 'transfer_out';
    const full = `${counterparty} ${description}`;
    return { booked_on: r.date, kind, counterparty, description, amount_out: r.credit ? null : r.amount, amount_in: r.credit ? r.amount : null, balance: null, currency: 'EUR',
      plate: extractPlate(full), vin: extractVin(full), category: classify(flow, counterparty, description, r.credit ? null : r.amount, r.credit ? r.amount : null), line_no: i + 1 };
  });
  const sumIn = out.reduce((s, l) => s + (l.amount_in ?? 0), 0), sumOut = out.reduce((s, l) => s + (l.amount_out ?? 0), 0);
  if (opening != null && closing != null && Math.abs(round2(opening + sumIn - sumOut) - closing) > 0.011) warnings.push(`solde d'ouverture + entrées − sorties ≠ solde de clôture (écart ${round2(opening + sumIn - sumOut - closing)} €) — une ligne mal lue`);
  return { account: 'cic', period_month: periodKey(start, end, out), opening_balance: opening, closing_balance: closing, currency: 'EUR', lines: out, warnings };
}

// ── Caisse d'Épargne (preuve 02/10) ─────────────────────────────────────────
// « 27/05/2026 27/05/2026 VIR SEPA BELLON MOTORSPORT DI G + 61 000,00 » puis
// les lignes de détail en dessous ; le signe donne le sens.
function parseCaisseEpargne(texts: string[]): ParsedStatement {
  const warnings: string[] = [];
  let opening: number | null = null, closing: number | null = null, start: string | null = null, end: string | null = null;
  type Row = { date: string; head: string; amount: number; credit: boolean; more: string[] };
  const rows: Row[] = [];
  let cur: Row | null = null, inTable = false;
  const ROW = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}\/\d{2}\/\d{4}) (.*?) ([+-]) ([\d\s\u00a0]+,\d{2})$/;
  for (const t of texts) {
    const sold = t.match(/^SOLDE (CREDITEUR|DEBITEUR) AU (\d{2}\/\d{2}\/\d{4}) ([+-]) ([\d\s\u00a0]+,\d{2})$/);
    if (sold) { const v = moneyFr(sold[4]) * (sold[3] === '-' ? -1 : 1); if (!inTable || opening == null) { opening = v; start = frDate(sold[2]); inTable = true; } else { closing = v; end = frDate(sold[2]); inTable = false; } cur = null; continue; }
    if (!inTable) continue;
    const m = t.match(ROW);
    if (m) { cur = { date: frDate(m[1])!, head: m[3].trim(), amount: moneyFr(m[5]), credit: m[4] === '+', more: [] }; rows.push(cur); continue; }
    if (/^(Conditions d'arrêté|Taux d'intérêts|EN\d{10,}|Commission de|Caisse d'Epargne et de|PH\d|directoire|Nantes - |\d{6} perception|75013 PARIS|\d{4} \d{6}$|14445$)/.test(t)) { cur = null; continue; }
    if (cur) cur.more.push(t);
  }
  const out: BankLine[] = rows.map((r, i) => {
    const km = r.head.match(/^(\*?FRAIS[^A-Z]*|VIR (?:SEPA|INST|INSTANTANE)|VIREMENT \w+|PRLV(?: SEPA)?|CB \w+|CHEQUE|REMISE \w+|COMMISSIONS?)\s*(.*)$/i);
    const kind = km ? km[1].trim() : r.head.split(' ').slice(0, 2).join(' ');
    let counterparty = km ? km[2].trim() : r.head;
    const more = r.more.map((x) => x.replace(/^-?(Provenance|Réf\. donneur d'ordre|Référence|Libellé)\s*:\s*/i, '').trim()).filter((x) => x && !/^[0-9A-Z]{10,}$/.test(x));
    const prov = r.more.map((x) => x.match(/^-?Provenance:(.+)$/i)?.[1]?.trim()).find(Boolean);
    if (prov) counterparty = prov;
    const description = [...new Set(more.filter((x) => x !== prov))].join(' · ');
    const flow = /FRAIS|COMMISSION/i.test(kind) ? 'fee' : /^CB/i.test(kind) ? 'card' : r.credit ? 'transfer_in' : 'transfer_out';
    const full = `${counterparty} ${description}`;
    // VIN coupé par le retour à la ligne (« WPOZZZ » / « 99Z7S722520 ») : recollé.
    const vin = extractVin(full) ?? extractVin(r.more.join('').replace(/\s+/g, ''));
    return { booked_on: r.date, kind, counterparty, description, amount_out: r.credit ? null : r.amount, amount_in: r.credit ? r.amount : null, balance: null, currency: 'EUR',
      plate: extractPlate(full), vin, category: classify(flow, counterparty, description, r.credit ? null : r.amount, r.credit ? r.amount : null), line_no: i + 1 };
  });
  const sumIn = out.reduce((s, l) => s + (l.amount_in ?? 0), 0), sumOut = out.reduce((s, l) => s + (l.amount_out ?? 0), 0);
  if (opening != null && closing != null && Math.abs(round2(opening + sumIn - sumOut) - closing) > 0.011) warnings.push(`solde d'ouverture + entrées − sorties ≠ solde de clôture (écart ${round2(opening + sumIn - sumOut - closing)} €) — une ligne mal lue`);
  return { account: 'caisse_epargne', period_month: periodKey(start, end, out), opening_balance: opening, closing_balance: closing, currency: 'EUR', lines: out, warnings };
}

/**
 * CHAÎNE DES SOLDES (relevés qui donnent le solde après chaque mouvement :
 * Finom, Revolut), lignes du plus récent au plus ancien : solde[i] =
 * solde[i+1] + montant[i]. Une ligne seule en défaut dont les voisines
 * tiennent = son montant est mal lu (OCR « 36,02 » pour 48,12) → corrigé
 * d'après les soldes, et dit. Deux défauts consécutifs = un solde mal lu, ou
 * une ligne manquante : rien n'est changé, l'endroit est nommé.
 */
function reconcileChain<R extends { date: string; amount: number; balance: number | null }>(rows: R[], labelOf: (r: R) => string, warnings: string[]): void {
  const bad = (i: number) => i + 1 < rows.length && rows[i].balance != null && rows[i + 1].balance != null && Math.abs(round2((rows[i + 1].balance as number) + rows[i].amount) - (rows[i].balance as number)) > 0.011;
  const fixed: string[] = [], left: string[] = [];
  // Deux défauts consécutifs (i et i+1) : si un seul solde — celui du milieu —
  // explique les deux (OCR « 53 237,91 » pour 51 237,91), on corrige ce solde.
  for (let i = 0; i + 2 < rows.length; i++) {
    if (!bad(i) || !bad(i + 1) || rows[i].balance == null || rows[i + 2].balance == null) continue;
    const mid = round2((rows[i].balance as number) - rows[i].amount);
    if (Math.abs(round2((rows[i + 2].balance as number) + rows[i + 1].amount) - mid) <= 0.011) { fixed.push(`${rows[i + 1].date} ${labelOf(rows[i + 1])} : solde lu ${rows[i + 1].balance} €, corrigé à ${mid} €`); rows[i + 1].balance = mid; }
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    if (!bad(i)) continue;
    const implied = round2((rows[i].balance as number) - (rows[i + 1].balance as number));
    const prevOk = i === 0 || !bad(i - 1), nextOk = !bad(i + 1);
    const sameSign = Math.sign(implied) === Math.sign(rows[i].amount) || rows[i].amount === 0;
    if (prevOk && nextOk && sameSign && Math.abs(implied) < 1_000_000) { fixed.push(`${rows[i].date} ${labelOf(rows[i])} : lu ${rows[i].amount} €, corrigé à ${implied} € d'après les soldes`); rows[i].amount = implied; }
    else left.push(`${rows[i].date} ${labelOf(rows[i])} (lu ${rows[i].amount} €, solde ${rows[i].balance} → ${rows[i + 1].balance})`);
  }
  if (fixed.length) warnings.push(`${fixed.length} montant(s) corrigé(s) par la chaîne des soldes : ${fixed.slice(0, 5).join(' ; ')}`);
  if (left.length) warnings.push(`${left.length} endroit(s) où le solde ne suit pas (ligne manquante ou solde mal lu) : ${left.slice(0, 5).join(' ; ')}`);
}

// ── Banque Populaire Grand Ouest (preuve 03/10, relevé n°9 au 02/01/2026) ──
// « Votre relevé de compte n°9 au 02/01/2026 » (l'année vient de là : les
// dates des lignes sont « 01/12 » sans année) ; « SOLDE CREDITEUR AU
// 28/11/2025 42 341,58 € » en tête, un solde intermédiaire au 31/12, le
// solde final marqué « * ». Ligne = date compta (x ≈ 51), libellé (x ≈ 102),
// référence, date opération, date valeur, montant à droite (« - 20,77 € »
// = débit, sans signe = crédit) ; détails en dessous (x ≈ 108), dont une
// ligne de change « 20,77EUR 1 EURO = 1,000000 » ignorée. Le tableau
// s'arrête à « TOTAL DES MOUVEMENTS » ; la section « DETAIL DE VOS
// MOUVEMENTS SEPA » qui suit répète les virements, elle est ignorée.
function parseBpgo(lines: TextLine[]): ParsedStatement {
  const warnings: string[] = [];
  const texts = lines.map((l) => l.text);
  const endM = texts.map((t) => t.match(/relev[ée] de compte n°\s*\d+ au (\d{2})\/(\d{2})\/(\d{4})/i) ?? t.match(/RELEVE N° ?\d+ AU (\d{2})\/(\d{2})\/(\d{4})/)).find(Boolean);
  const endYear = endM ? Number(endM[3]) : new Date().getFullYear(), endMonth = endM ? Number(endM[2]) : 12;
  const yearOf = (mm: number) => (mm > endMonth ? endYear - 1 : endYear);
  let opening: number | null = null, closing: number | null = null, end: string | null = null;
  let totalDebit: number | null = null, totalCredit: number | null = null;
  type Row = { date: string; label: string; amount: number; credit: boolean; more: string[] };
  const rows: Row[] = [];
  let cur: Row | null = null, inTable = false, done = false;
  for (const l of lines) {
    if (done) break;
    const t = l.text;
    const sold = t.match(/^SOLDE (CREDITEUR|DEBITEUR) AU (\d{2})\/(\d{2})\/(\d{4})(\*?) ([\d\s\u00a0]+,\d{2}) €$/);
    if (sold) {
      const v = moneyFr(sold[6]) * (sold[1] === 'DEBITEUR' ? -1 : 1);
      if (opening == null) { opening = v; inTable = true; }
      else { closing = v; end = `${sold[4]}-${sold[3]}-${sold[2]}`; if (sold[5] === '*') done = true; }
      cur = null; continue;
    }
    const td = t.match(/^TOTAL DES MOUVEMENTS (DEBITEURS|CREDITEURS) -? ?([\d\s\u00a0]+,\d{2}) €$/);
    if (td) { if (td[1] === 'DEBITEURS') totalDebit = moneyFr(td[2]); else totalCredit = moneyFr(td[2]); cur = null; continue; }
    if (/^DETAIL DE VOS (MOUVEMENTS|PRELEVEMENTS|VIREMENTS) SEPA/.test(t)) { done = true; break; }
    if (!inTable) continue;
    // Marques de marge (« 0001 », « 0002 » à x ≈ 9) devant la date sur certaines lignes : ignorées.
    const frags = l.frags.filter((f) => f.x >= 20);
    const first = frags[0], last = frags[frags.length - 1];
    const isRow = first && first.x <= 60 && /^\d{2}\/\d{2}$/.test(first.s) && last && last.x >= 495 && /^-?\s?[\d\s\u00a0]+,\d{2} €$/.test(last.s);
    if (isRow) {
      const [dd, mm] = first.s.split('/').map(Number);
      const label = frags.filter((f) => f.x > 60 && f.x < 300).map((f) => f.s).join(' ').replace(/\s+/g, ' ').trim();
      const credit = !last.s.trim().startsWith('-');
      cur = { date: `${yearOf(mm)}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, label, amount: moneyFr(last.s.replace(/[-€]/g, '')), credit, more: [] };
      rows.push(cur); continue;
    }
    if (!cur || !first || first.x < 90 || first.x > 115) continue;
    if (/^[\d\s\u00a0]+,\d{2}EUR 1 EURO =/.test(t) || /^0000\d OPERATION$/.test(t) || /^X[A-Z]{4}\d{3} \d{20,}/.test(t)) continue;
    cur.more.push(t);
  }
  const out: BankLine[] = rows.map((r, i) => {
    const km = r.label.match(/^(\d{6} CB\*{4}\d{4}|VIR INST|VIR DE|EUROVIR SEPA|VIR|PRLV SEPA|FRAIS VIREMENT|FRAIS CHEQUE BANQUE|FRAIS ACHAT ETRANGER\w*|FRAIS \w+|CHEQUE BANQUE|COTIS \w+|REJET TECHNIQUE|REMISE \w+|RETRAIT \w*|COMMISSION\w*)\s*(.*)$/i);
    const rawKind = km ? km[1] : r.label.split(' ').slice(0, 2).join(' ');
    const kind = /CB\*{4}/.test(rawKind) ? 'CB' : rawKind.toUpperCase();
    const rest = km ? km[2].trim() : r.label;
    const details = r.more.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    let counterparty = rest, description = details.join(' · ');
    if (kind === 'CB') { counterparty = (details[0] ?? '').replace(/\s*(FR|ES|NL|DE|BE|IT|LU|PT|GB|CH)\s+[\dA-Z][^·]*$/, '').trim() || rest; description = details.slice(1).join(' · '); }
    else if (kind === 'EUROVIR SEPA') { counterparty = (details[0] ?? '').replace(/^VIR\s+/, '').trim() || rest; description = details.slice(1).join(' · '); }
    else if (kind === 'VIR DE') { counterparty = details[1] ?? rest; description = details[0] ?? ''; }
    const flow = kind === 'CB' ? 'card' : /^(FRAIS|COTIS|COMMISSION)/.test(kind) ? 'fee' : r.credit ? 'transfer_in' : 'transfer_out';
    const full = `${counterparty} ${description}`;
    return { booked_on: r.date, kind, counterparty, description, amount_out: r.credit ? null : r.amount, amount_in: r.credit ? r.amount : null, balance: null, currency: 'EUR',
      plate: extractPlate(full), vin: extractVin(full), category: classify(flow, counterparty, description, r.credit ? null : r.amount, r.credit ? r.amount : null), line_no: i + 1 };
  });
  const sumIn = out.reduce((s, l) => s + (l.amount_in ?? 0), 0), sumOut = out.reduce((s, l) => s + (l.amount_out ?? 0), 0);
  if (totalCredit != null && Math.abs(totalCredit - sumIn) > 0.011) warnings.push(`crédits lus ${round2(sumIn)} € ≠ total des mouvements créditeurs ${totalCredit} €`);
  if (totalDebit != null && Math.abs(totalDebit - sumOut) > 0.011) warnings.push(`débits lus ${round2(sumOut)} € ≠ total des mouvements débiteurs ${totalDebit} €`);
  if (opening != null && closing != null && Math.abs(round2(opening + sumIn - sumOut) - closing) > 0.011) warnings.push(`solde d'ouverture + entrées − sorties ≠ solde de clôture (écart ${round2(opening + sumIn - sumOut - closing)} €) — une ligne mal lue`);
  // Mois du relevé : celui de la majorité des mouvements (le relevé va du 2 au 2 du mois suivant).
  const counts = new Map<string, number>();
  for (const l of out) counts.set(l.booked_on.slice(0, 7), (counts.get(l.booked_on.slice(0, 7)) ?? 0) + 1);
  const month = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (end ?? '').slice(0, 7);
  return { account: 'bpgo', period_month: month, opening_balance: opening, closing_balance: closing, currency: 'EUR', lines: out, warnings };
}

// ── Finom (preuve 02/10 soir, relevé OCR : PDF scanné) ─────────────────────
// « Du: 01/03/2026 » / « Au: 31/03/2026 », « Solde d'ouverture : 0,00€ »,
// lignes du plus récent au plus ancien : « 27/03/2026 Mc export - 149 435,35 €
// 13,63 € » (montant signé puis solde APRÈS le mouvement), puis le motif, puis
// « IBAN: … » / « BIC: … » du tiers (ignorés). Sens vérifié par le solde.
function parseFinom(texts: string[]): ParsedStatement {
  const warnings: string[] = [];
  const g = (re: RegExp) => texts.map((t) => t.match(re)).find(Boolean);
  const start = frDate(g(/^Du\s*:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? ''), end = frDate(g(/^Au\s*:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? '');
  const ob = g(/^Solde d'ouverture\s*:\s*(-?\s?[\d\s\u00a0.]*\d,\d{2})\s?€/), cb = g(/^Solde de cl[oô]ture\s*:\s*(-?\s?[\d\s\u00a0.]*\d,\d{2})\s?€/);
  const signed = (sgn: string | undefined, v: string) => moneyFr(v) * (sgn ? -1 : 1);
  const opening = ob ? moneyFr(ob[1].replace(/\s/g, '')) : null, closing = cb ? moneyFr(cb[1].replace(/\s/g, '')) : null;
  const ROW = /^(\d{2}\/\d{2}\/\d{4}) (.+?) (-\s?)?(\d[\d\s\u00a0.]*,\d{2})\s?€\s*(-\s?)?(\d[\d\s\u00a0.]*,\d{2})\s?€$/;
  type Row = { date: string; cp: string; amount: number; balance: number; more: string[]; hasIban: boolean };
  const rows: Row[] = [];
  let cur: Row | null = null;
  for (const t of texts) {
    const m = t.match(ROW);
    if (m) { cur = { date: frDate(m[1])!, cp: m[2].trim(), amount: signed(m[3], m[4]), balance: signed(m[5], m[6]), more: [], hasIban: false }; rows.push(cur); continue; }
    if (!cur) continue;
    if (/^(IBAN|BIC)\s*:/i.test(t)) { if (/^IBAN/i.test(t)) cur.hasIban = true; continue; }
    if (/^(finom|\d{1,2}|Terminé Description|MC EXPORT RELEVÉ|Numéro de TVA|Main$|Du\s*:|Au\s*:|Solde d)/i.test(t)) { cur = null; continue; }
    cur.more.push(t);
  }
  reconcileChain(rows, (r) => r.cp, warnings);
  const out: BankLine[] = rows.map((r, i) => {
    const description = r.more.join(' ').replace(/\s+/g, ' ').trim();
    const isIn = r.amount > 0;
    const kind = r.hasIban || /transfert|virement|facture|acompte|achat/i.test(description) ? 'Virement' : 'Carte';
    const flow = kind === 'Carte' ? 'card' : isIn ? 'transfer_in' : 'transfer_out';
    const full = `${r.cp} ${description}`;
    return { booked_on: r.date, kind, counterparty: r.cp, description, amount_out: isIn ? null : Math.abs(r.amount), amount_in: isIn ? r.amount : null, balance: r.balance, currency: 'EUR',
      plate: extractPlate(full), vin: extractVin(full), category: classify(flow, r.cp, description, isIn ? null : Math.abs(r.amount), isIn ? r.amount : null), line_no: i + 1 };
  });
  const sumIn = out.reduce((s, l) => s + (l.amount_in ?? 0), 0), sumOut = out.reduce((s, l) => s + (l.amount_out ?? 0), 0);
  if (opening != null && closing != null && Math.abs(round2(opening + sumIn - sumOut) - closing) > 0.011) warnings.push(`solde d'ouverture + entrées − sorties ≠ solde de clôture (écart ${round2(opening + sumIn - sumOut - closing)} €) — une ligne mal lue`);
  return { account: 'finom', period_month: periodKey(start, end, out), opening_balance: opening, closing_balance: closing, currency: 'EUR', lines: out, warnings };
}

// ── Revolut ─────────────────────────────────────────────────────────────────
// Anglais (juillet, août 2026) ET français (mai, juin 2026 : « 29 mai 2026 MOS À X • Achat … », « Recharge par »,
// « Solde d'ouverture », « Transactions de 5 mai 2026 à 31 mai 2026 », « Types de transactions »).
const REV_ROW = /^(\d{1,2}) ([A-Za-zéû]+\.?) (\d{4}) ([A-Z]{3}) (.*)$/;
const REV_STOP = /^(Transaction types|Types de transactions|Report lost or stolen card|Signaler une carte|Account statement|Relevé de compte|Generated on the|Relevé généré|©|Balance summary|Résumé du solde|Your funds are held|Vos fonds sont|Account name|Nom du compte|There were no transactions|Aucune transaction|For transactions to and from)/;
const REV_NOISE = /^(\+370|Get help directly|Obtenir de l'aide|Scan the QR code|Scanner le QR|out to us via|questions bancaires|Lituanie\.|garantie des dépôts|draudimas|Konstitucijos|Authority and whose|\d+\/\d+$|FX Rate |Taux de change|[$£]\s?[\d ,.]+$)/;
const REV_CP_PREFIX = /^(To|À|A|Money added from|Recharge par|From|De)\s+/i;
const EUR_TOKEN = /€\s?[\d   ]*\d\.\d{2}/g;
const REV_OUT = new Set(['MOS', 'CAR', 'FEE', 'ATM', 'EXO']);

// ── Revolut « Relevé de transactions » (export filtré, 04/10 : REVOLUT_SEPTEMBRE_2026.pdf, « Transactions de 5 mai
//    2026 à 21 septembre 2026 », compte clôturé) ── pas de solde, colonnes Argent sortant / entrant, une
//    transaction = la ligne datée (« 21 sept. MOS À Mc export • Transfert interne Terminé Main · €7 ») + la ligne
//    suivante (« 2026 EUR 094.26 ») qui porte l'année, la devise et la fin du montant coupé au millier.
const REVX_ROW = /^(\d{1,2}) ([A-Za-zéû]+)\.? ([A-Z]{3}) (.+?) (Terminé|Completed|Annulé|Reverted|En attente|Pending|Refusé|Declined|Échoué|Failed) (.+?) · €?([\d][\d ,.]*)$/;
const REVX_TAIL = /^(\d{4})(?: (.*?))? ([A-Z]{3})(?: ([\d ,.]+))?$/;
function parseRevolutExport(lines: TextLine[]): ParsedStatement {
  const warnings: string[] = ['export « Relevé de transactions » : pas de solde d\'ouverture ni de clôture, le contrôle des soldes est impossible'];
  const texts = lines.map((l) => l.text);
  const per = texts.map((t) => t.match(/^Transactions (?:de|du|from) (\d{1,2}) ([A-Za-zéû]+\.?) (\d{4}) (?:à|au|to) (\d{1,2}) ([A-Za-zéû]+\.?) (\d{4})/)).find(Boolean);
  const start = per ? ymd(per[1], per[2], per[3]) : null, end = per ? ymd(per[4], per[5], per[6]) : null;
  const out: BankLine[] = [];
  for (let i = 0; i < texts.length; i++) {
    const m = texts[i].match(REVX_ROW);
    if (!m) continue;
    // La ligne d'année suit, parfois après une ligne de taux de change (« Taux de change 1 EUR = 1.137004 USD $12.00 ») ;
    // elle peut porter la suite du libellé (« 2026 coupe telaio WP0ZZZ99Z7S726158 EUR 500.00 »).
    let tail: RegExpMatchArray | null = null;
    for (let j = i + 1; j <= i + 3 && j < texts.length; j++) { const t = texts[j].match(REVX_TAIL); if (t) { tail = t; break; } if (!REV_NOISE.test(texts[j])) break; }
    if (!tail) { warnings.push(`« ${texts[i].slice(0, 50)} » : ligne d'année / devise absente`); continue; }
    const [, d, mon, kind, desc0, status, , head] = m;
    const [, year, more, currency, rest] = tail;
    const desc = more ? `${desc0} ${more}` : desc0;
    if (!/^(Terminé|Completed)$/.test(status)) continue; // annulé, en attente, refusé : pas d'argent bougé
    if (currency !== 'EUR') { warnings.push(`${d} ${mon} ${year} ${kind} « ${desc.slice(0, 40)} » en ${currency} : ignorée (compte EUR seulement)`); continue; }
    const amount = Number(`${head}${rest ?? ''}`.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) { warnings.push(`${d} ${mon} ${year} : montant illisible « ${head} ${rest ?? ''} »`); continue; }
    const booked = ymd(d, mon, year);
    const isOut = REV_OUT.has(kind) || (!['MOA', 'MOR', 'TOP'].includes(kind) && !/^(De|From) /.test(desc));
    const text = desc.replace(/\s+/g, ' ').trim();
    const sep = text.indexOf(' • ');
    let counterparty = sep > 0 ? text.slice(0, sep) : text, description = sep > 0 ? text.slice(sep + 3) : '';
    counterparty = counterparty.replace(/^(À|To|De|From|Recharge par|Top-up by) /i, '').trim();
    const full = `${counterparty} ${description}`;
    out.push({ booked_on: booked, kind, counterparty, description, amount_out: isOut ? amount : null, amount_in: isOut ? null : amount, balance: null, currency: 'EUR',
      plate: extractPlate(full), vin: extractVin(full), category: classify(kind, counterparty, description, isOut ? amount : null, isOut ? null : amount), line_no: out.length + 1 });
  }
  out.sort((a, b) => a.booked_on.localeCompare(b.booked_on) || a.line_no - b.line_no);
  out.forEach((l, i) => { l.line_no = i + 1; });
  if (out.length === 0) throw new Error('export Revolut : aucune transaction terminée en EUR trouvée');
  const months = [...new Set(out.map((l) => l.booked_on.slice(0, 7)))].sort();
  const last = months[months.length - 1];
  return { account: 'revolut', account_name: 'Main', period_month: periodKey(start && start.slice(0, 7) === last ? start : `${last}-01`, end, out), opening_balance: null, closing_balance: null, currency: 'EUR', lines: out, warnings,
    split_by_month: months.length > 1, period_start: start, period_end: end };
}
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
    const curM = line.match(/(?:Currency|Devise) ([A-Z]{3})$/);
    if (curM) { currency = curM[1]; cur = null; inTable = false; continue; }
    const per = line.match(/^Transactions (?:from|de|du) (\d{1,2}) ([A-Za-zéû]+\.?) (\d{4}) (?:to|à|au)/);
    if (per) { if (!period) period = ymd(per[1], per[2], per[3]).slice(0, 7); inTable = true; cur = null; continue; }
    if (currency === 'EUR') {
      const ob = line.match(/^(?:Opening balance|Solde d'ouverture) €([\d ,.]+)$/); if (ob) opening = money(ob[1]);
      const cb = line.match(/^(?:Closing balance|Solde de clôture) €([\d ,.]+)$/); if (cb) closing = money(cb[1]);
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
    if (sep >= 0) { counterparty = r.text.slice(0, sep).replace(REV_CP_PREFIX, '').trim(); description = r.text.slice(sep + 1).trim(); }
    else if (r.kind === 'CAR') { counterparty = r.text.trim(); description = ''; }
    else { counterparty = r.text.replace(REV_CP_PREFIX, '').trim(); description = ''; }
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
/**
 * Règles qui ne dépendent ni de la banque ni du type de ligne (reprises par
 * la réparation des lignes déjà en base, 03/10 soir) :
 * - tiers = la société elle-même (« SAS MC EXPORT », « MC EXPORT 2 C26W… »
 *   du CIC, « MC EXPORT SAS » de Finom) = virement entre ses propres comptes,
 *   même si le libellé dit « Achat Aygo » : l'achat est sur l'autre compte.
 *   Constat : 72 326 € BPGO → Shine comptés en facture fournisseur ET en
 *   vente encaissée, 10 000 € CIC → Shine comptés en achats de véhicules.
 * - Deel = paie (plateforme de salaires), 19 968 € en « factures ».
 */
export function classifyAny(counterparty: string, description: string, out?: number | null, inn?: number | null): BankCategory | null {
  const cp = norm(counterparty), ds = norm(description), all = `${cp} ${ds}`;
  // Tiers = la société, sauf si le libellé porte une plaque (« Achat Aygo x HA134RA » payé depuis Finom,
  // « Achat yaris cross gf922wt » depuis Revolut : l'argent a acheté une voiture, il n'est arrivé sur aucun autre compte).
  if (/\bmc export\b/.test(cp) && !extractPlate(description)) return 'transfert_interne';
  if (/revolut business fee|airwallex|frais bancaires|commission d'intervention|abonnement shine|frais paiement|frais de tenue|cotisation carte/.test(all)) return 'frais_bancaires';
  // Charges sociales (URSSAF, retraite ALPRO / AGIRC) = coût de la paie, pas un impôt : elles entrent dans les frais (04/10).
  if (/urssaf|retraite|alpro|agirc|arrco|mutuelle|prevoyance/.test(all)) return 'salaire';
  if (/impots|impot[ .]|dgfip|finances publiques|tresor public|\btva\b|93033811600013|douane|\bsie\b|\bis\b.*rejet|rejet.*\bis\b|\bis[1-4]-\d{6}|\brcm1-\d{6}|\bcfe\b|\bcvae\b/.test(all)) return 'impots_tva';
  if (/bulletin de salaire|\bsalaire|\bpaie\b|\bdeel\b/.test(all)) return 'salaire';
  // AVOIR / REMBOURSEMENT (03/10 soir, « Avoir 00000056 » 27 600 € rendus à Wilar comptés en achat de véhicule,
  // Abf6 34 000 € relié « montant unique » à un dossier) : sortie vers un client = remboursement, entrée = remboursement reçu.
  if (/\bavoir ?\d|\bavoir\b|\brefund\b|rembours|vente annulee/.test(ds)) { if (out) return 'remboursement_client'; if (inn) return 'remboursement_recu'; }
  if (/gf holding/.test(cp)) return 'loyer'; // loyer = GF Holding (Channing 03/10 soir)
  if (/geo conseils/.test(cp)) return 'comptable';
  if (/mol ?\*? ?transport|uab axis auto|christian cloirec/.test(all)) return 'logistique'; // transport de véhicules (Channing 03/10 soir)
  // Virement entre nos comptes écrit côté réception sans tiers (Pennylane « Transferts interne de fonds »,
  // « VIR DE MC EXPORT », « Virement pour MC EXPORT » : 126 000 € comptés en ventes, 109 000 € en achats, 03/10 soir).
  // Un paiement à un tiers qui met « MC EXPORT » en référence (Toyota Kreditbank, « INTERVENTION … - MC EXPORT ») n'en est pas un.
  if (/tran?sferts? ?(interne|de fonds)|transferts? internes?|vir(ement)? (de|pour) mc export|transfert mc export/.test(ds)) return 'transfert_interne';
  if (/\bmc export\b/.test(cp)) return 'achat_vehicule';
  return null;
}
export function classify(kind: string, counterparty: string, description: string, out: number | null, inn: number | null): BankCategory {
  const cp = norm(counterparty), ds = norm(description), all = `${cp} ${ds}`;
  if (kind === 'ATM' || /^RETRAIT/i.test(kind)) return 'retrait_especes';
  if (kind === 'FEE' || kind === 'Fee' || kind === 'fee' || (kind === 'Adjustment' && /fees|invoice number/.test(all))) return 'frais_bancaires';
  const any = classifyAny(counterparty, description, out, inn);
  if (any) return any;
  const isIn = inn != null && (kind === 'MOA' || kind === 'MOR' || kind === 'Deposit' || kind === 'transfer_in');
  const isOutTransfer = out != null && (kind === 'MOS' || kind === 'Payout' || kind === 'Transfer' || kind === 'transfer_out');
  if (isIn) {
    if (/acquisto|achat|fattura|factuur|facture|\bfac\d|saldo|vente|solde|acompte|anticipo|invoice|yaris|ignis|sprinter|porsche|^[A-Z0-9]{6,}$/i.test(all) || inn >= 3000) return 'vente_encaissee';
    return 'autre';
  }
  if (isOutTransfer) {
    // Note de frais remboursée à quelqu'un (« Notes de frais channing gasoil man TGE Laval » 50 €, 04/10 : prise pour
    // un achat de véhicule à cause du mot TGE) : c'est le frais qu'elle rembourse.
    if (/notes? de frais|remboursement de frais|frais de deplacement/.test(ds)) return /gasoil|carburant|essence|diesel|plein/.test(ds) ? 'carburant' : /peage/.test(ds) ? 'peage' : /train|sncf|taxi|uber/.test(ds) ? 'train_transport' : /hotel|nuit/.test(ds) ? 'hebergement' : /repas|resto/.test(ds) ? 'repas' : 'autre';
    if (/acompte|anticipo|arrhes|deposit/.test(ds)) return 'acompte_vehicule';
    // Un achat de véhicule fait au moins 1 000 € : en dessous, un mot de modèle ou une plaque dans le libellé décrit un frais.
    if (out >= 1000 && (/achat|acquisto|solde|vehicule|voiture|\b(yaris|ignis|kona|tucson|sprinter|transit|transporter|porsche|rav ?4|elroq|enyaq|corolla|swift|aygo|tge|crafter|vito|id\.?3|911|997|ds ?7|astra|tayron|bz4x|c-?hr|mach-?e|q4)\b/.test(ds) || extractPlate(description))) return 'achat_vehicule';
    if (/assur/.test(all)) return 'assurance';
    if (/convoy|transport|livraison|plaque|carte grise|immat|w garage|depann|remorqu/.test(all)) return 'logistique';
    if (/facture|invoice|fac\d|\beurl\b|\bsarl\b|\bsas\b|\bsrl\b|\bbv\b/.test(all)) return 'facture_fournisseur';
    return out >= 5000 ? 'achat_vehicule' : 'autre';
  }
  // Paiements carte (Revolut CAR, Airwallex Card)
  if (/\b(total|shell|esso|avia|eni\d*|bp|agip|q8|station|dac\b|le plein|carburant|petrol|tankstation|tinq|intermarche sta|hyper u statio|super u sta|leclerc.*(dac|statio)|carrefour dac|e\.leclerc dac|relais.*(total|carb))/.test(all) && !/boutique|restau/.test(all)) return 'carburant';
  if (/autoroute|cofiroute|aprr|sanef|escota|vinci|aliae|peage|eiffag|asf\b|asf-|area\b|atmb|sftrf|\bbip\b|ulys|tolls?|\balis\b|alicorne|sapn|albea/.test(all) && !/areas/.test(all)) return 'peage';
  if (/sncf|ratp|semitan|fil bleu|ouigo|blablacar|flix|\btbm\b|tisseo|\brtm\b|\btram\b|metro|navigo|trenitalia|\bns\b|nmbs|sepem|transdev|keolis|ilevia|\btan\b|irigo|wagons-lits|taxi|uber|bolt|velib|parking|indigo|q-park|effia|saemes|semitag|tgcv|\bsta\b|star\b|tcl\b|divia|ginko|tao\b|tbc\b|setram|ter\b/.test(all)) return 'train_transport';
  if (/mc ?donald|burger king|boulangerie|brioche|restau|resto|pizza|cafe|coffee|newrest|areas|relais|marie blachere|\bpaul\b|kfc|subway|sushi|\bbar\b|tabac|epicerie|bistro|brasserie|la pala|\bange\b|koel|bakker|snack|kebab|deliveroo|uber eats|just eat|boulang|patisserie|traiteur|cantine|crep|sandwich|starbucks|columbus|levgada|soliodis|pyradis|maison|autogrill|relay|gourmandine|rocadis|tribs|ik exploitation|shell boutique|a\.r\.e\.a|\b\d{7}\b.*\b855\b|banette|grain d|moulin|macanti|chez lux|fournil|mie caline|la mie|chouzenou|chagar|burger|resto/.test(all)) return 'repas';
  if (/leclerc|carrefour|super u|hyper u|auchan|intermarche|\binter\b|magasins? u|lidl|aldi|monoprix|casino|franprix|station u|albert heijn|jumbo|action\b|bureau vallee|ikea|amazon|cdiscount|fnac|darty|boulanger|decathlon|bricomarche|leroy merlin|castorama/.test(all)) return 'courses';
  if (/laposte|la poste|\bdhl\b|chronopost|\bups\b|fedex|colissimo|mondial relay|postnl|depann|remorqu|speed depanne|lavage|\blav\b|wash/.test(all)) return 'logistique';
  if (/assur|\baxa\b|allianz|hiscox|maif|macif|matmut|groupama/.test(all)) return 'assurance';
  if (/apple|google|anthropic|openai|lovable|microsoft|adobe|notion|carvertical|histovec|autoviza|railway|supabase|zyte|\bovh\b|github|canva|linkedin|dropbox|slack|zoom|free mobile|orange|\bsfr\b|bouygues|sosh|spotify|netflix|revolut|qonto|airwallex/.test(all)) return 'logiciel_abonnement';
  if (/hotel|h[oô]tel|b&b|ibis|airbnb|booking|kyriad|campanile|premiere classe|mercure|novotel|logis/.test(all)) return 'hebergement';
  if (/garage|pneu|norauto|feu vert|speedy|midas|controle technique|dekra|autovision|autosur|securitest|carglass|volvo|toyota|peugeot|renault|citroen|mecanic|autom\b|automobile|carrosserie|vidange|oscaro|mister auto|pieces auto/.test(all)) return 'entretien_vehicule';
  return 'autre';
}

// ── Rapprochement avec les dossiers de vente ────────────────────────────────
/** Dossier de vente vu par le rapprochement. */
export interface DealLite {
  id: string; reference: string | null; purchase_price: number | null; sale_price: number | null; fees: number | null; commission_ht: number | null;
  transaction_date: string | null; status: string | null; commercial: string | null; notes: string | null;
  plate: string | null; vin: string | null; brand: string | null; model: string | null; vehicle_label: string | null; tab_month: string | null;
  /** Ligne disparue du tableur (marqueur du worker) : exclue des totaux du mois, reste rapprochable. */
  sheet_missing?: boolean;
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
  [/id\.? ?3/i, ['ID']], [/mach/i, ['M']], [/c-?hr/i, ['CHR']], [/vitara/i, ['V']], [/panda/i, ['FP']], [/bz4x/i, ['B']], [/q4/i, ['QF']], [/model 3|tesla/i, ['T']], [/\bnx\b/i, ['NX']], [/astra/i, ['A']], [/tayron/i, ['TAYRON']],
];
/** Vrai pour un véhicule « * » du tableur (TVA récupérable : acheté TTC avec TVA déductible, vendu HT). */
/** « ** » (double étoile, convention Channing 03/10 soir) : import acheté HORS TAXE — le tableur écrit le prix
 *  « TTC » comme partout, le paiement réel est prix / 1,2, aucune TVA à récupérer (Astra Consilcar 11 880 → 9 900). */
export const isImportDeal = (d: DealLite) => /\*\*\s*$/.test(d.vehicle_label ?? '') || /\bimport/i.test(d.vehicle_label ?? '');
/** « * » (une seule étoile) : TVA récupérable, acheté TTC avec TVA déductible, vendu HT. Un import n'en est pas un. */
export const isStarDeal = (d: DealLite) => /\*\s*$/.test(d.vehicle_label ?? '') && !isImportDeal(d);
/** Montant attendu en banque : prix du tableur, sauf la VENTE d'un véhicule « * » = prix / 1,2 (vendu HT). */
export const expectedCash = (d: DealLite, field: 'purchase_price' | 'sale_price'): number => {
  const v = d[field] as number;
  if (field === 'sale_price' && isStarDeal(d)) return Math.round((v / 1.2) * 100) / 100;
  if (field === 'purchase_price' && isImportDeal(d)) return Math.round((v / 1.2) * 100) / 100; // acheté HT
  return v;
};
/** Part d'une ligne attribuée à un dossier (un virement peut payer plusieurs véhicules). */
export interface LinkPart { id: string; how: string; amount: number }
/**
 * UN VIREMENT, PLUSIEURS VÉHICULES (03/10, Channing : « on a des paiements
 * client sur virement unique qui paient plusieurs véhicules, il faut lier
 * les dossiers grâce aux numéros de factures présents dans le sheet »).
 * « Factuur:FAC00000586.FAC00000587 » : chaque numéro cité ↔ le dossier dont
 * le tableur porte « Facture : FAC586 » ; le montant de la ligne est réparti
 * au prorata des encaissements attendus (vente / 1,2 pour un véhicule *).
 * Un seul numéro, ou aucun : règle habituelle (matchLine).
 */
export function matchLineParts(line: Parameters<typeof matchLine>[0], deals: DealLite[]): LinkPart[] | null {
  const amt = line.amount_in ?? line.amount_out ?? 0;
  if (['achat_vehicule', 'acompte_vehicule', 'vente_encaissee'].includes(line.category)) {
    const text = `${line.counterparty} ${line.description}`;
    const nums = [...new Set([...text.matchAll(/\bFAC0*(\d{2,})\b/gi)].map((m) => m[1]))];
    if (nums.length >= 2) {
      const field = line.amount_out != null ? 'purchase_price' : 'sale_price';
      const found: DealLite[] = [];
      for (const n of nums) {
        const re = new RegExp(`Facture : FAC0*${n}\\b`, 'i');
        const cands = deals.filter((d) => d.notes && re.test(d.notes));
        const best = cands.length === 1 ? cands[0] : cands.length > 1 && new Set(cands.map((d) => d.reference)).size === 1 ? (cands.find((d) => d.plate && d.sale_price != null) ?? cands[0]) : null;
        if (best && !found.includes(best)) found.push(best);
      }
      if (found.length >= 1) {
        const how = `factures (${found.length}/${nums.length})`;
        const exp = found.map((d) => (d[field] != null ? expectedCash(d, field) : 0));
        const total = exp.reduce((a, b) => a + b, 0);
        // Tous les dossiers trouvés et montant attendu connu : prorata ; sinon chaque dossier prend son attendu, le reste est sans dossier.
        const prorata = found.length === nums.length && total > 0;
        let left = amt;
        return found.map((d, i) => {
          const share = prorata ? (i === found.length - 1 ? left : Math.round((amt * exp[i]) / total * 100) / 100) : Math.min(exp[i], left);
          left = Math.round((left - share) * 100) / 100;
          return { id: d.id, how, amount: share };
        });
      }
    }
  }
  const m = matchLine(line, deals);
  return m ? [{ ...m, amount: amt }] : null;
}
/** Un achat rapproché par les 3 chiffres de la plaque (pas la plaque entière) doit être payé dans une fenêtre
 *  plausible autour du mois de facturation du dossier : 6 mois avant, 45 jours après (« un véhicule facturé
 *  en juillet peut être acheté en août », Channing). Constat 03/10 soir : YC427 (janvier) portait GJ427AC
 *  payée le 04/02 ET GQ427QZ payée le 10/04 — deux Yaris Cross différentes, 43 120 € pour 21 010 € au tableur. */
function inPurchaseWindow(d: DealLite, bookedOn: string | undefined, out: number | null): boolean {
  if (!bookedOn || out == null || !d.tab_month) return true;
  const [y, m] = d.tab_month.split('-').map(Number);
  const lo = new Date(Date.UTC(y, m - 1 - 6, 1)), hi = new Date(Date.UTC(y, m, 0) + 45 * 86400000);
  const t = new Date(bookedOn).getTime();
  return t >= lo.getTime() && t <= hi.getTime();
}
export function matchLine(line: { plate: string | null; vin: string | null; counterparty: string; description: string; amount_out: number | null; amount_in: number | null; category: string; booked_on?: string }, deals: DealLite[]): { id: string; how: string } | null {
  if (!['achat_vehicule', 'acompte_vehicule', 'vente_encaissee'].includes(line.category)) return null;
  const text = `${line.counterparty} ${line.description}`;
  const plate = line.plate ?? extractPlate(text);
  if (plate) {
    const exact = deals.find((d) => d.plate && d.plate === plate);
    if (exact) return { id: exact.id, how: 'plaque' };
    const digits = plate.slice(2, 5);
    const cands = deals.filter((d) => d.reference && d.reference.replace(/\D/g, '') === digits && (!d.plate || d.plate === plate) && inPurchaseWindow(d, line.booked_on, line.amount_out));
    if (cands.length === 1) return { id: cands[0].id, how: 'ref' };
    if (cands.length > 1) {
      const prefixes = MODEL_PREFIX.find(([re]) => re.test(text))?.[1] ?? [];
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
  // Montant exact + modèle cité (Tayron sans plaque, 26 800 € = prix d'achat
  // du dossier TAYRON) ou montant exact + client cité (Oostendorp 22 750 € =
  // prix de vente d'un seul dossier au client AUTOGROEP OOSTENDORP).
  const amt = line.amount_out ?? line.amount_in ?? 0;
  if (amt > 0) {
    const field = line.amount_out != null ? 'purchase_price' : 'sale_price';
    // Règle Channing 03/10 : le tableur est tout en TTC ; un véhicule « * »
    // (TVA récupérable) est vendu HT en réalité → encaissement attendu = vente / 1,2.
    const byAmount = deals.filter((d) => d[field] != null && Math.abs(expectedCash(d, field) - amt) <= 1);
    if (byAmount.length > 0) {
      const prefixes = MODEL_PREFIX.find(([re]) => re.test(text))?.[1] ?? [];
      const words = text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4 && !['SPRINTER', 'YARIS', 'CROSS', 'ACHAT', 'VENTE', 'FACTURE', 'FACTUUR', 'VIREMENT', 'TRANSFERT', 'HOLDING', 'AUTOMOBILES', 'AUTOMOBIELBEDRIJF', 'MOTORSPORT', 'INVOICE', 'SALDO', 'FATTURA', 'EXPORT'].includes(w));
      const byModel = prefixes.length ? byAmount.filter((d) => prefixes.includes((d.reference ?? '').replace(/\d.*$/, '').toUpperCase()) || (d.vehicle_label && MODEL_PREFIX.find(([re]) => re.test(d.vehicle_label!))?.[1]?.some((p) => prefixes.includes(p)))) : [];
      if (byModel.length === 1) return { id: byModel[0].id, how: 'montant + modèle' };
      const byClient = line.amount_in != null ? byAmount.filter((d) => d.notes && words.some((w) => new RegExp(`Client : [^\\n]*\\b${w}\\b`, 'i').test(d.notes!))) : [];
      if (byClient.length === 1) return { id: byClient[0].id, how: 'montant + client' };
      // Montant exact porté par UN SEUL dossier (paiement via un prestataire,
      // Fintecture 35 500 € = RAV4 RV667, constat Channing 02/10 soir) : les
      // prix répétés (Swift 15 900 € × 20) ne passent pas ce filtre.
      if (byAmount.length === 1 && amt >= 3000) return { id: byAmount[0].id, how: 'montant unique' };
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


/**
 * SECOND PASSAGE (02/10 soir, « des écarts de 1 000 € et c'est souvent des
 * acomptes ») : une ligne véhicule sans dossier dont le TIERS a déjà une
 * ligne reliée, et dont le montant comble exactement l'écart entre le payé
 * et le prix d'achat du tableur → même dossier. Rend les affectations
 * trouvées (id de ligne → dossier), à écrire par l'appelant.
 */
export function matchComplements<L extends { id: string; counterparty: string; amount_out: number | null; amount_in?: number | null; booked_on?: string; category: string; transaction_id: string | null }>(lines: L[], deals: DealLite[]): Map<string, { id: string; how: string }> {
  const out = new Map<string, { id: string; how: string }>();
  // Avoir / remboursement : hérite du dossier de la ligne opposée du même tiers, même montant (± 1 €), à moins de 120 jours
  // (Wilar : 27 600 reçus le 16/09 pour FAC563, 27 600 rendus le 30/09 « Avoir 00000056 » → même dossier, vente annulée).
  const days = (a?: string, b?: string) => (a && b ? Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000) : 0);
  for (const l of lines) {
    if (l.transaction_id || !['remboursement_client', 'remboursement_recu'].includes(l.category)) continue;
    const amt = l.amount_out ?? l.amount_in ?? 0; if (!amt) continue;
    const k = l.counterparty.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    const twin = lines.filter((x) => x.transaction_id && x.id !== l.id && x.counterparty.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() === k
      && Math.abs(((l.amount_out ? x.amount_in : x.amount_out) ?? 0) - amt) <= 1 && days(x.booked_on, l.booked_on) <= 120);
    if (twin.length >= 1) out.set(l.id, { id: twin[0].transaction_id!, how: l.amount_out ? 'avoir ↔ encaissement' : 'remboursement ↔ achat' });
  }
  const key = (c: string) => c.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const paidByDeal = new Map<string, number>();
  const dealsByCp = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.transaction_id || !l.amount_out) continue;
    paidByDeal.set(l.transaction_id, (paidByDeal.get(l.transaction_id) ?? 0) + l.amount_out);
    const k = key(l.counterparty); if (!k) continue;
    (dealsByCp.get(k) ?? dealsByCp.set(k, new Set()).get(k)!).add(l.transaction_id);
  }
  for (const l of lines) {
    if (l.transaction_id || !l.amount_out || !['achat_vehicule', 'acompte_vehicule'].includes(l.category)) continue;
    const cands = [...(dealsByCp.get(key(l.counterparty)) ?? [])]
      .map((id) => deals.find((d) => d.id === id)).filter((d): d is DealLite => !!d && d.purchase_price != null)
      .filter((d) => Math.abs((paidByDeal.get(d.id) ?? 0) + (l.amount_out ?? 0) - (d.purchase_price as number)) <= 1);
    if (cands.length === 1) { out.set(l.id, { id: cands[0].id, how: 'tiers + complément' }); paidByDeal.set(cands[0].id, (paidByDeal.get(cands[0].id) ?? 0) + l.amount_out); }
  }
  return out;
}
