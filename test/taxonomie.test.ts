/**
 * LE LIVRE DE CHAQUE SITE (30/10 → 01/11, Channing : « Il est important que nous ne polluons pas nos taxonomies,
 * elles doivent être parfaites » ; « le Truth Center, c'est notre vérité »).
 * - Jófogás : l'identifiant modèle du site (mo_cars), moissonné des annonces, jamais déduit d'un libellé.
 * - Les noms du livre se comparent par clé canonique, comme partout dans ADA (générateur ET Truth Center › Lacunes).
 */
import { readFileSync } from 'node:fs';
import { jofogasAdapter } from '../src/lib/study-core/marketplaces/jofogas';
import { siteLabelKey, vocabularyMatches, bookModelLabel, readSiteBook, brandKeyAmong } from '../src/lib/linkgen/siteVocabulary';
import { getSiteAdapter as siteAdapter } from '../src/lib/study-core/marketplaces';
import { refModelKey } from '../src/services/marketData';

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

jofogasAdapter.learnEnumValues!('jf:modelid:toyota', [{ code: '29', label: 'Prius' }, { code: '30', label: 'Prius+' }]);
ok(jofogasAdapter.buildSearchUrl({ brand: 'TOYOTA', model: 'PRIUS' }).modelExpressed === false, 'libellés ambigus (Prius / Prius+ : même clé) : aucun des deux n\'est posé');
jofogasAdapter.learnEnumValues!('jf:modelid:mercedes-benz', [{ code: '12', label: 'GLC' }]);
ok(jofogasAdapter.buildSearchUrl({ brand: 'MERCEDES', model: 'GLC' }).url.includes('mo_cars=12'), 'Mercedes-Benz côté site = MERCEDES côté ADA');

console.log('\n=== NOM LU SUR LE SITE : ÉQUIVALENT OU PLUS PRÉCIS QUE LE MODÈLE (31/10) ===\n');
const same = (b: string, label: string, model: string) => siteLabelKey(b, label) === refModelKey(b, model);
ok(same('MERCEDES', 'Classe cls', 'CLS-CLASS') && same('SKODA', 'Enyaq iV', 'ENYAQ') && same('BMW', '8er', '8-SERIES') && same('TOYOTA', 'Yaris Cross Hybrid', 'YARIS CROSS'),
  'équivalents : « Classe cls » = CLS-CLASS, « Enyaq iV » = ENYAQ, « 8er » = 8-SERIES, « Yaris Cross Hybrid » = YARIS CROSS');
ok(same('MG/MG MOTOR', 'MG ZS', 'ZS') && same('MERCEDES', 'Mercedes-Benz GLS', 'GLS-CLASS') && same('TOYOTA', 'Toyota Yaris Cross', 'YARIS CROSS'),
  'la marque en tête du nom est retirée : « MG ZS » = ZS, « Mercedes-Benz GLS » = GLS-CLASS');
ok(!same('MINI', 'Countryman Cooper', 'COUNTRYMAN') && !same('MERCEDES', 'GLS 350', 'GLS-CLASS') && !same('CUPRA', 'Raval e', 'RAVAL'),
  'plus précis (une version ?) : « Countryman Cooper », « GLS 350 », « Raval e »');

console.log('\n=== LA LISTE DU SITE : LE NOM QUE LE SITE EMPLOIE DÉJÀ (31/10) ===\n');
const SK = siteAdapter('SKELBIU')!, MD = siteAdapter('MOBILE_DE')!, SBA = siteAdapter('SUBITO')!, BB = siteAdapter('BILBASEN')!, LBA = siteAdapter('LEBONCOIN')!;
const skV = [{ field: 'sk:cat', code: '2924', label: 'MG ZS' }, { field: 'sk:cat', code: '101', label: 'Toyota' }, { field: 'sk:cat', code: '3554', label: 'Toyota Yaris' }];
SK.learnEnumValues!('sk:cat', skV);
const skM = vocabularyMatches(SK, 'MG/MG MOTOR', 'ZS', skV);
ok(skM.exact.join() === 'MG ZS' && skM.versions.length === 0, 'Skelbiu : « MG ZS » est le nom du site pour MG/MG MOTOR ZS (marque en tête retirée, écrit sans deviner)', skM);
ok(vocabularyMatches(SK, 'TOYOTA', 'YARIS CROSS', skV).exact.length === 0, 'Skelbiu : « Toyota Yaris » n\'est pas la Yaris Cross');
const mdV = [{ field: 'ms:make', code: '17200', label: 'Mercedes-Benz' }, { field: 'ms:make', code: '3500', label: 'BMW' },
  { field: 'ms:model', code: '17200;268', label: 'GLS 350' }, { field: 'ms:model', code: '17200;269', label: 'GLS 400' },
  { field: 'ms:model', code: '17200;340', label: 'GLS 450' }, { field: 'ms:model', code: '3500;99', label: 'GLS 999' }];
const mdM = vocabularyMatches(MD, 'MERCEDES', 'GLS-CLASS', mdV);
ok(mdM.exact.length === 0 && [...mdM.versions].sort().join() === 'GLS 350,GLS 400,GLS 450',
  'mobile.de : le GLS n\'existe qu\'en versions (350, 400, 450) — la marque lue dans le code (17200 = Mercedes-Benz), jamais le « GLS 999 » de BMW', mdM);
const sbV = [{ field: 'sb:model:fiat', code: '1', label: '500X' }, { field: 'sb:model:fiat', code: '2', label: '500L' }, { field: 'sb:model:renault', code: '3', label: 'Clio' }];
const sbM = vocabularyMatches(SBA, 'RENAULT', '5', sbV);
ok(sbM.exact.length === 0 && sbM.versions.length === 0, 'Subito : les 500X / 500L de Fiat ne sont jamais des versions de la Renault 5 (marque lue dans le champ)', sbM);
const bbV = [{ field: 'bb:model', code: 'mini;countryman-cooper', label: 'Countryman Cooper' }, { field: 'bb:model', code: 'mini;countryman-cooper-se', label: 'Countryman Cooper SE' }, { field: 'bb:model', code: 'mini;cooper', label: 'Cooper' }];
const bbM = vocabularyMatches(BB, 'MINI', 'COUNTRYMAN', bbV);
ok(bbM.exact.length === 0 && bbM.versions.length === 2, 'Bilbasen : Countryman découpé en « Countryman Cooper », « Countryman Cooper SE »', bbM);
const lbV = [{ field: 'u_car_model', code: 'NISSAN_370Z', label: '370Z' }, { field: 'u_car_model', code: 'MAZDA_5', label: '5' }];
LBA.learnEnumValues!('u_car_model', lbV);
ok(vocabularyMatches(LBA, 'NISSAN', '370Z', lbV).exact.join() === '370Z' && vocabularyMatches(LBA, 'RENAULT', '5', lbV).exact.length === 0,
  'Leboncoin : « 370Z » pour Nissan ; le « 5 » de Mazda n\'est jamais une Renault 5');

console.log('\n=== MARQUE « X/Y » DU RÉFÉRENTIEL (01/11) ===\n');
const { analyzeIngestion: ai } = await import('../src/lib/study-core/ingestion');
const tl = (title: string) => ({ title, description: '', price: 15000, currency: 'EUR', price_type: 'one-off', year: 2021, mileage: 30000, trim: null, listing_url: `https://x/${Math.random()}`, brand: null, model: null, fuel: null });
const brandOf = (b: string, titles: string[]) => ai('https://www.skelbiu.lt/skelbimai/?category_id=2924', { brand: b, model: 'ZS' }, titles.map(tl) as never, SK).confirmations.find((c) => c.field === 'brand');
const mgOk = brandOf('MG/MG MOTOR', ['MG ZS, 2021 m.', 'MG ZS EV', 'MG ZS 1.5', 'MG ZS, elektra', 'MG ZS EV Luxury']);
ok(mgOk?.status === 'confirmed' && mgOk.matchCount === 5, 'marque « MG/MG MOTOR » : des titres « MG ZS » la prouvent (l\'une OU l\'autre écriture)', mgOk);
const motor = brandOf('MG/MG MOTOR', ['Motor 1.5 Toyota', 'Motor Opel Astra', 'Motor Audi A4', 'Motor BMW', 'MG ZS']);
ok(motor?.status === 'rejected' && motor.matchCount === 1, 'le mot générique « Motor » seul ne prouve jamais la marque MG', motor);
console.log('\n=== LE LIVRE D\'UN SITE : UN SEUL NOM À EMPLOYER (01/11) ===\n');
const GP = siteAdapter('GASPEDAAL')!;
const gpV = [{ field: 'gp:brand', code: 'skoda', label: 'Skoda' }, { field: 'gp:model:skoda', code: 'enyaq-iv', label: 'Enyaq iV' }];
GP.learnEnumValues!('gp:model:skoda', [{ code: 'enyaq-iv', label: 'Enyaq iV' }]);
ok(bookModelLabel(GP, 'SKODA', 'ENYAQ', gpV) === 'Enyaq iV', 'Gaspedaal : ENYAQ s\'écrit « Enyaq iV », le nom du livre');
ok(bookModelLabel(SK, 'MG/MG MOTOR', 'ZS', skV) === 'MG ZS', 'Skelbiu : ZS s\'écrit « MG ZS »');
ok(bookModelLabel(MD, 'MERCEDES', 'GLS-CLASS', mdV) === null, 'mobile.de : que des versions (GLS 350, 400, 450) — aucun nom choisi');
const twoNames = [...gpV, { field: 'gp:model:skoda', code: 'enyaq', label: 'Enyaq' }];
GP.learnEnumValues!('gp:model:skoda', [{ code: 'enyaq', label: 'Enyaq' }]);
ok(vocabularyMatches(GP, 'SKODA', 'ENYAQ', twoNames).exact.length === 2 && bookModelLabel(GP, 'SKODA', 'ENYAQ', twoNames) === null,
  'deux noms du livre pour la même clé (« Enyaq iV », « Enyaq ») : rien n\'est choisi au hasard');

const SBB = siteAdapter('SUBITO')!;
const sbScenic = [{ field: 'sb:model:renault', code: '009120', label: 'Scénic Electric' }];
SBB.learnEnumValues!('sb:model:renault', [{ code: '009120', label: 'Scénic Electric' }]);
ok(bookModelLabel(SBB, 'RENAULT', 'SCENIC', sbScenic) === null && bookModelLabel(SBB, 'RENAULT', 'SCENIC', sbScenic, 'DIESEL') === null,
  'Subito : « Scénic Electric » n\'est jamais employé pour un Scénic tout court ou diesel (la recherche ne garderait que les électriques)');
ok(bookModelLabel(SBB, 'RENAULT', 'SCENIC', sbScenic, 'ELECTRIQUE') === 'Scénic Electric', '… mais l\'est pour un Scénic électrique');
ok(bookModelLabel(GP, 'SKODA', 'ENYAQ', gpV, 'DIESEL') === 'Enyaq iV', '« iV » n\'est pas une motorisation lue : Enyaq iV reste le nom d\'ENYAQ');

console.log('\n=== TRUTH CENTER › LACUNES : LE LIVRE COMPARÉ PAR NOM CANONIQUE (01/11) ===\n');
const REF = ['Toyota', 'MG', 'Mercedes', 'Land Rover', 'Škoda', 'Nissan'];
const as24 = readSiteBook([
  { field: 'as:make', code: '68', label: 'Toyota' }, { field: 'as:make', code: '47', label: 'Mercedes-Benz' },
  { field: 'as:model', code: '68;2081', label: 'RAV 4' }, { field: 'as:model', code: '68;74398', label: 'C-HR' },
  { field: 'as:model', code: '47;20389', label: 'GLS' }, { field: 'as:model', code: '47;1655', label: 'Classe CLS' },
], REF);
ok(as24.models.get('TOYOTA')?.has(refModelKey('Toyota', 'RAV4')) === true && as24.models.get('TOYOTA')?.get('RAV4') === 'RAV 4',
  'AutoScout24 : « RAV 4 » du site = RAV4 du référentiel (plus jamais « manquant » pour une espace)', [...(as24.models.get('TOYOTA') ?? [])]);
ok(as24.models.get('MERCEDES')?.has(refModelKey('Mercedes', 'CLS-CLASS')) === true && as24.brands.has('MERCEDES'),
  'Mercedes-Benz du site = Mercedes du référentiel, « Classe CLS » = CLS-CLASS', [...as24.brands.keys()]);
const lbc = readSiteBook([
  { field: 'u_car_brand', code: 'MG/MG MOTOR', label: 'MG/MG MOTOR' }, { field: 'u_car_model', code: 'MG/MG MOTOR_ZS', label: 'ZS' },
  { field: 'u_car_model', code: 'NISSAN_Navara', label: 'Navara' },
], REF);
ok(lbc.brands.has('MG') && lbc.models.get('MG')?.has('ZS') === true && !lbc.brands.has('MGMGMOTOR'),
  'marque « MG/MG MOTOR » du site rangée sous MG, la clé du référentiel', [...lbc.brands.keys()]);
ok(lbc.models.get('NISSAN')?.has('NAVARA') === true && lbc.brands.has('NISSAN'), 'marque lue dans le code (NISSAN_Navara) quand le site ne la liste pas');
ok(brandKeyAmong('MG/MG MOTOR', new Set(['MG', 'TOYOTA'])) === 'MG' && brandKeyAmong('Mercedes-Benz', new Set(['MERCEDES'])) === 'MERCEDES',
  'une étude « MG/MG MOTOR » compte pour la marque MG du référentiel');
const sk = readSiteBook([
  { field: 'sk:cat', code: '101', label: 'Toyota' }, { field: 'sk:cat', code: '3554', label: 'Toyota Yaris' },
  { field: 'sk:cat', code: '2924', label: 'MG ZS' }, { field: 'sk:cat', code: '555', label: 'Land Rover' },
  { field: 'sk:cat', code: '556', label: 'Land Rover Defender' }, { field: 'sk:cat', code: '31', label: 'Automobiliai' },
], REF);
ok(sk.brands.has('TOYOTA') && sk.brands.has('LANDROVER') && sk.models.get('MG')?.get('ZS') === 'MG ZS'
  && sk.models.get('LANDROVER')?.has('DEFENDER') === true && sk.models.get('TOYOTA')?.has('YARIS') === true && !sk.brands.has('AUTOMOBILIAI'),
  'Skelbiu : la marque lue en tête du libellé (« MG ZS », « Land Rover Defender ») ; une catégorie générique n\'est ni marque ni modèle',
  { brands: [...sk.brands.keys()], models: [...sk.models].map(([b, m]) => `${b}:${[...m.keys()].join('/')}`) });
const sbBook = readSiteBook([{ field: 'sb:brand', code: '000004', label: 'RENAULT' }, ...sbScenic, { field: 'sb:model:renault', code: '1', label: 'Clio' }], [...REF, 'Renault']);
ok(!sbBook.models.get('RENAULT')?.has('SCENIC') && sbBook.models.get('RENAULT')?.has('CLIO') === true && [...(sbBook.models.get('RENAULT')?.values() ?? [])].includes('Scénic Electric'),
  'Lacunes : le Scénic reste manquant quand le livre ne connaît que « Scénic Electric » (affiché parmi les noms du site)', [...(sbBook.models.get('RENAULT') ?? [])]);
const mp = readSiteBook([{ field: 'model_facet', code: 'skoda;enyaq-iv;13881', label: 'Enyaq iV' }], REF);
ok(mp.models.get('SKODA')?.has(refModelKey('Škoda', 'ENYAQ')) === true, 'Marktplaats : « Enyaq iV » (marque dans le code) = ENYAQ du référentiel « Škoda »', [...mp.models.keys()]);

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);
