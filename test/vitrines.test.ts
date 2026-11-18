/**
 * VITRINES (14/11, mission « 100 % des vitrines partenaires lues, et lues en entier ») — le relevé, sur une base
 * simulée et des fiches simulées :
 *  - une valeur connue en base (boîte, énergie, km, année, prix) n'est jamais effacée par une liste qui ne la donne pas ;
 *  - un prix absent parce que le site le dit (« sur demande ») reste absent ;
 *  - les fiches détail complètent ce que la liste ne donne pas, nouveaux véhicules d'abord, une valeur de la liste
 *    n'est jamais remplacée, une fiche illisible ne fait pas échouer le relevé ;
 *  - les lecteurs de fiche de chaque plateforme, sur des extraits réels.
 */
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

const old = '2026-11-01T00:00:00.000Z';
const db: FakeDb = {
  network_contacts: [{ id: 'c1', name: 'Concession test', website: 'https://dmd.test/liste', website2: null }],
  network_stock_runs: [], learning_cases: [],
  network_stock_vehicles: [
    { contact_id: 'c1', external_id: 'A', gearbox: 'Manuelle', fuel: 'Diesel', km: 50000, year: 2019, price: 10000, price_prev: null, first_seen_at: old, last_seen_at: old, gone_at: null },
    { contact_id: 'c1', external_id: 'C', gearbox: null, fuel: 'Essence', km: 1000, year: 2024, price: 20000, price_prev: null, first_seen_at: old, last_seen_at: old, gone_at: null },
    { contact_id: 'c1', external_id: 'D', gearbox: 'Automatique', fuel: 'Hybride', km: 10, year: 2025, price: 9000, price_prev: null, first_seen_at: old, last_seen_at: old, gone_at: null },
  ],
};
setSharedSupabase(fakeSupabase(db) as never);

// Fiches simulées : seules ces adresses répondent ; l'ordre des lectures est relevé.
const box = (v: string) => `<li><span>Boîte de vitesses</span> <span>${v}</span></li>`;
const pages: Record<string, string> = {
  'https://dmd.test/b': box('Auto Séquent.'),
  'https://dmd.test/c': box('Manuelle'),
  'https://dmd.test/f': box('Rob Double Embray'),
};
const fetched: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = String(input instanceof Request ? input.url : input);
  fetched.push(u);
  const body = pages[u];
  return new Response(body ?? 'introuvable', { status: body ? 200 : 404 });
}) as typeof fetch;

const { runDealerStock, readDmdDetail, DETAIL_READERS } = await import('../worker/dealerStock');
type V = Parameters<typeof runDealerStock>[3] extends infer R ? R extends { vehicles: Array<infer X> } ? X : never : never;
const car = (o: Partial<V> & { external_id: string }): V => ({
  url: null, title: 'Peugeot 3008', brand: 'Peugeot', model: '3008', price: null, km: null, year: null, fuel: null, gearbox: null,
  plate: null, vin: null, body: null, image: null, listed_at: null, status: null, ...o,
} as V);

console.log('\n=== RELEVÉ : RIEN DE CONNU N\'EST EFFACÉ, LES FICHES COMPLÈTENT LE RESTE ===\n');
const res = await runDealerStock('c1', 'https://dmd.test/liste', 'test', {
  provider: 'catalogpager', total: 6, declared: 6, pages: 1, warnings: [],
  vehicles: [
    car({ external_id: 'A', url: 'https://dmd.test/a' }),                                   // connu, liste muette
    car({ external_id: 'C', url: 'https://dmd.test/c', price: 19500 }),                     // connu sans boîte
    car({ external_id: 'B', url: 'https://dmd.test/b', price: 15000 }),                     // nouveau
    car({ external_id: 'D', url: 'https://dmd.test/d', status: 'price_on_request' }),       // prix « sur demande »
    car({ external_id: 'E', price: 12000 }),                                                // nouveau sans fiche
    car({ external_id: 'F', url: 'https://dmd.test/f', gearbox: 'Manuelle', price: 8000 }), // boîte donnée par la liste
    car({ external_id: 'G', url: 'https://dmd.test/g', price: 7000 }),                      // nouveau, fiche illisible
  ],
});
const row = (id: string) => db.network_stock_vehicles.find((r) => r.external_id === id) as Record<string, unknown>;
ok(res.total === 7 && db.network_stock_runs[0]?.status === 'done', 'le relevé aboutit (7 véhicules)', [res.total, db.network_stock_runs[0]?.status]);
const a = row('A');
ok(a.gearbox === 'Manuelle' && a.fuel === 'Diesel' && a.km === 50000 && a.year === 2019 && a.price === 10000,
  'A : boîte, énergie, km, année, prix connus gardés quand la liste ne les donne pas', a);
ok(row('D').price === null && row('D').status === 'price_on_request', 'D : prix « sur demande » laissé absent (pas l\'ancien prix)', row('D'));
ok(row('B').gearbox === 'Automatique' && row('C').gearbox === 'Manuelle', 'B et C : boîte lue sur la fiche (Auto Séquent. → Automatique, Manuelle)', [row('B').gearbox, row('C').gearbox]);
ok(row('F').gearbox === 'Manuelle' && !fetched.includes('https://dmd.test/f'), 'F : la boîte de la liste est gardée, sa fiche n\'est pas lue');
ok(!fetched.includes('https://dmd.test/a') && !fetched.includes('https://dmd.test/d'), 'A et D : boîte déjà connue en base, fiche non lue');
const order = fetched.filter((u) => u.startsWith('https://dmd.test/'));
ok(order.indexOf('https://dmd.test/b') < order.indexOf('https://dmd.test/c') && order.indexOf('https://dmd.test/g') < order.indexOf('https://dmd.test/c'),
  'les nouveaux (B, G) sont lus avant les connus (C)', order);
ok(row('G').gearbox === null && row('G').price === 7000, 'G : fiche illisible (404), boîte inconnue, le relevé continue', row('G'));
ok(row('C').price === 19500 && row('C').price_prev === 20000, 'C : un vrai changement de prix est enregistré', [row('C').price, row('C').price_prev]);

console.log('\n=== PRIX MAL LU CORRIGÉ, RELEVÉ PARTIEL SANS FAUX DISPARUS (18/11) ===\n');
db.network_contacts.push({ id: 'c2', name: 'Van Mossel test', website: 'https://vm.test/voorraad', website2: null });
const t14 = '2026-11-14T01:02:35.648Z';
db.network_stock_vehicles.push(
  { contact_id: 'c2', external_id: 'R', price: 6565, price_prev: null, price_first: 6565, price_history: [{ at: t14, price: 6565 }], first_seen_at: t14, last_seen_at: t14, gone_at: null },
  { contact_id: 'c2', external_id: 'S', price: 20000, price_prev: null, price_first: 20000, price_history: [{ at: t14, price: 20000 }], first_seen_at: t14, last_seen_at: t14, gone_at: null },
  { contact_id: 'c2', external_id: 'Z', price: 9000, price_prev: null, first_seen_at: t14, last_seen_at: t14, gone_at: null },
);
const vm = (declared: number) => ({ provider: 'carcards' as const, total: declared, declared, pages: 1, warnings: [] as string[],
  vehicles: [car({ external_id: 'R', price: 30990 }), car({ external_id: 'S', price: 19500 })] });
const partialRun = await runDealerStock('c2', 'https://vm.test/voorraad', 'test', vm(100));
const r2 = (id: string) => db.network_stock_vehicles.find((x) => x.contact_id === 'c2' && x.external_id === id) as Record<string, unknown>;
ok(r2('R').price === 30990 && r2('R').price_prev === null && r2('R').price_first === 30990 && JSON.stringify((r2('R').price_history as Array<{ price: number }>).map((x) => x.price)) === '[30990]',
  'R : la remise lue comme prix (6 565 €) sort de l\'historique quand le vrai prix (30 990 €) est lu ; ce n\'est pas une hausse', r2('R'));
ok(r2('S').price === 19500 && r2('S').price_prev === 20000 && partialRun.priceChanges === 1, 'S : une vraie baisse (20 000 → 19 500) reste une baisse', [r2('S').price_prev, partialRun.priceChanges]);
ok(r2('Z').gone_at === null && partialRun.goneCount === 0 && partialRun.warnings.some((w) => /Relevé partiel : 2 voitures lues pour 100 annoncées/.test(w)),
  'relevé partiel (2 lues / 100 annoncées) : Z n\'est PAS marquée disparue, et le bilan le dit', [r2('Z').gone_at, partialRun.warnings]);
const fullRun = await runDealerStock('c2', 'https://vm.test/voorraad', 'test', vm(2));
ok(r2('Z').gone_at != null && fullRun.goneCount === 1, 'relevé complet (2 / 2) : Z est marquée disparue', [r2('Z').gone_at, fullRun.goneCount]);

console.log('\n=== LECTEURS DE FICHE ===\n');
ok(readDmdDetail(box('Rob Double Embray')).gearbox === 'Automatique' && readDmdDetail(box('Manuelle')).gearbox === 'Manuelle'
  && readDmdDetail('<p>rien</p>').gearbox === null, 'DMD : robotisée double embrayage = Automatique, Manuelle, rien = inconnu');
ok(Object.values(DETAIL_READERS).every((r) => r && r.fields.length > 0), 'chaque lecteur de fiche dit les champs qu\'il rend');

console.log('\n=== LES ÉCRANS LISENT LES MOTS DES SITES (valeurs réelles en base, 14/11) ===\n');
const { fuelFamily, gearboxFamily } = await import('../src/lib/vehicleFamilies');
const fuels: Array<[string, string | null]> = [
  ['Híbrido no enchufable', 'hybrid'], ['Híbrido enchufable', 'phev'], ['Hibrido enchufable', 'phev'], ['Electra', 'electric'], ['GLP', 'gas'],
  ['Ibrida', 'hybrid'], ['Erdgas', 'gas'], ['Metano', 'gas'], ['Hibrido', 'hybrid'], ['E85', 'petrol'], ['Super Plus', 'petrol'], ['Gasolio', 'diesel'],
  ['Benzine', 'petrol'], ['Gasolina', 'petrol'], ['Diésel', 'diesel'], ['Hybride rechargeable', 'phev'], ['Elettrica', 'electric'], ['Plug-in Hybrid', 'phev'],
  ['Waterstof', null], ['autre', null],
];
const fuelBad = fuels.filter(([v, want]) => fuelFamily(v) !== want);
ok(fuelBad.length === 0, `énergie : ${fuels.length} mots de sites (es, it, de, nl, fr) classés`, fuelBad.map(([v]) => `${v} → ${fuelFamily(v)}`));
const gears: Array<[string, string]> = [['Autom. 7-Gang', 'auto'], ['A Var Continu', 'auto'], ['Rob Double Embray', 'auto'], ['Rob Simple Embray', 'auto'],
  ['Automaat', 'auto'], ['Handgeschakeld', 'manual'], ['Manuelle', 'manual'], ['Schaltgetriebe', 'manual']];
const gearBad = gears.filter(([v, want]) => gearboxFamily(v) !== want);
ok(gearBad.length === 0, `boîte : ${gears.length} mots de sites classés`, gearBad.map(([v]) => `${v} → ${gearboxFamily(v)}`));

console.log('\n=== LECTEURS : EXTRAITS RÉELS DES SITES (18/11) ===\n');
const ds = await import('../worker/dealerStock');
// datamotive (Jazzoni, Romana) : 1re immatriculation du JSON-LD ; adresse BYMYCAR d'abord ; « 1970 » = bouche-trou.
ok(ds.ldCarYear({ dateVehicleFirstRegistered: '2023-07-31', modelDate: '1970' }, 'https://www.jazzoni.com/auto-usate/fiat-500') === 2023
  && ds.ldCarYear({}, 'https://www.bymycar.fr/peugeot-3008-occasion-2021-x') === 2021
  && ds.ldCarYear({ modelDate: '1970' }, 'https://x/y') === null, 'datamotive : année = adresse, sinon 1re immatriculation, jamais « 1970 »');
// dutchvans : énergie par adresse dans le JSON-LD ItemList de la page.
const dv = ds.ldFuelByUrl(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org/', '@type': 'ItemList', itemListElement: [
  { '@type': 'ListItem', position: 1, item: { '@type': ['Product', 'Car'], url: 'https://www.dutchvans.com/bedrijfswagen/ford-transit-2-0tdci-165pk-automaat-l4h3-jumbo-3/', fuelType: 'Diesel' } },
] })}</script>`);
ok(dv.get('https://www.dutchvans.com/bedrijfswagen/ford-transit-2-0tdci-165pk-automaat-l4h3-jumbo-3') === 'Diesel', 'dutchvans : énergie lue par adresse (« / » final ignoré)', [...dv]);
// vehiclelistapi (Bossoni) : neuves sans km ni année, « in arrivo » = attendue, réservée.
const vrow = (o: Partial<import('../worker/dealerStock').VehicleListRow>) => ({ id: 1, urlName: '/auto/x', brand: 'Fiat', model: '500', finalPrice: 15000, ...o });
const nuovo = ds.vehicleListRowToVehicle(vrow({ archive: 'nuovo', vehicleStatus: 'stock' }), 'https://www.gruppobossoni.it');
ok(nuovo.km === null && nuovo.year === null && nuovo.status === null && nuovo.url === 'https://www.gruppobossoni.it/auto/x', 'Bossoni : une neuve reste sans km ni année, en vente');
ok(ds.vehicleListRowToVehicle(vrow({ vehicleStatus: 'assigned' }), '').status === 'expected' && ds.vehicleListRowToVehicle(vrow({ isBooked: true }), '').status === 'reserved',
  'Bossoni : « Veicolo in arrivo » = attendue, réservée = réservée');
ok(ds.vehicleListGaps([vrow({ archive: 'nuovo' }), vrow({ archive: 'km0', km: null })]).length === 2, 'Bossoni : le bilan dit ce que le site ne publie pas (neuves, km 0 sans km)');
// rswusato (Ghedini) : « Km Zero » → 0 ; fiche réelle.
const rsw = ds.readRswDetail(`<span class="feature-label">Immatricolazione</span>
  <span class="feature-value">07/2026</span> <span class="feature-label">Alimentazione</span>
  <span class="feature-value">Ibrida</span> <span class="feature-label">Chilometraggio</span>
  <span class="feature-value">Km Zero</span> <span class="feature-label">Cambio</span>
  <span class="feature-value">Manuale a 6 marce</span> <span class="price">11.850<span class="currency">&euro;</span></span>`);
ok(ds.rswKm('Km Zero') === 0 && ds.rswKm('92.535 km') === 92535 && rsw.km === 0 && rsw.year === 2026 && rsw.fuel === 'Ibrida' && rsw.gearbox === 'Manuelle' && rsw.price === 11850,
  'Ghedini : « Km Zero » = 0 km ; fiche : année, énergie, km, boîte, prix', rsw);
// autodata (Krimpenerwaard) : fiche réelle ; le prix n'est pas un champ relu.
const ad = ds.readAutodataDetail('<ul><li>Tellerstand<strong>116500 KM</strong></li><li>Brandstof<strong>Benzine</strong></li><li>Transmissie<strong>Handgeschakeld</strong></li><li>Bouwjaar<strong>2013</strong></li></ul>');
ok(ad.fuel === 'Benzine' && ad.gearbox === 'Manuelle' && ad.km === 116500 && ad.year === 2013, 'Krimpenerwaard : fiche → énergie, boîte, km, année', ad);
ok(JSON.stringify(ds.DETAIL_READERS.autodata?.fields) === JSON.stringify(['fuel', 'gearbox', 'km', 'year']), 'Krimpenerwaard : la fiche n\'est relue que pour énergie, boîte, km, année (jamais pour un prix « op aanvraag »)');

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);
