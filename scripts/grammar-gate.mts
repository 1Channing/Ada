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
import { applyVariableCriteria, injectTrimIntoUrl, CRITERIA_DETECTORS, missingUrlCriteria } from '../src/lib/linkgen/grammar';
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

// ─── Détecteurs par famille de critère — SOURCE UNIQUE : le registre ────────
const DET = CRITERIA_DETECTORS;
type Crit = string;
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
  // La Centrale : grammaire ENTIÈRE prouvée d'un bloc (corpus d'URLs-preuves
  // Channing 29/08 — yearMin/yearMax, mileageMax, powerDINMin, gearbox=AUTO|
  // MANUAL, energies=, versions=).
  LACENTRALE: { année: true, km: true, puissance: true, boîte: true, finition: true, carburant: true },
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
    fossil: 'https://www.autoscout24.fr/lst/toyota/rav4/bt_berline/re_2021?atype=C&cy=F&fregfrom=2021&fregto=2021&kmto=50000&powerfrom=99&powertype=hp&gear=M&fuel=D&body=6',
    wantPosed: [
      ['année', /fregfrom=2022&?/], ['année', /fregto=2024/], ['km', /kmto=90000/],
      // 150 ch → 110 kW (floor) + powertype=kw — unité prouvée live 18/08.
      ['puissance', /powerfrom=110/], ['puissance', /powertype=kw/],
      ['boîte', /gear=A(&|$)/], ['finition', /kwd=GR%20Sport/],
      // fuel=2 (HYBRIDE, table fixe vérifiée) — dossier Yaris Cross 26/08 :
      // les URLs apprises perdaient le carburant.
      ['carburant', /fuel=2(&|$)/],
    ],
    wantGone: [/re_2021/, /fregfrom/, /fregto/, /kmto/, /powerfrom/, /powertype/, /gear=/, /fuel=/, /\/bt_/, /[?&]body=/],
  },
  {
    site: 'LEBONCOIN',
    bare: 'https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA&u_car_model=TOYOTA_Rav4,RAV4',
    fossil: 'https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA&u_car_model=TOYOTA_Rav4,RAV4&regdate=2019-2019&mileage=min-50000&u_car_finition=TOYOTA_Rav4_Gr&text=vieux&gearbox=1&horse_power_din=99&fuel=2&vehicle_type=berline',
    wantPosed: [
      ['année', /regdate=2022-2024/], ['km', /mileage=min-90000/], ['finition', /text=GR%20Sport/],
      // gearbox=2 (Automatique) — enum humain confirmé en base + URL humaine
      // en mémoire (constat Ignis 27/08 : savoir par ligne → registre).
      ['boîte', /gearbox=2(&|$)/],
      // horse_power_din=N-max — la FORME vient des 12 lignes mémoire
      // humaines (constat Elroq 29/08 : la valeur nue était lue min=max).
      ['puissance', /horse_power_din=150-max(&|$)/],
      // fuel=6 (HYBRIDE) prouvé par URL humaine — inventaire 27/08.
      ['carburant', /fuel=6(&|$)/],
    ],
    wantGone: [/regdate/, /mileage=/, /u_car_finition/, /text=/, /gearbox=/, /horse_power_din/, /fuel=/, /vehicle_type/],
    // Liste à virgules du modèle → UN membre (05/09 : LBC rend total=0 dès
    // qu'un membre est invalide) — le membre préfixé MARQUE_ survit, en place.
    wantKept: [/u_car_model=TOYOTA_Rav4(&|$)/],
  },
  {
    site: 'BILBASEN',
    bare: 'https://www.bilbasen.dk/brugt/bil/toyota/rav4?includeengroscvr=true',
    fossil: 'https://www.bilbasen.dk/brugt/bil/toyota/rav4?yearfrom=2019&yearto=2020&regfrom=2019-01&regto=2020-12&mileageto=10000&hpfrom=999&gear=automatic&fuel=1&cartype=sedan&cartype=suv',
    wantPosed: [
      ['année', /regfrom=2022-01/], ['année', /regto=2024-12/], ['km', /mileageto=90000/],
      ['puissance', /hpfrom=150/], ['boîte', /gear=automatic/], ['finition', /free=GR%20Sport/],
      // fuel=6 (HYBRIDE) — codes 1/2/3/6 prouvés 26/08, promus voie mémoire.
      ['carburant', /fuel=6(&|$)/],
    ],
    wantGone: [/yearfrom/, /yearto/, /regfrom/, /regto/, /mileageto/, /hpfrom/, /gear=/, /fuel=/, /cartype=/],
  },
  {
    site: 'MOBILE_DE',
    bare: 'https://www.mobile.de/fr/voiture/recherche.html?isSearchRequest=true&ms=24100%3B28&sb=p',
    fossil: 'https://www.mobile.de/fr/voiture/recherche.html?isSearchRequest=true&ms=24100%3B28&fr=2019%3A2020&ml=%3A50000&pw=200&tr=AUTOMATIC_GEAR&c=Cabrio&c=OffRoad',
    wantPosed: [
      ['année', /fr=2022%3A2024/], ['km', /ml=%3A90000/], ['puissance', /pw=110/],
      ['boîte', /tr=AUTOMATIC_GEAR/], ['finition', /ms=24100%3B28%3B%3BGR%20Sport/],
    ],
    wantGone: [/[?&]fr=/, /[?&]ml=/, /[?&]pw=/, /[?&]tr=/, /[?&]c=/],
    // Politique dam=false posée sur les DEUX profils (critères pleins ou vides).
    wantKept: [/dam=false/],
  },
  {
    site: 'GASPEDAAL',
    bare: 'https://www.gaspedaal.nl/toyota/rav4?srt=pr-a',
    fossil: 'https://www.gaspedaal.nl/toyota/rav4/hybride/cabriolet?srt=pr-a&bmin=2019&bmax=2020&kmax=10000&vmin=999&trns=AUTOMATISCH&crs=SEDAN',
    wantPosed: [
      ['année', /bmin=2022/], ['année', /bmax=2024/], ['km', /kmax=90000/],
      ['puissance', /vmin=150/], ['boîte', /trns=AUTOMATISCH/], ['finition', /trefw=GR%20Sport/],
      // Segment de chemin /hybride posé sur URL apprise nue (slug prouvé
      // 01/08 ; PHEV → famille hybride, pas de catégorie rechargeable —
      // Channing 27/08).
      ['carburant', /\/rav4\/hybride(\?|$)/],
    ],
    wantGone: [/bmin/, /bmax/, /kmax/, /vmin/, /trns/, /\/hybride/, /\/cabriolet/, /crs=/],
  },
  {
    site: 'BLOCKET',
    bare: 'https://www.blocket.se/mobility/search/car?variant=1.19.219',
    fossil: 'https://www.blocket.se/mobility/search/car?variant=1.19.219&year_from=2019&year_to=2020&mileage_to=1000&engine_effect_from=999&transmission=2&body_type=9&body_type=3',
    wantPosed: [
      ['année', /year_from=2022/], ['année', /year_to=2024/],
      // MIL SUÉDOIS : 90 000 km → 9 000 mil.
      ['km', /mileage_to=9000(&|$)/],
      ['puissance', /engine_effect_from=150/], ['boîte', /transmission=2/], ['finition', /q=GR%20Sport/],
    ],
    wantGone: [/year_from/, /year_to/, /mileage_to/, /engine_effect_from/, /transmission/, /body_type=/],
  },
  {
    site: 'SKELBIU',
    bare: 'https://www.skelbiu.lt/skelbimai/?category_id=21575&search=1',
    fossil: 'https://www.skelbiu.lt/skelbimai/?category_id=21575&search=1&year_min=2019&year_max=2020&mileage_max=10000&power_min=999&keywords=vieux&body%5B%5D=5',
    wantPosed: [
      ['année', /year_min=2022/], ['année', /year_max=2024/], ['km', /mileage_max=90000/],
      // 150 ch → 110 kW (libellé « puissance kW » du formulaire, URL 26/08).
      ['puissance', /power_min=110/], ['finition', /keywords=GR%20Sport/],
    ],
    // Style FORMULAIRE : les champs restent posés VIDES, jamais supprimés —
    // SAUF body[] que le formulaire du site n'envoie que coché (retiré sec).
    wantGone: [/year_min=\d/, /year_max=\d/, /mileage_max=\d/, /power_min=\d/, /body(?:%5B%5D|\[\])=/],
    wantKept: [/year_min=/, /power_min=/],
  },
  {
    site: 'SUBITO',
    bare: 'https://www.subito.it/annunci-italia/vendita/auto/toyota/ibrida/?order=priceasc',
    fossil: 'https://www.subito.it/annunci-italia/vendita/auto/toyota/ibrida/berlina/?order=priceasc&ys=2019&ye=2020&me=18&hps=999&gr=2',
    wantPosed: [
      ['année', /ys=2022/], ['année', /ye=2024/],
      // me=18 ⇔ 90 000 km : SEUL palier enum prouvé.
      ['km', /me=18(&|$)/],
      ['puissance', /hps=150/], ['boîte', /gr=2(&|$)/], ['finition', /q=gr%20sport/],
    ],
    wantGone: [/[?&]ys=/, /[?&]ye=/, /[?&]me=/, /[?&]hps=/, /[?&]gr=/, /\/berlina/],
  },
  {
    site: 'JOFOGAS',
    bare: 'https://auto.jofogas.hu/magyarorszag/auto/toyota/rav-4-/hibrid?sp=1',
    fossil: 'https://auto.jofogas.hu/magyarorszag/auto/toyota/rav-4-/hibrid/kombi?sp=1&rs=2019&re=2020&me=50000',
    wantPosed: [
      ['année', /rs=2022/], ['année', /re=2024/], ['km', /me=90000/], ['finition', /q=gr%20sport/],
    ],
    // rs TOUJOURS posé (le site bloque sans lui) — repli large 2000.
    wantGone: [/re=/, /me=/, /\/kombi/],
    wantKept: [/rs=2000/],
  },
  {
    site: 'LACENTRALE',
    bare: 'https://www.lacentrale.fr/listing?makesModelsCommercialNames=TOYOTA%3A%3ARAV%204&sortBy=priceAsc',
    fossil: 'https://www.lacentrale.fr/listing?makesModelsCommercialNames=TOYOTA%3A%3ARAV%204&yearMin=2019&yearMax=2020&mileageMax=10000&powerDINMin=999&gearbox=MANUAL&energies=dies&categories=40&sortBy=priceAsc',
    wantPosed: [
      ['année', /yearMin=2022/], ['année', /yearMax=2024/], ['km', /mileageMax=90000/],
      // powerDINMin en ch DIN, bornes séparées — pas de piège N-max (corpus).
      ['puissance', /powerDINMin=150(&|$)/],
      ['boîte', /gearbox=AUTO(&|$)/],
      // versions= en minuscules, espace %20 (test Channing 29/08).
      ['finition', /versions=gr%20sport(&|$)/],
      ['carburant', /energies=hyb(&|$)/],
    ],
    wantGone: [/yearMin/, /yearMax/, /mileageMax/, /powerDINMin/, /gearbox=/, /energies=/, /categories=/],
    // Le libellé commercial (%3A%3A + %20) doit survivre OCTET PAR OCTET —
    // même classe que la liste à virgules Leboncoin.
    wantKept: [/makesModelsCommercialNames=TOYOTA%3A%3ARAV%204/, /sortBy=priceAsc/],
  },
  {
    // Bornes du hash posées SANS mapping appris — dossier X3 26/08 : la borne
    // haute d'année se perdait quand la ligne mémoire ne l'avait pas apprise.
    site: 'MARKTPLAATS (hash + finition chemin /q/)',
    bare: 'https://www.marktplaats.nl/l/auto-s/toyota/f/rav4/1234/#sortBy:PRICE',
    fossil: 'https://www.marktplaats.nl/l/auto-s/toyota/f/rav4/1234/#sortBy:PRICE|constructionYearFrom:2019|constructionYearTo:2019|mileageTo:1|f:485,13956',
    wantPosed: [
      ['année', /constructionYearFrom:2022/], ['année', /constructionYearTo:2024/],
      ['km', /mileageTo:90000/],
      ['finition', /\/q\/gr\+sport\//],
    ],
    // La facette carrosserie héritée (485) saute ; la facette NON-carrosserie
    // du même f: (13956, sous-type hybride) survit — pose intra-liste.
    wantGone: [/constructionYearFrom/, /constructionYearTo/, /mileageTo/, /f:[\d+,]*\b485\b/],
    wantKept: [/sortBy:PRICE/, /f:13956/],
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

// ─── 4. Décision de profondeur (missingUrlCriteria — règle « 5 pages ») ─────
console.log('=== 4. DÉCISION DE PROFONDEUR ===');
{
  // URL complète (voie mémoire enrichie par le registre) → 5 pages éligible.
  const complete = injectTrimIntoUrl(
    applyVariableCriteria('https://www.gaspedaal.nl/toyota/rav4/hybride?srt=pr-a', FULL),
    String(FULL.trim),
  );
  const m1 = missingUrlCriteria(complete, FULL);
  if (m1.length !== 0) fail(`profondeur: URL complète jugée incomplète (${m1.join(',')})\n    ${complete}`);
  // Carburant PHEV Leboncoin : fuel=8 (« Hybride Rechargeable ») — moisson
  // des annonces 30/07-01/08, RE-prouvé par URL humaine GLA 27/08 (&fuel=8).
  // Régression payée le 27/08 : le registre rabattait PHEV→6 (famille
  // hybride) et écrasait le 8 natif — étude GLA sur le mauvais marché.
  const lbcPhev = applyVariableCriteria(
    'https://www.leboncoin.fr/recherche?category=2&u_car_brand=MERCEDES-BENZ&fuel=6',
    { ...FULL, brand: 'MERCEDES-BENZ', model: 'GLA-Class', fuel: 'PLUG_IN_HYBRID' },
  );
  if (!/fuel=8(&|$)/.test(lbcPhev)) fail(`LBC PHEV: fuel=8 attendu (URL humaine GLA 27/08)\n    ${lbcPhev}`);
  // Gaspedaal n'a PAS de catégorie hybride rechargeable (Channing 27/08) :
  // une étude PHEV doit servir la famille /hybride — voie mémoire comprise.
  const gpPhev = applyVariableCriteria('https://www.gaspedaal.nl/toyota/rav4?srt=pr-a', { ...FULL, fuel: 'PLUG_IN_HYBRID' });
  if (!/\/rav4\/hybride(\?|$)/.test(gpPhev)) fail(`Gaspedaal PHEV: segment /hybride attendu (famille)\n    ${gpPhev}`);
  // La Centrale distingue NATIVEMENT le rechargeable : une étude PHEV doit
  // poser energies=plug_hyb (jamais la famille hyb) — même doctrine que le
  // fuel=8 Leboncoin, corpus 29/08.
  const lcPhev = applyVariableCriteria(
    'https://www.lacentrale.fr/listing?makesModelsCommercialNames=TOYOTA%3A%3ARAV%204&energies=hyb',
    { ...FULL, fuel: 'PLUG_IN_HYBRID' },
  );
  if (!/energies=plug_hyb(&|$)/.test(lcPhev)) fail(`La Centrale PHEV: energies=plug_hyb attendu (sous-type natif)\n    ${lcPhev}`);
  // CARROSSERIE (canon 30/08, URLs humaines LBC vehicle_type=4x4 + liste à
  // virgules littérales) : posée-ou-retirée — un fossile berline hérité doit
  // devenir le 4x4 de l'étude, jamais s'additionner.
  const lbcBody = applyVariableCriteria(
    'https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA&vehicle_type=berline',
    { ...FULL, vehicleType: '4x4, SUV & Crossover' },
  );
  if (!/vehicle_type=4x4(&|$)/.test(lbcBody)) fail(`LBC carrosserie: vehicle_type=4x4 attendu (URL humaine 30/08)\n    ${lbcBody}`);
  // AS24 : codes body= internationaux (1,2,3,4,5,6,12 — ordre de la facette,
  // URLs humaines 30/08) ; le segment bt_ localisé hérité est PURGÉ.
  const as24Body = applyVariableCriteria(
    'https://www.autoscout24.fr/lst/toyota/rav4/bt_berline?atype=C&cy=F',
    { ...FULL, vehicleType: 'SUV' },
  );
  if (!/[?&]body=4(&|$)/.test(as24Body) || /\/bt_/.test(as24Body)) {
    fail(`AS24 carrosserie: body=4 attendu et bt_ purgé\n    ${as24Body}`);
  }
  // La Centrale : berline = DEUX sous-codes 41_42 (underscore, URL humaine
  // 30/08) — l'underscore doit survivre octet par octet.
  const lcBody = applyVariableCriteria(
    'https://www.lacentrale.fr/listing?makesModelsCommercialNames=TOYOTA%3A%3ARAV%204&categories=40',
    { ...FULL, vehicleType: 'Berline' },
  );
  if (!/categories=41_42(&|$)/.test(lcBody)) fail(`La Centrale carrosserie: categories=41_42 attendu\n    ${lcBody}`);
  // Gaspedaal : carrosserie = crs= en QUERY (le segment de chemin en 4e
  // position est IGNORÉ en silence — sonde 30/08 : 776 = 776) ; un segment
  // hérité est purgé, le modèle en 2e position jamais (Mazda MPV).
  const gpBody = applyVariableCriteria('https://www.gaspedaal.nl/toyota/rav4/stationwagen?srt=pr-a', { ...FULL, vehicleType: 'suv' });
  if (!/\/toyota\/rav4\/hybride\?/.test(gpBody) || !/crs=SUV(&|$)/.test(gpBody) || /\/stationwagen/.test(gpBody)) {
    fail(`Gaspedaal carrosserie: crs=SUV en query attendu, segment purgé\n    ${gpBody}`);
  }
  const gpMpv = applyVariableCriteria('https://www.gaspedaal.nl/mazda/mpv?srt=pr-a', { brand: 'MAZDA', model: 'MPV' });
  if (!/\/mazda\/mpv(\?|$)/.test(gpMpv)) fail(`Gaspedaal: le MODÈLE mpv (position 2) a été strippé à tort\n    ${gpMpv}`);
  // mobile.de : c= à codes anglais, répété pour le multi — les DEUX fossiles
  // c=Cabrio&c=OffRoad doivent devenir le seul c=Van (monospace).
  const mdBody = applyVariableCriteria(
    'https://www.mobile.de/fr/voiture/recherche.html?isSearchRequest=true&ms=24100%3B28&c=Cabrio&c=OffRoad',
    { ...FULL, vehicleType: 'Monospace' },
  );
  if (!/[?&]c=Van(&|$)/.test(mdBody) || /c=Cabrio|c=OffRoad/.test(mdBody)) {
    fail(`mobile.de carrosserie: c=Van seul attendu (multi purgé)\n    ${mdBody}`);
  }
  // Marktplaats : facette carrosserie posée DANS la liste f: du hash sans
  // écraser les autres facettes (sous-type hybride 13956, Automaat 534).
  const mpBody = applyVariableCriteria(
    'https://www.marktplaats.nl/l/auto-s/toyota/f/rav4/1234/#sortBy:PRICE|f:13956',
    { ...FULL, vehicleType: 'Cabriolet' },
  );
  if (!/f:13956,485(\||$)/.test(mpBody)) fail(`Marktplaats carrosserie: f:13956,485 attendu (13956 préservé)\n    ${mpBody}`);
  // Bilbasen : cartype=stationcar (break).
  const bbBody = applyVariableCriteria('https://www.bilbasen.dk/brugt/bil/toyota/rav4?includeengroscvr=true', { ...FULL, vehicleType: 'Break' });
  if (!/cartype=stationcar(&|$)/.test(bbBody)) fail(`Bilbasen carrosserie: cartype=stationcar attendu\n    ${bbBody}`);
  // Subito : la carrosserie se place AVANT le carburant (ordre prouvé par
  // scrape live 30/08 : /suv-fuoristrada/ibrida = 100 hybrides SUV,
  // l'inverse = 0).
  const sbBody = applyVariableCriteria('https://www.subito.it/annunci-italia/vendita/auto/toyota/ibrida/?order=priceasc', { ...FULL, vehicleType: 'Citadine' });
  if (!/\/auto\/toyota\/city-car\/ibrida\/(\?|$)/.test(sbBody)) fail(`Subito carrosserie: /city-car/ibrida/ attendu (carrosserie AVANT carburant)\n    ${sbBody}`);
  const sbSuv = applyVariableCriteria('https://www.subito.it/annunci-italia/vendita/auto/toyota/ibrida/?order=priceasc', { ...FULL, vehicleType: 'SUV' });
  if (!/\/suv-fuoristrada\/ibrida\/(\?|$)/.test(sbSuv)) fail(`Subito carrosserie: /suv-fuoristrada/ibrida/ attendu\n    ${sbSuv}`);
  // Blocket : citadine = DEUX codes répétés (3 et 5 portes ensemble).
  const blBody = applyVariableCriteria('https://www.blocket.se/mobility/search/car?variant=1.19.219&body_type=9', { ...FULL, vehicleType: 'Citadine' });
  if (!/body_type=1&body_type=2(&|$)/.test(blBody) || /body_type=9/.test(blBody)) {
    fail(`Blocket carrosserie: body_type=1&body_type=2 attendu (9 purgé)\n    ${blBody}`);
  }
  // Skelbiu : body[]=3 = break (Universalas — dictionnaire sk:body, l'URL
  // humaine « break » était un copier-collé de la citadine).
  const skBody = applyVariableCriteria('https://www.skelbiu.lt/skelbimai/?category_id=21575&search=1&body%5B%5D=5', { ...FULL, vehicleType: 'Break' });
  if (!/body%5B%5D=3(&|$)/.test(skBody) || /body%5B%5D=5/.test(skBody)) {
    fail(`Skelbiu carrosserie: body%5B%5D=3 attendu (5 purgé)\n    ${skBody}`);
  }
  // Jófogás : segment multi suv+terepjaro (« on combine les deux »).
  const jfBody = applyVariableCriteria('https://auto.jofogas.hu/magyarorszag/auto/toyota/rav-4-/hibrid?sp=1', { ...FULL, vehicleType: 'SUV' });
  if (!/\/hibrid\/suv\+terepjaro(\?|$)/.test(jfBody)) fail(`Jófogás carrosserie: /suv+terepjaro attendu\n    ${jfBody}`);
  // Depuis la grammaire horse_power_din=N-max (29/08), l'URL LBC enrichie
  // par le registre exprime TOUT — plus aucun critère manquant.
  const lbc = applyVariableCriteria('https://www.leboncoin.fr/recherche?category=2&u_car_brand=TOYOTA', FULL);
  const m2 = missingUrlCriteria(lbc, FULL);
  if (m2.length !== 0) fail(`profondeur: URL LBC enrichie jugée incomplète (${m2.join(',')})\n    ${lbc}`);
  // Marktplaats sans grammaire puissance → la puissance manque, 3 pages.
  const mp = applyVariableCriteria('https://www.marktplaats.nl/l/auto-s/toyota/f/rav4/1234/#sortBy:PRICE', FULL);
  const m2b = missingUrlCriteria(mp, FULL);
  if (!m2b.includes('puissance')) fail(`profondeur: puissance absente de l'URL Marktplaats non détectée\n    ${mp}`);
  // Étude sans critères variables : rien à exiger — éligible d'office.
  if (missingUrlCriteria('https://www.gaspedaal.nl/toyota/rav4', EMPTY).length !== 0) {
    fail('profondeur: étude sans critères jugée incomplète');
  }
  // URL vide : jamais éligible.
  if (missingUrlCriteria('', FULL).length === 0) fail('profondeur: URL vide jugée complète');
}

if (fails > 0) {
  console.error(`\nGRAMMAR GATE : ${fails} ÉCHEC(S) — une grammaire prouvée a cessé d'être exprimée.`);
  process.exit(1);
}
console.log('\nGRAMMAR GATE : matrice complète, fossiles purgés, unités exactes — TOUT EST BON');
