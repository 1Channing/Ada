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
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  fetched.push(u);
  if ((cut[u] ?? 0) > 0) { cut[u]--; throw new TypeError('fetch failed'); }
  if ((flaky[u] ?? 0) > 0) { flaky[u]--; return new Response('Bad Gateway', { status: 502 }); }
  // Une API en POST (23/11, bourse BMW d'Autriche) : la réponse dépend du corps — clé « <adresse> <corps> ».
  const body = (typeof init?.body === 'string' ? pages[`${u} ${init.body}`] : undefined) ?? pages[u];
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

console.log('\n=== ITALIE (22/11) : SPAZIO GROUP (rswusato par type, tris réunis) ET CENTROAUTO VT (cardveicolo) ===\n');
{
  const dsi = await import('../worker/dealerStock');
  // Carte réelle de Spazio (auto.spaziogroup.com/tipologia/usato/, 22/11), allégée : les détails n'ont pas de nom de
  // champ, seulement une icône ; prix barré « oldprice » avant le prix.
  const spCard = (href: string, km: string, year: number, fuel: string, gear: string, price: string) => `<div class="card vehicle clickable usato">
    <div class="vehicle-labels"><span class="label label-tipologia label-usato"><span>Usato</span></span><br></div>
    <div class="card-image text-center"><a href="${href}" title="Jeep Compass"><img src="https://cdn.test/x.jpg" alt=""/></a></div>
    <div class="card-body"><div class="vehicle-title-box"><div class="vehicle-title">
      <span class="vehicle-brand">Jeep </span> <span class="vehicle-model">Compass</span></div>
      <div class="vehicle-subtitle"><span class="vehicle-version">II 2017 2.0 mjt Limited 4wd 140cv auto</span></div></div>
      <div class="vehicle-details">
            <span class="vehicle-detail"><span class="icon"><i class="fa-solid fa-road"></i></span>${km}</span>
            <span class="vehicle-detail"><span class="icon"><i class="fa-solid fa-calendar-days"></i></span>${year}</span>
            <span class="vehicle-detail"><span class="icon"><i class="fa-solid fa-gas-pump"></i></span>${fuel}</span>
            <span class="vehicle-detail"><span class="icon"><i class="fa-solid fa-gears"></i></span>${gear}</span>
            <span class="vehicle-detail"><span class="icon"><i class="fa-solid fa-engine"></i></span>1.956 cc</span>
      </div>
      <div class="vehicle-price"><span class="oldprice">17.900<span class="currency">&euro;</span></span>            <span class="price">${price}<span class="currency">&euro;</span></span></div>
    </div></div>`;
  // Neuf voitures A…I ; deux adresses que WordPress a rendues uniques par « -2 » (deux modèles différents).
  const href: Record<string, string> = Object.fromEntries('ABCDEFGHI'.split('').map((k, i) => [k, `https://sp.test/auto/jeep-compass-${k.toLowerCase()}-usato-a-torino-u90${i}000/`]));
  href.H = 'https://sp.test/auto/toyota-aygo-x-trend-benzina-usato-a-torino-2/';
  href.I = 'https://sp.test/auto/fiat-panda-cross-benzina-usato-a-torino-2/';
  const card = (k: string) => spCard(href[k], `${61 + k.charCodeAt(0)}.061 km`, 2019, 'diesel', 'automatico', '16.900');
  const head = `<link rel="https://api.w.org/" href="https://sp.test/wp-json/" /><select name="orderby" id="orderby"><option value="">Ordina per</option>`
    + `<option value="title">Marca / Modello</option><option value="date">Nuovi Arrivi</option><option value="km">Chilometri</option>`
    + `<option value="price-up">Prezzo crescente</option></select><p><b>9</b>  Auto Usato subito disponibili!</p>`;
  const nav = '<a href="https://sp.test/tipologia/usato/page/2/">2</a><a href="https://sp.test/tipologia/usato/page/3/">3</a>';
  const lst = (ks: string) => head + ks.split('').map(card).join('') + nav;
  // Ordre par défaut instable : la page 2 ne reprend que des voitures déjà vues, la page 3 en montre deux nouvelles.
  pages['https://sp.test/tipologia/usato/'] = lst('ABC');
  pages['https://sp.test/tipologia/usato/page/2/'] = lst('BCA');
  pages['https://sp.test/tipologia/usato/page/3/'] = lst('DEA');
  // Par kilométrage : tout, sans doublon.
  pages['https://sp.test/tipologia/usato/?orderby=km'] = lst('ABC');
  pages['https://sp.test/tipologia/usato/page/2/?orderby=km'] = lst('DEF');
  pages['https://sp.test/tipologia/usato/page/3/?orderby=km'] = lst('GHI');
  pages['https://sp.test/wp-json/wp/v2/veicoli_tipologia?slug=usato&_fields=id'] = '[{"id":7}]';
  pages['https://sp.test/wp-json/wp/v2/veicoli?per_page=100&page=1&orderby=id&order=asc&_fields=link,title&veicoli_tipologia=7'] = JSON.stringify('ABCDEFGHI'.split('').map((k) => ({ link: href[k], title: { rendered: 'Jeep Compass usato' } })));
  // Type inconnu de l'API : pas de vérification (pas de liste de l'API entière, où les km 0 seraient « absentes »).
  pages['https://sp.test/tipologia/demo/'] = head.replace('<b>9</b>', '<b>1</b>') + card('A');
  pages['https://sp.test/wp-json/wp/v2/veicoli_tipologia?slug=demo&_fields=id'] = '[]';
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) => realTimeout(fn, 0)) as typeof setTimeout;
  try {
    ok(dsi.detectDealerProvider(pages['https://sp.test/tipologia/usato/']) === 'rswusato', 'Spazio : cartes « vehicle-detail » à icône reconnues (rswusato)');
    const before = fetched.length;
    const sp = await dsi.fetchDealerStock('https://sp.test/tipologia/usato/');
    const asked = fetched.slice(before);
    const a = sp.vehicles.find((v) => v.url === href.A);
    ok(sp.vehicles.length === 9 && sp.declared === 9 && new Set(sp.vehicles.map((v) => v.external_id)).size === 9,
      'Spazio : page de doublons sans fin de lecture, tri « km » relu et réuni : 9 voitures sur 9, les deux « …-2/ » distinctes', [sp.vehicles.length, sp.declared, sp.vehicles.map((v) => v.external_id)]);
    ok(a?.km === 126061 && a?.year === 2019 && a?.fuel === 'diesel' && a?.gearbox === 'Automatique' && a?.price === 16900 && a?.brand === 'Jeep' && a?.power_ch === 140,
      'Spazio : km, année, énergie, boîte lus à leur icône ; prix (pas le prix barré) ; puissance de la version', a);
    ok(asked.includes('https://sp.test/wp-json/wp/v2/veicoli?per_page=100&page=1&orderby=id&order=asc&_fields=link,title&veicoli_tipologia=7')
      && sp.warnings.some((w) => /tri « km » : 4 voiture\(s\) de plus/.test(w)) && !asked.some((u) => /orderby=price-up/.test(u)) && !asked.some((u) => /\/auto\//.test(u)),
      'Spazio : API restreinte au type de l\'adresse ; un seul tri de plus suffit, aucune fiche lue une à une', [sp.warnings, asked]);
    const demo = await dsi.fetchDealerStock('https://sp.test/tipologia/demo/');
    ok(demo.vehicles.length === 1 && demo.warnings.some((w) => /type « demo » introuvable/.test(w)) && !fetched.some((u) => /veicoli\?per_page=100&page=1&orderby=id&order=asc&_fields=link,title$/.test(u)),
      'Spazio : type introuvable dans l\'API → pas de vérification par l\'API (avertissement), plutôt qu\'une fausse', demo.warnings);
  } finally { globalThis.setTimeout = realTimeout; }

  // Cartes réelles de Centroauto VT (centroautovt.it/ricerca-auto, 22/11), allégées ; l'empreinte du module CSS change
  // d'une mise en ligne à l'autre (« ZRArIW » page 1, « Q9x-_b » page 2).
  const ca = (h: string, href2: string, title: string, dati: string, price: string, badge = '') => `<article class="CardVeicolo-module__${h}__card"><a class="CardVeicolo-module__${h}__collegamento" href="${href2}">`
    + `<div class="CardVeicolo-module__${h}__cornice"><img src="/_next/image?url=https%3A%2F%2Fweb.imgstore.it%2F578d_orig.jpg&amp;w=828&amp;q=75" alt="${title}" class="CardVeicolo-module__${h}__foto"/>`
    + `<div class="CardVeicolo-module__${h}__badges">${badge}</div></div><div class="CardVeicolo-module__${h}__corpo"><h3 class="CardVeicolo-module__${h}__titolo">${title}</h3>`
    + `<p class="CardVeicolo-module__${h}__dati">${dati}</p><p class="CardVeicolo-module__${h}__sede">Sede di <!-- -->Viterbo</p><div class="PrezzoVeicolo-module__9m3wAW__prezzo PrezzoVeicolo-module__9m3wAW__card">`
    + `<span class="PrezzoVeicolo-module__9m3wAW__riga"><strong class="PrezzoVeicolo-module__9m3wAW__cifra">${price}</strong></span></div></div></a></article>`;
  const count = (n: number) => `<div class="Listino-module__byCslq__conteggioRiga"><p class="Listino-module__byCslq__conteggio">${n} auto trovate</p></div><a href="/ricerca-auto?pagina=2">2</a>`;
  pages['https://ca.test/ricerca-auto'] = count(5)
    + ca('ZRArIW', '/ricerca-auto/usate/bmw/serie-1-f40/bmw-116d-advantage-u25415', 'BMW 116d Advantage', '2021 · 108.688 km · Gasolio · Manuale', '14.900 €')
    + ca('ZRArIW', '/ricerca-auto/usate/smart/forfour/smart-forfour-1-0-passion-71cv-twinamic-u25376', 'Smart Forfour 1.0 Passion 71cv twinamic', '2017 · 61.195 km · Benzina · Automatico', '9600 €')
    + ca('ZRArIW', '/ricerca-auto/nuove/fiat/600e/fiat-600e-600e-turismo-n34606', 'Fiat 600e 600e Turismo', '0 km · Elettrica', '29.900 €');
  pages['https://ca.test/ricerca-auto?pagina=2'] = count(5)
    + ca('Q9x-_b', '/ricerca-auto/usate/fiat/500/fiat-500-1-0-hybrid-70cv-u25478', 'Fiat 500 1.0 hybrid 70cv', '2024 · 27.998 km · Ibrida · Manuale', '13.900 €')
    + ca('Q9x-_b', '/ricerca-auto/km0/jeep/avenger/jeep-avenger-1-2-turbo-altitude-n35001', 'Jeep Avenger 1.2 turbo Altitude', '2025 · 10 km · Benzina · Manuale', '21.500 €',
      '<span class="Badge-module__H8aylq__badge">Venduto</span>');
  ok(dsi.detectDealerProvider(pages['https://ca.test/ricerca-auto']) === 'cardveicolo' && dsi.detectDealerProvider(pages['https://ca.test/ricerca-auto?pagina=2']) === 'cardveicolo',
    'Centroauto : cartes « CardVeicolo-module__…__card » reconnues, quelle que soit l\'empreinte du module');
  const cv = await dsi.fetchDealerStock('https://ca.test/ricerca-auto');
  const bmw = cv.vehicles.find((v) => v.external_id === 'u25415'), neuve = cv.vehicles.find((v) => v.external_id === 'n34606');
  ok(cv.vehicles.length === 5 && cv.declared === 5 && cv.pages === 2, 'Centroauto : « 5 auto trovate », deux pages « ?pagina=N », 5 voitures sur 5', [cv.vehicles.length, cv.declared, cv.pages]);
  ok(bmw?.price === 14900 && bmw?.km === 108688 && bmw?.year === 2021 && bmw?.fuel === 'Gasolio' && bmw?.gearbox === 'Manuelle' && bmw?.location === 'Viterbo'
    && bmw?.url === 'https://ca.test/ricerca-auto/usate/bmw/serie-1-f40/bmw-116d-advantage-u25415' && bmw?.image === 'https://web.imgstore.it/578d_orig.jpg',
    'Centroauto : prix, km, année, énergie, boîte, lieu, adresse et photo d\'une carte', bmw);
  ok(cv.vehicles.find((v) => v.external_id === 'u25376')?.price === 9600 && neuve?.year === null && neuve?.km === 0 && neuve?.fuel === 'Elettrica' && neuve?.body === 'neuve en stock'
    && cv.vehicles.find((v) => v.external_id === 'n35001')?.status === 'sold' && cv.vehicles.find((v) => v.external_id === 'n35001')?.body === 'km 0',
    'Centroauto : « 9600 € » ; une neuve (pas d\'année, ni de boîte) lue à la forme de chaque donnée ; km 0 et « Venduto » reconnus',
    cv.vehicles.map((v) => [v.external_id, v.price, v.km, v.year, v.fuel, v.gearbox, v.body, v.status]));
}

console.log('\n=== ITALIE (23/11) : DI.BA. (youcan), AUTOINGROS (ibilista), INTERGEA NORD-EST (état Nuxt 2), MOTORK EN ITALIEN ===\n');
{
  const dsj = await import('../worker/dealerStock');
  // Di.Ba. : carte réelle (gruppodiba.it/auto-usate, 22/11), allégée ; une bannière publicitaire entre les cartes.
  const yc = (id: number, h3: string, km: string, fuel: string, gear: string, date: string, price: string) => `<div class="annuncio col-12 float-left reset-padding" onclick="location.href='https://yc.test/bmw-xm-usate/suv-${id}euro/${id}?customlabel=high'">
    <div class="titolo-auto col-12 float-left"><i class="far fa-heart" data-attr="${id}"></i><h3>${h3}</h3><span class="versione">XM 4.4 phev auto</span></div>
    <div class="foto-auto col-7 col-md-4 col-xl-5 float-left"><span class="cerchio-gruppo usate">Usata</span><img src="https://yc.test/foto/medium/${id}/1.jpg" alt=""/></div>
    <div class="info-auto col-5 col-md-3 col-xl-4 float-left">
      <span><i class="fas fa-road"></i> ${km} chilometri</span>
      <span><i class="fas fa-gas-pump"></i> ${fuel}</span>
      <span><i class="fas fa-cogs"></i> ${gear}</span>
      <span><i class="far fa-calendar-check"></i> ${date}</span>
      <span><i class="fas fa-car-side"></i> Suv</span>
    </div>
    <div class="prezzo-auto col-12 col-md-5 col-xl-3 float-left"><span class="prezzofinale d-flex justify-content-between"><font class="title">Prezzo:</font><font class="value"> ${price} &euro; </font></span></div></div>`;
  const banner = `<div class="annuncio col-12 float-left reset-padding annuncio-banner" onclick="location.href='https://yc.test/noleggio-breve-termine'"><img src="https://yc.test/banner.jpg" alt=""/></div>`;
  const ycHead = (n: number, p: number, of: number) => `<span class="descrizione">${n} auto trovate - Pagina ${p} di ${of}</span><a href="https://yc.test/auto-usate?pag=2 ">2</a>`;
  pages['https://yc.test/auto-usate'] = ycHead(3, 1, 2) + yc(94772, 'BMW XM', '20.255', 'Ibrida/Benzina', 'Cambio sequenziale', '03/2025', '105.990') + banner + yc(95650, 'BMW Serie 7 Berlina', '16.441', 'Ibrida/Diesel', 'Cambio manuale', '07/2024', '83.700');
  pages['https://yc.test/auto-usate?pag=2'] = ycHead(3, 2, 2) + yc(90001, 'Fiat Panda', '1.200', 'Benzina', 'Cambio automatico', '01/2026', '14.900');
  ok(dsj.detectDealerProvider(pages['https://yc.test/auto-usate']) === 'youcan', 'Di.Ba. : cartes « annuncio / info-auto / prezzofinale » reconnues (youcan)');
  const ycs = await dsj.fetchDealerStock('https://yc.test/auto-usate');
  const xm = ycs.vehicles.find((v) => v.external_id === '94772');
  ok(ycs.vehicles.length === 3 && ycs.declared === 3 && !ycs.vehicles.some((v) => /noleggio/.test(v.url ?? '')),
    'Di.Ba. : « 3 auto trovate », deux pages « ?pag=N », la bannière publicitaire n\'est pas une voiture', ycs.vehicles.map((v) => v.external_id));
  ok(xm?.km === 20255 && xm?.year === 2025 && xm?.fuel === 'Ibrida/Benzina' && xm?.gearbox === 'Automatique' && xm?.price === 105990 && xm?.brand === 'BMW' && xm?.body === 'Suv'
    && ycs.vehicles.find((v) => v.external_id === '95650')?.gearbox === 'Manuelle',
    'Di.Ba. : « 20.255 chilometri », « 03/2025 », « Cambio sequenziale » = automatique, prix', xm);

  // Autoingros : carte réelle (autoingros.it, 22/11), allégée ; champs nommés ; pages par les liens du site.
  const ib = (id: string, city: string, kind: string, km: string, year: string, fuel: string, gear: string, price: string) => `<li class="glide__slide">
	<a class="thmb_veicolo  brdr_rad_std bkg_clr_bw_fff pos_rel items_out" href="/auto/${kind}/${city}/alfa-romeo-tonale-tonale-1-6-sprint-130cv-tct6-diesel/${id}/">
		<div class="first_part pos_rel"><p class="marca_modello tac"><strong class="font_clr_col_01 uppercase marca">ALFA ROMEO</strong>
				<span class="modello">Tonale</span><br /><span class="allestimento text_clamp line_2 font_clr_gry_04">Tonale 1.6 Sprint 130cv tct6</span></p></div>
		<div class="media pos_rel"><img class="picture absolut_cntr fit_contain w_100" src="https://img.test/${id}.jpg" alt="" /></div>
		<div class="main_data d_flx j_start ai_center ac_center">
				<div class="item"><i class="fa-solid fa-road"></i><p><strong>Chilometri</strong><span>${km}</span></p></div>
				<div class="item"><i class="fa-solid fa-calendar-day"></i><p><strong>Immatricolazione</strong><span>${year}</span></p></div>
				<div class="item"><i class="fa-solid fa-gas-pump"></i><p><strong>Alimentazione</strong><span>${fuel}</span></p></div>
				<div class="item"><i class="fa-solid fa-gear"></i><p><strong>Cambio</strong><span>${gear}</span></p></div>
		</div>
		<div class="prezzo promozione d_flx ac_center ai_center brdr_rad_std"><p class="tac prezzo_esposto"><strong> ${price} € </strong></p></div></a></li>`;
  const ibNav = '<input type="hidden" id="MaxPage" value="2" /><a class="flx_itm  ricerca_page_button" href="/auto-usate-torino?FiltroTipologia=usato&amp;Ordinamento=0&amp;page=2" title="vai alla pagina 2">2</a>';
  pages['https://ib.test/auto-usate-torino/'] = ib('u2741861', 'rosta', 'usato', '41.000 km', '2023', 'Diesel', 'Semiautomatico', '21.900') + ib('u2739675', 'asti', 'usato', '41.000 km', '2023', 'Elettrica/Benzina', 'Manuale', '22.900') + ibNav;
  pages['https://ib.test/auto-usate-torino?FiltroTipologia=usato&Ordinamento=0&page=2'] = ib('u2742992', 'torino', 'aziendale', '10 km', '2025', 'Benzina', 'Manuale', '19.500')
    + ib('n2668936', 'rosta', 'nuovo', '0 km', '', 'Elettrica', 'Assente', '46.200') + ibNav;
  ok(dsj.detectDealerProvider(pages['https://ib.test/auto-usate-torino/']) === 'ibilista', 'Autoingros : cartes « thmb_veicolo / main_data / prezzo_esposto » reconnues (ibilista)');
  const ibs = await dsj.fetchDealerStock('https://ib.test/auto-usate-torino/');
  const t1 = ibs.vehicles.find((v) => v.external_id === 'u2741861');
  ok(ibs.vehicles.length === 4 && ibs.pages === 2 && !ibs.warnings.some((w) => /page\(s\) lue\(s\)/.test(w)),
    'Autoingros : la page 2 suit le lien du site (filtre du type gardé), jusqu\'à « MaxPage »', [ibs.vehicles.length, ibs.pages, ibs.warnings]);
  ok(t1?.brand === 'Alfa Romeo' && t1?.model === 'Tonale' && t1?.km === 41000 && t1?.year === 2023 && t1?.fuel === 'Diesel' && t1?.gearbox === 'Automatique' && t1?.price === 21900 && t1?.location === 'Rosta'
    && ibs.vehicles.find((v) => v.external_id === 'u2742992')?.body === 'démonstration',
    'Autoingros : champs nommés, « Semiautomatico » = automatique, ville de l\'adresse, voiture « aziendale » = démonstration', t1);
  const nv1 = ibs.vehicles.find((v) => v.external_id === 'n2668936');
  ok(nv1?.body === 'neuve en stock' && nv1?.gearbox === null && nv1?.year === null && nv1?.km === 0,
    'Autoingros : neuve « n2668936 » (lettre gardée dans le numéro), boîte « Assente » = inconnue, pas d\'année', nv1);

  // Intergea Nord-Est : état Nuxt 2 (forme réelle du 22/11) — valeurs répétées passées en arguments, lues SANS exécuter.
  const nuxt = (vehs: string[], n: number) => `<p class="text-sm mt-2 mb-0 md:pb-0 md:block"> ${n} risultati di ricerca </p><script>window.__NUXT__=(function(a,b,c,d,f,q,I,ek){`
    + `dt.price={min:b,max:176010};${vehs.map((v, k) => `ed[${k}]=${v};`).join('')}return {layout:"default",data:[{}]}}(false,0,"",1,"used","Manuale","Benzina","208"));</script>`;
  const nv = (serial: string, extra: string) => `{id:"x${serial}",erpId:"U${serial}",price:7900,displayPrice:7400,marketPrice:8100,promo:{name:"Super \\u002F offerta",legal:"Rate {12} da 77€, \\"TAN\\" 9%"},serialNumber:"${serial}",brand:"Peugeot",model:ek,`
    + `${extra},slug:"peugeot-208-12-puretech-autoteam9-${serial}",type:f,realType:f,createdAt:"2026-11-04T06:12:18+00:00",tech:{hp:"82",kw:60,fuelType:I,gearType:q},venue:{venueTown:"Verona"},imageUrl:"https:\\u002F\\u002Fimg.test\\u002F${serial}.jpg"}`;
  pages['https://nx.test/auto?conditions=used'] = nuxt([nv('12216320', 'mileageKm:95757,plate:"FC037RE",registrationDate:"2016-02-24",version:"208 1.2 PureTech 82cv Access",vin:"VF3CCHMZ6FT177661"'),
    nv('12466718', 'mileageKm:115000,plate:"FA750SP",registrationDate:"2015-10-19",version:"208 5p 1.6 bluehdi Active 75cv",vin:"VF3CCBHW6FT137200"')], 3);
  pages['https://nx.test/auto?conditions=used&page=2'] = nuxt([nv('11760906', 'mileageKm:100241,plate:"FS924SJ",registrationDate:"2018-08-29",version:"Up! 1.0 eco up! Move up! 68cv",vin:"WVWZZZAAZJD190389"')], 3);
  ok(dsj.detectDealerProvider(pages['https://nx.test/auto?conditions=used']) === 'nuxtvehicles', 'Intergea Nord-Est : état Nuxt 2 avec les voitures reconnu (nuxtvehicles)');
  const nxs = await dsj.fetchDealerStock('https://nx.test/auto?conditions=used');
  const p208 = nxs.vehicles.find((v) => v.external_id === '12216320');
  ok(nxs.vehicles.length === 3 && nxs.declared === 3, 'Intergea Nord-Est : « 3 risultati di ricerca », pages « &page=N » : 3 voitures sur 3', nxs.vehicles.map((v) => v.external_id));
  ok(p208?.price === 7400 && p208?.km === 95757 && p208?.year === 2016 && p208?.fuel === 'Benzina' && p208?.gearbox === 'Manuelle' && p208?.model === '208' && p208?.vin === 'VF3CCHMZ6FT177661'
    && p208?.plate === 'FC037RE' && p208?.power_ch === 82 && p208?.location === 'Verona' && p208?.listed_at === '2026-11-04T06:12:18+00:00' && p208?.image === 'https://img.test/12216320.jpg'
    && p208?.url === 'https://nx.test/auto/peugeot-208-12-puretech-autoteam9-12216320',
    'Intergea Nord-Est : prix affiché, km, immatriculation, énergie et boîte (paramètres de la fonction), VIN, plaque, chevaux, ville, date de mise en ligne', p208);
  const st = dsj.nuxt2State(pages['https://nx.test/auto?conditions=used']);
  ok(st?.vars.get('f') === 'used' && st?.vars.get('b') === 0 && st?.vars.get('a') === false && dsj.nuxt2Objects(st!.body, 'serialNumber').length === 2,
    'état Nuxt 2 : arguments de la fonction relus comme littéraux (rien n\'est exécuté), un objet par voiture malgré les accolades des textes', [...(st?.vars ?? [])]);

  // MotorK en italien : le total du compteur (« <strong>174</strong> risultati trovati ») est lu.
  ok(dsj.websparkDeclared('<span class="stock-listing__results-counter" x-ref="resultsFoundText">\n        <strong>174</strong> risultati trovati\n    </span>') === 174
    && dsj.websparkDeclared('<span class="stock-listing__results-counter" x-ref="resultsFoundText"><strong>3 193</strong> résultats trouvés</span>') === 3193,
    'MotorK : total du compteur lu en italien comme en français');
}

console.log('\n=== BOURSE BMW D\'AUTRICHE (bmw-boerse.at, API v2, 23/11) : ÉNERGIE ET BOÎTE PAR LES FILTRES DU SITE ===\n');
{
  const dsa2 = await import('../worker/dealerStock');
  // Page réelle de la bourse (perm_dealer_id=133, 23/11), réduite à ses marques ; voitures réelles de la réponse de l'API.
  pages['https://bb.test/suche/?perm_dealer_id=133'] = '<div id="tx_ems_vehiclesearch" data-endpoint="/api/v2/" data-match="{&quot;dealer&quot;: 133}"><input name="model[$or]" type="checkbox"></div>';
  const api = 'https://bb.test/api/v2/ems/search';
  const q = (match: Record<string, unknown>) => `${api} ${JSON.stringify({ $match: match, $skip: 0, $limit: 100 })}`;
  const car = (id: number, title: string, extra: Record<string, unknown> = {}) => ({ id, title, newVehicle: false, power: 190, registration: '2023-09-26T00:00:00', mileage: 14500, price: 39900, warranty: 24, dealer: { id: 133, name: 'BMW Wien', city: 'Wien' }, ...extra });
  const cars = [car(1, 'BMW 320d Touring'), car(2, 'BMW X5 xDrive50e'), car(3, 'BMW i4 M50 xDrive', { power: 544 }), car(4, 'MINI Cooper 5-Türer', { newVehicle: true, registration: null, mileage: 10 })];
  const list = (ids: number[]) => JSON.stringify({ $count: { $total: ids.length }, $list: cars.filter((c) => ids.includes(c.id)) });
  pages[q({ dealer: 133 })] = list([1, 2, 3, 4]);
  pages[q({ dealer: 133, engine: 'D' })] = list([1]);
  pages[q({ dealer: 133, engine: 'B' })] = list([4]);
  pages[q({ dealer: 133, engine: 'E' })] = list([3]);
  pages[q({ dealer: 133, engine: 'H' })] = list([2]);
  pages[q({ dealer: 133, transmission: 'A' })] = list([1, 2, 3]);
  pages[q({ dealer: 133, transmission: 'S' })] = list([4]);
  ok(dsa2.detectDealerProvider(pages['https://bb.test/suche/?perm_dealer_id=133']) === 'bmwused', 'bourse BMW d\'Autriche (« data-endpoint="/api/v2/" ») reconnue comme les sites hongrois et slovaques');
  const bb = await dsa2.fetchDealerStock('https://bb.test/suche/?perm_dealer_id=133');
  const by = (id: string) => bb.vehicles.find((v) => v.external_id === id);
  ok(bb.vehicles.length === 4 && bb.declared === 4 && !bb.warnings.length, 'bourse BMW : 4 voitures sur 4, toutes classées', [bb.vehicles.length, bb.warnings]);
  ok(by('1')?.fuel === 'Diesel' && by('1')?.gearbox === 'Automatique' && by('1')?.model === 'Série 3' && by('1')?.price === 39900 && by('1')?.year === 2023 && by('1')?.km === 14500 && by('1')?.url === 'https://bb.test/suche/details/1'
    && by('2')?.fuel === 'Plug-in Hybrid' && by('3')?.fuel === 'Elektro' && by('3')?.power_ch === 544 && by('4')?.gearbox === 'Manuelle' && by('4')?.year === null && /neuve/.test(by('4')?.body ?? ''),
    'bourse BMW : énergie et boîte prises dans les filtres « engine » / « transmission », « 320d » = Série 3, « xDrive50e » = hybride rechargeable, neuve sans immatriculation',
    bb.vehicles.map((v) => [v.external_id, v.fuel, v.gearbox, v.model, v.year]));
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
  ['Diesel/Elettrica', 'hybrid'], ['Benzina/Elettrica', 'hybrid'], ['Elettrica/Benzina', 'hybrid'], ['elettrico', 'electric'], ['ibrido', 'hybrid'],
  // 25/11 (Danemark, Sand-Jensen) : « el » = électrique ; « Benzin / El » est un hybride, « El » seul reste électrique.
  ['Benzin / El', 'hybrid'], ['Diesel / El', 'hybrid'], ['Benzin/El', 'hybrid'], ['El / Benzin', 'hybrid'], ['El', 'electric'], ['Plug-in hybrid (Benzin / El)', 'phev'],
  ['Waterstof', null], ['autre', null],
];
const fuelBad = fuels.filter(([v, want]) => fuelFamily(v) !== want);
ok(fuelBad.length === 0, `énergie : ${fuels.length} mots de sites (es, it, de, nl, fr, hu, cs, da) classés`, fuelBad.map(([v]) => `${v} → ${fuelFamily(v)}`));
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

console.log('\n=== CLIENTS (23/11) : DANEMARK (autoit), VAN EKRIS (occasionload), CONSILCAR (easysite) ===\n');
{
  const dsk = await import('../worker/dealerStock');
  const fam = await import('../src/lib/vehicleFamilies');
  // AutoIT (sej-biler.dk, autohus.dk, 23/11) : cartes réelles allégées ; « antal » porté au total rend tout le stock.
  const ait = (id: string, h2: string, version: string, km: string, year: string, fuel: string, dl: string, labels = '') => `<div class="card ait-border-radius-md vehicle-card" data-load-swiper>
    <a href="/brugte-biler/x-${id.toLowerCase()}/${id}/"><div class="card-image"><div class="slider-background"><img loading="lazy" src="https://img.test/${id}.jpg" alt=""></div>
                <div class="label-container">${labels}
    </div>
        </div>
        <div class="card-content"><h2 class="truncate">${h2}</h2><p class="truncate">${version}</p>
            <ul class="text-upper strong"><li class="icon icon-mileage" aria-label="Kilometerstand">${km}</li><li class="icon icon-model-year" aria-label="Model&#xE5;r">${year}</li>
                <li class="icon ${fuel === 'El' ? 'icon-ev' : 'icon-fuel'}" aria-label="Drivmiddel">${fuel}</li></ul></div>
        <div class="card-footer"><dl class="text-upper">${dl}</dl></div>
    </a>
</div>`;
  const kontant = (p: string, lbl = 'Kontant') => `<dt class="cash">${lbl}</dt><dd class="cash"><strong><span>${p}</span> kr.</strong></dd>`;
  const aitPage = (n: number, cards: string) => `<form class="pure-form" data-form="ait-search" data-action="/umbraco/api/vehiclesApi/vehicles" method="post"></form>
    <h2 data-search-header data-search-loading data-results-plural="Resultater">${n} Resultater</h2><div id="search-results" class="ait-grid cards vehicles">${cards}</div>
    <button class="ait-btn ait-btn-secondary  load-more" data-paging-page-number-alias="side" data-paging-page-size-alias="antal" data-paging-page-number="1" data-paging-page-size="2" data-paging-total-pages="2" data-search-load-more>Hent flere</button>`;
  const a1 = ait('AD5637705', 'Audi A4', 'Avant 2,0 TFSI  Mild hybrid Sport Prestige Tour S Tronic 190HK Stc 7g Aut.', '126.000 km', '2019', 'Benzin', kontant('189.900') + '<dt class="financing">Finansiering</dt><dd class="financing"><strong><span class="value">3.988</span> kr.</strong></dd>');
  const a2 = ait('AD5728000', 'Cupra Born', 'EL Pasi&#xF3;n 231HK 5d Aut.', '41.000 km', '2022', 'El', kontant('189.900'), '<p class="label label-sold text-upper">Solgt</p>');
  const a3 = ait('AD5595566', 'Mazda CX-30', '2,0 e-Skyactiv-G Exclusive-Line 150HK 5d 6g', '0 km', '-', 'Benzin', '<dt class="cash"><strong>Ring for pris</strong></dt><dd></dd>', '<p class="label text-upper">Demo</p>');
  const a4 = ait('AD5700001', 'Ford Transit Custom', '2,0 EcoBlue Trend 136HK Van 6g', '12.000 km', '2024', 'Diesel', kontant('209.900', 'Kontant (ekskl. moms)') + '<dt class="leasing">Leasing (ekskl. moms)</dt><dd class="leasing"><strong><span class="value">2.399</span> kr.</strong></dd>');
  const a5 = ait('AD5700002', 'Kia EV9', 'EL GT-Line 385HK 5d Aut.', '9.000 km', '2024', 'El', kontant('4.680') + '<dt class="leasing">Leasing</dt><dd class="leasing"><strong><span class="value">2.395</span> kr.</strong></dd>', '<p class="label text-upper">Engros</p>');
  pages['https://ait.test.dk/brugte-biler/'] = aitPage(5, a1 + a2);
  pages['https://ait.test.dk/brugte-biler/?antal=29'] = aitPage(5, a1 + a2 + a3 + a4 + a5);
  ok(dsk.detectDealerProvider(pages['https://ait.test.dk/brugte-biler/']) === 'autoit', 'Danemark : formulaire « ait-search » et cartes « vehicle-card » reconnus (autoit)');
  const aits = await dsk.fetchDealerStock('https://ait.test.dk/brugte-biler/');
  const audi = aits.vehicles.find((v) => v.external_id === 'AD5637705');
  ok(aits.vehicles.length === 5 && aits.declared === 5 && aits.pages === 2, 'Danemark : « 5 Resultater », tout le stock en une requête (« antal » = total + 24)', [aits.vehicles.length, aits.declared, aits.pages, aits.warnings]);
  ok(audi?.brand === 'Audi' && audi?.model === 'A4' && audi?.price === 189900 && audi?.currency === 'DKK' && audi?.km === 126000 && audi?.year === 2019 && audi?.fuel === 'Benzin' && audi?.gearbox === 'Automatique' && audi?.power_ch === 190,
    'Danemark : « Kontant 189.900 kr. » gardé en couronnes, « 7g Aut. » = automatique, « 190HK »', audi);
  const born = aits.vehicles.find((v) => v.external_id === 'AD5728000'), cx30 = aits.vehicles.find((v) => v.external_id === 'AD5595566');
  const van = aits.vehicles.find((v) => v.external_id === 'AD5700001'), ev9 = aits.vehicles.find((v) => v.external_id === 'AD5700002');
  ok(born?.status === 'sold' && /Pasión/.test(born?.title ?? '') && cx30?.status === 'price_on_request' && cx30?.price === null && cx30?.year === null && cx30?.gearbox === 'Manuelle'
    && /neuve en stock/.test(cx30?.body ?? '') && /démonstration/.test(cx30?.body ?? ''),
    'Danemark : « Solgt » = vendue, « Ring for pris » = prix sur demande, « 0 km » sans année = neuve, « 6g » = manuelle, entités décodées', [born, cx30]);
  ok(van?.price === 209900 && ev9?.price === null && ev9?.status === 'price_on_request' && /engros/.test(ev9?.body ?? ''),
    'Danemark : prix utilitaire hors TVA gardé ; « Kontant 4.680 » d\'une voiture en leasing n\'est pas un prix ; « Engros » noté', [van?.price, ev9]);

  // Van Ekris (vanekris.nl, 23/11) : cartes réelles allégées ; énergie par les passes du filtre « brandstof ».
  const vek = (id: string, h2: string, version: string, year: string, km: string, gear: string, site: string, plate: string, price: string) => `<a id="occasion-${id}" href="https://vek.test/toyota-occasions/${id}"
class="card bg-base-100 shadow hover:shadow-lg transition-shadow duration-300 overflow-hidden group">
    <figure class="relative overflow-hidden bg-base-200"><img src="https://media.test/${id}-1.jpg" alt="${h2}" class="w-full h-auto"></figure>
    <div class="card-body p-4">
        <h2 class="card-title text-base text-xl font-bold leading-tight">
            ${h2}
        </h2>
        <p class="text-sm text-base-content/60">${version}</p>
        <div class="flex flex-wrap gap-4 mt-2 text-sm text-base-content/70">
                            <span class="flex items-center gap-1"><svg class="w-3 h-3"><path d="M6.75 3v2.25"/></svg>                    ${year}
                </span>
                                        <span class="flex items-center gap-1"><svg class="w-3 h-3"><path d="M15 10.5a3"/></svg>                    ${km}
                </span>
                                        <span class="flex items-center gap-1"><svg class="w-3 h-3"><path d="M9.594 3.94"/></svg>                    ${gear}
                </span>
                                        <span class="flex items-center gap-1">                    Marge
                </span>
                    </div>
        <div class="flex items-center justify-between mt-3">
            <span class="flex items-center gap-1 text-sm font-bold text-base-content/60 toyota-bold"><svg class="w-4 h-4"><path d="M1 1"/></svg>
                                ${site}
            </span>
                            <span class="flex flex-row h-7.5 place-items-center bg-base-200"><span class="px-0.5 py-1.5 rounded-l-sm bg-blue-500 text-white no-underline"></span><span class="px-2 py-1.25 text-xs font-bold rounded-r-sm bg-yellow-400 no-underline ">${plate}</span></span>
                                                <span class="toyota-bold text-primary">${price}</span>
                                    </div>
    </div>
</a>`;
  const vekPage = (n: number, last: number, cards: string) => `<select name="brandstof" class="select"><option value="">(geen voorkeur)</option><option value="B">Benzine</option><option value="H">
                                        Hybride
                                    </option></select><p class="text-base-content/60 text-sm">
                ${n} occasions gevonden
            </p><div x-data="loadMore()" x-init="init()"><div id="occasion-results" class="grid">${cards}</div></div>
            <script>
                function loadMore() {
                    return { nextPage: 2, lastPage: ${last}, hasMore: true, loading: false, total: ${n}, loaded: 2 }
                }
            </script>`;
  const v1 = vek('58165042', 'Toyota RAV4', '2.0 VVTi X-Style 2WD', '2013', '64.178 km', 'Handgeschakeld', 'Mijdrecht', '7KKD90', '€ 15.950');
  const v2 = vek('57515826', 'Toyota Auris', '1.8 Hybrid Dynamic', '2016', '113.592 km', 'Automaat', 'Leiderdorp', 'KD846K', '€ 15.999');
  const v3 = vek('50988567', 'Lexus NX', '300h Business Line', '2019', '88.000 km', 'Automaat', 'Woerden', 'XY123Z', '<span class="line-through">€ 31.950</span> € 29.950');
  pages['https://vek.test/toyota-occasions'] = vekPage(3, 2, v1 + v2);
  pages['https://vek.test/toyota-occasions?page=2'] = vekPage(3, 2, v3);
  pages['https://vek.test/toyota-occasions?brandstof=B&page=1'] = vekPage(1, 1, v1);
  pages['https://vek.test/toyota-occasions?brandstof=H&page=1'] = vekPage(2, 1, v2 + v3);
  ok(dsk.detectDealerProvider(pages['https://vek.test/toyota-occasions']) === 'occasionload', 'Van Ekris : cartes « occasion-<n°> » et bouton Alpine.js « loadMore() » reconnus (occasionload)');
  const veks = await dsk.fetchDealerStock('https://vek.test/toyota-occasions');
  const rav4 = veks.vehicles.find((v) => v.external_id === '58165042'), nx = veks.vehicles.find((v) => v.external_id === '50988567');
  ok(veks.vehicles.length === 3 && veks.declared === 3 && !veks.warnings.some((w) => /sans énergie/.test(w)), 'Van Ekris : « 3 occasions gevonden », « ?page=N » jusqu\'à « lastPage », énergie de chaque voiture', [veks.vehicles.length, veks.warnings]);
  ok(rav4?.brand === 'Toyota' && rav4?.model === 'RAV4' && rav4?.year === 2013 && rav4?.km === 64178 && rav4?.gearbox === 'Manuelle' && rav4?.location === 'Mijdrecht' && rav4?.plate === '7KKD90' && rav4?.price === 15950 && rav4?.fuel === 'Benzine'
    && nx?.price === 29950 && nx?.gearbox === 'Automatique' && nx?.fuel === 'Hybride' && nx?.location === 'Woerden',
    'Van Ekris : année, km, « Handgeschakeld » / « Automaat », site, plaque, prix (l\'ancien prix barré écarté), énergie du filtre (libellé du site)', [rav4, nx]);

  // Consilcar (consilcar.pt, 23/11) : cartes réelles allégées ; la suite par « indexload.asp », rang de la suivante.
  const es = (id: string, path: string, name: string, version: string, date: string, km: string, price: string) => `<div class="artigo"><script>$(document).ready(function(){ $('.fadein72').hide(); });</script>
	<div class="col-xs-12 col-sm-12 col-md-12 item_listagem" itemscope itemtype ="https://schema.org/Car">
		<a href="/carros/${path}/${id}" style="text-decoration:none;"><div class="thumbnail-zoom fadein72"><div id="1" class="lazy72" style="border:0px;background-image: url(https://cdn.easysite.pt/crm_test/${id}/a-6.jpg);"></div></div>
			<div style="display:none" itemprop="offers" itemscope itemtype="http://schema.org/Offer"><div style="display:none" itemprop="priceCurrency">EUR</div><div style="display:none" itemprop="price">${price}</div></div>
			<div style="display:none" itemprop="sku">${id}</div>
			<div class="col-xs-12" itemprop="name"><div class="col-xs-12 texto-novidades" itemprop="brand">
							${name}
						</div><div class="col-xs-12 nopadding texto-novidades2  " >
							${version}
						</div></div>
			<div class="novidades-mais-info-listagem nopadding">Registo <br><span itemprop="productionDate">
							${date}
							</span></div><div class="novidades-mais-info-listagem">Quilómetros <br><span itemprop="mileageFromOdometer"> ${km} </span></div>
			<div class="preco-novidades"><div class="preco-novidades-inner">${price}</div></div></a></div></div>`;
  const esNext = `<script>$("#load-more-btn").click(function () { var offset = $('#posts .artigo').length+1; $.ajax({
				url: '/web1/zp/tpl1/id1/viaturas/automoveis/indexload.asp?a=0'+'&P_ord_campo=7&P_cod_anunciante=84&P_destino=index.asp'+'&P_num_pagina='+offset, dataType: 'html' }); });</script>`;
  const esForm = `<form id="pesquisaFormListagem" method="post"><select class="chosen-select" name="TextBox" multiple><option value="1:Audi">Audi</option></select>
    <input type="checkbox" name="P_cod_marca" value="12"><select name="P_ano_inicial"><option value="">Ano</option><option value="2020">2020</option></select>
    <input type="hidden" name="P_ord_campo" value="7"></form>`;
  const esCars = [es('1703900', 'Peugeot/Expert', 'Peugeot Expert', '1.5 BlueHDi M6 Confort 6Lug.', 'Novembro 2020', '214.079 Km', '17 890 €'), es('1752650', 'Peugeot/2008', 'Peugeot 2008', '1.2 Hybrid e-DCS6 Style Connect Navi', 'Março 2025', '19.189 Km', '20 980 €'),
    es('1784650', 'Citro%C3%ABn/e-C3', 'Citroën e-C3', 'Max 113cv', 'Janeiro 2025', '7.936 Km', '19 990 €')];
  pages['https://es.test/carros/usados/'] = `${esForm}<div id="posts">${esCars[0]}${esCars[1]}</div>${esNext}`;
  pages['https://es.test/web1/zp/tpl1/id1/viaturas/automoveis/load_numero_resultados.asp?P_ano_inicial=&P_ord_campo=7'] = '3';
  pages['https://es.test/carros/usados/?P_ord_campo=7&P_cod_anunciante=84&P_destino=index.asp&P_num_pagina=2'] = `${esForm}<div id="posts">${esCars.join('')}</div>${esNext}`;
  ok(dsk.detectDealerProvider(pages['https://es.test/carros/usados/']) === 'easysite', 'Consilcar : cartes « item_listagem » (microdonnées Car) et suite « indexload.asp » reconnues (easysite)');
  ok(dsk.formDefaults(pages['https://es.test/carros/usados/'], 'pesquisaFormListagem') === 'P_ano_inicial=&P_ord_campo=7', 'formulaire « .serialize() » par défaut : liste multiple et case non cochée omises');
  const ess = await dsk.fetchDealerStock('https://es.test/carros/usados/');
  const exp = ess.vehicles.find((v) => v.external_id === '1703900'), c3 = ess.vehicles.find((v) => v.external_id === '1784650');
  ok(ess.vehicles.length === 3 && ess.declared === 3, 'Consilcar : total du compteur du site (3), tout le stock en une page (« P_num_pagina » = pages de 10)', [ess.vehicles.length, ess.declared, ess.warnings]);
  ok(exp?.brand === 'Peugeot' && exp?.model === 'Expert' && exp?.price === 17890 && exp?.km === 214079 && exp?.year === 2020 && exp?.gearbox === null
    && ess.vehicles.find((v) => v.external_id === '1752650')?.gearbox === 'Automatique' && c3?.brand === 'Citroën' && c3?.model === 'e-C3',
    'Consilcar : « 17 890 € », « 214.079 Km », « Novembro 2020 », marque et modèle de l\'adresse (« Citro%C3%ABn »), boîte de la version (e-DCS6)', [exp, c3]);
  const fiche = dsk.readEasysiteDetail(`<div class="col-xs-12 valorCaracteristica nopadding" itemprop="fuelType">
							Gasóleo
						</div><div class=" col-xs-12 caractistica_nome nopadding" >
												Transmissão
											</div>
											<div class=" col-xs-12 caractistica_conteudo nopadding" >
										Manual
											</div>`);
  ok(fiche.fuel === 'Gasóleo' && fiche.gearbox === 'Manuelle' && dsk.DETAIL_READERS.easysite?.fields.includes('fuel') === true,
    'Consilcar : la fiche rend l\'énergie (« Combustível ») et la boîte (« Transmissão »)', fiche);
  ok(fam.fuelFamily('Gasóleo') === 'diesel' && fam.fuelFamily('Elétrico') === 'electric' && fam.fuelFamily('Gasolina') === 'petrol',
    'énergies portugaises : « Gasóleo » = diesel, « Elétrico » = électrique, « Gasolina » = essence');
  // Compteur illisible : sans total, pas de relevé plutôt que de fausses disparitions.
  pages['https://es2.test/carros/usados/'] = pages['https://es.test/carros/usados/'];
  let stopped = false;
  try { await dsk.fetchDealerStock('https://es2.test/carros/usados/'); } catch (e) { stopped = /total du site illisible/.test(String(e)); }
  ok(stopped, 'Consilcar : sans total lisible, pas de relevé (aucune voiture marquée disparue à tort)');
}

console.log('\n=== BMW DANEMARK (25/11) : BAYERN AUTOGROUP (productfilter), CARIPO (carsgrid), JAN NYGAARD (nextcars), SAND-JENSEN (carclicked), MEINICHE ET PROCAR (bilinfo) ===\n');
{
  const dsb = await import('../worker/dealerStock');
  // Bayern AutoGroup (bag.dk) : page rendue avec ses facettes ; voitures par la route JSON « /api/product/filter ».
  pages['https://bag.test.dk/brugte-biler?dealername.keyword=Bayern%20AutoGroup%20Aarhus%20A%2FS'] = `<html lang="da"><script>{"facets":{"propellant.keyword":[{"key":"El","count":3}],"dealername.keyword":[{"key":"Bayern AutoGroup Aarhus A\\u002FS","count":3,"selected":true}]},"total":3,"hits":[]}</script> 324.900 kr.</html>`;
  const hit = (id: string, o: Record<string, unknown>) => ({ id, title: 'BMW iX2', make: 'BMW', model: 'iX2', variant: 'eDrive20 M-Sport Pro', year: 2025, mileage: '22.000 km', priceType: 'RetailPrice', gearType: 'Automatisk', productUrl: `/bmw-ix2-${id}`, vehicletype: 'PV', isDemo: false, vatType: 'WithVat', propellant: 'El', dealerName: 'Bayern AutoGroup Aarhus A/S', pictures: [`https://img.test/${id}.jpg`], cashPrice: '379.900 kr.', ...o });
  pages['https://bag.test.dk/api/product/filter?dealername.keyword=Bayern+AutoGroup+Aarhus+A%2FS&from=0&take=100&culture=da-DK&productType=Cars'] = JSON.stringify({ total: 3, hits: [
    hit('748584159', {}), hit('1518322967', { title: 'BMW i7', model: 'i7', variant: 'eDrive50 M-Sport', priceType: 'Leasing', cashPrice: undefined, leasingPrice: '12.000 kr.' }),
    hit('1880737347', { title: 'BMW 320d', model: '3-Serie', variant: '2,0 Touring aut.', propellant: 'Diesel', gearType: 'Manuel', isDemo: true, vatType: 'WithoutVat', mileage: '9.000 km', cashPrice: '214.900 kr.' })] });
  ok(dsb.detectDealerProvider(pages['https://bag.test.dk/brugte-biler?dealername.keyword=Bayern%20AutoGroup%20Aarhus%20A%2FS']) === 'productfilter', 'Bayern AutoGroup : facettes « dealername.keyword » / « propellant.keyword » reconnues (productfilter)');
  const bag = await dsb.fetchDealerStock('https://bag.test.dk/brugte-biler?dealername.keyword=Bayern%20AutoGroup%20Aarhus%20A%2FS');
  const ix2 = bag.vehicles.find((v) => v.external_id === '748584159'), i7 = bag.vehicles.find((v) => v.external_id === '1518322967'), d320 = bag.vehicles.find((v) => v.external_id === '1880737347');
  ok(bag.vehicles.length === 3 && bag.declared === 3 && ix2?.price === 379900 && ix2?.currency === 'DKK' && ix2?.km === 22000 && ix2?.year === 2025 && ix2?.fuel === 'El' && ix2?.gearbox === 'Automatique'
    && ix2?.url === 'https://bag.test.dk/bmw-ix2-748584159',
    'Bayern AutoGroup : route filtrée sur la concession de la vitrine, « 379.900 kr. » en couronnes, « 22.000 km », « Automatisk »', [bag.declared, ix2, bag.warnings]);
  ok(i7?.price === null && i7?.status === 'price_on_request' && d320?.gearbox === 'Manuelle' && /démonstration/.test(d320?.body ?? '') && bag.warnings.some((w) => /hors TVA/.test(w)),
    'Bayern AutoGroup : une voiture en leasing n\'a pas de prix de vente ; « Manuel », démonstration, prix hors TVA signalé', [i7, d320]);

  // Caripo (caripo-biler.dk) : cartes « car car--used card », km et année sur la fiche.
  const cg = (id: string, title: string, price: string) => `<div class="item filter-BMW"><a href="/c/brugte-biler/x-${id}" class="blue car car--used card"><div class="image"><img src="https://img.test/${id}.jpg" alt=""></div>
    <div class="content"><span class="tag tag--news">Nyhed</span><div class="content__text"><h3>
										${title}
									</h3><div class="price">kr. ${price}</div></div></div><div class="red read-more">Se mere</div></a></div>`;
  pages['https://cg.test.dk/p/brugte-biler'] = `<div class="cars-grid cars-grid--used grid">${cg('5738689', 'BMW i4 eDrive40 Gran Coupé EL M-Sport 340HK 5d Aut.', '439.900')}${cg('5727339', 'BMW 118i 1,5 M-Sport 136HK 5d 6g', '199.900')}</div>`;
  ok(dsb.detectDealerProvider(pages['https://cg.test.dk/p/brugte-biler']) === 'carsgrid', 'Caripo : cartes « car--used » dans « cars-grid--used » reconnues (carsgrid)');
  const cgs = await dsb.fetchDealerStock('https://cg.test.dk/p/brugte-biler');
  const i4 = cgs.vehicles.find((v) => v.external_id === '5738689'), b118 = cgs.vehicles.find((v) => v.external_id === '5727339');
  ok(cgs.vehicles.length === 2 && i4?.price === 439900 && i4?.currency === 'DKK' && i4?.fuel === 'El' && i4?.gearbox === 'Automatique' && i4?.power_ch === 340 && b118?.gearbox === 'Manuelle' && b118?.fuel === null,
    'Caripo : « kr. 439.900 », « EL » et « Aut. » du titre, « 6g » = manuelle ; l\'énergie absente du titre attend la fiche', [i4, b118]);
  const facts = dsb.readUsedCarFactsDetail('<div class="used-car-facts__item"><div class="used-car-facts__caption">Modelår</div> 2025</div><div class="used-car-facts__item"><div class="used-car-facts__caption">Kilometer</div> 26.000</div><div class="used-car-facts__item"><div class="used-car-facts__caption">Brændstof</div> Benzin</div>');
  ok(facts.km === 26000 && facts.year === 2025 && facts.fuel === 'Benzin' && dsb.DETAIL_READERS.carsgrid?.fields.includes('km') === true, 'Caripo : la fiche rend km, année et énergie (« used-car-facts »)', facts);

  // Jan Nygaard (jan-nygaard.dk) : Next.js à composants serveur, « UsedCarOverview » → « cars ».
  const car = (id: string, title: string, sub: string, loc: string, cash: string, km: string, year: string) => ({ card: { badge: 'Premium Selection', href: `/brugte-biler/x-${id}`, id, images: [`https://img.test/${id}.jpg`], location: { href: '/locations/x', name: loc }, price: `${cash} kr.`, priceSubline: '$undefined', subtitle: sub, title }, CashPrice: cash.replace(/\./g, ''), CreatedDate: '06-10-2026 10:59:17', make: 'BMW', Mileage: km, modelSeries: '3-Serie', powertrain: 'Benzin-hybrid', Year: year });
  const rsc = `2e:I[24200,["$4"],"UsedCarOverview"]\n24:["$","$L2e",null,${JSON.stringify({ cars: [car('725991055', 'BMW 330e Touring M-Sport aut.', 'Plug-in hybrid · 2022 · 75.000 km.', 'Birkerød', '309.000', '75000', '2022'), car('920013733', 'BMW i7 eDrive50 M-Sport', 'El · 2025 · 39.000 km.', 'København', '795.000', '39000', '2025')] })}]`;
  pages['https://jn.test.dk/brugte-biler'] = `<html><body><p>2 biler fundet</p><script>self.__next_f.push([1,${JSON.stringify(rsc)}])</script></body></html>`;
  ok(dsb.detectDealerProvider(pages['https://jn.test.dk/brugte-biler']) === 'nextcars', 'Jan Nygaard : composant « UsedCarOverview » de la charge Next.js reconnu (nextcars)');
  const jns = await dsb.fetchDealerStock('https://jn.test.dk/brugte-biler');
  const e330 = jns.vehicles.find((v) => v.external_id === '725991055'), i7b = jns.vehicles.find((v) => v.external_id === '920013733');
  ok(jns.vehicles.length === 2 && jns.declared === 2 && e330?.price === 309000 && e330?.km === 75000 && e330?.year === 2022 && e330?.fuel === 'Plug-in hybrid' && e330?.gearbox === 'Automatique'
    && e330?.location === 'Birkerød' && e330?.listed_at === '2026-10-06T10:59:00' && i7b?.location === 'København' && i7b?.currency === 'DKK',
    'Jan Nygaard : prix, km, année, énergie du sous-titre, site de chaque voiture, date de mise en ligne — lu sans rien exécuter', [e330, i7b]);

  // Sand-Jensen (sandjensen.dk) : 48 cartes « carClicked » par page, microdonnées ; les liens de page portent le filtre.
  const sj = (slug: string, brand: string, h3: string, price: string, year: string, km: string, fuel: string, tag = '') => `<a data-event="carClicked" data-category="navigation" data-label="carClicked" data-url="${slug}"
    class="" href="/bilsoegning/${slug}"><article class="relative"><div class="absolute flex"><div class="pr-3"><p>${tag}</p></div></div><div class="relative"><swiper-container class="carTileSwiper"><swiper-slide><picture>
    <img loading="lazy" class="object-cover" src="https://img.test/${slug}.jpeg?class=S1600X1600&amp;width=768" alt="" /></picture></swiper-slide></swiper-container></div>
    <div class="flex"><div class="leading-none pb-3"><p class="tagline">${brand}</p><h3 class="text-xl"><b>${h3.split(' ').slice(0, 2).join(' ')}</b> ${h3.split(' ').slice(2).join(' ')}</h3></div>
    <div class="display-x-small font-semibold mb-0 leading-none ">\n ${price}\n </div><div class="text-sm"><div class="font-semibold">12.792 kr.</div><small class="opacity-60">Leasing fra</small></div>
    <p itemprop="modelDate">${year}</p><p itemprop="mileageFromOdometer" itemscope itemtype="https://schema.org/QuantitativeValue"><span itemprop="value">${km}</span> <small>Km.</small></p><p itemprop="fuelType">${fuel}</p></div></article></a>`;
  const sjNav = (p: number) => `<p>Viser 1–2 af 3 biler</p><a href="/bilsoegning/?tx=Varebil&#x2B;inkl.&#x2B;moms%2cVan&amp;pageSize=48&amp;page=${p}" aria-label="Gå til side ${p}">${p}</a>`;
  pages['https://sj.test.dk/bilsoegning/'] = sjNav(2) + sj('bmw-m5-touring-xdrive-aut-dma60oooi59', 'BMW', 'BMW M5 4,4 Touring xDrive aut.', '1.849.900 kr.', '2025', '32000', 'Benzin / El', 'Nypris -23%')
    + sj('porsche-911-carrera-4s-coupe-pdk-mdvczpcfzsz', 'Porsche', 'Porsche 911 Carrera 4S 3,0 Coup&#xE9; PDK', '1.299.900 kr.', '2021', '41000', 'Benzin');
  pages['https://sj.test.dk/bilsoegning/?tx=Varebil+inkl.+moms%2cVan&pageSize=48&page=2'] = sjNav(1) + sj('bmw-i4-edrive35-m-sport-ra7mgbqnaio', 'BMW', 'BMW i4 eDrive35 M-Sport', '', '2023', '61000', 'El', 'Solgt');
  ok(dsb.detectDealerProvider(pages['https://sj.test.dk/bilsoegning/']) === 'carclicked', 'Sand-Jensen : cartes « carClicked » à microdonnées reconnues (carclicked)');
  const sjs = await dsb.fetchDealerStock('https://sj.test.dk/bilsoegning/');
  const m5 = sjs.vehicles.find((v) => v.external_id === 'dma60oooi59'), p911 = sjs.vehicles.find((v) => v.external_id === 'mdvczpcfzsz'), i4s = sjs.vehicles.find((v) => v.external_id === 'ra7mgbqnaio');
  ok(sjs.vehicles.length === 3 && sjs.declared === 3 && sjs.pages === 2 && m5?.price === 1849900 && m5?.currency === 'DKK' && m5?.km === 32000 && m5?.year === 2025 && m5?.fuel === 'Benzin / El'
    && m5?.gearbox === 'Automatique' && p911?.gearbox === 'Automatique' && p911?.title === 'Porsche 911 Carrera 4S 3,0 Coupé PDK' && i4s?.status === 'sold' && i4s?.price === null
    && m5?.image === 'https://img.test/bmw-m5-touring-xdrive-aut-dma60oooi59.jpeg?class=S1600X1600&width=768',
    'Sand-Jensen : « 1.849.900 kr. », microdonnées km / année / énergie, « aut. » et « PDK » = automatique, « Solgt » = vendue, page 2 par le lien du site (filtre gardé)', [sjs.pages, m5, p911, i4s, sjs.warnings]);

  // Bilinfo (Meiniche par le module « Brugtbilsmodulet », Procar par « vehiclesArr » dans la page) : même format.
  const bi = (id: string, o: Record<string, unknown>) => ({ Id: id, Make: 'BMW', Model: 'i4', Variant: 'eDrive35 M-Sport', Price: '329900', CashPrice: '329900', PriceType: 'RetailPrice', Mileage: '25000', Year: '2024',
    Propellant: 'El', SecondaryPropellant: null, GearType: 'A', Effect: '286', Type: 'Personvogn', Vin: null, Pictures: [`https://img.test/${id}.jpg`], CreatedDate: '24-09-2026 11:51:40', VehicleSourceId: `src-${id}`, SoldAge: null, DeletedDate: null, ...o });
  pages['https://www.bbm.test.dk/meiniche-a-s/'] = '<div><script id="usedcarsmodule" src="//www.bbm.test.dk/bbm/537e1f7d-cc9f-48e2-8b20-94d7a73fe7c7.js"></script></div>';
  pages['https://www.bbm.test.dk/bbm/bbm.app.js?guid=537e1f7d-cc9f-48e2-8b20-94d7a73fe7c7'] = `app.controller("x", function ($scope) {\n  $scope.data = null;\n  $scope.initialize = async function () {\n    $scope.data = ${JSON.stringify({ ApiVersion: '3', Vehicles: [bi('377670560', { Make: 'Kia', Model: 'Stonic', Variant: 'T-GDi Prestige DCT', Propellant: 'Benzin', Price: '199900', Effect: '100' }), bi('1843649265', { GearType: 'M', Propellant: 'Benzin', SecondaryPropellant: 'El', Model: '330e' })] })};\n  };\n});`;
  ok(dsb.detectDealerProvider(pages['https://www.bbm.test.dk/meiniche-a-s/']) === 'bilinfo', 'Meiniche : module « usedcarsmodule » de Brugtbilsmodulet reconnu (bilinfo)');
  const mei = await dsb.fetchDealerStock('https://www.bbm.test.dk/meiniche-a-s/');
  const kia = mei.vehicles.find((v) => v.external_id === '377670560'), phev = mei.vehicles.find((v) => v.external_id === '1843649265');
  ok(mei.vehicles.length === 2 && kia?.price === 199900 && kia?.currency === 'DKK' && kia?.km === 25000 && kia?.year === 2024 && kia?.gearbox === 'Automatique' && kia?.power_ch === 100
    && kia?.listed_at === '2026-09-24T11:51:00' && kia?.url === 'https://www.bbm.test.dk/meiniche-a-s/#377670560' && phev?.fuel === 'Benzin / El' && phev?.gearbox === 'Manuelle',
    'Meiniche : stock lu dans « $scope.data » du module (prix en couronnes, km, année, « A » / « M », ch, date) ; énergie double « Benzin / El »', [kia, phev]);
  pages['https://pc.test.dk/biler-til-salg/'] = `<a href="https://pc.test.dk/bil-detaljer?id=src-303856412">Se bilen</a><script>var vehiclesArr=[];var base_url='https://pc.test.dk';if(20)\nvehiclesArr=${JSON.stringify([
    bi('303856412', { Model: 'i4', Variant: 'M60 xDrive', Price: '569900' }),
    bi('218232938', { Model: 'M240i', Variant: 'Cabriolet xDrive aut.', Price: '2260', PriceType: 'Leasing', VehicleSourceId: 'src-m240' }),
    bi('1286366219', { Model: 'M240i', Variant: 'Cabriolet xDrive aut.', Price: '229900', PriceType: 'RetailPriceWithoutTax', VehicleSourceId: 'src-m240' }),
    bi('45264850', { Model: 'X1', Price: '', CashPrice: null, PriceType: 'Leasing', VehicleSourceId: 'src-x1' })])};</script>`;
  ok(dsb.detectDealerProvider(pages['https://pc.test.dk/biler-til-salg/']) === 'bilinfo', 'Procar : « vehiclesArr » Bilinfo dans la page reconnu (bilinfo)');
  const pc = await dsb.fetchDealerStock('https://pc.test.dk/biler-til-salg/');
  const m240 = pc.vehicles.find((v) => v.model === 'M240i'), x1 = pc.vehicles.find((v) => v.external_id === '45264850');
  ok(pc.vehicles.length === 3 && pc.declared === 3 && m240?.external_id === '1286366219' && m240?.price === 229900 && /prix hors TVA/.test(m240?.title ?? '')
    && m240?.url === 'https://pc.test.dk/bil-detaljer?id=src-m240' && x1?.price === null && x1?.status === 'price_on_request' && pc.warnings.some((w) => /en double/.test(w)),
    'Procar : une voiture en deux annonces (leasing + vente hors TVA) comptée une fois, sous celle qui a un prix ; leasing seul = sans prix de vente ; lien « bil-detaljer »', [pc.vehicles, pc.warnings]);
}

console.log('\n=== BMW DANEMARK, SUITE (26/11) : EJVIND NIELSEN (attityde), ARNE POULSEN (fluidcards), JENS WINTHER (datavehicle), HALDRUP (jetbrugte), CONCEPT BILER (bilinfolist) ===\n');
{
  const dsd = await import('../worker/dealerStock');
  // Ejvind Nielsen : la page n'a que 20 cartes ; le formulaire de recherche de la page poste à « /api/search/cars », qui les rend toutes.
  const enCard = (slug: string, h3: string, ver: string, year: string, fuel: string, km: string, price: string, tag = '') => `<article class="flex flex-col"><a class="relative z-10 block h-full bg-muted" href="/biler/${slug}">
    <div class="relative"><div class="absolute top-0 left-0 hidden xl:flex">${tag ? `<span class="px-2.5 py-1 text-xs tracking-widest uppercase bg-primary">${tag}</span>` : ''}</div><img loading="lazy" class="object-cover" src="https://img.test/${slug}.jpeg?class=S1600X1600&amp;width=600" /></div>
    <div class="p-4"><div class="flex-1 pb-3"><h3 class="text-xl font-normal leading-none">${h3}</h3><span class="text-base leading-none"> ${ver}</span></div>
    <div class="flex justify-between"><span class="whitespace-nowrap">\n    ${year}\n</span><span class="whitespace-nowrap">\n    ${fuel}\n</span><span class="line-clamp-1">\n    ${km}\n</span></div>
    <div class="flex flex-col gap-0.5 pt-3"><h5 class="mb-1 text-xl font-medium leading-none">${price} <small class="text-sm"></small></h5></div></div></a></article>`;
  pages['https://en.test.dk/biler/'] = `<h2>Vi har i øjeblikket <span class="text-primary">3</span> biler på lager</h2><form class="relative" id="searchForm" x-data="search(1066, 'da-DK', initSearch)"><input type="hidden" name="Sort" /></form><div id="search-result">${enCard('bmw-x2-sdrive18d-m-sport-aut-a044d9df5a304843ad0c54993113f9b2', 'BMW X2', '2,0 sDrive18d M-Sport aut.', '2020', 'Diesel', '136.000 km', 'DKK 199.900,-', 'Nyhed')}</div>`;
  pages['https://en.test.dk/api/search/cars?id=1066&culture=da-DK Search=&Sort=Date'] = enCard('bmw-x2-sdrive18d-m-sport-aut-a044d9df5a304843ad0c54993113f9b2', 'BMW X2', '2,0 sDrive18d M-Sport aut.', '2020', 'Diesel', '136.000 km', 'DKK 199.900,-', 'Nyhed')
    + enCard('mini-cooper-se-classic-trim-drmmnjspahv', 'MINI Cooper SE', 'Classic Trim', '2024', 'El', '12.000 km', 'DKK 229.900,-')
    + enCard('bmw-i3-rex-3f3851d6effecbbc212f08df3da85964', 'BMW i3', 'REX', '2014', 'El', '200.000 km', 'Solgt', 'Solgt');
  ok(dsd.detectDealerProvider(pages['https://en.test.dk/biler/']) === 'attityde', 'Ejvind Nielsen : formulaire « searchForm » de la page reconnu (attityde)');
  const en = await dsd.fetchDealerStock('https://en.test.dk/biler/');
  const x2 = en.vehicles.find((v) => v.model === 'X2'), mini = en.vehicles.find((v) => v.external_id === 'drmmnjspahv'), i3 = en.vehicles.find((v) => v.model === 'i3');
  ok(en.vehicles.length === 3 && en.declared === 3 && x2?.price === 199900 && x2?.currency === 'DKK' && x2?.km === 136000 && x2?.year === 2020 && x2?.fuel === 'Diesel' && x2?.gearbox === 'Automatique'
    && mini?.title === 'MINI Cooper SE Classic Trim' && i3?.status === 'sold' && i3?.price === null,
    'Ejvind Nielsen : tout le stock par la recherche du site (pas seulement les 20 de la page), « DKK 199.900,- », « aut. », code court, « Solgt »', [en.vehicles, en.warnings]);
  ok(dsd.readGeartypeDetail('<div class="text-sm font-headline opacity-70">Geartype</div>\n    <span>Automatgear</span>').gearbox === 'Automatique' && dsd.DETAIL_READERS.attityde?.fields.includes('gearbox') === true,
    'Ejvind Nielsen : la fiche rend la boîte (« Geartype : Automatgear »)');

  // Arne Poulsen : cartes à cases étiquetées, prix dans le bouton.
  const apCard = (slug: string, h3: string, ver: string, year: string, km: string, price: string, tag: string) => `<a href="/biler-til-salg/${slug}"\n    class="relative flex flex-col transition rounded-medium bg-card group"><div><div class="flex-1"><h3 class="text-fluid-md mb-0">${h3}</h3>
    <span class="text-fluid-sm text-primary">${ver}</span></div></div><div class="relative aspect-4/3"><img\n        src="https://img.test/${slug}.jpeg?class=S1600X1600&amp;width=480"\n /><div class="absolute flex"><div class="px-2 py-1 bg-green-400 text-sm">${tag}</div></div></div>
    <div class="grid"><div class=" py-1 bg-background"><div class="text-fluid-sm opacity-50">Modelår</div>\n                ${year}\n            </div><div class=" py-1"><div class="text-fluid-sm opacity-50">Drivmiddel</div>\n                El\n            </div><div class=" py-1"><div class="text-fluid-sm opacity-50">Km</div>\n                ${km}\n            </div></div>
    <div class="m-1 flex gap-1"><button type="button" class="button text-fluid-base w-full button--secondary">\n        ${price}\n    </button></div></a>`;
  pages['https://ap.test.dk/biler-til-salg/'] = apCard('bmw-ix2-xdrive30-m-sport-54617832ce014486b0072117edf47385', 'BMW iX2', 'xDrive30 M-Sport', '2025', '15.000', 'DKK 375.000,-', 'Nyhed')
    + apCard('bmw-i4-m50-m-sport-xdrive-c7a9d35f1f45469891c27d6e9c174aa6', 'BMW i4', 'M50 M-Sport xDrive', '2023', '41.000', 'Solgt', 'Solgt');
  ok(dsd.detectDealerProvider(pages['https://ap.test.dk/biler-til-salg/']) === 'fluidcards', 'Arne Poulsen : cartes à cases « Modelår / Drivmiddel / Km » reconnues (fluidcards)');
  const ap = await dsd.fetchDealerStock('https://ap.test.dk/biler-til-salg/');
  const ix2 = ap.vehicles.find((v) => v.model === 'iX2'), i4 = ap.vehicles.find((v) => v.model === 'i4');
  ok(ap.vehicles.length === 2 && ix2?.price === 375000 && ix2?.km === 15000 && ix2?.year === 2025 && ix2?.fuel === 'El' && ix2?.external_id === '54617832ce014486b0072117edf47385'
    && i4?.status === 'sold' && i4?.price === null, 'Arne Poulsen : « DKK 375.000,- », cases étiquetées, « Solgt » = vendue', ap.vehicles);

  // Jens Winther : valeurs en attributs data-*.
  pages['https://jw.test.dk/biler/'] = `<a href="https://jw.test.dk/koeretoejer/bmw/ix1-edrive20-el-m-sport-204hk-5d-aut/AD5696250/" class="group flex flex-col"\n    data-vehicle data-make="BMW" data-fuel="El" data-new="0" data-sold="1"\n    data-order="2" data-price="0" data-km="21000" data-year="2025"\n    data-search="bmw ix1">\n    <img src="https://img.test/AD5696250.jpg" alt="" /><h2 class="mt-1 text-lg">iX1 <span class="font-normal text-steel">eDrive20 EL M-Sport 204HK 5d Aut.</span></h2></a>`;
  ok(dsd.detectDealerProvider(pages['https://jw.test.dk/biler/']) === 'datavehicle', 'Jens Winther : cartes « data-vehicle » reconnues (datavehicle)');
  const jw = await dsd.fetchDealerStock('https://jw.test.dk/biler/');
  const ix1 = jw.vehicles[0];
  ok(jw.vehicles.length === 1 && ix1?.external_id === 'AD5696250' && ix1?.title === 'BMW iX1 eDrive20 EL M-Sport 204HK 5d Aut.' && ix1?.km === 21000 && ix1?.year === 2025 && ix1?.status === 'sold' && ix1?.price === null
    && ix1?.gearbox === 'Automatique' && ix1?.power_ch === 204, 'Jens Winther : km, année, énergie des attributs, « data-sold » = vendue, « 204HK » et « Aut. » de la version', jw.vehicles);

  // Bilhuset Haldrup : 16 voitures dans la page (JetEngine), la liste complète par l'API REST publique, le reste sur la fiche.
  const hdItem = (id: string, slug: string, title: string, ver: string, price: string, year: string, fuel: string, km: string, site: string) => `<div class="jet-listing-grid__item jet-listing-dynamic-post-${id}" data-post-id="${id}"  ><a class="elementor-element" href="https://hd.test.dk/brugte-biler/${slug}/"><img src="https://img.test/${slug}.jpg" />
    <h2 class="elementor-heading-title elementor-size-default">${title}</h2><div class="jet-listing-dynamic-field__content">${ver}</div><h2 class="elementor-heading-title">${price}</h2><h2 class="elementor-heading-title">Inkl. leveringsomkosting</h2>
    <div class="jet-listing-dynamic-field__content">${year}</div><div class="jet-listing-dynamic-field__content">Personbil</div><div class="jet-listing-dynamic-field__content">${fuel}</div><div class="jet-listing-dynamic-field__content">${km}</div><div class="jet-listing-dynamic-field__content">48.03 km/l</div><div class="jet-listing-dynamic-field__content">${site}</div></a></div>`;
  pages['https://hd.test.dk/brugte-biler/'] = `<div class="jet-listing-grid__items" data-nav="{&quot;query&quot;:{&quot;post_type&quot;:&quot;brugte-biler&quot;,&quot;posts_per_page&quot;:&quot;16&quot;}}" data-page="1" data-pages="2">`
    + hdItem('25706', 'bmw-i4-22', 'BMW i4', 'M50 Gran Coupé EL XDrive 544HK 5d Aut.', '319.900,-', '2022', 'El', '167.500 km', 'Randers SV') + '</div>';
  pages['https://hd.test.dk/wp-json/wp/v2/brugte-biler?per_page=100&page=1&_fields=id,link,title,date,class_list'] = JSON.stringify([
    { id: 25706, link: 'https://hd.test.dk/brugte-biler/bmw-i4-22/', title: { rendered: 'BMW i4' }, date: '2026-11-26T09:06:07', class_list: ['post-25706', 'drivmiddel-el', 'afdeling-randers-sv', 'model-i4', 'maerke-bmw'] },
    { id: 26100, link: 'https://hd.test.dk/brugte-biler/bmw-x5/', title: { rendered: 'BMW X5' }, date: '2026-11-20T10:00:00', class_list: ['post-26100', 'drivmiddel-diesel', 'afdeling-hobro', 'model-x5', 'maerke-bmw'] }]);
  ok(dsd.detectDealerProvider(pages['https://hd.test.dk/brugte-biler/']) === 'jetbrugte', 'Haldrup : JetEngine, type « brugte-biler » reconnu (jetbrugte)');
  const hd = await dsd.fetchDealerStock('https://hd.test.dk/brugte-biler/');
  const hi4 = hd.vehicles.find((v) => v.external_id === '25706'), x5 = hd.vehicles.find((v) => v.external_id === '26100');
  ok(hd.vehicles.length === 2 && hi4?.price === 319900 && hi4?.km === 167500 && hi4?.year === 2022 && hi4?.location === 'Randers SV' && hi4?.power_ch === 544
    && x5?.title === 'BMW X5' && x5?.brand === 'BMW' && x5?.fuel === 'Diesel' && x5?.location === 'Hobro' && x5?.price === null && x5?.listed_at === '2026-11-20T10:00:00',
    'Haldrup : voiture de la page complète ; voiture absente de la page prise dans l\'API REST (marque, énergie, site, date), le reste attend sa fiche', hd.vehicles);
  const hdDet = dsd.readJetBrugteDetail('<span>Kilometer</span><span>167.500</span><span>Drivmiddel</span><span>El</span><span>1. reg. dato</span><span>2022</span><div class="elementor-element carprice"><div><h3 class="elementor-heading-title">319.900 DKK</h3></div></div><p>Udstyrsliste</p><p>Android Auto, Automatgear, Klimaanlæg</p><span>Modelår</span><span>2022</span>');
  ok(hdDet.km === 167500 && hdDet.year === 2022 && hdDet.price === 319900 && hdDet.fuel === 'El' && hdDet.gearbox === 'Automatique' && dsd.DETAIL_READERS.jetbrugte?.fields.includes('price') === true,
    'Haldrup : la fiche rend prix, km, année, énergie et boîte', hdDet);

  // Concept Biler : application Vue « car-list », stock par « /?bilinfo_generate_list ».
  pages['https://cb.test.dk/biler/'] = '<link rel="stylesheet" href="https://cb.test.dk/wp-content/plugins/pb-elementor-widgets/partials/car-list/style.css"><div id="app"></div><script src="https://cb.test.dk/wp-content/plugins/pb-elementor-widgets/partials/car-list/js/app.5bfb3fcd.js"></script>';
  pages['https://cb.test.dk/?bilinfo_generate_list'] = JSON.stringify([
    { id: 318986, image: 'https://img.test/1.jpg', title: 'BMW X3 xDrive30e M-Sport 5d', make: 'BMW', model: 'X3', year: 2023, fuel: 'Benzin', fuel2: 'El', mileage: 41000, leasing: false, price: 389900, geartype: 'Automatisk', permalink: 'https://cb.test.dk/bil/bmw-x3/', publishedTime: '20261125', sold: false, new: false },
    { id: 318984, image: 'https://img.test/2.jpg', title: 'MINI Cooper 5d', make: 'MINI', model: 'Cooper', year: 2019, fuel: 'Benzin', fuel2: null, mileage: 88000, leasing: false, price: 129900, geartype: 'Manuel', permalink: 'https://cb.test.dk/bil/mini-cooper/', publishedTime: '20261101', sold: true, new: false }]);
  ok(dsd.detectDealerProvider(pages['https://cb.test.dk/biler/']) === 'bilinfolist', 'Concept Biler : application « car-list » reconnue (bilinfolist)');
  const cb = await dsd.fetchDealerStock('https://cb.test.dk/biler/');
  const x3 = cb.vehicles.find((v) => v.model === 'X3'), cooper = cb.vehicles.find((v) => v.model === 'Cooper');
  ok(cb.vehicles.length === 2 && x3?.price === 389900 && x3?.km === 41000 && x3?.fuel === 'Benzin / El' && x3?.gearbox === 'Automatique' && x3?.listed_at === '2026-11-25T00:00:00'
    && x3?.url === 'https://cb.test.dk/bil/bmw-x3/' && cooper?.gearbox === 'Manuelle' && cooper?.status === 'sold', 'Concept Biler : prix, km, énergie double, « Automatisk » / « Manuel », date de mise en ligne, vendue', cb.vehicles);
}

console.log('\n=== BMW PAYS-BAS (25/11) : FILTRE DE LIEU DES VITRINES dvapi (PALA, HEDIN), KALLENHARD (sucars) ===\n');
{
  const dsn = await import('../worker/dealerStock');
  // Pala Group : la page d'un site filtre dans le navigateur (« locatie[0]=Uden&sources[0]=occasions ») ; l'API doit les recevoir.
  const dvPage = (host: string, list: number) => `<div class="vehicle-overview" data-update-url="/voorraad-api/vehiclelist/${list}/vehicles.json?limit=21&amp;sort=created_at_desc"></div>`;
  const dvApi = (host: string, list: number, params: Array<[string, string]>) => {
    const u = new URL(`https://${host}/voorraad-api/vehiclelist/${list}/vehicles.json?limit=21&sort=created_at_desc`);
    u.searchParams.set('limit', '100');
    for (const [k, v] of params) u.searchParams.append(k, v);
    return u;
  };
  const dvItem = (id: string, model: string, price: number) => ({ id, brand: 'BMW', model, type: 'xDrive30e M Sport', price, url: `/aanbod/${id}`,
    attributes: { voertuignr: { value: id }, tellerstand: { value: 18000 }, bouwjaar: { value: 2024 }, brandstof: { value: 'Hybride' }, transmissie: { value: 'Automaat' } } });
  pages['https://pala.test/aanbod?locatie%5B0%5D=Uden&sources%5B0%5D=occasions'] = dvPage('pala.test', 2);
  const uden = dvApi('pala.test', 2, [['locatie[0]', 'Uden'], ['sources[0]', 'occasions']]);
  uden.searchParams.set('page', '1'); uden.searchParams.set('sort', 'created_at_asc');
  pages[uden.toString()] = JSON.stringify({ count: 1, pages: { total: 1 }, items: [dvItem('U93', 'X3', 52950)] });
  // Sans le filtre, l'API rendrait tout le groupe (2 200 voitures le 25/11) : ici cette adresse-là ne répond pas.
  ok(dsn.detectDealerProvider(pages['https://pala.test/aanbod?locatie%5B0%5D=Uden&sources%5B0%5D=occasions']) === 'dvapi', 'Pala Group : page « aanbod » à data-update-url reconnue (dvapi)');
  const pala = await dsn.fetchDealerStock('https://pala.test/aanbod?locatie%5B0%5D=Uden&sources%5B0%5D=occasions');
  ok(pala.vehicles.length === 1 && pala.vehicles[0].external_id === 'U93' && pala.vehicles[0].km === 18000 && pala.declared === 1,
    'Pala Group : « locatie[0] » et « sources[0] » de la page passés à l\'API — le site seul, pas tout le groupe', [pala.vehicles.length, pala.warnings]);
  // De Waal (déjà relevée) : « bouwjaar » et « sort » ne sont pas des filtres de lieu — l'appel à l'API ne change pas.
  pages['https://dewaal.test/voorraad?bouwjaar=2017%3B2028&sort=price_asc&page=1'] = dvPage('dewaal.test', 7);
  const dw = dvApi('dewaal.test', 7, []); dw.searchParams.set('page', '1'); dw.searchParams.set('sort', 'price_asc');
  pages[dw.toString()] = JSON.stringify({ count: 1, pages: { total: 1 }, items: [dvItem('D1', 'X1', 29950)] });
  const dwr = await dsn.fetchDealerStock('https://dewaal.test/voorraad?bouwjaar=2017%3B2028&sort=price_asc&page=1');
  ok(dwr.vehicles.length === 1 && !fetched.some((u) => u.startsWith('https://dewaal.test/voorraad-api/') && /bouwjaar|locatie|plaats|sources/.test(u)),
    'De Waal : sans filtre de lieu dans l\'adresse, l\'appel à l\'API est celui d\'avant (rien de recopié)', fetched.filter((u) => u.includes('dewaal.test')));

  // Kallenhard : fichier JSON public « app-vehicles-nl.json » (data-json-url), prix affiché + prix export, BTW / marge.
  pages['https://kh.test/voorraad/'] = '<div id="vehicle-compare-bar" data-json-url="/app/uploads/app-vehicles-nl.json?v=1795602005" data-compare-url="https://kh.test/vergelijk-modellen/"></div>';
  const kh = (slug: string, title: string, desc: string, o: Record<string, unknown>, f: Record<string, unknown>) => ({ slug, title, link: `https://kh.test/voorraad/${slug}/`, published_at: 1795604990,
    short_description: desc, image: { '768px': `https://kh.test/app/uploads/su-cars/${slug}.jpg` }, fuel: 'Hybride', transmission: 'Automaat', price: 52875, price_export: 41500, ...o,
    filters: { brand: 'bmw', model: 'x3', year: 2023, vat: 'b', mileage: 86954, status: ['nieuw-binnen'], ...f } });
  pages['https://kh.test/app/uploads/app-vehicles-nl.json?v=1795602005'] = JSON.stringify({ items: [
    kh('bmw-x3-58352001', 'BMW X3', 'xDrive30e M-Sport - Pano - M-Zetels - 2023 - 86.954 km - Hybride Automaat', {}, {}),
    kh('bmw-1-serie-58351090', 'BMW 1-serie', '118i M-Sport - Pano - 2021 - 152.430 km - Benzine Handgeschakeld', { fuel: 'Benzine', transmission: 'Handgeschakeld', price: 18875, price_export: 18875 }, { model: '1-serie', year: 2021, vat: 'm', mileage: 152430, status: ['verkocht'] }),
  ], filters: [{ type: 'taxonomy_filter_widget', settings: { slug: 'brand' }, terms: [{ slug: 'bmw', name: 'BMW' }] }, { type: 'taxonomy_filter_widget', settings: { slug: 'model' }, terms: [{ slug: 'x3', name: 'X3' }, { slug: '1-serie', name: '1 Serie' }] }] });
  ok(dsn.detectDealerProvider(pages['https://kh.test/voorraad/']) === 'sucars', 'Kallenhard : fichier « app-vehicles-nl.json » annoncé par data-json-url reconnu (sucars)');
  const khs = await dsn.fetchDealerStock('https://kh.test/voorraad/');
  const x3 = khs.vehicles.find((v) => v.external_id === '58352001'), b1 = khs.vehicles.find((v) => v.external_id === '58351090');
  ok(khs.vehicles.length === 2 && khs.declared === 2 && x3?.price === 52875 && x3?.km === 86954 && x3?.year === 2023 && x3?.fuel === 'Hybride' && x3?.gearbox === 'Automatique'
    && x3?.brand === 'BMW' && x3?.model === 'X3' && x3?.title === 'BMW X3 xDrive30e M-Sport · TVA récupérable · prix export 41 500 €' && x3?.listed_at === '2026-11-25T11:09:50.000Z'
    && b1?.gearbox === 'Manuelle' && b1?.status === 'sold' && b1?.title === 'BMW 1-serie 118i M-Sport' && b1?.model === '1 Serie',
    'Kallenhard : prix affiché gardé, prix export et TVA récupérable (« BTW ») dans le titre, marge sans mention, « verkocht » = vendue, date de mise en ligne', [x3, b1]);
}

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);
