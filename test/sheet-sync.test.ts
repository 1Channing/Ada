/**
 * La synchro du tableur des ventes (19/10) : une REF sur deux véhicules.
 * Constat : 10 REF (YC134 … YC979) désignaient chacune deux Yaris Cross (autre
 * fin de VIN, autre mois). Chaque passage réécrivait le dossier ADA deux fois
 * (véhicule, VIN), l'astérisque de l'autre voiture posait « TVA récupérable »
 * (YC134, YC206, YC250, YC979), et la seconde vente n'avait pas de dossier.
 * La partie pure (sameVehicle, refPlan), puis deux passages complets avec une
 * fausse API Google Sheets et une base simulée.
 */
import { generateKeyPairSync } from 'node:crypto';
import { sameVehicle, refPlan, starOf, syncOnce, type SheetSale } from '../worker/salesSheetSync';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
type Row = Record<string, unknown>;

console.log('\n=== TABLEUR DES VENTES : UNE REF SUR DEUX VÉHICULES ===\n');

// --- La partie pure ----------------------------------------------------------------------------
const sale = (o: Partial<SheetSale>): SheetSale => ({
  ref: 'YC979', facture: '', vehicule: '', vin: '', ville: '', prixAchat: null, prixVente: null, commissions: null, commissionHt: null,
  fraisHt: null, modePaiement: '', dateAchat: null, dateLivraison: null, convoyeur: '', client: '', seller: '', paiement: false, livre: false, header: [], ...o,
});
ok(!sameVehicle(sale({ vehicule: 'YARIS CROSS TRAIL', vin: '721' }), sale({ vehicule: 'YARIS CROSS COLLECTION*', vin: '971' }))
  && sameVehicle(sale({ vehicule: 'ASTRA*', vin: '0123' }), sale({ vehicule: 'ASTRA**', vin: '0123' }))
  && sameVehicle(sale({ vehicule: 'CHR', prixAchat: 15000, prixVente: 16000 }), sale({ vehicule: 'C-HR'.replace('-', ''), prixAchat: 15000, prixVente: 16000 }))
  && !sameVehicle(sale({ vehicule: 'YARIS CROSS TRAIL', prixAchat: 21000, prixVente: 22900 }), sale({ vehicule: 'YARIS CROSS TRAIL', prixAchat: 22500, prixVente: 24100 })),
  'même véhicule : la fin de VIN si les deux l\'ont (les étoiles ne comptent pas) ; sinon le libellé et les deux prix');
ok(starOf('YARIS CROSS TRAIL*') && !starOf('ASTRA**') && !starOf('YARIS CROSS TRAIL') && !starOf(null), 'astérisque : « * » TVA récupérable, « ** » import HT, rien sinon');

const jan979 = sale({ vehicule: 'YARIS CROSS TRAIL', vin: '721', prixAchat: 21480, prixVente: 23880 });
const oct979 = sale({ vehicule: 'YARIS CROSS COLLECTION*', vin: '971', prixAchat: 25000, prixVente: 27500 });
const a920 = sale({ ref: 'YC920', vehicule: 'TOYOTA YARIS CROSS', vin: '714', prixAchat: 20000, prixVente: 22000 });
const b920 = sale({ ref: 'YC920', vehicule: 'YARIS CROSS GR', vin: '536', prixAchat: 21917, prixVente: 24000 });
const jan500 = sale({ ref: 'YC500', vehicule: 'CHR', vin: '111', prixAchat: 15000, prixVente: 16000 });
const mar500 = sale({ ref: 'YC500', vehicule: 'CHR', vin: '111', prixAchat: 15000, prixVente: 16000 });
const new1 = sale({ ref: 'YC777', vehicule: 'YARIS CROSS GR', vin: '001', prixAchat: 20000, prixVente: 22000 });
const new2 = sale({ ref: 'YC777', vehicule: 'YARIS CROSS TRAIL', vin: '002', prixAchat: 21000, prixVente: 23000 });
const dossiers: Record<string, { purchase_price: number; sale_price: number }> = { YC979: { purchase_price: 21480, sale_price: 23880 }, YC920: { purchase_price: 21917, sale_price: 24000 }, YC500: { purchase_price: 15000, sale_price: 16000 } };
const plan = refPlan([
  { tab: 'JANVIER 2026', rows: [jan979, jan500] },
  { tab: 'MARS 2026', rows: [a920, b920, mar500, new1] },
  { tab: 'OCTOBRE 2026', rows: [oct979, new2] },
], (ref) => dossiers[ref] ?? null);
const c979 = plan.conflicts.find((c) => c.ref === 'YC979');
const c920 = plan.conflicts.find((c) => c.ref === 'YC920');
const c777 = plan.conflicts.find((c) => c.ref === 'YC777');
ok(!!c979 && c979.kept.row === jan979 && c979.others.map((x) => x.row) .join() === [oct979].join() && plan.tabOf.get('YC979') === 'JANVIER 2026' && plan.writes.has(jan979) && !plan.writes.has(oct979),
  'YC979 : la ligne de janvier a le dossier (ses prix) ; celle d\'octobre, un autre véhicule, n\'écrit rien', c979 && { kept: c979.kept.tab, others: c979.others.map((x) => x.tab) });
ok(!!c920 && c920.kept.row === b920 && plan.writes.has(b920) && !plan.writes.has(a920) && plan.tabOf.get('YC920') === 'MARS 2026',
  'YC920 : deux lignes dans le même onglet — celle dont les prix sont ceux du dossier, même si elle est la seconde', c920 && c920.kept.row.vehicule);
ok(!plan.conflicts.some((c) => c.ref === 'YC500') && plan.copies.some((c) => c.ref === 'YC500' && c.tabs.join() === 'JANVIER 2026,MARS 2026') && plan.tabOf.get('YC500') === 'JANVIER 2026' && plan.writes.has(jan500) && !plan.writes.has(mar500),
  'YC500 : le même véhicule recopié en mars — une recopie, le dossier reste en janvier');
ok(!!c777 && c777.kept.row === new1 && plan.writes.has(new1) && !plan.writes.has(new2), 'une REF nouvelle sur deux véhicules : la première ligne crée le dossier, l\'autre attend sa REF');

// --- Deux passages complets : fausse API Google Sheets, base simulée --------------------------------
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const creds = JSON.stringify({ client_email: 'synchro@test.iam.gserviceaccount.com', private_key: privateKey });
const header = ['REF', 'VEHICULE', 'VIN', 'PRIX ACHAT', 'PRIX VENTE', 'COMMISSIONS HT', 'FRAIS HT', 'CLIENT', 'PAIEMENT', 'LIVRÉ'];
// Les onglets dans l'ordre du classeur : le plus récent d'abord.
const tabsData: Record<string, string[][]> = {
  'OCTOBRE 2026': [['CHANNING'], header,
    ['YC979', 'YARIS CROSS COLLECTION*', '971', '25 000', '27 500', '1800', '500', 'GARAGE NEUF', 'FALSE', 'FALSE'],
    ['YC100', 'YARIS CROSS GR', '555', '20000', '22000', '1200', '400', '', 'FALSE', 'FALSE']],
  'MARS 2026': [['ANTOINE'], header,
    ['YC920', 'TOYOTA YARIS CROSS', '714', '20000', '22000', '1000', '500', '', 'TRUE', 'TRUE'],
    ['YC920', 'YARIS CROSS GR', '536', '21917', '24000', '1123,17', '613', '', 'TRUE', 'TRUE'],
    ['YC500', 'CHR', '111', '15000', '16000', '700', '300', '', 'TRUE', 'TRUE']],
  'JANVIER 2026': [['ANTOINE'], header,
    ['YC979', 'YARIS CROSS TRAIL', '721', '21 480', '23 880', '1429,04', '571', '', 'TRUE', 'TRUE'],
    ['YC500', 'CHR', '111', '15000', '16000', '700', '300', '', 'TRUE', 'TRUE']],
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'jeton' }), { status: 200 });
  if (url.includes('?fields=sheets.properties.title')) return new Response(JSON.stringify({ sheets: Object.keys(tabsData).map((title) => ({ properties: { title } })) }), { status: 200 });
  const m = url.match(/\/values\/([^?]+)/);
  if (m) {
    const tab = decodeURIComponent(m[1]).match(/^'(.+)'!/)?.[1] ?? '';
    return new Response(JSON.stringify({ values: tabsData[tab] ?? [] }), { status: 200 });
  }
  return realFetch(input as never, init);
}) as typeof fetch;

const base979: Row = { id: 't979', reference: 'YC979', notes: '[Tableur JANVIER 2026]\nVéhicule : YARIS CROSS TRAIL\nVIN (fin) : 721', purchase_price: 21480, sale_price: 23880, fees: 571, commission_ht: 1429.04, commercial: 'ANTOINE', buyer_contact_id: 'c-1', seller_contact_id: null, seller_contact_id_2: null, supplier_contact_id: null, client_contact_id: null, transaction_date: '2026-01-12', status: 'cloturee', closed_at: '2026-01-20T12:00:00Z', transaction_type: 'sale', vat_recoverable: true };
const db: FakeDb = {
  app_config: [{ key: 'gsheet_sales', value: { spreadsheetId: 'classeur', sinceMonth: '2026-01' } }],
  transactions_admin: [
    base979,
    { ...base979, id: 't920', reference: 'YC920', notes: '[Tableur MARS 2026]\nVéhicule : YARIS CROSS GR\nVIN (fin) : 536', purchase_price: 21917, sale_price: 24000, fees: 613, commission_ht: 1123.17, vat_recoverable: false },
    { ...base979, id: 't500', reference: 'YC500', notes: '[Tableur MARS 2026]\nVéhicule : CHR\nVIN (fin) : 111', purchase_price: 15000, sale_price: 16000, fees: 300, commission_ht: 700, vat_recoverable: false },
  ],
  contacts: [],
  learning_cases: [{ id: 'lc-812', kind: 'sheet_ref_duplicate', key: 'YC812', status: 'open', seen_count: 2487, title: 'ancien cas' }],
};
setSharedSupabase(fakeSupabase(db) as never);
const warns: string[] = [];
const realWarn = console.warn;
console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
const tx = (id: string) => db.transactions_admin.find((t) => t.id === id) as Row;

await syncOnce(creds);
await new Promise((r) => setTimeout(r, 50)); // les cas de la boîte sont écrits sans attendre
const pass1 = [...warns];
ok(String(tx('t979').notes).includes('Véhicule : YARIS CROSS TRAIL') && String(tx('t979').notes).includes('VIN (fin) : 721') && !pass1.some((w) => /YC979 : (Véhicule|VIN)/.test(w)),
  'YC979 : le dossier garde son véhicule et son VIN (plus d\'aller-retour avec celui d\'octobre)', { notes: tx('t979').notes, logs: pass1.filter((w) => /YC979/.test(w)) });
ok(tx('t979').vat_recoverable === false && pass1.some((w) => /YC979 : TVA récupérable retirée — l'astérisque venait de l'autre véhicule de la REF \(OCTOBRE 2026 : YARIS CROSS COLLECTION\*\)/.test(w)),
  'YC979 : « TVA récupérable », posée par l\'astérisque de l\'autre voiture, retirée — et dit', tx('t979').vat_recoverable);
ok(String(tx('t920').notes).includes('Véhicule : YARIS CROSS GR') && String(tx('t920').notes).includes('VIN (fin) : 536') && !pass1.some((w) => /YC920 : (Véhicule|VIN)/.test(w)),
  'YC920 : le dossier reste celui de ses prix (la seconde ligne de mars), sans aller-retour', tx('t920').notes);
ok(String(tx('t500').notes).startsWith('[Tableur JANVIER 2026]') && pass1.some((w) => /YC500 : onglet MARS 2026 → JANVIER 2026/.test(w)), 'YC500 recopié : le dossier va au plus ancien onglet (règle du 04/10)', tx('t500').notes);
const yc100 = db.transactions_admin.filter((t) => t.reference === 'YC100');
ok(yc100.length === 1 && yc100[0].commercial === 'CHANNING' && String(yc100[0].notes).startsWith('[Tableur OCTOBRE 2026]'), 'une REF nouvelle : son dossier est créé, une fois', yc100);
ok(db.transactions_admin.filter((t) => t.reference === 'YC979').length === 1, 'la seconde YC979 ne crée pas de dossier en double');
const case979 = db.learning_cases.find((c) => c.kind === 'sheet_ref_duplicate' && c.key === 'YC979');
const detail979 = case979?.detail as { dossier?: { onglet?: string; vin?: string }; sans_dossier?: Array<{ onglet: string; vehicule: string; vin: string; achat: number; vente: number }> } | undefined;
ok(!!case979 && /la REF YC979 désigne 2 véhicules — JANVIER 2026 : YARIS CROSS TRAIL \(VIN …721\) a le dossier ADA ; OCTOBRE 2026 : YARIS CROSS COLLECTION\* \(VIN …971\) n'en a pas : lui donner sa propre REF dans le tableur/.test(String(case979.title))
  && detail979?.dossier?.vin === '721' && detail979?.sans_dossier?.[0]?.achat === 25000 && detail979?.sans_dossier?.[0]?.vente === 27500 && case979.actor === 'equipe',
  'la boîte à apprendre (équipe) : les deux véhicules, avec les prix du second, et quoi faire', case979 && { title: case979.title, detail: case979.detail });
ok(db.learning_cases.some((c) => c.key === 'YC920' && /désigne 2 véhicules — MARS 2026 : YARIS CROSS GR \(VIN …536\) a le dossier ADA ; MARS 2026 : TOYOTA YARIS CROSS \(VIN …714\)/.test(String(c.title)))
  && db.learning_cases.some((c) => c.key === 'YC500' && /recopiée dans 2 onglets \(JANVIER 2026, MARS 2026\) — gardée dans JANVIER 2026/.test(String(c.title))),
  'YC920 (même onglet) et YC500 (recopie) : chacun son cas', db.learning_cases.map((c) => c.title));
ok((db.learning_cases.find((c) => c.key === 'YC812') as Row).status === 'done', 'une REF corrigée dans le tableur (YC812) : son cas se ferme seul');
ok(pass1.filter((w) => /REF sur plusieurs véhicules/.test(w)).length === 1 && pass1.some((w) => /2 REF sur plusieurs véhicules .* YC979 \(JANVIER 2026 \/ OCTOBRE 2026\), YC920 \(MARS 2026 \/ MARS 2026\)/.test(w)),
  'une ligne de journal pour toutes les REF doubles', pass1.filter((w) => /REF sur plusieurs/.test(w)));

// Second passage : plus rien à écrire.
const before = JSON.stringify(db.transactions_admin);
warns.length = 0;
await syncOnce(creds);
await new Promise((r) => setTimeout(r, 50));
ok(JSON.stringify(db.transactions_admin) === before && !warns.some((w) => /→|retirée|REF sur plusieurs/.test(w)), 'second passage : aucun dossier réécrit, journal silencieux', warns);

console.warn = realWarn;
globalThis.fetch = realFetch;
if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}
