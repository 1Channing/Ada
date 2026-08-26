/**
 * TEST DE MATRICE AU GATE — le garde-fou du REGISTRE UNIQUE des grammaires.
 *
 * Lancé par `npm run gate` (avant le build). HORS-LIGNE : adaptateurs +
 * registre seulement, dictionnaires amorcés par les graines PROUVÉES
 * ci-dessous — jamais de réseau ni de base.
 *
 * Trois vérifications :
 *  1. VOIE NATIVE — chaque adaptateur exprime dans son URL chaque critère
 *     que la matrice attendue déclare (elle est le SNAPSHOT des grammaires
 *     prouvées : toute régression d'un adaptateur casse le gate).
 *  2. VOIE MÉMOIRE — applyVariableCriteria pose chaque critère prouvé sur
 *     une URL apprise nue, et RETIRE chaque fossile hérité quand le critère
 *     est absent (règle des variables, anti-fossile).
 *  3. UNITÉS & FORMES — conversions ch→kW, mil suédois ÷10, enum me= Subito,
 *     formes composites (fr=min:max, ml=:max, regdate a-b/a-max).
 *
 * Une case attendue qui devient fausse = un critère qui a cessé d'être
 * exprimé = le bug silencieux qu'on a payé deux fois (bmax fossile Gaspedaal
 * 25/08, regdate perdu Leboncoin 26/08). Le gate hurle à la place du marché.
 */

import { allSiteAdapters } from '../src/lib/study-core/marketplaces/index';
import { applyVariableCriteria, injectTrimIntoUrl } from '../src/lib/linkgen/grammar';
import type { LinkGenParams } from '../src/lib/linkgen/types';

let fails = 0;
const fail = (msg: string) => { fails++; console.error(`✗ ${msg}`); };

// ─── Graines PROUVÉES (URLs humaines) pour bâtir les URLs natives hors-ligne ─
const adapters = allSiteAdapters();
const byKey = new Map(adapters.map((a) => [a.key, a]));
// mobile.de : ms=24100;28 = Toyota RAV4 (URL humaine 26/08).
byKey.get('MOBILE_DE')?.learnEnumValues?.('ms:model', [{ code: '24100;28', label: 'RAV4' }]);

// ─── Critères de référence (modèle connu, tout prouvé quelque part) ─────────
const FULL: LinkGenParams = {
  brand: 'TOYOTA', model: 'RAV4', fuel: 'HYBRIDE',
  yearFrom: '2022', yearTo: '2024', mileage: 90000,
  minPower: 150, trim: 'GR Sport', gearbox: 'AUTOMATIQUE',
};
const EMPTY: LinkGenParams = { brand: 'TOYOTA', model: 'RAV4' };

// ─── Détecteurs par famille de critère (toutes grammaires prouvées) ─────────
const DET: Record<string, RegExp> = {
  année: /regdate=|fregfrom=|bmin=|regfrom=|[?&]fr=|year_from=|constructionYearFrom|[?&]ys=|[?&]rs=|year_min=[^&]/i,
  km: /mileage=min|kmto=|kmax=|mileageto=|[?&]ml=|mileage_to=|mileageTo|[?&]me=|mileage_max=[^&]/i,
  puissance: /powerfrom=|hpfrom=|[?&]pw=|vmin=|engine_effect_from=|power_min=[^&]|[?&]hps=/i,
  boîte: /[?&]gear=|[?&]tr=|trns=|transmission=|[?&]gr=|534/i,
  finition: /text=|kwd=|trefw=|free=|\/q\/|[?&#]q[:=]|keywords=[^&]|%3B%3B|;;/i,
  carburant: /fuel=|fuel%5B%5D=[^&]|[?&]ft=|[?&]fe=|13838|473|\/hybride|\/elektr|\/ibrida|\/benzina|\/hibrid|\/dizel|\/elektromos|\/benzin\b/i,
};
type Crit = keyof typeof DET;
const CRITS = Object.keys(DET) as Crit[];

// ─── 1. MATRICE NATIVE ATTENDUE (snapshot des grammaires prouvées) ──────────
// true = le critère DOIT être exprimé dans l'URL native. Une case ne passe à
// true qu'avec une PREUVE (URL humaine / constat live) ; elle ne repasse à
// false qu'en retirant sciemment la grammaire du registre ET d'ici.
const EXPECTED_NATIVE: Record<string, Record<Crit, boolean>> = {
  AUTOSCOUT_FR: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  AUTOSCOUT_DE: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  AUTOSCOUT_NL: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  AUTOSCOUT_IT: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  AUTOSCOUT_ES: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  AUTOSCOUT_BE: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  // Leboncoin : puissance/boîte sans grammaire prouvée (backlog preuves).
  LEBONCOIN: { année: true, km: true, puissance: false, boîte: false, finition: true, carburant: true },
  MOBILE_DE: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  // Marktplaats : année/km/boîte dans le hash natif, carburant/modèle en
  // facettes ; puissance sans preuve.
  MARKTPLAATS: { année: true, km: true, puissance: false, boîte: true, finition: true, carburant: true },
  BILBASEN: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  GASPEDAAL: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  BLOCKET: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  // Skelbiu : boîte sans preuve (le formulaire en a une, jamais prouvée en URL).
  SKELBIU: { année: true, km: true, puissance: true, boîte: false, finition: true, carburant: true },
  SUBITO: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
  // Jófogás : puissance/boîte sans preuve.
  JOFOGAS: { année: true, km: true, puissance: false, boîte: false, finition: true, carburant: true },
};

console.log('=== 1. VOIE NATIVE (matrice attendue vs URL construite) ===');
for (const a of adapters) {
  const expected = EXPECTED_NATIVE[a.key];
  if (!expected) { fail(`${a.key}: absent de la matrice attendue — ajouter sa ligne (avec preuves)`); continue; }
  const { url } = a.buildSearchUrl(FULL as never);
  if (!url) { fail(`${a.key}: URL native vide pour le combo de référence`); continue; }
  for (const c of CRITS) {
    const got = DET[c].test(url);
    if (expected[c] && !got) fail(`${a.key}: critère « ${c} » attendu mais ABSENT de l'URL native\n    ${url}`);
    if (!expected[c] && got) fail(`${a.key}: critère « ${c} » exprimé sans preuve au registre — mettre la matrice à jour si une preuve existe\n    ${url}`);
  }
}

// ─── 2. VOIE MÉMOIRE : pose sur URL nue + purge des fossiles ────────────────
// bare : URL apprise minimale (le pire cas réel). fossil : URL chargée des
// paramètres d'une AUTRE étude — tout doit sauter avec des critères vides.
const MEMORY_CASES: Array<{
  site: string; bare: string; fossil: string;
  wantPosed: Array<[Crit, RegExp]>; wantGone: RegExp[]; wantKept?: RegExp[];
}> = [
  {
    site: 'AUTOSCOUT',
    bare: 'https://www.autoscout24.fr/lst/toyota/rav4?atype=C&cy=F',
    fossil: 'https://www.autoscout24.fr/lst/toyota/rav4/re_2021?atype=C&cy=F&fregfrom=2021&fregto=2021&kmto=50000&powerfrom=99&powertype=hp&gear=M',
    wantPosed: [
      ['année', /fregfrom=2022&?/], ['année', /fregto=2024/], ['km', /kmto=90000/],
      // 150 ch → 110 kW (floor) + powertype=kw — unité prouvée live 18/08.
      ['puissance', /powerfrom=110/], ['puissance', /powertype=kw/],
      ['boîte', /gear=A(&|$)/], ['finition', /kwd=GR%20Sport/],
    ],
    wantGone: [/re_2021/, /fregfrom/, /fregto/, /kmto/, /powerfrom/, /powertype/, /gear=/],
  },
  {
    site: 'LEBONCOIN',
    bare: 'https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA&u_car_model=TOYOTA_Rav4,RAV4',
    fossil: 'https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA&u_car_model=TOYOTA_Rav4,RAV4&regdate=2019-2019&mileage=min-50000&u_car_finition=TOYOTA_Rav4_Gr&text=vieux',
    wantPosed: [
      ['année', /regdate=2022-2024/], ['km', /mileage=min-90000/], ['finition', /text=GR%20Sport/],
    ],
    wantGone: [/regdate/, /mileage=/, /u_car_finition/, /text=/],
    // La liste à virgules du modèle doit survivre OCTET PAR OCTET.
    wantKept: [/u_car_model=TOYOTA_Rav4,RAV4/],
  },
  {
    site: 'BILBASEN',
    bare: 'https://www.bilbasen.dk/brugt/bil/toyota/rav4?includeengroscvr=true',
    fossil: 'https://www.bilbasen.dk/brugt/bil/toyota/rav4?yearfrom=2019&yearto=2020&regfrom=2019-01&regto=2020-12&mileageto=10000&hpfrom=999&gear=automatic',
    wantPosed: [
      ['année', /regfrom=2022-01/], ['année', /regto=2024-12/], ['km', /mileageto=90000/],
      ['puissance', /hpfrom=150/], ['boîte', /gear=automatic/], ['finition', /free=GR%20Sport/],
    ],
    wantGone: [/yearfrom/, /yearto/, /regfrom/, /regto/, /mileageto/, /hpfrom/, /gear=/],
  },
  {
    site: 'MOBILE_DE',
    bare: 'https://www.mobile.de/fr/voiture/recherche.html?isSearchRequest=true&ms=24100%3B28&sb=p',
    fossil: 'https://www.mobile.de/fr/voiture/recherche.html?isSearchRequest=true&ms=24100%3B28&fr=2019%3A2020&ml=%3A50000&pw=200&tr=AUTOMATIC_GEAR',
    wantPosed: [
      ['année', /fr=2022%3A2024/], ['km', /ml=%3A90000/], ['puissance', /pw=110/],
      ['boîte', /tr=AUTOMATIC_GEAR/], ['finition', /ms=24100%3B28%3B%3BGR%20Sport/],
    ],
    wantGone: [/[?&]fr=/, /[?&]ml=/, /[?&]pw=/, /[?&]tr=/],
    // Politique dam=false posée sur les DEUX profils (critères pleins ou vides).
    wantKept: [/dam=false/],
  },
  {
    site: 'GASPEDAAL',
    bare: 'https://www.gaspedaal.nl/toyota/rav4/hybride?srt=pr-a',
    fossil: 'https://www.gaspedaal.nl/toyota/rav4/hybride?srt=pr-a&bmin=2019&bmax=2020&kmax=10000&vmin=999&trns=AUTOMATISCH',
    wantPosed: [
      ['année', /bmin=2022/], ['année', /bmax=2024/], ['km', /kmax=90000/],
      ['puissance', /vmin=150/], ['boîte', /trns=AUTOMATISCH/], ['finition', /trefw=GR%20Sport/],
    ],
    wantGone: [/bmin/, /bmax/, /kmax/, /vmin/, /trns/],
  },
  {
    site: 'BLOCKET',
    bare: 'https://www.blocket.se/mobility/search/car?variant=1.19.219',
    fossil: 'https://www.blocket.se/mobility/search/car?variant=1.19.219&year_from=2019&year_to=2020&mileage_to=1000&engine_effect_from=999&transmission=2',
    wantPosed: [
      ['année', /year_from=2022/], ['année', /year_to=2024/],
      // MIL SUÉDOIS : 90 000 km → 9 000 mil.
      ['km', /mileage_to=9000(&|$)/],
      ['puissance', /engine_effect_from=150/], ['boîte', /transmission=2/], ['finition', /q=GR%20Sport/],
    ],
    wantGone: [/year_from/, /year_to/, /mileage_to/, /engine_effect_from/, /transmission/],
  },
  {
    site: 'SKELBIU',
    bare: 'https://www.skelbiu.lt/skelbimai/?category_id=21575&search=1',
    fossil: 'https://www.skelbiu.lt/skelbimai/?category_id=21575&search=1&year_min=2019&year_max=2020&mileage_max=10000&power_min=999&keywords=vieux',
    wantPosed: [
      ['année', /year_min=2022/], ['année', /year_max=2024/], ['km', /mileage_max=90000/],
      // 150 ch → 110 kW (libellé « puissance kW » du formulaire, URL 26/08).
      ['puissance', /power_min=110/], ['finition', /keywords=GR%20Sport/],
    ],
    // Style FORMULAIRE : les champs restent posés VIDES, jamais supprimés.
    wantGone: [/year_min=\d/, /year_max=\d/, /mileage_max=\d/, /power_min=\d/],
    wantKept: [/year_min=/, /power_min=/],
  },
  {
    site: 'SUBITO',
    bare: 'https://www.subito.it/annunci-italia/vendita/auto/toyota/ibrida/?order=priceasc',
    fossil: 'https://www.subito.it/annunci-italia/vendita/auto/toyota/ibrida/?order=priceasc&ys=2019&ye=2020&me=18&hps=999&gr=2',
    wantPosed: [
      ['année', /ys=2022/], ['année', /ye=2024/],
      // me=18 ⇔ 90 000 km : SEUL palier enum prouvé.
      ['km', /me=18(&|$)/],
      ['puissance', /hps=150/], ['boîte', /gr=2(&|$)/], ['finition', /q=gr%20sport/],
    ],
    wantGone: [/[?&]ys=/, /[?&]ye=/, /[?&]me=/, /[?&]hps=/, /[?&]gr=/],
  },
  {
    site: 'JOFOGAS',
    bare: 'https://auto.jofogas.hu/magyarorszag/auto/toyota/rav-4-/hibrid?sp=1',
    fossil: 'https://auto.jofogas.hu/magyarorszag/auto/toyota/rav-4-/hibrid?sp=1&rs=2019&re=2020&me=50000',
    wantPosed: [
      ['année', /rs=2022/], ['année', /re=2024/], ['km', /me=90000/], ['finition', /q=gr%20sport/],
    ],
    // rs TOUJOURS posé (le site bloque sans lui) — repli large 2000.
    wantGone: [/re=/, /me=/],
    wantKept: [/rs=2000/],
  },
  {
    site: 'MARKTPLAATS (finition = chemin /q/)',
    bare: 'https://www.marktplaats.nl/l/auto-s/toyota/f/rav4/1234/#sortBy:PRICE',
    fossil: 'https://www.marktplaats.nl/l/auto-s/toyota/f/rav4/1234/#sortBy:PRICE',
    wantPosed: [['finition', /\/q\/gr\+sport\//]],
    wantGone: [],
  },
];

console.log('=== 2. VOIE MÉMOIRE (pose sur URL nue + purge des fossiles) ===');
for (const tc of MEMORY_CASES) {
  let posed = applyVariableCriteria(tc.bare, FULL);
  posed = injectTrimIntoUrl(posed, String(FULL.trim));
  for (const [crit, re] of tc.wantPosed) {
    if (!re.test(posed)) fail(`${tc.site}: « ${crit} » non posé (attendu ${re})\n    ${posed}`);
  }
  const purged = applyVariableCriteria(tc.fossil, EMPTY);
  for (const re of tc.wantGone) {
    if (re.test(purged)) fail(`${tc.site}: fossile survivant (${re})\n    ${purged}`);
  }
  for (const re of tc.wantKept ?? []) {
    if (!re.test(posed) && !re.test(purged)) fail(`${tc.site}: invariant perdu (${re})\n    posé: ${posed}\n    purgé: ${purged}`);
  }
}

// ─── 3. Idempotence : le registre repassé sur sa propre sortie ne change rien ─
console.log('=== 3. IDEMPOTENCE ===');
for (const tc of MEMORY_CASES) {
  const once = applyVariableCriteria(tc.bare, FULL);
  const twice = applyVariableCriteria(once, FULL);
  if (once !== twice) fail(`${tc.site}: applyVariableCriteria non idempotente\n    1×: ${once}\n    2×: ${twice}`);
}

if (fails > 0) {
  console.error(`\nGRAMMAR GATE : ${fails} ÉCHEC(S) — une grammaire prouvée a cessé d'être exprimée.`);
  process.exit(1);
}
console.log('\nGRAMMAR GATE : matrice complète, fossiles purgés, unités exactes — TOUT EST BON');
