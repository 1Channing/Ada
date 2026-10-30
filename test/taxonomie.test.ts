/**
 * L'APPRENTISSAGE DES SITES (30/10, Channing : « Il est important que nous ne polluons pas nos taxonomies, elles
 * doivent être parfaites »).
 * Jófogás : l'identifiant modèle du site (mo_cars), moissonné des annonces, jamais déduit d'un libellé.
 */
import { readFileSync } from 'node:fs';
import { jofogasAdapter } from '../src/lib/study-core/marketplaces/jofogas';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== JÓFOGÁS : IDENTIFIANT MODÈLE DU SITE ===\n');

const html = readFileSync(new URL('./fixtures/html/jofogas-next.html', import.meta.url), 'utf8');
const ids = jofogasAdapter.harvestTaxonomy!(html).filter((h) => h.field === 'jf:modelid:toyota');
ok(ids.length === 3 && ids.some((h) => h.code === '33' && h.label === 'RAV 4') && ids.some((h) => h.code === '49' && h.label === 'C-Hr'),
  'la moisson relève l\'identifiant modèle donné par le site (model_cars), pas un slug deviné', ids);

const before = jofogasAdapter.buildSearchUrl({ brand: 'TOYOTA', model: 'C-HR', fuel: 'HYBRIDE', yearFrom: 2020 });
ok(before.modelExpressed === false && !before.url.includes('mo_cars'), 'avant apprentissage : le C-HR reste inexprimable (page marque)', before);

jofogasAdapter.learnEnumValues!('jf:modelid:toyota', ids.map(({ code, label }) => ({ code, label })));
// Garde anti-pollution : un code qui n'a pas la forme d'un identifiant du site est ignoré.
jofogasAdapter.learnEnumValues!('jf:modelid:toyota', [{ code: 'corolla', label: 'Corolla' }]);

const chr = jofogasAdapter.buildSearchUrl({ brand: 'TOYOTA', model: 'C-HR', fuel: 'HYBRIDE', yearFrom: 2020, mileage: 90000 });
ok(chr.modelExpressed === true && chr.url.startsWith('https://auto.jofogas.hu/magyarorszag/auto/toyota/hibrid?mo_cars=49&') && chr.url.includes('me=90000'),
  'après apprentissage : C-HR hybride → /toyota/hibrid?mo_cars=49 (forme prouvée en direct le 30/10), km et années conservés', chr.url);
ok(!chr.warnings.some((w) => /modèle/i.test(w)), 'plus d\'avertissement « modèle sans slug »', chr.warnings);

const rav = jofogasAdapter.buildSearchUrl({ brand: 'TOYOTA', model: 'RAV4', fuel: 'HYBRIDE' });
ok(rav.url.includes('/toyota/rav-4-/hibrid') && !rav.url.includes('mo_cars'), 'la graine de chemin prouvée (rav-4-) garde la priorité', rav.url);

const corolla = jofogasAdapter.buildSearchUrl({ brand: 'TOYOTA', model: 'COROLLA' });
ok(corolla.modelExpressed === false && !corolla.url.includes('mo_cars'), 'le code non numérique n\'a rien appris : Corolla reste à apprendre', corolla.url);

const yc = jofogasAdapter.buildSearchUrl({ brand: 'TOYOTA', model: 'YARIS CROSS' });
ok(yc.modelExpressed === false && !yc.url.includes('mo_cars=47'), 'Yaris Cross ne prend jamais l\'identifiant de la Yaris', yc.url);

const pre = jofogasAdapter.prefillCriteriaFromUrl!('https://auto.jofogas.hu/magyarorszag/auto/toyota/hibrid?mo_cars=49&rs=2020');
ok(pre.brand === 'TOYOTA' && pre.model === 'C-HR' && pre.fuel === 'HYBRIDE' && pre.yearFrom === '2020', 'une adresse collée avec mo_cars se relit (marque, modèle, carburant, année)', pre);

jofogasAdapter.learnEnumValues!('jf:modelid:mercedes-benz', [{ code: '12', label: 'GLC' }]);
ok(jofogasAdapter.buildSearchUrl({ brand: 'MERCEDES', model: 'GLC' }).url.includes('mo_cars=12'), 'Mercedes-Benz côté site = MERCEDES côté ADA');

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);
