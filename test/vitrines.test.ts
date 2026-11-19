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
const statuses: Record<string, number> = {}; // code HTTP d'une page simulée, quand ce n'est pas 200
const flaky: Record<string, number> = {};    // nombre de réponses 502 avant la bonne (erreur de passerelle passagère)
const cut: Record<string, number> = {};      // nombre de connexions coupées (« fetch failed ») avant la bonne
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = String(input instanceof Request ? input.url : input);
  fetched.push(u);
  if ((cut[u] ?? 0) > 0) { cut[u]--; throw new TypeError('fetch failed'); }
  if ((flaky[u] ?? 0) > 0) { flaky[u]--; return new Response('Bad Gateway', { status: 502 }); }
  const body = pages[u];
  return new Response(body ?? 'introuvable', { status: body ? statuses[u] ?? 200 : 404 });
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

console.log('\n=== NUMÉROS TOUS CHANGÉS : LES VOITURES SONT RETROUVÉES, PAS VENDUES (18/11, Bierschneider) ===\n');
db.network_contacts.push({ id: 'c3', name: 'Refonte test', website: 'https://refonte.test/fahrzeuge/', website2: null });
const t0 = '2026-10-01T00:00:00.000Z';
const known3 = (id: string, o: Record<string, unknown>) => ({ contact_id: 'c3', external_id: id, url: `https://refonte.test/alt/${id}`, price_prev: null, first_seen_at: t0, last_seen_at: t0, gone_at: null, vin: null, year: null, ...o });
for (let i = 1; i <= 20; i++) db.network_stock_vehicles.push(known3(`u${i}`, { brand: 'Volkswagen', title: `Volkswagen Golf ${i}`, km: 10000 + i * 1000, year: 2020, price: 15000 + i * 100 }));
db.network_stock_vehicles.push(
  known3('v1', { brand: 'Volkswagen', title: 'Volkswagen ID.3 Pro', vin: 'WVWZZZE1ZPP000001', km: 5, price: 40000 }),
  known3('n1', { brand: 'Skoda', title: 'Skoda Elroq 85 Sportline AHK KAMERA LED', km: 10, price: 47990 }),
  known3('n2', { brand: 'Skoda', title: 'Skoda Fabia 1.0 TSI Selection', km: 10, price: 21990 }),
  known3('n3', { brand: 'Skoda', title: 'Skoda Fabia 1.0 TSI Selection', km: 10, price: 21990 }),
  known3('s1', { brand: 'Audi', title: 'Audi A4 Avant', km: 77777, year: 2018, price: 19000 }),
  known3('k1', { brand: 'Seat', title: 'Seat Ibiza 1.0 TSI Style Navi', km: 19520, price: 17950 }),
);
const refonte = () => ({ provider: 'cfdnext' as const, total: 26, declared: 26, pages: 1, warnings: [] as string[], vehicles: [
  ...Array.from({ length: 20 }, (_, k) => car({ external_id: `x${k + 1}`, brand: 'VW', title: `VW Golf ${k + 1} neu`, km: 10000 + (k + 1) * 1000, year: 2020, price: 15000 + (k + 1) * 100 + (k === 0 ? 200 : 0) })),
  car({ external_id: 'xv1', brand: 'Volkswagen', title: 'Volkswagen ID.3 Pro Performance', vin: 'WVWZZZE1ZPP000001', price: 39000 }),
  car({ external_id: 'xn1', brand: 'Skoda', title: 'Skoda Elroq 85 Sportline AHK KAMERA LED Pano', price: 47990 }),
  car({ external_id: 'xn2', brand: 'Skoda', title: 'Skoda Fabia 1.0 TSI Selection', price: 21990 }),
  car({ external_id: 'xn3', brand: 'Skoda', title: 'Skoda Fabia 1.0 TSI Selection', price: 21990 }),
  car({ external_id: 'xk1', brand: 'Seat', title: 'Seat Ibiza 1.0 TSI Style Navi', km: 25000, price: 17950 }),
  car({ external_id: 'xnew', brand: 'Cupra', title: 'Cupra Born', km: 10, price: 35000 }),
] });
const swap = await runDealerStock('c3', 'https://refonte.test/fahrzeuge/', 'test', refonte());
const r3 = (id: string) => db.network_stock_vehicles.find((x) => x.contact_id === 'c3' && x.external_id === id) as Record<string, unknown> | undefined;
const kept3 = [...Array.from({ length: 20 }, (_, k) => `x${k + 1}`), 'xv1', 'xn1'];
ok(kept3.every((id) => r3(id)?.first_seen_at === t0 && r3(id)?.gone_at === null),
  '22 voitures retrouvées sous leur nouveau numéro (VIN, marque « VW » = Volkswagen + km + année, titre + prix) : première vue gardée, en stock', kept3.filter((id) => r3(id)?.first_seen_at !== t0));
ok(['u1', 'v1', 'n1'].every((id) => r3(id) === undefined), 'les anciens numéros n\'existent plus (la ligne a changé de numéro, pas de doublon)');
ok(r3('x1')?.price === 15300 && r3('x1')?.price_prev === 15100, 'x1 : l\'historique suit la voiture (15 100 → 15 300 = changement de prix)', [r3('x1')?.price, r3('x1')?.price_prev]);
ok(swap.newCount === 4 && swap.goneCount === 4, 'nouveautés = 4 (2 Fabia identiques, l\'Ibiza au km différent, la Born) ; sorties = 4 (2 Fabia indiscernables, l\'A4 vendue, l\'Ibiza) — pas 26', [swap.newCount, swap.goneCount]);
ok(r3('s1')?.gone_at != null && r3('n2')?.gone_at != null && r3('k1')?.gone_at != null, 'A4 vendue, Fabia ambiguës et Ibiza au km incompatible (19 520 → 25 000) sortent normalement');
ok(swap.warnings.some((w) => /Numéros de la vitrine tous changés \(0 voiture\(s\) sur 26 .*22 retrouvée\(s\).*4 sans correspondance/.test(w)), 'le bilan du relevé le dit', swap.warnings);
const again = await runDealerStock('c3', 'https://refonte.test/fahrzeuge/', 'test', refonte());
ok(!again.warnings.some((w) => /Numéros de la vitrine/.test(w)) && again.newCount === 0 && again.goneCount === 0, 'relevé suivant, numéros revus : aucune reprise, rien de nouveau ni de sorti', [again.newCount, again.goneCount, again.warnings]);
ok(!fullRun.warnings.some((w) => /Numéros de la vitrine/.test(w)), 'moins de 20 voitures connues (Van Mossel test) : la règle ne joue pas');

console.log('\n=== DEUX RELEVÉS DE LA MÊME FICHE EN MÊME TEMPS : AUCUNE FAUSSE DISPARITION (19/11, BMW Lion Car) ===\n');
{
  // Le relevé parti juste avant réécrit « vue le » avec son heure, plus ancienne, juste après notre écriture : nos
  // voitures paraissent « vues avant notre départ ». Elles ne doivent pas sortir ; une vraie absente, si.
  db.network_contacts.push({ id: 'c5', name: 'Lion test', website: 'https://lion.test/ponuka', website2: null });
  db.network_stock_vehicles.push({ contact_id: 'c5', external_id: 'old1', price: 9000, first_seen_at: old, last_seen_at: old, gone_at: null });
  const fake = fakeSupabase(db);
  const early = new Date(Date.now() - 60_000).toISOString();
  setSharedSupabase({ ...fake, from: (t: string) => {
    const q = fake.from(t) as unknown as { upsert: (r: unknown[], o: unknown) => unknown; then: (a: unknown, b?: unknown) => Promise<unknown> };
    if (t !== 'network_stock_vehicles') return q;
    const up = q.upsert.bind(q);
    q.upsert = (rows: unknown[], o: unknown) => {
      up(rows, o);
      const then = q.then.bind(q);
      q.then = (ok1: unknown, ko?: unknown) => then((res: unknown) => {
        for (const r of rows as Array<Record<string, unknown>>) {
          const row = db.network_stock_vehicles.find((x) => x.contact_id === r.contact_id && x.external_id === r.external_id);
          if (row) row.last_seen_at = early;
        }
        return res;
      }).then(ok1 as never, ko as never);
      return q;
    };
    return q;
  } } as never);
  const crossed = await runDealerStock('c5', 'https://lion.test/ponuka', 'test', { provider: 'autopalace', total: 3, declared: 3, pages: 1, warnings: [],
    vehicles: [car({ external_id: 'L1', price: 50000 }), car({ external_id: 'L2', price: 60000 }), car({ external_id: 'L3', price: 70000 })] });
  setSharedSupabase(fake as never);
  const r5 = (id: string) => db.network_stock_vehicles.find((x) => x.contact_id === 'c5' && x.external_id === id) as Record<string, unknown>;
  ok(['L1', 'L2', 'L3'].every((id) => r5(id)?.gone_at === null) && r5('old1')?.gone_at != null && crossed.goneCount === 1
    && crossed.warnings.some((w) => /réécrite\(s\) par un autre relevé/.test(w)),
    'relevés croisés : les 3 voitures vues restent en stock, seule la vraie absente sort, et le bilan le dit', [crossed.goneCount, ['L1', 'L2', 'L3', 'old1'].map((id) => r5(id)?.gone_at), crossed.warnings]);
}

console.log('\n=== LECTEURS DE FICHE ===\n');
ok(readDmdDetail(box('Rob Double Embray')).gearbox === 'Automatique' && readDmdDetail(box('Manuelle')).gearbox === 'Manuelle'
  && readDmdDetail('<p>rien</p>').gearbox === null, 'DMD : robotisée double embrayage = Automatique, Manuelle, rien = inconnu');
ok(Object.values(DETAIL_READERS).every((r) => r && r.fields.length > 0), 'chaque lecteur de fiche dit les champs qu\'il rend');

console.log('\n=== DAS WELTAUTO (HONGRIE, 19/11) : LA CONCESSION, RIEN QUE LA CONCESSION ===\n');
{
  const ds2 = await import('../worker/dealerStock');
  const html = '<script id="ng-state" type="application/json">{"u":"https://dwa.test/api/locales/hu_HU/vehicles/search/","c":"https://dwa.test/api/locales/hu_HU/dwa/configuration"}</script>';
  const item = (vid: string, o: Record<string, unknown> = {}) => ({ id: { dealerIdNumber: 4859, fiveDigitsVehicleId: vid }, brand: 'VW', modelVariant: 'Passat Variant 2.0 TDI DSG', nameLabel: 'Passat',
    price: 5290000, mileage: 146209, registration: '2018-05-02', fuelText: 'Dízel', transmission: 'Automata, DSG, Tiptronic', vin: 'WVWZZZ3CZJE000001', reserved: false,
    priceHistory: [{ changedAt: '2026-11-05T15:45:10Z', price: 5290000 }, { changedAt: '2026-10-12T08:00:00Z', price: 5490000 }], dealer: { name: 'Porsche Buda', city: 'Budapest' }, ...o });
  const api = 'https://dwa.test/api/locales/hu_HU/vehicles/search/?dealerId=';
  pages['https://dwa.test/haendler/porschebuda/4859/s'] = html;
  pages[`${api}4859&pageSize=100&page=1&sortBy=price&sortAscending=true`] = JSON.stringify({ count: 2, pruned: false, resultListPage: { content: [item('11623'),
    item('11541', { brand: 'Škoda', modelVariant: 'Octavia Combi Style 1.0 TSI', fuelText: 'Egyéb', transmission: 'Sebességváltó', reserved: true }), { ...item('77777'), id: { dealerIdNumber: 603, fiveDigitsVehicleId: '77777' } }] } });
  // Filtre TVA sans résultat : l'API « élargit » (pruned) et rend toutes les voitures — ce n'est pas un résultat.
  pages[`${api}4859&pageSize=100&page=1&pretaxDeductible=true`] = JSON.stringify({ count: 0, pruned: true, resultListPage: { content: [item('11623'), item('11541')] } });
  ok(ds2.detectDealerProvider(html) === 'dasweltauto', 'Das WeltAuto reconnu (ng-state + configuration /api/locales/hu_HU/dwa/)');
  const st = await ds2.fetchDealerStock('https://dwa.test/haendler/porschebuda/4859/s');
  const g = (id: string) => st.vehicles.find((v) => v.external_id === id);
  ok(st.vehicles.length === 2 && !g('60377777'), 'seules les voitures de la concession 4859 sont gardées (une voiture d\'une autre concession dans la réponse : écartée)', st.vehicles.map((v) => v.external_id));
  ok(st.vehicles.every((v) => !/TVA/.test(v.title)), 'filtre TVA « élargi » (pruned, count 0) : aucune voiture marquée TVA récupérable', st.vehicles.map((v) => v.title));
  ok(g('485911623')?.currency === 'HUF' && g('485911623')?.url === 'https://dwa.test/vehicle/485911623' && g('485911623')?.listed_at === '2026-10-12T08:00:00.000Z'
    && g('485911623')?.gearbox === 'Automatique' && g('485911623')?.vin === 'WVWZZZ3CZJE000001' && g('485911623')?.year === 2018,
    'voiture : forints, lien public, en ligne au moins depuis le plus ancien prix, boîte, VIN, année', g('485911623'));
  ok(g('485911541')?.fuel === 'Benzin' && g('485911541')?.gearbox === 'Manuelle' && g('485911541')?.status === 'reserved',
    '« Egyéb » → énergie lue dans la version (TSI = essence) ; « Sebességváltó » = manuelle ; réservée', g('485911541'));
  pages['https://dwa.test/haendler/babjakauto/956/s'] = html;
  pages[`${api}956&pageSize=100&page=1&sortBy=price&sortAscending=true`] = JSON.stringify({ count: 0, pruned: true, resultListPage: { content: [item('11623')] } });
  const empty = await ds2.fetchDealerStock('https://dwa.test/haendler/babjakauto/956/s');
  ok(empty.vehicles.length === 0 && empty.declared === 0, 'concession sans occasion : 0 voiture (pas celles que l\'API rend en élargissant)', [empty.vehicles.length, empty.declared]);
  ok(JSON.stringify(['https://x.hu/haendler/porschebuda/4859/s', 'https://x.hu/gruppe/hu_walter/HU_WALTER/849/s', 'https://x.hu/s?dealerId=999'].map((u) => ds2.dwaConfig(u, html).dealerId)) === '["4859","849","999"]',
    'n° de concession : page concession, page de groupe (identifiant en lettres), recherche filtrée');
  // Page de GROUPE (Slovaquie, 19/11) : le n° est celui de la page du groupe ; l'API filtre par groupe, voitures de ses trois concessions.
  const htmlSk = html.replace(/hu_HU/g, 'sk_SK');
  const apiSk = 'https://dwa.test/api/locales/sk_SK/vehicles/search/?dealerGroupId=PIA&dealerPageId=1015';
  pages['https://dwa.test/gruppe/porscheinterauto/PIA/1015/s'] = htmlSk;
  pages[`${apiSk}&pageSize=100&page=1&sortBy=price&sortAscending=true`] = JSON.stringify({ count: 3, pruned: false, resultListPage: { content: [
    { ...item('20001', { modelVariant: 'T-Roc Style 1.5 TSI ACT 6G', transmission: null, fuelText: 'Benzín', priceHistory: [] }), id: { dealerIdNumber: 8135, fiveDigitsVehicleId: '20001' } },
    { ...item('20002', { brand: 'SEAT', modelVariant: 'Ateca Style 1.6 TDI 6-G', transmission: null, fuelText: 'Nafta', priceHistory: [] }), id: { dealerIdNumber: 8101, fiveDigitsVehicleId: '20002' } },
    { ...item('20003', { brand: 'Škoda', modelVariant: 'Superb Combi 2.0 TDI 7DSG', transmission: null, fuelText: 'Hybr.D/E ext.nab.', priceHistory: [] }), id: { dealerIdNumber: 8199, fiveDigitsVehicleId: '20003' } }] } });
  pages[`${apiSk}&pageSize=100&page=1&pretaxDeductible=true`] = JSON.stringify({ count: 0, pruned: true, resultListPage: { content: [] } });
  const grp = await ds2.fetchDealerStock('https://dwa.test/gruppe/porscheinterauto/PIA/1015/s');
  const gv = (id: string) => grp.vehicles.find((v) => v.external_id === id);
  ok(grp.vehicles.length === 3 && gv('813520001')?.currency === 'EUR', 'page de groupe : dealerGroupId + dealerPageId, voitures des trois concessions, en euros', grp.vehicles.map((v) => v.external_id));
  ok(gv('813520001')?.gearbox === 'Manuelle' && gv('810120002')?.gearbox === 'Manuelle' && gv('819920003')?.gearbox === 'Automatique',
    'boîte absente : « 6G », « 6-G » = manuelle, « 7DSG » = automatique (lues dans la version)', grp.vehicles.map((v) => [v.title, v.gearbox]));
  ok(ds2.dwaGearOfVariant('DS7 Crossback BlueHDi 130', 'DS') === null && ds2.dwaGearOfVariant('Passat 2.0 TDI DS7', 'VW') === 'Automatique', '« DS7 » = DSG 7, sauf chez la marque DS');
  ok(ds2.dwaConfig('https://x.hu/gruppe/hu_walter/HU_WALTER/849/s', html).groupId === 'HU_WALTER' && ds2.dwaConfig('https://x.hu/haendler/porschebuda/4859/s', html).groupId === null, 'groupe lu dans l\'adresse (page de groupe seulement)');
}

console.log('\n=== WEBSPARK (BONY, 19/11) : UNE PAGE QUI REPREND DES CARTES N\'EST PAS LA DERNIÈRE ===\n');
{
  const dsw = await import('../worker/dealerStock');
  const card = (id: number) => `<div class="card vcard" data-id="${id}"><a href="https://ws.test/voiture/${id}" class="vcard--link"><span class="vcard-main-info__make-model">Renault Clio</span></a>`
    + `<h3 class="vcard-main-info__version-heading">TCe 90</h3><p class="vcard-consumption__title">03/2022 - 25 000 Km - Essence</p><span class="vcard-price__price">14 990 €</span></div>`;
  const list = (ids: number[], total: number | null) => (total == null ? '' : `<span class="stock-listing__results-counter" x-ref="resultsFoundText"><strong>${total}</strong> résultats trouvés</span>`) + ids.map(card).join('');
  // Trois pages de 4 ; une voiture entrée en tête pendant la lecture décale tout : la page 2 reprend la dernière de la page 1.
  pages['https://ws.test/stock/'] = list([1, 2, 3, 4], 10);
  pages['https://ws.test/stock/?page=2'] = list([4, 5, 6, 7], 10);
  pages['https://ws.test/stock/?page=3'] = list([8, 9, 10], 10);
  // Site qui rend la page 1 quel que soit « page=N », sans total annoncé : la lecture ne tourne pas en rond.
  pages['https://ws2.test/stock/'] = list([1, 2], null);
  for (let p = 2; p <= 6; p++) pages[`https://ws2.test/stock/?page=${p}`] = list([1, 2], null);
  const realTimeout = globalThis.setTimeout; // 10 s entre deux pages chez webspark : sans attente pour le test
  globalThis.setTimeout = ((fn: () => void) => realTimeout(fn, 0)) as typeof setTimeout;
  try {
    ok(dsw.detectDealerProvider(pages['https://ws.test/stock/']) === 'webspark', 'webspark reconnu (cartes vcard)');
    flaky['https://ws.test/stock/?page=3'] = 1; // Sofibrie, 19/11 : un 502 passager à la page 41 arrêtait le relevé
    cut['https://ws.test/stock/'] = 1;          // autobazar.eu, 19/11 : connexion coupée sur la première page
    cut['https://ws.test/stock/?page=2'] = 2;
    const st = await dsw.fetchDealerStock('https://ws.test/stock/');
    ok(st.vehicles.length === 10 && st.pages === 3 && !st.warnings.some((w) => /lu\(s\) pour|HTTP 502/.test(w)),
      'page 2 avec une carte déjà lue : la lecture continue ; un 502 et des connexions coupées passagères sont réessayés : 10 voitures sur 10', [st.vehicles.length, st.pages, st.warnings]);
    const dead = await dsw.fetchDealerStock('https://ws.test/mort/').then(() => 'lu', (e: Error) => e.message);
    ok(/introuvable|HTTP 404/.test(dead), 'une page absente (404) n\'est pas réessayée comme une connexion coupée', dead);
    const before = fetched.length;
    const loop = await dsw.fetchDealerStock('https://ws2.test/stock/');
    const asked = fetched.slice(before).filter((u) => u.startsWith('https://ws2.test/'));
    ok(loop.vehicles.length === 2 && !asked.includes('https://ws2.test/stock/?page=5') && loop.warnings.some((w) => /aucune voiture nouvelle/.test(w)),
      'page 1 rendue pour toute page : arrêt après trois pages sans nouvelle, signalé', [loop.vehicles.length, asked, loop.warnings]);
  } finally { globalThis.setTimeout = realTimeout; }
}

console.log('\n=== AUTO PALACE / SITES BMW DE SLOVAQUIE (19/11) : PROMOTIONS, LIEU, RÉSERVÉE, VENDUE ===\n');
{
  const dsa = await import('../worker/dealerStock');
  // Carte réelle (bmw-zilina.sk, 19/11), raccourcie ; « Predané » sur une deuxième carte (MD-Bavaria, même gabarit).
  const card = (id: string, slug: string, site: string, sticker: string, vin: string) => `<div class="cell slice-1 item with-compare virtual-list manager stock" style="animation-delay:0s"> <div class="info"> <div class="img-wrap">
    <a href="/ponuka-vozidiel/${slug}-${id}" class="image" onclick="dataLayer.push(dataLayer_${id}_onClickEvent)" > <div class="stockName">${site}</div> <div class="overlay"></div> <img src="preview-file/x.jpg" alt="BMW"> </a> </div>
    <h2> <a href="/ponuka-vozidiel/${slug}-${id}" onclick="dataLayer.push(dataLayer_${id}_onClickEvent)" > BMW 223 xDrive Gran Coupe </a> </h2> <div class="epithet_wrapper stickers"> <div class="sticker anthraciteBg">Manažérske vozidlo</div> <span class="sticker grey">${sticker}</span> </div>
    <div class="table prices"> <div class="row action"> <div class="cell large label">Zvýhodnená cena<i>:</i></div> <div class="cell large value">33 990 €</div> </div> </div>
    <div class="table data extender"> <div class="tag registration"> 25.06.2025 </div> <div class="tag mileage"> <div class="square"></div> 15 631km </div> <div class="tag fuel"> <div class="square"></div> Benzín </div>
    <div class="tag power"> <div class="square"></div> 150 kW (204 PS) <div class="break"></div> </div> <div class="tag vin"> <div class="break"></div> ${vin} <div class="square"></div> </div> <div class="tag availability"> <b> Na sklade v Žiline </b> </div> </div> </div> </div>
    <script> const dataLayer_${id} = { item_name: 'BMW 223 xDrive Gran Coupe', item_id: '${vin}', price: 33990, item_brand: 'BMW', item_category: 'BMW radu 2', item_category2: 'Benzín' }; </script>`;
  const promo = `<div class="cell slice-1 item with-compare virtual-list new way"> <div class="info"> <div class="img-wrap"> <a href="/ponuka-vozidiel/ix3-40-0992165" class="image" > <img src="/x.jpg" alt="BMW iX3 40"> </a> </div>
    <h2> <a href="/ponuka-vozidiel/ix3-40-0992165" > BMW iX3 40 [Neue Klasse] </a> </h2> <div class="table data extender"> <div class="tag vin"> <div class="break"></div> </div> </div> </div> </div>`;
  // Neuves « …-66713-neue-klasse » (fin d'adresse sans chiffre) : le numéro de la carte (« car-id »), pas « klasse ».
  const klasse = (n: string, carId: string) => card(carId, 'x', 'ZA', 'Nové vozidlo', 'WBA71GG0407T5603' + n.slice(-1)).replace(/\/ponuka-vozidiel\/x-\d+/g, `/ponuka-vozidiel/ix3-50-xdrive-${n}-neue-klasse`)
    + `<a href="#" class="button more" save-car="favourite" car-id="${carId}"></a>`;
  pages['https://ap.test/jazdene-vozidla/sklad:3'] = `<div class="locator version2 bmw bmw-zilina" data-domain-code="bmw-zilina"> <div class="row list inPopup"> <div class="content"> ${promo} </div> </div>
    <div class="row list bmw"> <div class="content" id="filter_content"> <p>Počet záznamov: <span>4</span></p> ${card('54124', 'bmw-223-xdrive-gran-coupe-6ac66c867f322', 'ZA', 'Rezervované', 'WBA71GG0407T56031')}
    ${card('52444', 'bmw-ix3-50-xdrive-da05284', 'TN', 'Predané', 'WBA71GG0407T56032')} ${klasse('66713', '51062')} ${klasse('66716', '51069')} </div> </div> </div>`;
  ok(dsa.detectDealerProvider(pages['https://ap.test/jazdene-vozidla/sklad:3']) === 'autopalace', 'CMS des concessions BMW reconnu (autopalace)');
  const ap = await dsa.fetchDealerStock('https://ap.test/jazdene-vozidla/sklad:3');
  const g = (id: string) => ap.vehicles.find((v) => v.external_id === id);
  ok(ap.vehicles.length === 4 && !g('0992165') && !!g('51062') && !!g('51069') && !g('klasse'), 'cartes promotionnelles (bloc « inPopup ») écartées ; neuves « …-neue-klasse » sous le numéro de leur carte : 4 lues pour 4 annoncées', ap.vehicles.map((v) => v.external_id));
  ok(g('54124')?.status === 'reserved' && g('54124')?.location === 'Žilina' && g('52444')?.status === 'sold' && g('52444')?.location === 'Trenčín'
    && g('54124')?.model === 'Série 2' && g('54124')?.price === 33990 && g('54124')?.km === 15631,
    '« Rezervované » = réservée, « Predané » = vendue, lieu « stockName » (ZA, TN), Série 2, prix, km', ap.vehicles.map((v) => [v.external_id, v.status, v.location, v.model]));
}

console.log('\n=== GROUPES HONGROIS (JP Auto, Autentik, MBM, Duna, Schiller, Petrányi, Leier — 19/11) ===\n');
{
  const dh = await import('../worker/dealerStock');
  // JP Auto, occasions : ligne réelle du tableau « lista » (jpauto.hu/hasznalt-auto/hasznaltautok-budapest, 19/11).
  const jpRow = `<table class="lista"><tr class="tr_alt"> <td style="height: 45px; width: 20px;">91.</td> <td style="width: 65px;"><a href="https://jpauto.hu/hasznalt-auto/hasznaltautok-budapest?hirdeteskod=23741916"><img src="https://x/1.jpg" alt="" class="kiskep"/></a></td>
    <td style="width: 280px;"><a href="https://jpauto.hu/hasznalt-auto/hasznaltautok-budapest?hirdeteskod=23741916">KIA SPORTAGE 1.6 T-GDI Platinum</a></td> <td style="width: 200px; text-align: center;">8 390 000 Ft</td> <td style="width: 200px; text-align: center;"></td>
    <td style="text-align: center;">2022/07</td> <td style="width: 130px; text-align: center;">110 kW, 150 LE</td> <td style="width: 200px; text-align: center;">Benzin</td> </tr></table>`;
  const [jp] = dh.parseJpUsedRows(jpRow, 'budapest');
  ok(jp?.external_id === '23741916' && jp?.brand === 'Kia' && jp?.price === 8390000 && jp?.year === 2022 && jp?.fuel === 'Benzin' && jp?.power_ch === 150 && jp?.location === 'JP Auto Fót (Budapest M0-M3)',
    'JP Auto : ligne réelle des occasions (code hasznaltauto, marque, prix, 1re immatriculation, énergie, puissance, site)', jp);
  const fiche = '<ul><li><div class="alabel">Üzemanyag: </div><div class="value">benzin</div></li> <li><div class="alabel">Sebesség váltó: </div><div class="value">automata</div></li> <li><div class="alabel">Km. óra állás: </div><div class="value">23 587 km</div></li></ul>';
  const det = dh.readHgSpecDetail(fiche);
  ok(det.gearbox === 'Automatique' && det.km === 23587 && det.fuel === 'benzin', 'fiche « export hasznaltauto » : boîte, km, énergie (libellés réels)', det);
  ok(dh.hgVat('KIA CEED 1.5 T-GDI ÁFA-s!') && dh.hgVat('Nettó: 12 590 000 Ft') && !dh.hgVat('nem áfás, magánszemélytől') && JSON.stringify(dh.hgPrice('11 690 000 Ft +27% ÁFA')) === '{"price":14846300,"net":true}',
    'TVA récupérable (« ÁFA-s », « Nettó ») ; « nem áfás » non ; prix « + ÁFA » = hors taxe, converti en TTC × 1,27');
  // Autentik / Hedin (Feki Webstudio) : tout le groupe dans la page ; la concession = « site= » (mot entier : « gyor » ne prend
  // pas « Győri út », adresse de Sopron), « marque= » ; page de groupe sans « site= » refusée ; lieu inconnu refusé.
  const fwCar = (id: number, brand: string, site: string) => ({ id, brand, model: 'X', type: `${brand} X 2.0`, year: '2023', km: '15 000 km', price: 9990000, currency: 'HUF', link: `https://fw.test/hu/auto/${id}`, fuel: 'Dízel', transmission: 'Automata', site });
  const fwPage = `<script>window.FW = window.FWS = window.FekiWebstudio = ${JSON.stringify({ cars: [fwCar(1, 'MERCEDES-BENZ', '9012 Győr, Mérföldkő u. 1.'), fwCar(2, 'KIA', '9400 Sopron, Győri út 42.'), fwCar(3, 'MERCEDES-BENZ', '2800 Tatabánya, Táncsics u. 2.')] })};</script>`;
  for (const q of ['', '?site=gyor', '?site=gyor&marque=kia', '?site=pecs']) pages[`https://fw.test/hu/hasznaltautok${q}`] = fwPage;
  ok(dh.detectDealerProvider(fwPage) === 'fwcars', 'Autentik : page Feki Webstudio reconnue (liste « cars » en JSON)');
  const err = (u: string) => dh.fetchDealerStock(u).then((r) => `lu ${r.vehicles.length}`, (e: Error) => e.message);
  const whole = await err('https://fw.test/hu/hasznaltautok');
  const gy = await dh.fetchDealerStock('https://fw.test/hu/hasznaltautok?site=gyor');
  const gyKia = await dh.fetchDealerStock('https://fw.test/hu/hasznaltautok?site=gyor&marque=kia');
  const nowhere = await err('https://fw.test/hu/hasznaltautok?site=pecs');
  ok(/vitrine de groupe/.test(whole) && gy.vehicles.map((v) => v.external_id).join() === '1' && gy.vehicles[0]?.brand === 'Mercedes-Benz' && gyKia.declared === 0 && /aucune voiture au lieu/.test(nowhere),
    'groupe sans « site= » refusé ; « site=gyor » : la voiture de Győr seulement (pas « Győri út » à Sopron) ; aucune Kia à Győr = vrai zéro ; lieu inconnu refusé (rien marqué disparu)', [whole, gy.vehicles.map((v) => v.external_id), gyKia.declared, nowhere]);
  // JP Auto « auto-kereso » sans telephely : le stock de tout le groupe n'est pas une concession.
  pages['https://jp.test/auto-kereso/?marka=mercedes-benz'] = '<span class="sum ">Összesen: 281 db autó</span><a href="https://www.jpauto.hu/auto-kereso/?x=1">x</a>';
  ok(/sans telephely/.test(await err('https://jp.test/auto-kereso/?marka=mercedes-benz')), 'JP Auto : liste des neuves sans « telephely » (tout le groupe) refusée');
  const [jn] = dh.parseJpNewCards('<div class="product-item-row" data-url="https://www.jpauto.hu/auto-kereso/ev3-earth-my26"><div class="name"><a href="#">ÚJ KIA EV3 EARTH ADA HEA LR MY26 Ivory Silver metál</a></div>'
    + '<span class="icon"><img src="/i/icon-allapot.svg"></span><span class="val">Új</span><div class="price">16 890 000 Ft</div></div>', 'Kia', 'JP Auto Veszprém');
  ok(jn?.external_id === 'ev3-earth-my26' && jn?.year === 2026 && jn?.price === 16890000 && /^Kia EV3 EARTH/.test(jn?.title ?? ''), 'JP Auto neuve : « MY26 » = année-modèle 2026, « ÚJ » et la marque répétée ôtés', jn);
  // Détection : un marqueur réel par plateforme.
  const det7 = [
    '<a href="https://jpauto.hu/hasznalt-auto/hasznaltautok-eger">x</a> Találatok száma: 20 <table class="lista"></table>',
    '<div id="vehicleListU"></div><input name="ha_source"><select id="pageLimitSelectorU"></select>',
    '<div data-components--stock-search-load-endpoint-value="&#x2F;auto-kereso&#x2F;load"></div><span data-components--stock-search-target="counter"></span>',
    '<script>window.__APP_CONFIG__ = {"API_URL":"https://api.schiller.hu/api/trpc"}</script><script src="/assets/carListing-Ab12.js"></script>',
    '<link rel="canonical" href="https://www.petranyiauto.hu/kinalat/hasznalt-autok/" />',
    '<body class="wp-theme-leierauto"><select name="gyartmany"></select><article class="used-vehicle-card">',
  ].map((h) => dh.detectDealerProvider(h));
  ok(JSON.stringify(det7) === '["jpauto","mbmauto","dunaauto","schiller","petranyi","leierauto"]', 'JP Auto, MBM, Duna, Schiller, Petrányi, Leier reconnus par leurs marqueurs', det7);
}

console.log('\n=== SLOVAQUIE (19/11) : STOCK NEUF ŠKODA, KIA, AUTOBAZAR.EU, HEDIN, KIA OCCASIONS, TODOS ===\n');
{
  const dk = await import('../worker/dealerStock');
  // Voiture réelle de l'API du stock neuf Škoda (Auto Lamač, 19/11).
  const item = { id: 'SVK21733412966', manufactury: 'Škoda', model: 'Fabia', title: 'Extra', salePrice: { unit: 'EUR', value: 17790.0 }, listPrice: { unit: 'EUR', value: 19442.0 },
    mileage: { unit: 'km', value: '9' }, initialReg: 'without', productionDate: '2026-10-08T00:00:00+00:00', modelYear: 2027, type: 'N', isDemoCar: false, isReserved: false,
    vin: 'TMBER6PJ6V4067733', businessModel: 'dealer_stock', availableFrom: 'Immediately', availableFromDate: null,
    technicalData: { fuel: 'Benzín', gear: 'Manuálna', transmissionName: '6-stup. manuál', engineName: '1.0 TSI 85,00 kW', engineShortName: '1.0 TSI', motor: { unit: 'kW', value: 85 } },
    dealer: { id: '654-21733', name: 'Auto Lamač, Bratislava', street: 'Hodonínska 13' } };
  const sv = dk.skodaStockToVehicle(item as never, 'https://www.skoda-auto.sk/apps/stock', '654-21733');
  ok(sv?.external_id === 'SVK21733412966' && sv?.price === 17790 && sv?.km === 9 && sv?.year === 2026 && sv?.fuel === 'Benzín' && sv?.gearbox === 'Manuelle' && sv?.vin === 'TMBER6PJ6V4067733'
    && sv?.power_ch === 116 && /prix catalogue 19442/.test(sv?.body ?? ''), 'stock neuf Škoda : voiture réelle (prix remisé, km, année de fabrication, boîte, VIN, puissance, prix catalogue)', sv);
  const marks = [
    '<script>window.SCUC = {"webAppRoute":"apps/stock","dealer":"654-21733"}</script>',
    '<script data-page="app" type="application/json">{"component":"cars\\/Index","props":{}}</script><title>Kiaihned</title>',
    '<script id="__NEXT_DATA__" type="application/json">{"runtimeConfig":{"host":"www.autobazar.eu"}}</script><script type="application/ld+json">{"@type": "ItemList","itemListElement":[{"@type":"Car"}]}</script>',
    '<link href="/MotorCarGroup/Content/site.css" rel="stylesheet"><select class="x" id="predajca"></select> https://www.hedinautomotive.sk/vozidla',
    '<script src="https://used-cars.kia.eu/ucl-bff/static/app.js"></script>',
    '<div id="app" data-page="{&quot;component&quot;:&quot;Cars/Index&quot;}"></div><a href="https://todosjazdene.sk/ponuka">x</a>',
  ].map((h) => dk.detectDealerProvider(h));
  ok(JSON.stringify(marks) === '["skodastock","kiaihned","autobazareu","hedin","kiaused","todosjazdene"]', 'les six plateformes slovaques reconnues (autobazar.eu avant la règle JSON-LD « datamotive »)', marks);
}

console.log('\n=== TOYOTA HONGRIE (pewneauto, 19/11) : CARTES ET FICHES RÉELLES ===\n');
{
  const ds3 = await import('../worker/dealerStock');
  const card = (id: string, make: string, version: string, fuel: string, li: string) => `<div class="o-bx" aria-label="${make}: ajánlat azonosítóval ${id}" offer-id="${id}">
    <div class="o-bx__gallery"><a href="/ajanlat/x/${id}"><img src="https://panel.pewneauto.pl/media/thumbnails/ed/${id}.jpg" alt=""></a></div>
    <div class="o-bx__title"><a href="/ajanlat/x/${id}" tabindex="-1"><strong>${make}</strong></a>
        <span>${version}</span></div>
    <div class="o-bx__info"><b>Schiller (Budapest IV. ker.)</b><ul>${li}<li>${fuel}</li><li><span>1 598 cm<sup>3</sup></span></li></ul></div>
    <div class="o-bx__price"><p class="retail-price"><small>bruttó</small><strong>6 390 000 Ft</strong></p></div></div>`;
  const page = `<html><head><title>Autó ajánlatok megtekintése - 155 ajánlat | Toyota Minősített Használt</title></head><body><img src="https://panel.pewneauto.pl/toyotapl/resources/img/main-hero.jpg">
    ${card('446979', 'Hyundai Tucson', '1.6 T-GDI LP MHEV Premium DCT ÁFÁS!MAGYARORSZÁGI!', '<strong>Benzin</strong>', '<li><span>2022</span></li><li><span>147 261 km</span></li>')}
    ${card('446975', 'Toyota C-HR', '1.8 Hybrid Style', '<strong class="color-hybrid">Hibrid</strong>', '<li><span>2025</span></li><li><span>30 863 km</span></li>')}
    ${card('446980', 'Opel Astra', '1.2 T Edition', '<strong>Benzin</strong>', '<li><span>2021</span></li><li><span>88 000 km</span></li>')}</body></html>`;
  ok(ds3.detectDealerProvider(page) === 'pewneauto' && ds3.detectDealerProvider('<title>x - 0 ajánlat | Toyota</title><img src="https://panel.pewneauto.pl/toyotapl/resources/img/main-hero">') === 'pewneauto',
    'pewneauto reconnu, y compris une station vide (« 0 ajánlat »)');
  const cs = ds3.parsePewneCards(page, 'https://toyotaminositetthasznalt.hu');
  const c = (id: string) => cs.find((v) => v.external_id === id);
  ok(ds3.pewneDeclared(page) === 155 && cs.length === 3, 'total annoncé du titre (155) et 3 cartes', [ds3.pewneDeclared(page), cs.length]);
  ok(c('446979')?.price === 6390000 && c('446979')?.currency === 'HUF' && c('446979')?.km === 147261 && c('446979')?.year === 2022 && c('446979')?.fuel === 'Benzin'
    && c('446979')?.gearbox === 'Automatique' && /TVA récupérable$/.test(c('446979')?.title ?? '') && c('446979')?.location === 'Schiller (Budapest IV. ker.)',
    'carte : prix brut en forints, km, année, énergie, boîte (DCT), « ÁFÁS! » = TVA récupérable, concession', c('446979'));
  ok(c('446975')?.fuel === 'Hibrid' && c('446975')?.gearbox === 'Automatique', 'énergie dans <strong class="color-hybrid"> ; hybride Toyota = automatique (e-CVT)', c('446975'));
  ok(c('446980')?.gearbox === null, 'version muette (Opel 1.2 T) : boîte laissée à la fiche', c('446980'));
  const fiche = '<li><span>Gyártási év</span><span>2026</span></li><li><span>Első forgalomba helyezés dátuma</span><span>-</span></li><li><span>Futásteljesítmény</span><span>27 670 km</span></li><li><span>Üzemanyagtípus</span><span>Hibrid</span></li><li><span>Váltó</span><span>Automata</span></li>';
  ok(JSON.stringify(ds3.readPewneDetail(fiche)) === JSON.stringify({ gearbox: 'Automatique', fuel: 'Hibrid', km: 27670, year: 2026 }), 'fiche : « Váltó », énergie, km, année (immatriculation « - » → année de fabrication)', ds3.readPewneDetail(fiche));
  // Slovaquie (19/11) : occasions usedcars.toyota.sk (même gabarit, euros, « Odpočet DPH ») et neuves nove.toyota.sk (gabarit récent).
  const usedSk = `<div class="o-bx" aria-label="Toyota PROACE VERSO: ponuka s ID 444937" offer-id="444937"> <div class="o-bx__gallery"> <a href="/ponuka/toyota-proace-verso/444937" aria-label="x"> <img src="https://panel.pewneauto.pl/media/x.jpg" alt="x"> </a> </div>
    <div class="o-bx__title"> <a href="/ponuka/toyota-proace-verso/444937" tabindex="-1"><strong>Toyota PROACE VERSO</strong></a> <span>MY26 - L1 - 2.2L Diesel 180k - 8 AT Family 8 miest webasto</span> <div class="o-bx__tags"> <span class="tag tag--primary">Odpočet DPH</span> </div> </div>
    <div class="o-bx__info"> <b>A.A.Service, spol. s r.o.</b> <ul> <li><span>2026</span></li> <li><span>490 km</span></li> <li><strong>Diesel</strong></li> <li><span>2 184 cm<sup>3</sup></span></li> </ul> </div>
    <div class="o-bx__price"> <p class="retail-price--old">Cena pred zľavou: <s>48 745 €</s></p> <p class="retail-price"> <small>Aktuálna cena:</small> <strong>40 900 €</strong> </p> </div> </div>`;
  const newSk = `<div class="o-bx"> <a href="/ponuka/toyota-yaris/447315" class="o-bx__image gaServeEvent" data-pjax="0"> <div class="o-bx__image__location semi-trans-background-light"> <i class="t-icon-tr-pin"></i><strong>Prievidza</strong> </div> </a>
    <div class="o-bx__data"> <div class="o-bx__header"> <div class="o-bx__header__name"> <a href="/ponuka/toyota-yaris/447315" class="o-bx__header__name__title gaServeEvent" data-pjax="0"> Toyota Yaris </a> <span class="o-bx__header__name__subtitle"> 1.5 HEV 130k - eCVT GR Sport </span> </div>
    <div class="o-bx__header__extras"> <div class="o-bx__header__extras__tag o-bx__header__extras__tag--primary">Odpočet DPH</div> <div class="o-bx__header__extras__tag o-bx__header__extras__tag--secondary">NOVÉ</div> </div> </div>
    <div class="o-bx__price"> <span>28 090 €</span> <strong>25 590 €&nbsp;<small>s DPH</small></strong> <small>357 €&nbsp;s DPH/mes.</small> </div>
    <button type="button" data-click="compareToggleCar" data-used_car_id="447315"></button> <ul class="o-bx__spec__list"> <li class="o-bx__spec__list__element"> <b>Rok výroby</b><span>2026</span> </li> <li class="o-bx__spec__list__element"> <b>Najazdené km</b><span>5&nbsp;km</span> </li>
    <li class="o-bx__spec__list__element o-bx__spec__list__element--hybrid"> <b>Druh paliva</b><span>Hybrid</span> </li> <li class="o-bx__spec__list__element"> <b>Prevodovka</b><span>Automatická (eCVT)</span></li> <li class="o-bx__spec__list__element"> <b>Výkon</b><span>96&nbsp;kW</span> </li> </ul> </div> </div>`;
  const [u1] = ds3.parsePewneCards(usedSk, 'https://usedcars.toyota.sk');
  const [n1] = ds3.parsePewneCards(newSk, 'https://nove.toyota.sk');
  ok(u1?.external_id === '444937' && u1?.price === 40900 && u1?.currency === 'EUR' && u1?.km === 490 && u1?.year === 2026 && u1?.fuel === 'Diesel' && u1?.gearbox === 'Automatique'
    && /TVA récupérable$/.test(u1?.title ?? '') && u1?.url === 'https://usedcars.toyota.sk/ponuka/toyota-proace-verso/444937' && u1?.location === 'A.A.Service, spol. s r.o.',
    'occasion slovaque : prix en euros (pas l\'ancien prix barré), « 8 AT » automatique, « Odpočet DPH » = TVA récupérable, fiche « /ponuka/ »', u1);
  ok(n1?.external_id === '447315' && n1?.title === 'Toyota Yaris 1.5 HEV 130k - eCVT GR Sport · TVA récupérable' && n1?.price === 25590 && n1?.currency === 'EUR' && n1?.km === 5 && n1?.year === 2026
    && n1?.fuel === 'Hybrid' && n1?.gearbox === 'Automatique' && n1?.power_ch === 131 && n1?.location === 'Prievidza',
    'neuve slovaque (gabarit récent) : nom, version, prix remisé, km, année, énergie, boîte, puissance, lieu', n1);
  const [u2] = ds3.parsePewneCards(usedSk.replace(/444937/g, '446895').replace('MY26 - L1 - 2.2L Diesel 180k - 8 AT Family 8 miest webasto', '2.0D 8AT L2 5D Tailgate VIP 6S Webasto'), 'https://usedcars.toyota.sk');
  ok(u2?.gearbox === 'Automatique', '« 8AT » (rapports collés) = automatique', u2?.gearbox);
  const [h1] = ds3.parsePewneCards(usedSk.replace('Odpočet DPH', '').replace('MY26 - L1 - 2.2L Diesel 180k - 8 AT Family 8 miest webasto', '1.8 Hybrid Style e-CVT Mo.-i. 1 tulajdonos! Garanciális! ÁFA-s!'), 'https://x.hu');
  ok(/TVA récupérable$/.test(h1?.title ?? ''), '« ÁFA-s! » (Hongrie, trait d\'union) = TVA récupérable', h1?.title);
  ok(ds3.pewneDeclared('<title>Zobraziť ponuky vozidiel - 48 ponúk | Toyota Overené jazdené vozidlá</title>') === 48 && ds3.pewneDeclared('<title>Zobraziť ponuky vozidiel - 0 ponúk | Toyota</title>') === 0
    && ds3.detectDealerProvider('<title>Zobraziť ponuky vozidiel - 48 ponúk</title><link href="/toyotapl/resources/app.css">') === 'pewneauto', 'total « N ponúk », gabarit récent reconnu');
  const ficheSk = '<li><span>Rok výroby</span><span>2022</span></li><li><span>Dátum prvej registrácie</span><span>09-09-2022</span></li><li><span>Najazdené kilometre</span><span>116 988 km</span></li><li><span>Typ paliva</span><span>Hybrid</span></li><li><span>Prevodovka</span><span>Automatická (eCVT)</span></li>';
  ok(JSON.stringify(ds3.readPewneDetail(ficheSk)) === JSON.stringify({ gearbox: 'Automatique', fuel: 'Hybrid', km: 116988, year: 2022 }), 'fiche slovaque : « Prevodovka », « Typ paliva », « Najazdené kilometre », 1re registrácia', ds3.readPewneDetail(ficheSk));
}

console.log('\n=== PLACE DE MARCHÉ DES NEUVES DU GROUPE VW (turbo-stream, 19/11) ===\n');
{
  const ds4 = await import('../worker/dealerStock');
  // Encodeur minimal au format réel « search.data » : chaque valeur à un indice, objets aux clés « _<indice de la clé> », null = -5.
  const enc = (root: unknown): unknown[] => {
    const arr: unknown[] = [];
    const put = (v: unknown): number => {
      if (v === null) return -5;
      const i = arr.length; arr.push(null);
      if (Array.isArray(v)) arr[i] = v.map(put);
      else if (v && typeof v === 'object') { const o: Record<string, number> = {}; for (const [k, x] of Object.entries(v)) { const ki = arr.length; arr.push(k); o[`_${ki}`] = put(x); } arr[i] = o; }
      else arr[i] = v;
      return i;
    };
    put(root);
    return arr;
  };
  const real = { id: 'V-2026-0520490-HU', mileageKm: 0, brand: 'VW', model: { name: 'Polo Comfort 1.0 TSI', groupName: 'Polo', year: 2027 },
    flagData: { stockVehicle: true, testDrive: false, storedByImporter: null, vatDeductible: true, reservedOnline: false },
    colorData: { exterior: { name: 'Ascot-szürke' } }, technicalData: { combinedFuelGroupName: 'Gázolaj', gearName: 'Kézi 5 fokozatú', manufacturingYear: 2026, power: { powerHp: 95 } },
    priceData: { display: { currency: 'HUF', gross: 731258000 } }, patchedDealer: { internetDealerId: '04859', name: 'Porsche Buda' } };
  const arr = enc({ 'routes/search/search.route': { data: { resultList: [{ type: 'car', car: real }], page: { total: 1, size: 100 } } } });
  const car = (ds4.turboStreamDecode(arr) as any)['routes/search/search.route'].data.resultList[0].car;
  ok(car.id === 'V-2026-0520490-HU' && car.brand === 'VW' && car.flagData.storedByImporter === null && car.patchedDealer.internetDealerId === '04859'
    && car.priceData.display.gross === 731258000, 'turbo-stream décodé (références par indice, clés « _n », -5 = null)', car);
  const v = ds4.vwgmToVehicle(car, 'https://azonnalelviheto.volkswagen.hu');
  ok(v?.price === 7312580 && v?.brand === 'Volkswagen' && v?.gearbox === 'Manuelle' && v?.fuel === 'Gázolaj' && /TVA récupérable$/.test(v?.title ?? '')
    && v?.url === 'https://azonnalelviheto.volkswagen.hu/search/car/V-2026-0520490-HU', 'voiture : fillér → forints, « Kézi » = manuelle, TVA récupérable, lien de la fiche', v);

  // Slovaquie (19/11) : boîtes réelles, CUPRA sous le code SEAT, utilitaires « LNF », gamme « Nové Audi A6 Avant ».
  const gears = ['DSG 7-st.', 'S tronic 7-st.', '6-st.', 'Automatická', 'Tiptronic 8-st.', '5-st.', 'Elek.ovlád.mechanick', 'S-tronic 6-st.', 'Kézi 5 fokozatú'].map((g) => ds4.vwgmGear(g));
  ok(JSON.stringify(gears) === '["Automatique","Automatique","Manuelle","Automatique","Automatique","Manuelle","Automatique","Automatique","Manuelle"]', 'boîtes slovaques : « 6-st. » = manuelle, « S-tronic », « Elek.ovlád. » (eHybrid) = automatique', gears);
  const sk = (o: Record<string, unknown>) => ds4.vwgmToVehicle({ ...real, id: 'V-SK-1', priceData: { display: { currency: 'EUR', gross: 4339000 } }, ...o } as never, 'https://skladove-vozidla.seat.sk');
  const cu = sk({ brand: 'SEAT', model: { name: 'CUPRA Formentor 1,5 eTSI 150 7DSG', groupName: 'CUPRA Formentor' } });
  const ln = sk({ brand: 'LNF', model: { name: 'Multivan Style1.5 TSI eHybrid 4M LR', groupName: 'Multivan' } });
  const a6 = sk({ brand: 'AUDI', model: { name: 'A6 Avant 40 TDI quattro', groupName: 'Nové Audi A6 Avant' } });
  ok(cu?.brand === 'CUPRA' && cu?.model === 'Formentor' && /^CUPRA Formentor 1,5/.test(cu?.title ?? '') && cu?.price === 43390 && cu?.currency === 'EUR'
    && ln?.brand === 'Volkswagen Užitkové vozidlá' && ln?.model === 'Multivan' && a6?.model === 'A6 Avant',
    'CUPRA (code SEAT) = marque CUPRA, « LNF » = utilitaires VW, gamme sans « Nové » ni la marque, euros', [cu?.brand, cu?.model, cu?.title, cu?.price, ln?.brand, a6?.model]);

  // Plus de 100 voitures : découpe par « stock-cars » / « test-drive », puis par gamme ; page de groupe ; concession sans page.
  const mk = (id: string, o: { dealer?: string; importer?: boolean; demo?: boolean; group?: string } = {}) => ({ ...real, id, model: { name: `${o.group ?? 'Audi Q5 SUV'} ${id}`, groupName: o.group ?? 'Audi Q5 SUV' },
    flagData: { stockVehicle: !o.demo, testDrive: !!o.demo, storedByImporter: o.importer ? true : null }, patchedDealer: { internetDealerId: o.dealer ?? '08135', name: 'Porsche Zlaté Piesky' } });
  const resp = (cars: unknown[], total: number, groups: Array<[string, number]> = []) => JSON.stringify(enc({ 'routes/search/search.route': { data: {
    resultList: cars.map((c) => ({ type: 'car', car: c })), page: { total, size: 100 }, filters: [{ id: 'fmodel_group', sections: [{ id: 'mg', items: groups.map(([code, count]) => ({ code, count })) }] }] } } }));
  const c1 = mk('A1'), c2 = mk('A2'), c3 = mk('A3', { importer: true, group: 'Nové Audi A6 Avant' }), c4 = mk('A4', { group: 'Nové Audi A6 Avant' }), c5 = mk('A5', { demo: true });
  const gm = 'https://vwgm.test/d-8135/search.data?size=100';
  pages['https://vwgm.test/d-8135/search'] = '<script>window.__reactRouterContext = {"routes/search/search.route":{"storedByImporter":null}};</script>';
  pages[gm] = resp([c1, c2, c3], 5);                                                     // 5 annoncées, 3 servies (plafond)
  pages[`${gm}&stock-cars=true`] = resp([c1, c2, c3], 4, [['Audi Q5 SUV', 2], ['Nové Audi A6 Avant', 2]]);
  pages[`${gm}&stock-cars=true&mg=${encodeURIComponent('Audi Q5 SUV')}`] = resp([c1, c2], 2);
  pages[`${gm}&stock-cars=true&mg=${encodeURIComponent('Nové Audi A6 Avant')}`] = resp([c3, c4], 2);
  pages[`${gm}&test-drive=true`] = resp([c5], 1);
  const split = await ds4.fetchDealerStock('https://vwgm.test/d-8135/search');
  ok(split.vehicles.length === 4 && split.declared === 4 && !split.warnings.some((w) => /partiel/.test(w)) && split.vehicles.some((x) => x.external_id === 'A4'),
    'liste plafonnée : découpe stock / démonstration puis par gamme, les 4 voitures de la concession lues, relevé complet (l\'importateur écarté)', [split.vehicles.map((x) => x.external_id), split.declared, split.warnings]);
  pages['https://vwgm.test/g-sk_galimex/search'] = pages['https://vwgm.test/d-8135/search'];
  pages['https://vwgm.test/g-sk_galimex/search.data?size=100'] = resp([mk('G1', { dealer: '08108' }), mk('G2', { dealer: '08125' }), mk('G3', { importer: true, dealer: '' })], 3);
  const grpV = await ds4.fetchDealerStock('https://vwgm.test/g-sk_galimex/search');
  ok(grpV.vehicles.length === 2 && grpV.declared === 2, 'page de groupe « /g-<groupe>/ » : voitures de ses deux concessions, sans l\'importateur', grpV.vehicles.map((x) => x.external_id));
  pages['https://vwgm.test/d-8407/search'] = pages['https://vwgm.test/d-8135/search'];
  pages['https://vwgm.test/d-8407/search.data?size=100'] = '[["SingleFetchRedirect",1],{"_2":3,"_4":5},"redirect","https://vwgm.test/search?size=100","status",302]';
  statuses['https://vwgm.test/d-8407/search.data?size=100'] = 202; // renvoi React Router : HTTP 202 (réel, 19/11)
  const redir = await ds4.fetchDealerStock('https://vwgm.test/d-8407/search').then(() => 'lu', (e: Error) => e.message);
  ok(/recherche nationale/.test(redir), 'concession renvoyée vers la recherche nationale : échec du relevé (pas de stock national pris pour le sien)', redir);
}

console.log('\n=== OCCASIONS BMW HONGRIE (ajanlatok.bmw.hu, 19/11) ===\n');
{
  const ds5 = await import('../worker/dealerStock');
  const item = { id: 291919, vin17: 'WBA31FZ010FV64590', title: 'BMW 320d xDrive Touring', brand: { label: 'BMW' }, series: { label: '3' }, bodyType: { label: 'Kombi' },
    productionYear: 2025, registration: '2025-09-26T00:00:00+00:00', mileage: 15064, fuel: { label: 'Dízel' }, powerHP: 190, transmission: { label: 'Automata' },
    color: { label: 'BMW Individual Dravit Szürke metálfényezés' }, warranty: 24, vatReclaimable: true, transactionalPrice: 17600000, reserved: false, reservationStatus: '',
    campaigns: [{ text: 'BMW Gyár Debrecen cégautó' }], created: '2026-11-18T13:29:07+01:00', dealer: { id: 82, name: 'Mag3', city: 'Nyiregyhaza' } };
  const v = ds5.bmwUsedToVehicle(item, 'https://ajanlatok.bmw.hu');
  ok(v?.external_id === '291919' && v?.price === 17600000 && v?.currency === 'HUF' && v?.vin === 'WBA31FZ010FV64590' && v?.year === 2025 && v?.km === 15064
    && v?.gearbox === 'Automatique' && v?.model === 'Série 3' && v?.listed_at === '2026-11-18T12:29:07.000Z' && /TVA récupérable$/.test(v?.title ?? '')
    && v?.url === 'https://ajanlatok.bmw.hu/hasznalt/kereses/reszletek/291919', 'voiture réelle : prix, VIN, 1re immatriculation, Série 3, date de mise en ligne, TVA récupérable, lien', v);
  const phev = ds5.bmwUsedToVehicle({ ...item, id: 290685, title: 'BMW 225e xDrive Active Tourer', fuel: { label: 'Hibrid (elektromos/benzines)' } }, 'https://ajanlatok.bmw.hu');
  ok(phev?.fuel === 'Plug-in Hibrid (elektromos/benzines)', '« Hibrid » sur une 225e = hybride rechargeable', phev?.fuel);
  ok(ds5.detectDealerProvider('<form><select name="dealer[$or]"></select><select name="series[$or]"></select></form>') === 'bmwused', 'plateforme reconnue par son formulaire (dealer[$or], series[$or])');
  // Slovaquie (bezcakania.bmw.sk/jazdene, 19/11) : même API sous « /jazdene/ », index sk_SK déduit du pays, euros, « BMW radu 3 ».
  const form = '<form><select name="dealer[$or]"></select><select name="series[$or]"></select></form>';
  pages['https://bmw.test.sk/jazdene/?perm_dealer_id=87'] = form;
  const skItem = (id: number, title: string, series: string, fuel: string) => ({ ...item, id, title, series: { label: series }, fuel: { label: fuel }, transmission: { label: 'Automatická' },
    transactionalPrice: 64990, dealer: { id: 87, name: 'MD-Bavaria', city: 'Žilina' } });
  const skList = [skItem(291239, 'BMW 520d xDrive Sedan', 'BMW radu 5', 'Diesel'), skItem(291240, 'BMW X1 xDrive25e', 'BMW X', 'Hybrid (elektrina/benzín)'), skItem(291241, 'BMW i4 eDrive40', 'BMW i', 'Elektrina')];
  const bodies: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u === 'https://bmw.test.sk/jazdene/api/v1/ems/bmw-used-sk_SK/search') { bodies.push(String(init?.body)); return new Response(JSON.stringify({ $list: skList, $count: { $total: 3 } }), { status: 200 }); }
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    const st = await ds5.fetchDealerStock('https://bmw.test.sk/jazdene/?perm_dealer_id=87');
    const g = (id: string) => st.vehicles.find((x) => x.external_id === id);
    ok(st.vehicles.length === 3 && JSON.parse(bodies[0] ?? '{}').$match?.dealer === 87 && g('291239')?.currency === 'EUR' && g('291239')?.url === 'https://bmw.test.sk/jazdene/vyhladavanie/detail/291239'
      && g('291239')?.model === 'Série 5' && g('291240')?.model === 'X1' && g('291241')?.model === 'i4' && g('291240')?.fuel === 'Plug-in Hybrid (elektrina/benzín)',
      'Slovaquie : API « /jazdene/…/bmw-used-sk_SK », euros, fiche « vyhladavanie/detail », « BMW radu 5 » = Série 5, X1, i4, hybride rechargeable', st.vehicles.map((x) => [x.external_id, x.model, x.fuel, x.currency, x.url]));
  } finally { globalThis.fetch = realFetch; }
}

console.log('\n=== NEUVES KIA HONGRIE (kia.com « piacter », 19/11) ===\n');
{
  const ds6 = await import('../worker/dealerStock');
  const card = `<div class="carColItemArea"><div class="imgBox"><div class="carAmount"><p class="priDis"><span class="price">6 447 000 Ft</span><span class="txtPrice">(áfával együtt)</span></p></div>
    <a href="/hu/buy-my-kia/piacter/piacter-ajanlat/?vhvin=KNAB351B5TT464429&amp;dealerId=C26VAHG120&amp;postalCode=1037" class="btn_linkPage">Részletek</a></div>
    <div class="contentBox"><strong class="veName">Picanto<span class="veTrim">GOLD</span></strong><ul><li class="engine">1.0 benzin  (Benzin,  kW /  LE) <br/></li>
    <li class="transmission">5 MT 2WD</li><li class="color"><span><img src="x.jpg" alt="Clear White"/></span></li></ul><p>KIA Wallis Kerepesi úti Autó Kft.</p></div></div>`;
  const cs = ds6.parseKiaOspCards(card + card.replace('KNAB351B5TT464429', 'KNAB351BXTT447951').replace('C26VAHG120', 'C26VAHG950'), 'https://www.kia.com');
  const a = cs[0];
  ok(cs.length === 2 && a.dealerId === 'C26VAHG120' && a.v.vin === 'KNAB351B5TT464429' && a.v.price === 6447000 && a.v.fuel === 'Benzin' && a.v.gearbox === 'Manuelle'
    && a.v.model === 'Picanto' && a.v.km === 0 && cs[1].dealerId === 'C26VAHG950', 'carte réelle : VIN et code concession du lien, prix TTC, énergie, « 5 MT » = manuelle, neuve', cs);
  ok(ds6.detectDealerProvider('<div data-url="/hu/buy-my-kia/piacter/piacter-lista/_jcr_content/contents_1/aggregationlist.allOffersResults/"></div>') === 'kiaosp', 'liste « piacter » reconnue');
  // Année-modèle du VIN (10e caractère) : T = 2026, V = 2027 vendue dès novembre 2026, S = 2025 ; code « 9 » d'une 2009 ; VIN tronqué : rien.
  const nov26 = new Date('2026-11-19T00:00:00Z');
  ok(a.v.year === 2026 && JSON.stringify(['KNAB351B5TT464429', 'U5YH5819AVL123456', 'KNAB351B5ST464429', 'KNAFE22129K123456', 'KNAB351B5T'].map((v) => ds6.vinModelYear(v, nov26))) === '[2026,2027,2025,2009,null]',
    'année-modèle lue dans le VIN (10e caractère, cycle de 30 ans, jamais au-delà de l\'an prochain)', [a.v.year, ['KNAB351B5TT464429', 'U5YH5819AVL123456', 'KNAB351B5ST464429', 'KNAFE22129K123456', 'KNAB351B5T'].map((v) => ds6.vinModelYear(v, nov26))]);
}

console.log('\n=== PAPPAS (Mercedes / Kia Hongrie, 19/11) ===\n');
{
  const ds7 = await import('../worker/dealerStock');
  const card = `<section class="vehicle-teaser stretch-link h-100"><a href="/hasznaltauto/szemelyautok/kia/804659901228-kia-sportage" class="stretch-link__link"></a>
    <div class="vehicle-teaser__content"><div class="vehicle-teaser__content-badges"><span class="badge bg-dark">Ajánlat</span></div>
    <h2 class="vehicle-teaser__content-title" tabindex="0"><span>Kia Sportage</span></h2><div class="vehicle-teaser__name">SPORTAGE 239 HEV</div>
    <div class="vehicle-teaser__content-detail"><span>11/2026</span><span>Benzin-Hibrid</span><span>0 km</span><span>SUV</span><span>132 kW / 179 LE</span><span></span></div>
    <div class="vehicle-teaser__content-bottom"><span class="vehicle-teaser__price text-success text-nowrap">-22%</span>
    <span class="vehicle-teaser__price vehicle-teaser__price--instead">Listaár <span class="text-nowrap">17 908 000 Ft</span></span>
    <span class="vehicle-teaser__price text-nowrap">13 990 000 Ft</span><span class="text-muted">ÁFA-val, Regisztrációs adóval</span></div></div></section>`;
  const page = `<form><input name="conditionCategory[]"></form><p>pappas.hu — 147 jármű</p>${card}`;
  const v = ds7.parsePappasCards(page, 'https://www.pappas.hu')[0];
  ok(v?.external_id === '804659901228' && v?.price === 13990000 && v?.year === 2026 && v?.km === 0 && v?.fuel === 'Benzin-Hibrid' && v?.power_ch === 179 && v?.gearbox === null,
    'carte réelle : le prix est le DERNIER montant (pas la liste barrée ni la remise), 1re immatriculation, énergie, km, ch ; boîte laissée à la fiche', v);
  ok(ds7.pappasDeclared(page) === 147 && ds7.detectDealerProvider(page) === 'pappas', 'total « 147 jármű » et site reconnu');
  const empty = '<form><input name="conditionCategory[]"></form><div>Pappas Auto</div><p>Nincsenek a keresési feltételeknek megfelelő járművek.</p>';
  ok(ds7.detectDealerProvider(empty) === 'pappas' && ds7.pappasDeclared(empty) === 0, 'liste vide reconnue, total 0 (pas « site non reconnu »)');
  ok(ds7.readPappasDetail('<dl><dt class="key-value__key">Váltó típusa</dt><dd class="key-value__value">Automata</dd><dt>Évjárat</dt><dd>12/2024</dd></dl>').gearbox === 'Automatique', 'fiche : « Váltó típusa » = boîte');
}

console.log('\n=== POLITESSE : PAS PLUS D\'UNE REQUÊTE TOUTES LES 350 MS PAR SITE ===\n');
{
  const { reserveSiteSlot, SITE_MIN_GAP_MS } = await import('../worker/dealerStock');
  const slots = new Map<string, number>();
  const t = 1_000_000;
  const waits = [reserveSiteSlot('a.test', t, slots), reserveSiteSlot('a.test', t, slots), reserveSiteSlot('a.test', t + 100, slots), reserveSiteSlot('b.test', t + 100, slots), reserveSiteSlot('a.test', t + 2000, slots)];
  ok(SITE_MIN_GAP_MS === 350 && JSON.stringify(waits) === JSON.stringify([0, 350, 600, 0, 0]),
    'même site : départs espacés de 350 ms (0, 350, 600 ms d\'attente), autre site sans attente, site au repos sans attente', waits);
  // Bout en bout : trois lectures du même site à la suite, sans pause du lecteur → au moins 2 × 350 ms.
  const t0 = Date.now();
  const { fetchDealerStock } = await import('../worker/dealerStock');
  for (const u of ['https://dmd.test/b', 'https://dmd.test/c', 'https://dmd.test/f']) await fetchDealerStock(u).catch(() => null); // une requête chacune (page non reconnue)
  ok(Date.now() - t0 >= 2 * 350 - 5, 'trois requêtes vers un même site, sans pause du lecteur : au moins 700 ms', Date.now() - t0);
}

console.log('\n=== LES ÉCRANS LISENT LES MOTS DES SITES (valeurs réelles en base, 14/11) ===\n');
const { fuelFamily, gearboxFamily } = await import('../src/lib/vehicleFamilies');
const fuels: Array<[string, string | null]> = [
  ['Híbrido no enchufable', 'hybrid'], ['Híbrido enchufable', 'phev'], ['Hibrido enchufable', 'phev'], ['Electra', 'electric'], ['GLP', 'gas'],
  ['Ibrida', 'hybrid'], ['Erdgas', 'gas'], ['Metano', 'gas'], ['Hibrido', 'hybrid'], ['E85', 'petrol'], ['Super Plus', 'petrol'], ['Gasolio', 'diesel'],
  ['Benzine', 'petrol'], ['Gasolina', 'petrol'], ['Diésel', 'diesel'], ['Hybride rechargeable', 'phev'], ['Elettrica', 'electric'], ['Plug-in Hybrid', 'phev'],
  ['Autogas', 'gas'], ['Autogas (LPG)', 'gas'], ['Etanol', 'petrol'], ['Hybrid-Benzin', 'hybrid'],
  ['Dízel', 'diesel'], ['Gázolaj', 'diesel'], ['Benzin(mild) Hybrid', 'hybrid'], ['Nafta', 'diesel'], ['Hibr.B/E külső töltő', 'phev'], ['Benzin/elektromos', 'hybrid'], ['Hibrid', 'hybrid'], ['Elektromos', 'electric'], ['Benzín', 'petrol'], ['Elektrický', 'electric'],
  ['Hybr.B/E ext.nab.', 'phev'], ['Hybr.D/E ext.nab.', 'phev'], ['Hybr.B/E', 'hybrid'],
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

console.log('\n=== LECTEURS FRANÇAIS : EXTRAITS RÉELS (18/11) ===\n');
// webspark (SIPA, Sofibrie, Edenauto, Bony) : boîte, km, VIN lus dans le JSON-LD de la liste ; « autre » = inconnue.
const wsld = ds.websparkLdById(`<script type="application/ld+json" class="yoast-schema-graph">${JSON.stringify({ '@graph': [{ '@type': 'ItemList', itemListElement: [
  { '@type': 'ListItem', position: 1, item: { '@type': 'Vehicle', sku: '5353760', fuelType: 'Électrique', vehicleTransmission: 'Automatique', vehicleModelDate: 2023, vehicleIdentificationNumber: 'ZFAEFAG45PX162816', mileageFromOdometer: { '@type': 'QuantitativeValue', value: 23379, unitCode: 'KMT' }, offers: { '@type': 'Offer', priceCurrency: 'EUR', price: 19490 } } },
  { '@type': 'ListItem', position: 2, item: { '@type': 'Vehicle', sku: '5415712', fuelType: 'Hybride', vehicleTransmission: 'autre' } },
] }] })}</script>`);
ok(wsld.get('5353760')?.gearbox === 'Automatique' && wsld.get('5353760')?.km === 23379 && wsld.get('5353760')?.price === 19490 && wsld.get('5353760')?.vin === 'ZFAEFAG45PX162816' && wsld.get('5415712')?.gearbox === null,
  'webspark : boîte, km, prix, VIN du JSON-LD de la liste ; « autre » = inconnue', [...wsld]);
ok(ds.websparkDeclared('<span class="stock-listing__results-counter" x-ref="resultsFoundText">\n        <strong>3193</strong> résultats trouvés') === 3193, 'webspark : total annoncé (Bony, 3 193)');
// openflex (Vikings) : « vehiculeinfos » lu par forme ; boîte de la fiche.
ok(JSON.stringify(ds.openflexInfos('2026 / Essence')) === JSON.stringify({ year: 2026, km: null, fuel: 'Essence' })
  && ds.openflexInfos('2020 / 102666km / Essence / Electrique').fuel === 'Hybride Essence / Electrique' && ds.openflexInfos('2016 / 123844km / Essence').km === 123844,
  'openflex : neuve sans km (plus de 0 lu dans « Essence »), hybride « Essence / Electrique »');
const ofd = ds.readOpenflexDetail('<ul class="grille-3 caracteristiques">\n<li class="km">123844 km</li><li class="boite">Boîte manuelle</li>\n<li class="carburant">Essence</li>\n<li class="date">11-08-2016</li></ul>');
ok(ofd.gearbox === 'Manuelle' && ofd.km === 123844 && ofd.year === 2016 && ofd.fuel === 'Essence', 'openflex : fiche (boîte, km, année, énergie)', ofd);
// VGRF / Yooflex / DMD : libellés de boîte français ; version lue en mots entiers.
ok(['Rob double embray', 'Automate à fonct. Continu', 'A Var Continu', 'Boîte hybride multimode', 'Auto Séquent.', 'Rob Simple Embray'].every((s) => ds.gearboxFr(s) === 'Automatique') && ds.gearboxFr('Manuelle') === 'Manuelle' && ds.gearboxFr('Boîte manuelle') === 'Manuelle',
  'boîte FR : robotisée, variateur, multimode = Automatique');
ok(ds.gearboxOfVersion('Up 1.0 75 BlueMotion Technology BVM5 Up! Beats Audio') === 'Manuelle' && ds.gearboxOfVersion('Kona 1.0 T-gdi 120ch Fap Creative') === null && ds.gearboxOfVersion('Clio TCe 130 EDC FAP Intens') === 'Automatique',
  'version en mots entiers : « Beats », « Creative » ne sont pas EAT ; EDC = automatique');
// Versions réelles de Bony (page du 18/11) que le JSON-LD annonçait « Manuelle » ; et ce qui doit rester sans signal.
const autoVersions = ['Dacia Sandero stepway expression Eco-G 120 auto - 25', 'Renault Symbioz evolution full hybrid E-Tech 160 ch - 26b',
  'Renault Clio techno full hybrid E-Tech 160 ch - 26', 'Renault 4 E-Tech Electric techno 150 ch autonomie confort - 26', 'Nissan X-Trail NEW T33C N-CONNECTA E-POWER 204CH'];
const quietVersions = ['FIAT 500 1.0 70 ch Hybride BSG S/S 3p', 'Peugeot 208 1.2 PureTech 100 Active Clim Auto GPS', 'Dacia Duster TCe 130 4x4 Extreme', 'Renault Kangoo VAN L2 BLUE DCI 115 GRAND CONFORT - 22'];
ok(autoVersions.every((v) => ds.gearboxOfVersion(v) === 'Automatique') && quietVersions.every((v) => ds.gearboxOfVersion(v) === null),
  'version : « full hybrid », « E-Tech », « e-Power », « 120 auto » = automatique ; « Clim Auto », hybride légère BSG, TCe, dCi = pas de signal',
  [...autoVersions, ...quietVersions].map((v) => `${v} → ${ds.gearboxOfVersion(v)}`));
ok(ds.readDmdDetail('<span>Boîte de vitesse</span>\n <span>A Var Continu</span>').gearbox === 'Automatique', 'DMD : « A Var Continu » = Automatique');

ok(ds.evGearbox('Manuelle', 'Électrique') === 'Automatique' && ds.evGearbox('Manuelle', 'Hybride') === 'Manuelle' && ds.evGearbox('Manuelle', 'Essence') === 'Manuelle'
  && ds.evGearbox(null, 'Électrique') === 'Automatique' && ds.evGearbox(null, 'Essence') === null,
  'une électrique, annoncée « Manuelle » ou sans boîte, est comparée comme une automatique (hybride et essence inchangées)');
// 19/11 : versions réelles de SIPA, Sofibrie, Bony restées sans boîte.
const autoMore = ['Alfa Romeo Tonale 1.5 Hybrid 160 ch VGT TCT7 Sprint 5p', 'Audi Q3 Sportback 45 TFSIe 245 ch S tronic 6 S line 5p', 'Volvo XC60 T6 AWD Hybride rechargeable 253 ch+145 ch Geartronic 8 Start 5p',
  'Jeep Renegade 1.3 Turbo T4 150 ch BVR6 80th Anniversary 5p', 'Alfa Romeo Stelvio 2.2 190 ch Q4 AT8 Sprint 5p', 'Citroën C5 Aircross Hybride 145 ch e-DCS6 Plus 5p', 'Honda ZR-V e:HEV 2.0 i-MMD Sport 5p',
  'MG ZS HYBRID+ 197 LUXURY', 'MG EHS 1.5T GDI PHEV Luxury'];
const quietMore = ['Dacia Bigster Hybrid-G 150 4x4 Journey', 'Renault Clio Blue dCi 100 ch GSR2 Evolution', 'Fiat Panda 1.0 70 ch Hybride BSG S/S'];
ok(autoMore.every((v) => ds.gearboxOfVersion(v) === 'Automatique') && quietMore.every((v) => ds.gearboxOfVersion(v) === null),
  'version : « TCT7 », « S tronic », « Geartronic », « BVR6 », « AT8 », « e-DCS6 », « i-MMD », « Hybrid+ », PHEV = automatique ; hybrides légères et dCi sans signal',
  [...autoMore, ...quietMore].map((v) => `${v} → ${ds.gearboxOfVersion(v)}`));

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);
