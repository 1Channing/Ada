/**
 * mobile.de — squelette d'adaptateur (GO Channing 26/07/2026).
 *
 * Grammaire d'URL PROUVÉE par URL humaine (capture des filtres à l'appui) :
 *   /fr/voiture/recherche.html?isSearchRequest=true&s=Car&vc=Car
 *     &ms=22900%3B26          → ms=<makeId>;<modelId>  (Skoda;Elroq)
 *     &fr=2025%3A2025         → 1ère immatriculation <de>:<à>
 *     &ml=%3A80000            → kilométrage <min>:<max>
 *     &ft=ELECTRICITY         → carburant (enum)
 *     &pw=184                 → puissance MIN en kW (capture : « à partir de
 *                               184 kW (250 Ch DIN) »)
 *
 * Les IDs marque/modèle sont OPAQUES (taxonomie non publique — l'ancienne API
 * refdata est morte, vérifié 26/07). Stratégie Marktplaats : graine minimale
 * humaine + apprentissage par ingestion d'URLs collées (prefill décode ms=)
 * + réutilisation mémoire. Sans ID connu, PAS d'URL (no_url au centre de
 * résolution) plutôt qu'une page tous-modèles mensongère.
 *
 * Le site est défendu (Akamai : « Zugriff verweigert » pour les datacenters) —
 * profils Zyte type AutoScout, detectBlocked dédié.
 */

import type {
  BuildUrlResult, CandidateSegment, SampleListing, ScrapedListing, SearchCriteria,
  SiteAdapter, SiteValidationResult, ZyteProfileOverrides,
} from './types';
import { resolveYearRange } from './urlTemplate';
import { decomposeUrl } from './urlDecompose';
import { defaultBuildPaginatedUrl } from './registry';
import { parseNextDataListings, readField, deepFindPrice, toInt, toYear, toHp } from '../parsers/nextdata';
import { parseListings as genericParseListings } from '../parsers/generic';

/** Valeur site → clé interne (miroir des autres adaptateurs). */
function reverseLookup(map: Record<string, string>, siteValue: string): string {
  const found = Object.entries(map).find(([, v]) => v.toLowerCase() === siteValue.toLowerCase());
  return found ? found[0] : siteValue;
}

const URL_TEMPLATE =
  'https://www.mobile.de/fr/voiture/recherche.html?isSearchRequest=true&s=Car&vc=Car' +
  '&ms={makeId};{modelId}&fr={yearFrom}:{yearTo}&ml=:{mileage}&ft={fuel}';

// IDs marque — graines humaines (URLs Channing 26/07). S'enrichit par ingestion.
const MAKE_ID: Record<string, string> = {
  SKODA: '22900',   // Elroq (capture)
  BMW: '3500',      // iX1 (capture)
  TOYOTA: '24100',  // Yaris Cross (capture)
  HYUNDAI: '11600', // Tucson (capture)
};

// IDs modèle par `MARQUE|MODÈLE` canonique (alphanumérique MAJ), avec le
// libellé d'affichage pour le prefill inverse.
const MODEL_ID: Record<string, { id: string; label: string }> = {
  'SKODA|ELROQ': { id: '26', label: 'ELROQ' },
  'BMW|IX1': { id: '337', label: 'IX1' },
  'TOYOTA|YARISCROSS': { id: '78', label: 'YARIS CROSS' },
  'HYUNDAI|TUCSON': { id: '27', label: 'TUCSON' },
};

/**
 * Carburants : deux paramètres distincts chez mobile.de (prouvé par URLs
 * humaines 26/07) — `ft=` porte ELECTRICITY (Elroq/iX1) et HYBRID (Yaris
 * Cross « Hybride essence/électrique »), tandis que le PHEV passe par
 * `fe=HYBRID_PLUGIN` (Tucson « Hybride rechargeable »). PETROL/DIESEL/LPG :
 * tokens de l'ancienne API publique, hypothèses — un mauvais token donne une
 * page 0 annonce, jamais de pollution, et la boîte noire le remonterait.
 */
const FUEL_PARAM: Record<string, { param: 'ft' | 'fe'; value: string }> = {
  ELECTRIQUE: { param: 'ft', value: 'ELECTRICITY' },
  ELECTRIC: { param: 'ft', value: 'ELECTRICITY' },
  HYBRIDE: { param: 'ft', value: 'HYBRID' },
  HYBRID: { param: 'ft', value: 'HYBRID' },
  PLUG_IN_HYBRID: { param: 'fe', value: 'HYBRID_PLUGIN' },
  ESSENCE: { param: 'ft', value: 'PETROL' },
  PETROL: { param: 'ft', value: 'PETROL' },
  GASOLINE: { param: 'ft', value: 'PETROL' },
  DIESEL: { param: 'ft', value: 'DIESEL' },
  GPL: { param: 'ft', value: 'LPG' },
};

const FUEL_SITE_TO_LABEL: Record<string, string> = {
  ELECTRICITY: 'ELECTRIQUE',
  PETROL: 'ESSENCE',
  DIESEL: 'DIESEL',
  HYBRID: 'HYBRIDE',
  HYBRID_PLUGIN: 'PLUG_IN_HYBRID',
  LPG: 'GPL',
};

const UNSUPPORTED_PARAMS: string[] = [];

const norm = (s: string) => s.trim().toUpperCase();
// Clé alphanumérique : 'YARIS CROSS' ≡ 'YARIS-CROSS' ≡ 'Yaris Cross'.
const canon = (s: string) => norm(s).replace(/[^A-Z0-9]/g, '');
const comboKey = (brand: string, model: string) => `${canon(brand)}|${canon(model)}`;

// ─── Taxonomie APPRISE (moissonnée des pages + persistée en dictionnaire) ────
// Les graines humaines MAKE_ID/MODEL_ID restent prioritaires (prouvées par
// URL) ; l'appris comble le reste. ms:make → code=makeId, label=marque.
// ms:model → code=`makeId;modelId`, label=modèle.
const LEARNED_MAKE_ID: Record<string, string> = {};           // canon(marque) → makeId
const LEARNED_MAKE_LABEL: Record<string, string> = {};        // makeId → label affichable
const LEARNED_MODEL_ID: Record<string, { id: string; label: string }> = {}; // `${makeId}|${canon(modèle)}` → {modelId, label}

function learnEnumValues(field: string, pairs: Array<{ code: string; label: string }>): void {
  for (const p of pairs) {
    const label = p.label.trim();
    if (!label) continue;
    if (field === 'ms:make' && /^\d{3,6}$/.test(p.code)) {
      const key = canon(label);
      // Une graine humaine contradictoire gagne toujours (prouvée par URL).
      if (MAKE_ID[key] && MAKE_ID[key] !== p.code) continue;
      LEARNED_MAKE_ID[key] = p.code;
      LEARNED_MAKE_LABEL[p.code] = label;
      // Alias premier mot : le planificateur dit MERCEDES là où mobile.de
      // écrit « Mercedes-Benz ». Jamais d'écrasement d'une clé existante.
      const first = canon(label.split(/[\s-]+/)[0] ?? '');
      if (first && first !== key && !MAKE_ID[first] && !LEARNED_MAKE_ID[first]) {
        LEARNED_MAKE_ID[first] = p.code;
      }
    } else if (field === 'ms:model' && /^\d{3,6};\d{1,6}$/.test(p.code)) {
      const [makeId, modelId] = p.code.split(';');
      LEARNED_MODEL_ID[`${makeId}|${canon(label)}`] = { id: modelId, label };
      // Alias sans le contenu parenthésé : mobile.de groupe des variantes
      // (« Aygo (X) », « Proace (Verso) ») que le planificateur demande nues
      // ('AYGO'). Jamais d'écrasement d'une entrée existante.
      const bare = canon(label.replace(/\([^)]*\)/g, ' '));
      if (bare && bare !== canon(label)) {
        const aliasKey = `${makeId}|${bare}`;
        if (!LEARNED_MODEL_ID[aliasKey]) LEARNED_MODEL_ID[aliasKey] = { id: modelId, label };
      }
    }
  }
}

function makeIdFor(brand: string): string | undefined {
  const key = canon(brand);
  return MAKE_ID[key] ?? LEARNED_MAKE_ID[key];
}
function modelIdFor(makeId: string, brand: string, model: string): string | undefined {
  return MODEL_ID[comboKey(brand, model)]?.id ?? LEARNED_MODEL_ID[`${makeId}|${canon(model)}`]?.id;
}

/**
 * Moisson PURE du référentiel marques embarqué — preuve worker_logs 26/07 :
 * la page contient (en JSON parfois ÉCHAPPÉ dans une chaîne) le tableau
 * complet `{"label":"Leapmotor","value":"32303"}, …`. On ancre sur
 * « Leapmotor » (introuvable ailleurs que dans ce tableau), on remonte au
 * crochet ouvrant, on équilibre jusqu'au fermant, on déplie l'échappement et
 * on parse. GARDE-FOU données : moisson acceptée uniquement si ≥3 de nos 4
 * graines humaines y figurent avec l'ID EXACT — sinon [] (jamais de devinette).
 */
function harvestTaxonomy(html: string): Array<{ field: string; code: string; label: string }> {
  const makes = harvestMakes(html);
  const models = harvestModelsFromAds(html, makes);
  return [...makes, ...models];
}

/**
 * Modèles depuis les ANNONCES du flight — preuve dump 1ʳᵉ-annonce (21h19) :
 * chaque annonce porte makeId:17200, modelId:344 et make/model
 * {id, localized}. Chaque page scrapée apprend donc les modèles qu'elle
 * affiche (une page marque entière apprend toute la gamme d'un coup).
 * Garde-fou : makeId doit être une marque CONNUE (graine, apprise ou
 * moissonnée sur cette même page) — jamais de code orphelin.
 */
function harvestModelsFromAds(html: string, makesJustHarvested: Array<{ code: string }>): Array<{ field: string; code: string; label: string }> {
  const out: Array<{ field: string; code: string; label: string }> = [];
  try {
    const { ads } = extractFlightAds(html);
    if (!ads.length) return out;
    const knownMakes = new Set<string>([
      ...Object.values(MAKE_ID),
      ...Object.keys(LEARNED_MAKE_LABEL),
      ...makesJustHarvested.map((m) => m.code),
    ]);
    const seen = new Set<string>();
    for (const ad of ads) {
      const a = ad as { makeId?: unknown; modelId?: unknown; make?: { id?: unknown }; model?: { id?: unknown; localized?: unknown } };
      const makeId = String(a.makeId ?? a.make?.id ?? '');
      const modelId = String(a.modelId ?? a.model?.id ?? '');
      const label = typeof a.model?.localized === 'string' ? a.model.localized.trim() : '';
      if (!/^\d{3,6}$/.test(makeId) || !/^\d{1,6}$/.test(modelId) || !label) continue;
      if (!knownMakes.has(makeId)) continue;
      const code = `${makeId};${modelId}`;
      if (seen.has(code)) continue;
      seen.add(code);
      out.push({ field: 'ms:model', code, label });
    }
    if (out.length) console.warn(`[MOBILEDE_OBS] moisson modèles: ${out.length} combo(s) appris des annonces (ex. ${out[0].code}=${out[0].label})`);
  } catch { /* moisson silencieuse */ }
  return out;
}

function harvestMakes(html: string): Array<{ field: string; code: string; label: string }> {
  try {
    const anchor = html.indexOf('Leapmotor');
    if (anchor < 0) return [];
    // Jusqu'à 4 candidats de crochet ouvrant en remontant (un '[' imbriqué
    // plus proche peut précéder l'ancre) — le premier qui parse ET passe le
    // garde-fou gagne.
    let from = anchor;
    for (let attempt = 0; attempt < 4; attempt++) {
      const start = html.lastIndexOf('[', from);
      if (start < 0 || anchor - start > 400_000) return [];
      let depth = 0;
      let end = -1;
      const cap = Math.min(html.length, start + 800_000);
      for (let i = start; i < cap; i++) {
        const ch = html[i];
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end > anchor) {
        let seg = html.slice(start, end + 1);
        if (seg.includes('\\"')) seg = seg.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
        try {
          const arr = JSON.parse(seg) as Array<{ label?: unknown; value?: unknown }>;
          if (Array.isArray(arr)) {
            const entries = arr
              .filter((o) => o && typeof o.label === 'string' && /^\d{3,6}$/.test(String(o.value ?? '')) && !/^\d+$/.test(o.label))
              .map((o) => ({ field: 'ms:make', code: String(o.value), label: String(o.label).trim() }));
            const seedHits = Object.entries(MAKE_ID)
              .filter(([key, id]) => entries.some((e) => e.code === id && canon(e.label) === key)).length;
            if (seedHits >= 3) {
              console.warn(`[MOBILEDE_OBS] moisson marques: ${entries.length} entrées (graines validées ${seedHits}/4)`);
              return entries;
            }
            console.warn(`[MOBILEDE_OBS] moisson marques REJETÉE — graines ${seedHits}/4 seulement (${entries.length} entrées candidates)`);
          }
        } catch { /* candidat suivant */ }
      }
      from = start - 1;
    }
  } catch { /* moisson silencieuse — jamais bloquante */ }
  return [];
}

function mapBrand(raw: string): string { return makeIdFor(raw) ?? raw.trim(); }
function mapModel(raw: string): string { return raw.trim(); }
function mapFuel(raw: string): string { return FUEL_PARAM[norm(raw)]?.value ?? ''; }

/** ch DIN → kW (le paramètre pw est en kW : 184 kW = 250 Ch, capture 26/07). */
function hpToKw(hp: number): number { return Math.round(hp / 1.35962); }

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const makeId = makeIdFor(params.brand ?? '');
  const modelId = params.model && makeId ? modelIdFor(makeId, params.brand ?? '', String(params.model)) : undefined;

  // Sans ID connu, on ne fabrique PAS une URL tous-modèles mensongère : l'étude
  // sort en no_url et le centre de résolution dit quoi apprendre (coller une
  // URL mobile.de du combo — le prefill décode ms= et la mémoire prend le relais).
  if (!makeId || (params.model && !modelId)) {
    warnings.push(`[LINKGEN_WARNING] MOBILE_DE: ID ${!makeId ? 'marque' : 'modèle'} inconnu pour ${params.brand ?? ''} ${params.model ?? ''} — coller une URL mobile.de pour l'apprendre`);
    return { url: '', warnings };
  }

  const qs = new URLSearchParams();
  qs.set('isSearchRequest', 'true');
  qs.set('s', 'Car');
  qs.set('vc', 'Car');
  qs.set('ms', modelId ? `${makeId};${modelId}` : makeId);
  const { yearFrom, yearTo } = resolveYearRange(params);
  if (yearFrom || yearTo) qs.set('fr', `${yearFrom ?? ''}:${yearTo ?? ''}`);
  if (params.mileage) qs.set('ml', `:${params.mileage}`);
  const fuel = params.fuel ? FUEL_PARAM[norm(params.fuel)] : undefined;
  if (fuel) qs.set(fuel.param, fuel.value);
  else if (params.fuel) warnings.push(`[LINKGEN_WARNING] MOBILE_DE: carburant "${params.fuel}" sans enum connu — filtre omis`);
  const power = params.powerFrom ?? params.minPower;
  if (power !== undefined && String(power).trim()) qs.set('pw', String(hpToKw(Number(power))));
  // Tri prix croissant — prouvé (URL humaine : od=up&sb=p ↔ « Prix (croissant) »).
  qs.set('sb', 'p');
  qs.set('od', 'up');

  return { url: `https://www.mobile.de/fr/voiture/recherche.html?${qs.toString()}`, warnings };
}

/**
 * Sondes taxonomie [MOBILEDE_OBS] — évidence pour tuer la saisie manuelle.
 * La campagne du 26/07 a prouvé que la page de résultats fait ~644 Ko : si le
 * référentiel marques/modèles du formulaire y est embarqué, le contexte autour
 * d'une marque exotique (Leapmotor — quasi impossible ailleurs que dans le
 * dropdown) révèle la forme exacte {label, id}, et les chemins d'API embarqués
 * révèlent l'endpoint modèles. On bâtira la moisson automatique sur cette
 * preuve — on ne devine rien. Borné à 3 pages par vie du process.
 */
let refProbeCount = 0;
function probeRefData(html: string): void {
  if (refProbeCount >= 3) return;
  refProbeCount++;
  try {
    const idx = html.indexOf('Leapmotor');
    if (idx >= 0) {
      console.warn(`[MOBILEDE_OBS] ctx "Leapmotor": …${html.slice(Math.max(0, idx - 200), idx + 200).replace(/\s+/g, ' ')}…`);
    } else {
      console.warn('[MOBILEDE_OBS] "Leapmotor" absent du HTML — référentiel marques non embarqué dans la page');
    }
    // Le blob d'état vu le 26/07 est du JSON ÉCHAPPÉ (\"label\":\"Leapmotor\")
    // dans l'unique <script type="application/json"> : on sonde les deux
    // graphies pour localiser modèles et annonces dans l'état.
    for (const needle of ['"models"', '\\"models\\"', '\\"searchResults\\"', '\\"items\\"', '\\"ads\\"', '\\"listings\\"']) {
      const at = html.indexOf(needle);
      if (at >= 0) console.warn(`[MOBILEDE_OBS] ctx ${needle}: …${html.slice(Math.max(0, at - 120), at + 380).replace(/\s+/g, ' ')}…`);
    }
    const tag = html.match(/<script([^>]*type="application\/json"[^>]*)>([\s\S]{0,260})/i);
    if (tag) console.warn(`[MOBILEDE_OBS] script json — attrs:${tag[1].slice(0, 160)} début: ${tag[2].replace(/\s+/g, ' ')}`);
    const apis = [...new Set(
      [...html.matchAll(/["'](\/[a-z0-9/._-]{3,80}(?:api|refdata|reference-data|models|makes)[a-z0-9/._?=&;-]{0,80})["']/gi)].map((m) => m[1]),
    )].slice(0, 6);
    if (apis.length) console.warn(`[MOBILEDE_OBS] chemins API embarqués: ${apis.join(' | ')}`);
  } catch { /* sonde silencieuse */ }
}

/**
 * Parseur FLIGHT — la vraie source structurée, prouvée par sonde v2 (21h07) :
 * mobile.de est un site Next.js App Router qui streame son état dans des
 * chunks `self.__next_f.push([1,"…"])` (chaînes JS échappées). Concaténés et
 * dépliés, ils contiennent :
 *   "searchResults":{"numResultsTotal":…,"listings":[{…,"attr":{
 *     "fr":"05/2025","pw":"130 kW (177 Ch DIN)","ft":"Hybride (essence/
 *     électrique)","ml":"20 900 km","tr":"Boîte automatique","ecol":"Noir",
 *     "door":"4/5","loc":"…"}}]}
 * Les clés attr sont PROUVÉES ; titre/prix/URL sont lus avec des candidats
 * tolérants + une sonde qui logge la 1ʳᵉ annonce complète pour affiner. Si
 * la moisson n'atteint pas un minimum exploitable, on rend [] et la chaîne
 * retombe sur le générique — jamais pire qu'avant.
 */
function decodeFlightChunks(html: string): string {
  const parts: string[] = [];
  for (const m of html.matchAll(/__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try { parts.push(JSON.parse(`"${m[1]}"`)); } catch { /* chunk illisible — ignoré */ }
  }
  return parts.join('');
}

/** Équilibrage d'accolades conscient des chaînes (le texte est du JSON réel). */
function balancedJsonObject(text: string, openBrace: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = openBrace; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(openBrace, i + 1); }
  }
  return null;
}

/** Extraction partagée parse/moisson, avec micro-cache par identité de html
 *  (le même HTML est lu deux fois par scrape : annonces puis taxonomie). */
let lastFlight: { html: string; total: number | null; ads: Array<Record<string, unknown>> } | null = null;
function extractFlightAds(html: string): { total: number | null; ads: Array<Record<string, unknown>> } {
  if (lastFlight && lastFlight.html === html) return lastFlight;
  const empty = { total: null, ads: [] as Array<Record<string, unknown>> };
  const text = decodeFlightChunks(html);
  if (!text) return empty;
  const at = text.indexOf('"searchResults":{');
  if (at < 0) return empty;
  const objTxt = balancedJsonObject(text, text.indexOf('{', at + '"searchResults"'.length));
  if (!objTxt) return empty;
  let sr: { numResultsTotal?: number; listings?: unknown[] };
  try { sr = JSON.parse(objTxt); } catch { return empty; }
  const ads = (Array.isArray(sr.listings) ? sr.listings : []).filter(
    (a): a is Record<string, unknown> => !!a && typeof a === 'object');
  lastFlight = { html, total: sr.numResultsTotal ?? null, ads };
  return lastFlight;
}

let flightProbeCount = 0;
function parseFlightListings(html: string): ScrapedListing[] {
  const { total, ads } = extractFlightAds(html);
  if (!ads.length) return [];
  if (flightProbeCount < 2) {
    flightProbeCount++;
    try {
      // Clés restantes à verrouiller (URL/id de l'annonce) : liste complète
      // des clés + valeurs des clés id/url-esques — le dump 1800c tronquait.
      const keys = Object.keys(ads[0]).join(',');
      const idish = Object.entries(ads[0])
        .filter(([k, v]) => /id|url|link|href/i.test(k) && (typeof v === 'string' || typeof v === 'number'))
        .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(' | ');
      console.warn(`[MOBILEDE_OBS] flight: total=${total ?? '?'} listings=${ads.length} ; clés: ${keys} ; id/url: ${idish || 'aucune'}`);
    } catch { /* sonde silencieuse */ }
  }
  const out: ScrapedListing[] = [];
  // mobile.de liste aussi des annonces hors Allemagne — attr.cn (prouvé :
  // "DE" sur les dumps) donne le pays de l'annonce. Une étude MOBILE_DE
  // décrit le MARCHÉ ALLEMAND : on écarte les autres pays (compteur loggé).
  // cn absent = on garde (fail-open, jamais de filtrage aveugle).
  const foreign = new Map<string, number>();
  for (const ad of ads) {
    const cn = String((ad as { attr?: { cn?: unknown } }).attr?.cn ?? '').trim().toUpperCase();
    if (cn && cn !== 'DE') {
      foreign.set(cn, (foreign.get(cn) ?? 0) + 1);
      continue;
    }
    // Clés PROUVÉES par le dump 1ʳᵉ-annonce (21h19) : p="23 610 €",
    // shortTitle="Mercedes-Benz eVito", subTitle="112 Kasten KLIMA…",
    // st="Concessionnaire", attr.{fr,yc,pw,ft,ml,tr,ecol,door,sc,c},
    // make={id,localized}. ('p' retiré des clés attr : en passe substring il
    // matchait attr.pw → prix fantôme.)
    const price = toInt(readField(ad, ['p', 'price', 'grossPrice'], []))
      ?? deepFindPrice((ad as { price?: unknown }).price ?? (ad as { prices?: unknown }).prices ?? (ad as { priceInfo?: unknown }).priceInfo ?? null);
    const shortTitle = readField(ad, ['shortTitle'], []);
    const subTitle = readField(ad, ['subTitle'], []);
    const title = [shortTitle, subTitle].filter(Boolean).join(' ')
      || readField(ad, ['title', 'name', 'headline', 'adTitle', 'heading'], []);
    if (!price || !title) continue;
    let url = readField(ad, ['relativeUrl', 'url', 'detailPageUrl', 'vipUrl', 'href', 'link'], []) ?? '';
    if (url.startsWith('/')) url = `mobile.de${url}`;
    out.push({
      title: title.slice(0, 200),
      price,
      currency: 'EUR',
      mileage: toInt(readField(ad, ['mileage'], ['ml'])),
      year: toYear(readField(ad, ['firstRegistration', 'year'], ['fr', 'yc'])),
      trim: null,
      // '' (et non un placeholder commun) : la dédupe worker retombe alors
      // sur titre|prix — un placeholder identique écrasait 24 annonces en 1
      // (campagne 21h21, « échantillon 1 < 3 » sur 890 Elroq réelles).
      listing_url: url,
      description: '',
      price_type: 'one-off',
      brand: readField(ad, ['make', 'makeName', 'brand'], []),
      fuel: readField(ad, ['fuel', 'fuelType'], ['ft']),
      gearbox: readField(ad, ['transmission', 'gearbox'], ['tr']),
      powerDin: toHp(readField(ad, ['power'], ['pw'])),
      doors: toInt((readField(ad, ['doors'], ['door']) ?? '').split('/')[0] || null),
      seats: toInt(readField(ad, ['seats'], ['sc'])),
      color: readField(ad, ['color', 'exteriorColor'], ['ecol']),
      vehicleType: readField(ad, ['category', 'bodyType'], ['c']),
      sellerType: readField(ad, ['sellerType', 'st'], []),
      priceType: null,
    });
  }
  if (foreign.size > 0) {
    const detail = [...foreign.entries()].map(([c, n]) => `${c}×${n}`).join(', ');
    console.warn(`[MOBILEDE_OBS] ${[...foreign.values()].reduce((a, b) => a + b, 0)} annonce(s) hors Allemagne écartée(s) (${detail})`);
  }
  // Seuil d'exploitabilité : sous 3 annonces complètes (titre+prix) on
  // préfère le repli générique — la sonde révélera les clés manquantes.
  // (Les hors-DE écartées ne comptent pas contre le seuil.)
  const kept = ads.length - [...foreign.values()].reduce((a, b) => a + b, 0);
  if (out.length < Math.min(3, kept)) {
    console.warn(`[MOBILEDE_OBS] flight: ${kept} annonces trouvées mais ${out.length} exploitables (titre/prix manquants) — repli`);
    return [];
  }
  console.warn(`[MOBILEDE_OBS] flight: ${out.length}/${ads.length} annonces structurées extraites (total site: ${total ?? '?'})`);
  return out;
}

/**
 * Chaîne de parse par PREUVE (état 26/07 : pas de __NEXT_DATA__, un unique
 * <script type="application/json"> de ~1,4 Mo dont l'état est du JSON échappé
 * DANS une chaîne du JSON externe) :
 *   1. blob application/json parsé tel quel (recherche profonde nextdata) ;
 *   2. chaînes internes qui SONT du JSON (≥ 1 000 caractères) dépliées puis
 *      re-cherchées — c'est là que vivent marques/modèles/annonces ;
 *   3. repli parseur générique (heuristique HTML) : c'est lui qui extrayait
 *      les 100 annonces des campagnes précédentes — les études continuent de
 *      fonctionner pendant la calibration du parseur structuré.
 */
function parseFromJsonState(html: string): ScrapedListing[] {
  const cfg = { host: 'mobile.de', currency: 'EUR' as const, siteLabel: 'MOBILE_DE', verbose: true };
  const scripts = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of scripts) {
    const direct = parseNextDataListings(m[1], cfg);
    if (direct.length > 0) {
      console.warn(`[MOBILEDE_OBS] annonces trouvées dans le blob application/json direct: ${direct.length}`);
      return direct;
    }
    try {
      const outer = JSON.parse(m[1]);
      const innerJsonStrings: string[] = [];
      const walk = (v: unknown, depth: number): void => {
        if (depth > 6 || innerJsonStrings.length >= 8) return;
        if (typeof v === 'string') {
          const t = v.trim();
          if (t.length >= 1000 && (t.startsWith('{') || t.startsWith('['))) innerJsonStrings.push(t);
        } else if (Array.isArray(v)) {
          for (const x of v) walk(x, depth + 1);
        } else if (v && typeof v === 'object') {
          for (const x of Object.values(v)) walk(x, depth + 1);
        }
      };
      walk(outer, 0);
      for (const s of innerJsonStrings) {
        const viaInner = parseNextDataListings(s, cfg);
        if (viaInner.length > 0) {
          console.warn(`[MOBILEDE_OBS] annonces trouvées dans le JSON ÉCHAPPÉ interne: ${viaInner.length}`);
          return viaInner;
        }
      }
    } catch { /* blob non-JSON — on continue */ }
  }
  return [];
}

/**
 * Parse : tentative générique NEXT_DATA (diagnostics intégrés → worker_logs).
 * `verbose` : la structure est en cours de calibration — les lignes de forme
 * ([NEXTDATA] keys/attrs/1er item brut/fuels bruts) partent en WARN pour être
 * capturées dans worker_logs. La campagne du 26/07 a montré 100 annonces
 * extraites mais un carburant illisible (52× « petrol » sur une page d'Elroq,
 * impossible) : la prochaine page scrapée fournira le champ fautif.
 */
function parseListings(html: string, url: string): ScrapedListing[] {
  probeRefData(html);
  const viaNext = parseNextDataListings(html, { host: 'mobile.de', currency: 'EUR', siteLabel: 'MOBILE_DE', verbose: true });
  if (viaNext.length > 0) return viaNext;
  const viaFlight = parseFlightListings(html);
  if (viaFlight.length > 0) return viaFlight;
  const viaState = parseFromJsonState(html);
  if (viaState.length > 0) return viaState;
  // Repli générique — comportement des campagnes du 26/07 (100 annonces,
  // marque/modèle/année confirmées ; carburant sniffé, gardé par la
  // confirmation). Le [MOBILEDE_OBS] garde la trace pour la calibration.
  const viaGeneric = genericParseListings(html, url);
  console.warn(`[MOBILEDE_OBS] parse structuré vide — repli générique: ${viaGeneric.length} annonces ; taille: ${html.length}`);
  return viaGeneric;
}

function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
  const raw = parseListings(html, url).slice(0, 10);
  const sampleListings: SampleListing[] = raw.map((l) => ({
    title: l.title ?? '', price: l.price ?? 0, year: l.year ?? null,
    mileage: l.mileage ?? null, fuel: l.fuel ?? '', url: l.url ?? '',
  }));
  return {
    site: 'MOBILE_DE', url, listingCount, sampleListings,
    appliedFilters: {
      brand: url.includes('ms='), model: url.includes('%3B') || url.includes(';'),
      year: url.includes('fr='), mileage: url.includes('ml='), fuel: url.includes('ft='),
      trim: false, sort: false,
    },
    score: listingCount > 0 ? 0.5 : 0,
    status: 'not_checked',
    issues: [],
    evidence: { structuredFieldsAvailable: raw.length > 0, fieldsUsed: [], missingFields: [] },
    parserDetails: { htmlLength: html.length, parserUsed: 'nextdata-generic', parsedSampleCount: raw.length, extractionMethod: '__NEXT_DATA__ (générique)' },
  };
}

function generateCorrectionHypotheses(params: SearchCriteria, issueTypes: Set<string>): Array<{ url: string; reason: string }> {
  const result: Array<{ url: string; reason: string }> = [];
  if (issueTypes.has('fuel_mismatch') && params.fuel) {
    const { url } = buildSearchUrl({ ...params, fuel: undefined });
    if (url) result.push({ url, reason: 'MOBILE_DE H1: fuel filter removed (mismatch)' });
  }
  return result;
}

/** Akamai : raw unblocker géolocalisé d'abord (moins cher), navigateur ensuite. */
function getFetchProfile(attempt: number): ZyteProfileOverrides {
  if (attempt <= 2) return { httpResponseBody: true, geolocation: 'DE' };
  return { javascript: true, geolocation: 'DE', actions: [{ action: 'waitForTimeout', timeout: 4 }] };
}

function detectBlocked(html: string, hasListings: boolean): boolean {
  if (hasListings) return false;
  return html.includes('Zugriff verweigert') || html.includes('Access denied');
}

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const d = decomposeUrl(url);
  if (!d) return {};
  const q = d.queryParams;
  const out: Partial<SearchCriteria> = {};
  const ms = (q['ms'] ?? '').split(';');
  if (ms[0]) {
    // Graines humaines puis marques apprises (moisson persistée).
    const seeded = reverseLookup(MAKE_ID, ms[0]);
    if (seeded !== ms[0]) out.brand = seeded;
    else if (LEARNED_MAKE_LABEL[ms[0]]) out.brand = LEARNED_MAKE_LABEL[ms[0]];
    if (ms[1]) {
      const hit = Object.entries(MODEL_ID).find(([k, v]) =>
        v.id === ms[1] && (!out.brand || k.startsWith(`${canon(out.brand)}|`)));
      if (hit) { out.brand = out.brand ?? hit[0].split('|')[0]; out.model = hit[1].label; }
      else {
        const learned = Object.entries(LEARNED_MODEL_ID).find(([k, v]) => v.id === ms[1] && k.startsWith(`${ms[0]}|`));
        if (learned) out.model = learned[1].label;
      }
    }
  }
  const fr = (q['fr'] ?? '').split(':');
  if (/^\d{4}$/.test(fr[0] ?? '')) out.yearFrom = fr[0];
  if (/^\d{4}$/.test(fr[1] ?? '')) out.yearTo = fr[1];
  const ml = (q['ml'] ?? '').split(':');
  if (/^\d+$/.test(ml[1] ?? '')) out.mileage = ml[1];
  // Deux paramètres carburant : ft= (électrique/hybride/thermique) et
  // fe=HYBRID_PLUGIN (hybride rechargeable — URL humaine Tucson 26/07).
  if (q['ft'] && FUEL_SITE_TO_LABEL[q['ft'].toUpperCase()]) out.fuel = FUEL_SITE_TO_LABEL[q['ft'].toUpperCase()];
  if (q['fe'] && FUEL_SITE_TO_LABEL[q['fe'].toUpperCase()]) out.fuel = FUEL_SITE_TO_LABEL[q['fe'].toUpperCase()];
  if (/^\d+$/.test(q['pw'] ?? '')) out.powerFrom = String(Math.round(Number(q['pw']) * 1.35962));
  return out;
}

/** Les IDs opaques ms= sont la matière d'apprentissage (façon facettes Marktplaats). */
function extractCandidateSegments(url: string): CandidateSegment[] {
  const d = decomposeUrl(url);
  if (!d) return [];
  const q = d.queryParams;
  const out: CandidateSegment[] = [];
  const ms = (q['ms'] ?? '').split(';');
  if (ms[0]) out.push({ raw: ms[0], location: 'query', paramName: 'ms:make', guessField: 'brand' });
  if (ms[1]) out.push({ raw: ms[1], location: 'query', paramName: 'ms:model', guessField: 'model' });
  if (q['ft']) out.push({ raw: q['ft'], location: 'query', paramName: 'ft', guessField: 'fuel' });
  if (q['fe']) out.push({ raw: q['fe'], location: 'query', paramName: 'fe', guessField: 'fuel' });
  if (q['fr']) out.push({ raw: q['fr'], location: 'query', paramName: 'fr', guessField: 'year' });
  if (q['ml']) out.push({ raw: q['ml'], location: 'query', paramName: 'ml', guessField: 'mileage' });
  if (q['pw']) out.push({ raw: q['pw'], location: 'query', paramName: 'pw', guessField: 'power' });
  return out;
}

export const mobiledeAdapter: SiteAdapter = {
  key: 'MOBILE_DE',
  displayName: 'Mobile.de',
  country: 'Germany',
  countryCode: 'DE',
  domain: 'mobile.de',
  urlTemplate: URL_TEMPLATE,

  mapBrand,
  mapModel,
  mapFuel,
  supportsParam: (param) => !UNSUPPORTED_PARAMS.includes(param),

  buildSearchUrl,
  buildPaginatedUrl: defaultBuildPaginatedUrl,

  parseSearchResults: parseListings,

  scoreSearchResults,
  generateCorrectionHypotheses,

  getFetchProfile,
  detectBlocked,

  harvestTaxonomy,
  learnEnumValues,

  prefillCriteriaFromUrl,
  extractCandidateSegments,
};
