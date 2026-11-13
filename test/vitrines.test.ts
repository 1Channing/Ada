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

console.log('\n=== LECTEURS DE FICHE ===\n');
ok(readDmdDetail(box('Rob Double Embray')).gearbox === 'Automatique' && readDmdDetail(box('Manuelle')).gearbox === 'Manuelle'
  && readDmdDetail('<p>rien</p>').gearbox === null, 'DMD : robotisée double embrayage = Automatique, Manuelle, rien = inconnu');
ok(Object.values(DETAIL_READERS).every((r) => r && r.fields.length > 0), 'chaque lecteur de fiche dit les champs qu\'il rend');

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);
