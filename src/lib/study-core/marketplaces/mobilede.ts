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
import { parseNextDataListings } from '../parsers/nextdata';

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

function mapBrand(raw: string): string { return MAKE_ID[canon(raw)] ?? raw.trim(); }
function mapModel(raw: string): string { return raw.trim(); }
function mapFuel(raw: string): string { return FUEL_PARAM[norm(raw)]?.value ?? ''; }

/** ch DIN → kW (le paramètre pw est en kW : 184 kW = 250 Ch, capture 26/07). */
function hpToKw(hp: number): number { return Math.round(hp / 1.35962); }

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const makeId = MAKE_ID[canon(params.brand ?? '')];
  const modelId = params.model ? MODEL_ID[comboKey(params.brand ?? '', String(params.model))]?.id : undefined;

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
 * Parse : tentative générique NEXT_DATA (diagnostics intégrés → worker_logs).
 * Si mobile.de n'est pas un site Next, la sonde [MOBILEDE_OBS] logge les blobs
 * JSON embarqués pour bâtir le vrai parseur sur preuve au prochain rapport.
 */
function parseListings(html: string, _url: string): ScrapedListing[] {
  const viaNext = parseNextDataListings(html, { host: 'mobile.de', currency: 'EUR', siteLabel: 'MOBILE_DE' });
  if (viaNext.length > 0) return viaNext;
  try {
    const blobs = [...html.matchAll(/window\.__(?:INITIAL_STATE|PRELOADED_STATE|APP_STATE)__\s*=\s*\{/g)].map((m) => m[0]);
    const scripts = [...html.matchAll(/<script[^>]*type="application\/(?:json|ld\+json)"[^>]*>/g)].length;
    console.warn(`[MOBILEDE_OBS] parse vide — blobs: ${blobs.join(' | ') || 'aucun'} ; scripts json: ${scripts} ; taille: ${html.length}`);
  } catch { /* sonde silencieuse */ }
  return [];
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
    const brand = reverseLookup(MAKE_ID, ms[0]);
    if (brand !== ms[0]) out.brand = brand;
    if (ms[1]) {
      const hit = Object.entries(MODEL_ID).find(([k, v]) =>
        v.id === ms[1] && (!out.brand || k.startsWith(`${canon(out.brand)}|`)));
      if (hit) { out.brand = out.brand ?? hit[0].split('|')[0]; out.model = hit[1].label; }
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

  prefillCriteriaFromUrl,
  extractCandidateSegments,
};
