/**
 * LACENTRALE.FR — adaptateur v1 (29/08/2026), écrit sur PREUVE.
 *
 * Étalon : CORPUS D'URLS-PREUVES COMPLET fourni par Channing le 29/08
 * (26 URLs posées à la main dans l'interface du site — gravé au BACKLOG) :
 *   /listing?makesModelsCommercialNames=TOYOTA%3A%3ARAV%204  (séparateur
 *     DOUBLE deux-points ::, modèle en LIBELLÉ commercial avec espace)
 *   yearMin=/yearMax= · mileageMin=/mileageMax= · powerDINMin=/powerDINMax=
 *     (ch DIN, bornes séparées — pas de piège N-max)
 *   energies= dies/ess/elec/hyb/plug_hyb/not_plug_hyb/gpl/eth (le site
 *     distingue NATIVEMENT rechargeable / non-rechargeable)
 *   gearbox=AUTO|MANUAL · versions=gr%20sport (minuscules, espace %20)
 *   sortBy=priceAsc · page=N · détail /auto-occasion-annonce-{id}.html
 *
 * Recon durci 29/08 (Datadome franchi par l'unblocker brut FR — 1,4 Mo) :
 * les annonces vivent dans `window.__PRELOADED_STATE_LISTING__ = {...}`
 * (script id="listing-script-0") — le __NEXT_DATA__ ne porte que du HTML
 * échappé. Champs par annonce prouvés (échantillon hit RAV 4) : vehicle
 * {make, model:"RAV 4", version, trimLevel, energy:"HYBRID_ESSENCE_ELECTRIC",
 * mileage, year, gearbox:"AUTO", doors, category=CARROSSERIE, externalColor,
 * ratedHorsePower=CV FISCAUX (JAMAIS DIN)}, price, reference:"E119422537",
 * customerType:"PRO", firstOnlineDate:"2026-07-01" (marqueur vélocité au
 * jour), photoUrl pictures.lacentrale.fr/classifieds/E{ref}_STANDARD_{n}.jpg.
 *
 * PIÈGE prouvé : reference "E118264752" ≠ id du lien détail "69118264752"
 * (préfixe variable 69/66…) — l'URL d'annonce est appariée par la carte DOM
 * (data-testid="vehicleCardV2") dont l'img src porte classifieds/E{ref}_.
 *
 * MODÈLE : le paramètre attend le LIBELLÉ commercial du site (« RAV 4 »
 * avec espace — non dérivable de notre « RAV4 ») : seules les graines
 * PROUVÉES et le dictionnaire appris (lc:model:*, moissonné à chaque scrape
 * via vehicle.model) posent le segment modèle ; sinon marque seule + tri
 * structuré en aval (le champ model est lu sur chaque annonce).
 */

import type {
  SiteAdapter, SearchCriteria, BuildUrlResult,
  SiteValidationResult, ZyteProfileOverrides, CandidateSegment,
} from './types';
import type { ScrapedListing } from '../types';
import { parsePublishedAt } from '../parsers/shared';
import { resolveYearRange } from './urlTemplate';
import { modelKeyLoose } from '../business-logic';

const URL_TEMPLATE = 'https://www.lacentrale.fr/listing?makesModelsCommercialNames={brand}%3A%3A{model}&yearMin={yearFrom}&yearMax={yearTo}&mileageMax={mileage}&sortBy=priceAsc';

// energies= — huit valeurs PROUVÉES par le corpus 29/08. hyb = famille
// hybride ; plug_hyb = rechargeable NATIF (page au sous-type VRAI —
// SUBTYPE_TRUE_URL côté marketData) ; MILD_HYBRID → famille hyb (pas de
// valeur mild dédiée prouvée), affinage en aval comme partout.
const FUEL_CODE: Record<string, string> = {
  ESSENCE: 'ess', PETROL: 'ess', GASOLINE: 'ess',
  DIESEL: 'dies',
  ELECTRIQUE: 'elec', ELECTRIC: 'elec',
  HYBRIDE: 'hyb', HYBRID: 'hyb', MILD_HYBRID: 'hyb',
  PLUG_IN_HYBRID: 'plug_hyb', PHEV: 'plug_hyb',
  GPL: 'gpl', LPG: 'gpl',
  ETHANOL: 'eth',
};
const FUEL_CODE_TO_CANON: Record<string, string> = {
  ess: 'ESSENCE', dies: 'DIESEL', elec: 'ELECTRIQUE',
  hyb: 'HYBRIDE', plug_hyb: 'PLUG_IN_HYBRID', not_plug_hyb: 'HYBRIDE',
  gpl: 'GPL', eth: 'ETHANOL',
};

// Libellés commerciaux MODÈLE prouvés (corpus 29/08 : TOYOTA::RAV 4).
// Complétés en vivant par le dictionnaire appris lc:model:* (moisson de
// vehicle.model sur chaque scrape) — jamais dérivés mécaniquement.
const MODEL_LABEL_SEED: Record<string, string> = {
  'TOYOTA|RAV4': 'RAV 4',
};
const learnedModelLabels = new Map<string, string>(); // 'BRANDKEY|MODELKEY' → libellé site

const canonKey = (v: string) =>
  (v ?? '').toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Z0-9]/g, '');
const slugify = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Libellé commercial du modèle pour le paramètre makesModels… (graine
 *  prouvée puis dictionnaire appris) — null quand inconnu. */
function modelLabelFor(brand: string, model: string): string | null {
  const k = `${canonKey(brand)}|${canonKey(model)}`;
  return learnedModelLabels.get(k) ?? MODEL_LABEL_SEED[k] ?? null;
}

/**
 * Pose chirurgicale d'un paramètre — copie locale de la logique
 * setQueryParamRaw du registre (study-core ne peut pas importer linkgen/).
 * OBLIGATOIRE ici : URLSearchParams re-sérialiserait la query entière et
 * transformerait les %20 prouvés (RAV%204, gr%20sport) en `+`, forme JAMAIS
 * prouvée sur ce site (même classe que les virgules Leboncoin).
 */
function setParamSurgical(url: string, param: string, value: string | null): string {
  const qIdx = url.indexOf('?');
  const path = qIdx >= 0 ? url.slice(0, qIdx) : url;
  let pairs = qIdx >= 0 ? url.slice(qIdx + 1).split('&').filter(Boolean) : [];
  pairs = pairs.filter((p) => p !== param && !p.startsWith(`${param}=`));
  if (value !== null && value !== '') pairs.push(`${param}=${encodeURIComponent(value)}`);
  return path + (pairs.length ? `?${pairs.join('&')}` : '');
}

// ─── Lecture du state embarqué ───────────────────────────────────────────────

/** Le script d'assignation est ENVELOPPÉ dans un bloc `{ … }` (constat
 *  contre-épreuve 29/08 : page de 1,55 Mo, total 757 lu, 0 hit parsé — le
 *  découpage jusqu'à </script> embarquait l'accolade du bloc et JSON.parse
 *  cassait). Extraction à ACCOLADES ÉQUILIBRÉES depuis le premier `{` après
 *  le marqueur — insensible à l'enveloppe et à tout </script> embarqué. */
function extractPreloadedState(html: string): unknown {
  const i = html.indexOf('__PRELOADED_STATE_LISTING__');
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

type Hit = {
  reference: string;
  price: number;
  customerType?: string;
  firstOnlineDate?: string;
  vehicle: {
    make?: string; model?: string; version?: string; trimLevel?: string;
    energy?: string; mileage?: number; year?: number; gearbox?: string;
    doors?: number; category?: string; externalColor?: string;
    powerDIN?: number;
  };
};

// Références à LETTRE VARIABLE : E118264752 mais aussi W103542718 (autopsie
// 29/08 — le filtre /^E\d+/ rejetait tous les hits W, 2 annonces sur 16).
const looksLikeHit = (o: unknown): o is Hit => {
  const h = o as Hit;
  return Boolean(
    h && typeof h === 'object' && !Array.isArray(h)
    && typeof h.price === 'number' && h.price > 0
    && typeof h.reference === 'string' && /^[A-Z]?\d+$/.test(h.reference)
    && h.vehicle && typeof h.vehicle === 'object'
    && typeof h.vehicle.make === 'string',
  );
};

/**
 * Chasse RÉCURSIVE des hits dans le state (le chemin exact du tableau
 * principal n'est pas contractuel — la forme du hit, elle, est prouvée).
 * Les sous-arbres similarHits (annonces d'AILLEURS, pas sur la page) et
 * boostVo (encart sponsorisé hors-critères possibles) sont exclus : pureté
 * des données de segment avant exhaustivité — un hit boosté présent aussi
 * dans le tableau principal est capté là-bas.
 */
function collectHits(node: unknown, out: Map<string, Hit>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const el of node) collectHits(el, out);
    return;
  }
  if (looksLikeHit(node) && !out.has(node.reference)) out.set(node.reference, node);
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (/similar|boost/i.test(k)) continue;
    collectHits(v, out);
  }
}

/** Cartes DOM vehicleCardV2 : appariement reference → URL détail (l'img
 *  classifieds/{REF}_ vit dans le segment de SA carte, borné par le href
 *  suivant et plafonné — le dernier segment court sinon jusqu'au state).
 *  Rend aussi la table LETTRE→préfixe apprise des paires observées : l'id du
 *  lien détail = préfixe 2 chiffres selon la lettre de la référence + ses
 *  chiffres (prouvé 29/08 : E118264752↔69118264752, W103542718↔87103542718)
 *  — secours pour les hits du state sans carte appariée. */
function refToUrlMap(html: string): { urls: Map<string, string>; letterPrefix: Map<string, string> } {
  const urls = new Map<string, string>();
  const letterPrefix = new Map<string, string>();
  const parts = html.split(/href="\/auto-occasion-annonce-(\d+)\.html"/);
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const linkId = parts[i];
    const ref = parts[i + 1].slice(0, 5000).match(/classifieds\/([A-Z]\d+)_/)?.[1];
    if (!ref || urls.has(ref)) continue;
    urls.set(ref, `https://www.lacentrale.fr/auto-occasion-annonce-${linkId}.html`);
    const digits = ref.slice(1);
    // La paire ne fait loi que si l'id du lien est EXACTEMENT préfixe+digits.
    if (linkId.length === digits.length + 2 && linkId.endsWith(digits) && !letterPrefix.has(ref[0])) {
      letterPrefix.set(ref[0], linkId.slice(0, 2));
    }
  }
  return { urls, letterPrefix };
}

function parseSearchResults(html: string): ScrapedListing[] {
  const state = extractPreloadedState(html);
  if (!state) return [];
  const hits = new Map<string, Hit>();
  collectHits(state, hits);
  const { urls, letterPrefix } = refToUrlMap(html);
  const out: ScrapedListing[] = [];
  for (const h of hits.values()) {
    const v = h.vehicle ?? {};
    // Carte DOM d'abord ; sinon dérivation par la table lettre→préfixe
    // apprise des paires de CETTE page (jamais codée en dur).
    const prefix = letterPrefix.get(h.reference[0]);
    const url = urls.get(h.reference)
      ?? (prefix && /^[A-Z]\d+$/.test(h.reference)
        ? `https://www.lacentrale.fr/auto-occasion-annonce-${prefix}${h.reference.slice(1)}.html`
        : undefined);
    // Sans URL d'annonce (ni carte ni préfixe appris) l'observation ne serait
    // ni dédupliquée ni suivie (vélocité) — hit écarté, le score le voit.
    if (!url) continue;
    const year = Number(v.year);
    const mileage = Number(v.mileage);
    const powerDin = Number(v.powerDIN);
    out.push({
      title: [v.make, v.model, v.version].filter(Boolean).join(' '),
      description: '',
      price: h.price,
      currency: 'EUR',
      price_type: 'one-off',
      year: Number.isFinite(year) && year > 0 ? year : null,
      mileage: Number.isFinite(mileage) && mileage >= 0 ? mileage : null,
      trim: v.trimLevel?.trim() || null,
      listing_url: url,
      brand: v.make?.trim() || null,
      model: v.model?.trim() || null,
      // energy brut du site ("HYBRID_ESSENCE_ELECTRIC") — canonicalizeFuel
      // digère les underscores ; le sous-type PHEV vient de l'URL de segment
      // (energies=plug_hyb, SUBTYPE_TRUE_URL) + refineFuelToken sur le texte.
      fuel: v.energy?.trim() || null,
      gearbox: v.gearbox?.trim() || null,
      // powerDIN quand le hit le porte (vu sur similarHits ; lecture
      // TOLÉRANTE sur le hit principal). ratedHorsePower = CV FISCAUX,
      // jamais lu comme puissance.
      powerDin: Number.isFinite(powerDin) && powerDin > 0 ? powerDin : null,
      doors: Number.isFinite(Number(v.doors)) && Number(v.doors) > 0 ? Number(v.doors) : null,
      color: v.externalColor?.trim() || null,
      vehicleType: v.category?.trim() || null,
      sellerType: h.customerType?.trim() || null,
      // firstOnlineDate "2026-07-01" — marqueur vélocité natif au jour.
      publishedAt: parsePublishedAt(h.firstOnlineDate),
    });
  }
  return out;
}

/** Total « 758 annonces » affiché par la page (constat sonde 29/08). */
function readTotalCount(html: string): number | null {
  const m = html.match(/(\d[\d\s  ]*)\s*annonces?\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(/[\s  ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ─── Construction d'URL ──────────────────────────────────────────────────────

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const brandLabel = (params.brand ?? '').trim().toUpperCase();
  const modelLabel = params.model ? modelLabelFor(params.brand ?? '', params.model) : null;
  if (params.model && !modelLabel) {
    warnings.push(`[LINKGEN_WARNING] LaCentrale: modèle "${params.model}" sans libellé commercial prouvé (lc:model:* à apprendre) — page marque, tri structuré en aval`);
  }
  const pairs: Array<[string, string]> = [];
  if (brandLabel) {
    pairs.push(['makesModelsCommercialNames', modelLabel ? `${brandLabel}::${modelLabel}` : brandLabel]);
  }
  const { yearFrom, yearTo } = resolveYearRange(params);
  if (yearFrom) pairs.push(['yearMin', yearFrom]);
  if (yearTo) pairs.push(['yearMax', yearTo]);
  const km = Number(params.mileage ?? '');
  if (Number.isFinite(km) && km > 0) pairs.push(['mileageMax', String(km)]);
  const fuelCode = params.fuel ? FUEL_CODE[String(params.fuel).trim().toUpperCase()] : undefined;
  if (params.fuel && !fuelCode) {
    warnings.push(`[LINKGEN_WARNING] LaCentrale: carburant "${params.fuel}" sans code energies= prouvé — filtre omis`);
  }
  if (fuelCode) pairs.push(['energies', fuelCode]);
  const g = String(params.gearbox ?? '').trim().toUpperCase();
  if (/^AUTOMAT|^AUTO$/.test(g)) pairs.push(['gearbox', 'AUTO']);
  else if (/^MANUEL|^MANUAL/.test(g)) pairs.push(['gearbox', 'MANUAL']);
  const ch = Number(params.minPower ?? params.powerFrom ?? '');
  if (Number.isFinite(ch) && ch > 0) pairs.push(['powerDINMin', String(ch)]);
  const chTo = Number(params.powerTo ?? '');
  if (Number.isFinite(chTo) && chTo > 0) pairs.push(['powerDINMax', String(chTo)]);
  const trim = String(params.trim ?? '').trim();
  // versions= en minuscules, espace %20 — prouvé par test Channing 29/08.
  if (trim) pairs.push(['versions', trim.toLowerCase()]);
  if (params.sort !== 'relevance') pairs.push(['sortBy', 'priceAsc']);
  const qs = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return {
    url: `https://www.lacentrale.fr/listing${qs ? `?${qs}` : ''}`,
    warnings,
    modelExpressed: !params.model || Boolean(modelLabel),
  };
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
  const listings = parseSearchResults(html);
  const wantBrand = (params.brand ?? '').trim().toLowerCase();
  const brandHits = wantBrand ? listings.filter((l) => (l.brand ?? '').toLowerCase().includes(wantBrand)).length : listings.length;
  const brandOk = listings.length > 0 && brandHits / listings.length >= 0.8;
  const wantModelKey = params.model ? modelKeyLoose(params.model) : '';
  const modelHits = wantModelKey ? listings.filter((l) => modelKeyLoose(l.model) === wantModelKey).length : 0;
  const modelOk = wantModelKey ? modelHits / Math.max(1, listings.length) >= 0.8 : false;
  const issues: SiteValidationResult['issues'] = [];
  if (!brandOk && wantBrand) issues.push({ type: 'brand_missing' });
  if (params.model && !/makesModelsCommercialNames=[^&]*(%3A%3A|::)/.test(url)) issues.push({ type: 'model_not_applied' });
  if (listings.length === 0) issues.push({ type: 'no_listings' });
  return {
    site: 'LACENTRALE', url, listingCount,
    sampleListings: listings.slice(0, 5).map((l) => ({ title: l.title, price: l.price, year: l.year, mileage: l.mileage, fuel: l.fuel ?? '', url: l.listing_url })),
    appliedFilters: {
      brand: brandOk, model: modelOk,
      year: /yearMin=|yearMax=/.test(url), mileage: /mileageMax=/.test(url),
      fuel: /energies=/.test(url), trim: /versions=/.test(url), sort: /sortBy=/.test(url),
    },
    score: brandOk ? (modelOk ? 90 : 70) : 30,
    status: listings.length === 0 ? 'invalid' : brandOk ? (modelOk ? 'valid' : 'partial') : 'invalid',
    issues,
    evidence: {
      structuredFieldsAvailable: true,
      fieldsUsed: ['brand', 'model', 'fuel', 'year', 'mileage', 'gearbox', 'price', 'publishedAt'],
      missingFields: [],
    },
  };
}

// ─── Ingestion (URL collée) ──────────────────────────────────────────────────

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const out: Partial<SearchCriteria> = {};
  try {
    const u = new URL(url);
    const q = u.searchParams;
    const mm = q.get('makesModelsCommercialNames');
    if (mm) {
      const [brand, model] = mm.split('::');
      if (brand?.trim()) out.brand = brand.trim();
      if (model?.trim()) out.model = model.trim();
    }
    const num = (name: string) => { const v = q.get(name); return v && /^\d+$/.test(v) ? v : null; };
    const ymin = num('yearMin'); if (ymin) out.yearFrom = ymin;
    const ymax = num('yearMax'); if (ymax) out.yearTo = ymax;
    const kmax = num('mileageMax'); if (kmax) out.mileage = kmax;
    const pmin = num('powerDINMin'); if (pmin) { out.minPower = pmin; out.powerFrom = pmin; }
    const pmax = num('powerDINMax'); if (pmax) out.powerTo = pmax;
    const fuel = q.get('energies');
    if (fuel && FUEL_CODE_TO_CANON[fuel]) out.fuel = FUEL_CODE_TO_CANON[fuel];
    const gb = q.get('gearbox');
    if (gb === 'AUTO') out.gearbox = 'Automatique';
    else if (gb === 'MANUAL') out.gearbox = 'Manuelle';
    const versions = q.get('versions');
    if (versions?.trim()) out.trim = versions.trim();
  } catch { /* URL illisible */ }
  return out;
}

function extractCandidateSegments(url: string): CandidateSegment[] {
  const out: CandidateSegment[] = [];
  try {
    const u = new URL(url);
    const GUESS: Record<string, CandidateSegment['guessField']> = {
      makesModelsCommercialNames: 'model',
      yearMin: 'year', yearMax: 'year',
      mileageMin: 'mileage', mileageMax: 'mileage',
      powerDINMin: 'power', powerDINMax: 'power',
      energies: 'fuel', gearbox: 'gearbox', versions: 'trim',
    };
    for (const [k, v] of u.searchParams.entries()) {
      if (!v) continue;
      out.push({ raw: v, location: 'query', paramName: k, guessField: GUESS[k] });
    }
  } catch { /* ignore */ }
  return out;
}

// ─── Moisson taxonomie ───────────────────────────────────────────────────────

/** Libellés commerciaux du site, lus sur les annonces structurées : marque,
 *  modèle (« RAV 4 » — la clé du paramètre makesModels…), carrosserie
 *  (category — pré-câblage critère carrosserie), énergie (vocabulaire brut). */
function harvestTaxonomy(html: string): Array<{ field: string; code: string; label: string }> {
  const out: Array<{ field: string; code: string; label: string }> = [];
  const seen = new Set<string>();
  const push = (field: string, code: string, label: string) => {
    if (!code || !label) return;
    const k = `${field}|${code}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ field, code, label });
  };
  for (const l of parseSearchResults(html)) {
    const brand = (l.brand ?? '').trim();
    const model = (l.model ?? '').trim();
    if (brand) push('lc:make', slugify(brand), brand);
    if (brand && model) push(`lc:model:${slugify(brand)}`, slugify(model), model);
    if (l.vehicleType) push('lc:body', slugify(l.vehicleType), l.vehicleType);
    if (l.fuel) push('lc:energy', slugify(l.fuel), l.fuel);
    if (l.trim) push('lc:trim', slugify(l.trim), l.trim);
  }
  return out;
}

function learnEnumValues(field: string, pairs: Array<{ code: string; label: string }>): void {
  const m = field.match(/^lc:model:(.+)$/);
  if (!m) return;
  const brandKey = canonKey(m[1].replace(/-/g, ' '));
  for (const { label } of pairs) {
    if (label?.trim()) learnedModelLabels.set(`${brandKey}|${canonKey(label)}`, label.trim());
  }
}

// ─── Adaptateur ──────────────────────────────────────────────────────────────

export const lacentraleAdapter: SiteAdapter = {
  key: 'LACENTRALE',
  displayName: 'La Centrale',
  country: 'France',
  countryCode: 'FR',
  domain: 'lacentrale.fr',
  urlTemplate: URL_TEMPLATE,

  mapBrand: (raw) => raw.trim().toUpperCase(),
  mapModel: (raw) => modelLabelFor('', raw) ?? raw.trim(),
  mapFuel: (raw) => FUEL_CODE[raw.trim().toUpperCase()] ?? '',
  supportsParam: (p) => p === 'minPower',

  buildSearchUrl,
  // page=N — PROUVÉ par le corpus (page=2). Pose chirurgicale : jamais
  // URLSearchParams (ré-encoderait RAV%204 en RAV+4, forme non prouvée).
  buildPaginatedUrl: (baseUrl: string, pageNumber: number): string =>
    pageNumber <= 1 ? baseUrl : setParamSurgical(baseUrl, 'page', String(pageNumber)),

  parseSearchResults: (html: string) => parseSearchResults(html),
  scoreSearchResults,
  generateCorrectionHypotheses: () => [],

  // Datadome franchi par l'unblocker brut FR (sondes 29/08 : 1,4 Mo, state
  // complet — le moins cher, comme AutoScout). Escalade navigateur + attente
  // 6 s si le brut revient bloqué (profil lui aussi prouvé passant).
  getFetchProfile: (attempt: number): ZyteProfileOverrides =>
    attempt <= 2
      ? { httpResponseBody: true, geolocation: 'FR' }
      : { geolocation: 'FR', actions: [{ action: 'waitForTimeout', timeout: 6 }] },

  detectBlocked: (html: string, hasListings: boolean): boolean =>
    !hasListings && !html.includes('__PRELOADED_STATE_LISTING__')
    && /captcha-delivery\.com|datadome/i.test(html),

  // « 758 annonces » affiché par la page : total 0 = marché vide déclaré par
  // le site ; total > 0 sans annonce parsée = tripwire structure ; sinon nul.
  detectEmptyState: (html: string): boolean | null => {
    const total = readTotalCount(html);
    if (total === null) return null;
    if (total === 0) return true;
    return parseSearchResults(html).length === 0 ? false : null;
  },

  harvestTaxonomy,
  learnEnumValues,
  prefillCriteriaFromUrl,
  extractCandidateSegments,
};
