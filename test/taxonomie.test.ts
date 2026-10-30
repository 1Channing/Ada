/**
 * L'APPRENTISSAGE DES SITES (30/10, Channing : « Il est important que nous ne polluons pas nos taxonomies, elles
 * doivent être parfaites »).
 * Jófogás : l'identifiant modèle du site (mo_cars), moissonné des annonces, jamais déduit d'un libellé.
 */
import { readFileSync } from 'node:fs';
import { jofogasAdapter } from '../src/lib/study-core/marketplaces/jofogas';
import {
  diffUrls, deduceModelFragment, deduceFilterRule, applyModelFragment, applyLearnedFilters, checkNumeric, verifyValueFor,
  valueKeyOf, learningKey, ruleValueKey, lineInstruction, type LearnedRuleRow, type FilterRule, type ModelFragment,
} from '../src/lib/linkgen/learning';

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

console.log('\n=== APPRENTISSAGE : LIRE L\'ADRESSE OBTENUE ===\n');

const LBC0 = 'https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA&sort=price&order=asc';
const d0 = diffUrls(LBC0, 'https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA&u_car_model=TOYOTA_Corolla%20Cross&page=2');
ok(d0.ok && d0.changes.length === 1 && d0.changes[0].type === 'param_added', 'diff : seul le modèle compte (tri retiré et pagination ignorés)', d0.changes);

const lbc = deduceModelFragment(LBC0, 'https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA&u_car_model=TOYOTA_Corolla%20Cross&sort=price&order=asc', 'leboncoin.fr');
ok(lbc.ok && (lbc.learned as ModelFragment).op === 'param' && JSON.stringify(lbc.learned) === JSON.stringify({ op: 'param', param: 'u_car_model', value: 'TOYOTA_Corolla Cross' }),
  'Leboncoin : le modèle = le paramètre u_car_model, valeur exacte du site', lbc);
const lc = deduceModelFragment('https://www.lacentrale.fr/listing?makesModelsCommercialNames=TOYOTA&sortBy=priceAsc', 'https://www.lacentrale.fr/listing?makesModelsCommercialNames=TOYOTA%3A%3ARAV%204&sortBy=priceAsc', 'lacentrale.fr');
ok(lc.ok && JSON.stringify(lc.learned) === JSON.stringify({ op: 'param', param: 'makesModelsCommercialNames', value: 'TOYOTA::RAV 4' }), 'La Centrale : le paramètre réécrit « TOYOTA::RAV 4 »', lc);
const as = deduceModelFragment('https://www.autoscout24.fr/lst/toyota?atype=C&cy=F&sort=price', 'https://www.autoscout24.fr/lst/toyota/c-hr?atype=C&cy=F&sort=price', 'autoscout24.fr');
ok(as.ok && JSON.stringify(as.learned) === JSON.stringify({ op: 'segments', after: 'toyota', segments: ['c-hr'] }), 'AutoScout24 : un segment après la marque', as);
const sb = deduceModelFragment('https://www.subito.it/annunci-italia/vendita/auto/bmw/?order=priceasc', 'https://www.subito.it/annunci-italia/vendita/auto/bmw/serie-1/?order=priceasc', 'subito.it');
ok(sb.ok && JSON.stringify(sb.learned) === JSON.stringify({ op: 'segments', after: 'bmw', segments: ['serie-1'] }), 'Subito : le segment du modèle', sb);
const jf = deduceModelFragment('https://auto.jofogas.hu/magyarorszag/auto/toyota?rs=2000&sp=1', 'https://auto.jofogas.hu/magyarorszag/auto/toyota?mo_cars=49&rs=2000&sp=1', 'jofogas.hu');
ok(jf.ok && JSON.stringify(jf.learned) === JSON.stringify({ op: 'param', param: 'mo_cars', value: '49' }), 'Jófogás : mo_cars=49', jf);

const no = (r: { ok: boolean; reasons?: string[] }, re: RegExp, what: string) => ok(!r.ok && (r.reasons ?? []).some((x) => re.test(x)), what, r);
no(deduceModelFragment(LBC0, 'https://www.lacentrale.fr/listing?makesModelsCommercialNames=TOYOTA%3A%3ARAV%204', 'leboncoin.fr'), /n'est pas sur leboncoin\.fr/, 'refus : adresse d\'un autre site');
no(deduceModelFragment(LBC0, `${LBC0}&u_car_model=TOYOTA_C-HR&fuel=4`, 'leboncoin.fr'), /Plusieurs choses ont changé/, 'refus : Claude a touché à un autre filtre (carburant)');
no(deduceModelFragment(LBC0, `${LBC0}&u_car_model=TOYOTA_C-HR&text=gr%20sport`, 'leboncoin.fr'), /finition/, 'refus : texte libre (finition) touché');
no(deduceModelFragment(LBC0, LBC0, 'leboncoin.fr'), /Rien n'a changé/, 'refus : rien de coché');
no(deduceModelFragment('https://www.autoscout24.fr/lst/toyota?atype=C', 'https://www.autoscout24.fr/lst/lexus/ux?atype=C', 'autoscout24.fr'), /Forme non prise en charge/, 'refus : la marque a changé (chemin réécrit)');

console.log('\n=== APPRENTISSAGE : POSER LE MODÈLE APPRIS ===\n');
ok(applyModelFragment('https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA&mileage=min-90000', lbc.ok ? lbc.learned : ({} as ModelFragment))
  === 'https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA&mileage=min-90000&u_car_model=TOYOTA_Corolla%20Cross', 'Leboncoin : le modèle posé, le reste de l\'adresse intact (%20)');
ok(applyModelFragment('https://www.subito.it/annunci-italia/vendita/auto/bmw/diesel/?order=priceasc&ys=2021', { op: 'segments', after: 'bmw', segments: ['serie-1'] })
  === 'https://www.subito.it/annunci-italia/vendita/auto/bmw/serie-1/diesel/?order=priceasc&ys=2021', 'Subito : le modèle s\'insère entre la marque et le carburant');
ok(applyModelFragment('https://www.subito.it/annunci-italia/vendita/auto/bmw/serie-1/?x=1', { op: 'segments', after: 'bmw', segments: ['serie-1'] }) === 'https://www.subito.it/annunci-italia/vendita/auto/bmw/serie-1/?x=1', 'déjà posé : rien ne double');
ok(applyModelFragment('https://www.autoscout24.fr/lst/lexus?x=1', { op: 'segments', after: 'toyota', segments: ['c-hr'] }) === null, 'marque introuvable dans l\'adresse : rien n\'est posé (null)');

console.log('\n=== APPRENTISSAGE : LES FILTRES ===\n');
const BRAND = 'https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA';
const r1 = deduceFilterRule('mileageMin', '20000', BRAND, `${BRAND}&mileage=20000-max`, 'leboncoin.fr');
ok(r1.ok && JSON.stringify(r1.learned) === JSON.stringify({ encoding: 'range', param: 'mileage', side: 'min', sep: '-', openMin: '', openMax: 'max' }), 'Leboncoin km min : plage « 20000-max » (borne ouverte « max » vue sur le site)', r1);
const r2 = deduceFilterRule('mileageMin', '20 000', 'https://www.autoscout24.fr/lst/toyota?atype=C', 'https://www.autoscout24.fr/lst/toyota?atype=C&kmfrom=20000', 'autoscout24.fr');
ok(r2.ok && JSON.stringify(r2.learned) === JSON.stringify({ encoding: 'param', param: 'kmfrom' }), 'km min en valeur nue (kmfrom=20000)', r2);
const r3 = deduceFilterRule('mileageMin', '20000', 'https://www.marktplaats.nl/l/auto-s/toyota/#constructionYearFrom:2020', 'https://www.marktplaats.nl/l/auto-s/toyota/#constructionYearFrom:2020|mileageFrom:20000', 'marktplaats.nl');
ok(r3.ok && JSON.stringify(r3.learned) === JSON.stringify({ encoding: 'hash', key: 'mileageFrom' }), 'Marktplaats : clé d\'ancre mileageFrom', r3);
const r4 = deduceFilterRule('mileageMin', '20000', 'https://www.subito.it/annunci-italia/vendita/auto/bmw/', 'https://www.subito.it/annunci-italia/vendita/auto/bmw/?ms=12', 'subito.it');
ok(r4.ok && JSON.stringify(r4.learned) === JSON.stringify({ encoding: 'code', param: 'ms', code: '12' }), 'liste du site : un code pour CETTE valeur (ms=12)', r4);
const r5 = deduceFilterRule('powerFrom', '150', 'https://www.autoscout24.fr/lst/toyota?atype=C', 'https://www.autoscout24.fr/lst/toyota?atype=C&powerfrom=110', 'autoscout24.fr');
ok(r5.ok && JSON.stringify(r5.learned) === JSON.stringify({ encoding: 'param', param: 'powerfrom', unit: 'kw' }), 'puissance : l\'unité du site (kW) reconnue d\'elle-même', r5);
const r6 = deduceFilterRule('fuel', 'HYBRIDE', 'https://auto.jofogas.hu/magyarorszag/auto/toyota?rs=2000', 'https://auto.jofogas.hu/magyarorszag/auto/toyota/hibrid?rs=2000', 'jofogas.hu');
ok(r6.ok && JSON.stringify(r6.learned) === JSON.stringify({ encoding: 'segment', segment: 'hibrid' }), 'carburant en segment de chemin (/hibrid)', r6);
const r7 = deduceFilterRule('fuel', 'HYBRIDE', BRAND, `${BRAND}&fuel=4`, 'leboncoin.fr');
ok(r7.ok && JSON.stringify(r7.learned) === JSON.stringify({ encoding: 'code', param: 'fuel', code: '4' }), 'carburant en code (fuel=4)', r7);
no(deduceFilterRule('mileageMin', '20000', BRAND, `${BRAND}&mileage=20000-max&regdate=2020-max`, 'leboncoin.fr'), /Plusieurs choses ont changé/, 'refus : deux filtres réglés au lieu d\'un');
no(deduceFilterRule('mileageMin', '20000', BRAND, `${BRAND}&mileage=30000-max`, 'leboncoin.fr'), /Valeur illisible|non prise en charge/, 'refus : la valeur réglée n\'est pas celle demandée');
no(deduceFilterRule('mileageMin', '20000', 'https://www.autoscout24.fr/lst/toyota?atype=C', 'https://www.autoscout24.fr/lst/toyota?atype=C&kmfrom=30000', 'autoscout24.fr'), /différente de la valeur demandée/, 'refus : 30 000 réglés pour 20 000 demandés (jamais pris pour un code)');
ok(ruleValueKey('mileageMin', { encoding: 'param', param: 'kmfrom' }, '20000') === '*' && ruleValueKey('mileageMin', { encoding: 'code', param: 'ms', code: '12' }, '20000') === '20000', 'une forme générale vaut pour toutes les valeurs, un code pour la sienne');

const rule = (criterion: string, value_key: string, r: FilterRule): LearnedRuleRow => ({ id: `${criterion}-${value_key}`, site: 'X', kind: 'filtre', brand_key: '', model_key: '', criterion, value_key, rule: r, status: 'active' });
const kmMinLbc = rule('mileageMin', '*', { encoding: 'range', param: 'mileage', side: 'min', sep: '-', openMin: '', openMax: 'max' });
const NONE = new Set<string>(['km min']);
let a = applyLearnedFilters(`${BRAND}&mileage=min-90000`, { brand: 'TOYOTA', model: '', mileage: 90000, mileageMin: 20000 }, [kmMinLbc], NONE);
ok(a.url === `${BRAND}&mileage=20000-90000` && a.applied.includes('mileageMin'), 'km min appris + km max codé : « 20000-90000 »', a.url);
a = applyLearnedFilters(BRAND, { brand: 'TOYOTA', model: '', mileageMin: 20000 }, [kmMinLbc], NONE);
ok(a.url === `${BRAND}&mileage=20000-max`, 'km min seul : « 20000-max »', a.url);
a = applyLearnedFilters(`${BRAND}&mileage=min-90000`, { brand: 'TOYOTA', model: '', mileage: 90000 }, [kmMinLbc], NONE);
ok(a.url === `${BRAND}&mileage=min-90000`, 'sans km min : la plage du registre n\'est pas touchée', a.url);
a = applyLearnedFilters(`${BRAND}&mileage=20000-max`, { brand: 'TOYOTA', model: '' }, [kmMinLbc], NONE);
ok(a.url === BRAND, 'sans km min ni max : un km min hérité est retiré (anti-fossile)', a.url);
a = applyLearnedFilters('https://www.lacentrale.fr/listing?makesModelsCommercialNames=TOYOTA&mileageMin=20000', { brand: 'TOYOTA', model: '', mileageMin: 20000 }, [rule('mileageMin', '*', { encoding: 'param', param: 'kmMinBidon' })], new Set());
ok(!a.url.includes('kmMinBidon') && a.applied.length === 0, 'priorité au code : La Centrale écrit déjà mileageMin, la règle apprise ne touche à rien', a.url);

const SB = 'https://www.subito.it/annunci-italia/vendita/auto/bmw/';
const codes = [rule('mileageMin', '10000', { encoding: 'code', param: 'ms', code: '11' }), rule('mileageMin', '20000', { encoding: 'code', param: 'ms', code: '12' })];
a = applyLearnedFilters(SB, { brand: 'BMW', model: '', mileageMin: 25000 }, codes, NONE);
ok(a.url === `${SB}?ms=12`, 'liste du site : 25 000 demandé → 20 000 (en dessous : la recherche n\'est jamais rétrécie)', a.url);
a = applyLearnedFilters(SB, { brand: 'BMW', model: '', mileageMin: 5000 }, codes, NONE);
ok(a.url === SB && a.gaps.length === 1 && a.gaps[0].criterion === 'mileageMin' && a.gaps[0].valueKey === '5000', 'valeur absente de la liste apprise : une lacune pour CETTE valeur', a.gaps);
const fuelRules = [rule('fuel', 'hybrid', { encoding: 'code', param: 'fuel', code: '4' })];
a = applyLearnedFilters(BRAND, { brand: 'TOYOTA', model: '', fuel: 'HYBRIDE' }, fuelRules, new Set(['carburant']));
ok(a.url === `${BRAND}&fuel=4`, 'carburant appris posé', a.url);
a = applyLearnedFilters(BRAND, { brand: 'TOYOTA', model: '', fuel: 'DIESEL' }, fuelRules, new Set(['carburant']));
ok(a.gaps.length === 1 && a.gaps[0].valueKey === 'diesel', 'carburant non appris : lacune « diesel »', a.gaps);
a = applyLearnedFilters(`${BRAND}&fuel=4`, { brand: 'TOYOTA', model: '' }, fuelRules, new Set());
ok(a.url === BRAND, 'carburant non demandé : le code appris est retiré', a.url);
const JF = 'https://auto.jofogas.hu/magyarorszag/auto/toyota?rs=2000';
const seg = [rule('fuel', 'hybrid', { encoding: 'segment', segment: 'hibrid' })];
a = applyLearnedFilters(JF, { brand: 'TOYOTA', model: '', fuel: 'Hybride' }, seg, new Set(['carburant']));
ok(a.url === 'https://auto.jofogas.hu/magyarorszag/auto/toyota/hibrid?rs=2000', 'segment appris posé en fin de chemin', a.url);
a = applyLearnedFilters('https://auto.jofogas.hu/magyarorszag/auto/toyota/hibrid?rs=2000', { brand: 'TOYOTA', model: '' }, seg, new Set());
ok(a.url === JF, 'segment appris retiré quand le carburant n\'est pas demandé', a.url);
a = applyLearnedFilters(BRAND, { brand: 'TOYOTA', model: '', mileageMin: 30000 }, [], NONE);
ok(a.gaps.length === 1 && a.gaps[0].valueKey === '*' && a.gaps[0].value === '30000', 'rien d\'appris : lacune de forme (« * ») avec la valeur à demander', a.gaps);

console.log('\n=== APPRENTISSAGE : CONTRÔLE, CLÉS, CONSIGNES ===\n');
ok(checkNumeric('mileageMin', '20000', [{ mileage: 25000 }, { mileage: 30000 }, { mileage: 19800 }, { mileage: 50000 }]).verdict === 'ok', 'contrôle km min : conformes (tolérance d\'arrondi de 2 %)');
ok(checkNumeric('mileageMin', '20000', [{ mileage: 5000 }, { mileage: 8000 }, { mileage: 30000 }, { mileage: 9000 }]).verdict === 'echec', 'contrôle km min : trop d\'annonces sous la borne → échec');
ok(checkNumeric('mileageMin', '20000', [{ mileage: 25000 }, { mileage: null }]).verdict === 'humain', 'moins de 3 annonces renseignées → à vous de juger');
ok(verifyValueFor('mileageMin', '20000') === '40000' && verifyValueFor('mileageMax', '90000') === '63000' && verifyValueFor('yearFrom', '2021') === '2020' && verifyValueFor('fuel', 'HYBRIDE') === 'HYBRIDE', 'vérification : une autre valeur que celle de Claude');
ok(valueKeyOf('fuel', 'HYBRIDE') === 'hybrid' && valueKeyOf('fuel', 'Hybride rechargeable') === 'phev' && valueKeyOf('mileageMin', '20 000') === '20000', 'clés de valeur : jetons canoniques d\'ADA');
ok(learningKey('modele', 'SUBITO', { brandKey: 'BMW', modelKey: 'SERIE1' }) === 'modele|SUBITO|BMW|SERIE1' && learningKey('filtre', 'SUBITO', { criterion: 'mileageMin' }) === 'filtre|SUBITO|mileageMin|*', 'clés de la file');
ok(/kilométrage minimum sur 20\u202f000 km/.test(lineInstruction({ kind: 'filtre', brand: 'TOYOTA', model: '', criterion: 'mileageMin', value: '20000' })), 'consigne de ligne : la valeur en clair', lineInstruction({ kind: 'filtre', brand: 'TOYOTA', model: '', criterion: 'mileageMin', value: '20000' }));

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);
