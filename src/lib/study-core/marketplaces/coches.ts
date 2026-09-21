/**
 * COCHES.NET (ES) — adaptateur v1 (21/09/2026), écrit sur PREUVE.
 *
 * Étalon : URLs humaines Channing 21/09 (sans filtre `?fi=Price&or=1`, Toyota
 * RAV4 `MakeIds[0]=46&ModelIds[0]=131`, Mercedes Clase C `MakeIds[0]=28&
 * ModelIds[0]=8` avec boîte `TransmissionTypeId=1` et les huit carrosseries
 * `ArrBodyType=1..8`) + reconnaissance directe de 30 URLs le même jour.
 *
 * GRAMMAIRE — table FILTER_NAMES du bundle du site (main.50f35432.js), puis
 * chaque paramètre vérifié en direct sur la page (écho dans initialSearch,
 * champs des annonces) :
 *   MakeIds[0]= · ModelIds[0]= (ids opaques, catalogue complet dans la page)
 *   MinYear=/MaxYear= · MinKms=/MaxKms= · PowerHpFrom=/PowerHpTo= (CV ≈ ch DIN :
 *     PowerHpFrom=200 → toutes les annonces ≥ 218 hp)
 *   Fueltype2List=N SCALAIRE (1 Diésel, 2 Gasolina, 3 Eléctrico, 4 Híbrido,
 *     5 Híbrido enchufable, 6 GLP, 7 GNC — dictionnaire du bundle ; ni virgule
 *     ni paramètre répété : UN carburant par URL)
 *   TransmissionTypeId=1 automatique (114 RAV4 ≥ 2023, toutes eCVT ; 3 028
 *     Clase C sur 4 122) · 2 manuelle
 *   ArrBodyType= 1 Berlina · 2 Coupe · 3 Cabrio · 4 Familiar · 5 Monovolumen ·
 *     6 Todoterrenos 4x4 y SUV · 7 Pick Up · 8 Furgoneta (libellés lus dans
 *     le H1 de chaque page)
 *   st=1 pro / st=2 particulier · hasPriceDrop=true · KeyWords= (texte)
 *   fi=Price&or=1 (prix croissant) · or=-1 · fi=SortDate · pg=N (30/page)
 *
 * PAGE : tout est dans `window.__INITIAL_PROPS__ = JSON.parse("…")` —
 * initialResults {items[30], totalResults, totalPages}, listFiltersOptions
 * .vehicles (165 marques × modèles avec ids : la TAXONOMIE ENTIÈRE en une
 * page). Par annonce : price, km, year, fuelType(+Id), make/makeId,
 * model/modelId, hp (43 %), bodyTypeId (43 %), isProfessional + seller,
 * photos[], publicationDate, priceDrop {originalPrice, percentage,
 * daysSinceUpdate}, offerType, location, url. PAS de boîte ni de finition
 * par annonce (la version n'est que dans le titre quand le vendeur la donne).
 *
 * ZYTE : mode NAVIGATEUR + geolocation ES obligatoire (1,4 Mo lus) ; le mode
 * brut (httpResponseBody) rend 520 à chaque essai — jamais utilisé ici.
 */

import type {
  SiteAdapter, SearchCriteria, BuildUrlResult,
  SiteValidationResult, ZyteProfileOverrides, CandidateSegment,
} from './types';
import type { ScrapedListing } from '../types';
import { parsePublishedAt } from '../parsers/shared';
import { resolveYearRange } from './urlTemplate';
import { modelKeyLoose, fiscalTerritoryOf, isElectricSiblingOf, wantsElectricSibling } from '../business-logic';
import { bodyLabel, canonicalizeBody } from '../bodyTypes';

const URL_TEMPLATE = 'https://www.coches.net/search/?MakeIds%5B0%5D={brand}&ModelIds%5B0%5D={model}&MinYear={yearFrom}&MaxYear={yearTo}&MaxKms={mileage}&fi=Price&or=1';

// Fueltype2List — dictionnaire du bundle (XA = {1:Diésel, 2:Gasolina,
// 3:Eléctrico, 4:Híbrido, 5:Híbrido enchufable, 6:GLP, 7:GNC}), 1/2/3/4/5
// vérifiés en direct (toutes les annonces de la page au carburant demandé).
const FUEL_CODE: Record<string, string> = {
  DIESEL: '1',
  ESSENCE: '2', PETROL: '2', GASOLINE: '2',
  ELECTRIQUE: '3', ELECTRIC: '3',
  HYBRIDE: '4', HYBRID: '4', MILD_HYBRID: '4',
  PLUG_IN_HYBRID: '5', PHEV: '5',
  GPL: '6', LPG: '6',
  CNG: '7', GNV: '7',
};
const FUEL_CODE_TO_CANON: Record<string, string> = {
  '1': 'DIESEL', '2': 'ESSENCE', '3': 'ELECTRIQUE', '4': 'HYBRIDE', '5': 'PLUG_IN_HYBRID', '6': 'GPL', '7': 'CNG',
};
const FUEL_LABEL: Record<string, string> = {
  '1': 'Diésel', '2': 'Gasolina', '3': 'Eléctrico', '4': 'Híbrido', '5': 'Híbrido enchufable', '6': 'Gas licuado (GLP)', '7': 'Gas natural (GNC)',
};

// ArrBodyType — huit URLs humaines 21/09, libellés lus dans le H1.
const BODY_CODE: Record<string, string> = { berline: '1', coupe: '2', cabriolet: '3', break: '4', monospace: '5', suv: '6' };
const BODY_LABEL: Record<string, string> = {
  '1': 'Berlina', '2': 'Coupe', '3': 'Cabrio', '4': 'Familiar', '5': 'Monovolumen', '6': 'Todoterrenos 4x4 y SUV', '7': 'Pick Up', '8': 'Furgoneta',
};
const BODY_TOKEN: Record<string, string> = { '1': 'berline', '2': 'coupe', '3': 'cabriolet', '4': 'break', '5': 'monospace', '6': 'suv' };

// Ids PROUVÉS (URLs humaines 21/09) ; le reste vient du catalogue de la page
// (listFiltersOptions.vehicles, moissonné à chaque scrape → cn:make / cn:model:*).
const BRAND_ID_SEED: Record<string, string> = { TOYOTA: '46', MERCEDESBENZ: '28', MERCEDES: '28' };
const MODEL_ID_SEED: Record<string, string> = { '46|rav4': '131', '28|class:C': '8' };
const LEARNED_BRAND_ID = new Map<string, string>();          // canonKey(label) → id
const LEARNED_BRAND_LABEL = new Map<string, string>();       // id → label
const LEARNED_MODEL_ID = new Map<string, string>();          // `${makeId}|${modelKeyLoose(label)}` → id
const LEARNED_MODEL_LABEL = new Map<string, string>();       // `${makeId}|${modelId}` → label

const canonKey = (v: string) =>
  (v ?? '').toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Z0-9]/g, '');
const brandKey = (v: string) => { const k = canonKey(v); return k === 'VW' ? 'VOLKSWAGEN' : k === 'MERCEDES' ? 'MERCEDESBENZ' : k; };
/** Clé modèle : famille Mercedes ramenée à sa lettre (« CLASSE C » ADA = « Clase C » du site = « C-Class ») ; sinon clé lâche commune. */
const modelKeyOf = (v: string): string => {
  const up = (v ?? '').toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
  const m = up.match(/^(?:CLASSE|CLASE|CLASS|KLASSE)\s+([A-Z]{1,3})$/) ?? up.match(/^([A-Z]{1,3})[-\s](?:CLASS|CLASSE|KLASSE)$/);
  return m ? `class:${m[1]}` : modelKeyLoose(up);
};

function brandIdFor(brand: string): string | undefined {
  const k = brandKey(brand);
  return LEARNED_BRAND_ID.get(k) ?? BRAND_ID_SEED[k] ?? (k === 'MERCEDESBENZ' ? BRAND_ID_SEED.MERCEDES : undefined);
}
function modelIdFor(makeId: string, model: string): string | undefined {
  const k = `${makeId}|${modelKeyOf(model)}`;
  return LEARNED_MODEL_ID.get(k) ?? MODEL_ID_SEED[k];
}

/** Pose chirurgicale d'un paramètre (jamais URLSearchParams : il ré-encoderait `[0]` et `%20`). */
function setParamSurgical(url: string, param: string, value: string | null): string {
  const qIdx = url.indexOf('?');
  const path = qIdx >= 0 ? url.slice(0, qIdx) : url;
  let pairs = qIdx >= 0 ? url.slice(qIdx + 1).split('&').filter(Boolean) : [];
  pairs = pairs.filter((p) => p !== param && !p.startsWith(`${param}=`));
  if (value !== null && value !== '') pairs.push(`${param}=${encodeURIComponent(value)}`);
  return path + (pairs.length ? `?${pairs.join('&')}` : '');
}

// ─── Lecture de la page ──────────────────────────────────────────────────────

interface CnItem {
  id?: string | number; url?: string; title?: string; price?: number; km?: number; year?: number;
  fuelType?: string; fuelTypeId?: number; make?: string; makeId?: number; model?: string; modelId?: number;
  hp?: number; bodyTypeId?: number; isProfessional?: boolean; seller?: { name?: string };
  publicationDate?: string; creationDate?: string; photos?: string[]; img?: string;
  priceDrop?: { originalPrice?: number; percentage?: number; daysSinceUpdate?: number };
  offerType?: { id?: number; literal?: string }; includesTaxes?: boolean;
  /** Régime fiscal déclaré (preuve 21/09 sur 60 annonces : 1 = IVA
   *  continent, 2 = IGIC — les 18 annonces Canarias, aucune autre). */
  taxTypeId?: number;
  /** N° de province INE = préfixe postal (35 Las Palmas, 38 Tenerife, 51 Ceuta, 52 Melilla). */
  provinceId?: number;
  location?: { mainProvince?: string; regionLiteral?: string; mainProvinceId?: number };
}
interface CnProps {
  initialResults?: { items?: CnItem[]; totalResults?: number; totalPages?: number };
  listFiltersOptions?: { vehicles?: { options?: Array<{ id: string | number; label: string; models?: Array<{ id: string | number; label: string }> }> } };
  initialSearch?: Record<string, unknown>;
}

/** `window.__INITIAL_PROPS__ = JSON.parse("…")` : chaîne JSON échappée dans un littéral JS — deux décodages. */
function extractInitialProps(html: string): CnProps | null {
  const m = html.match(/window\.__INITIAL_PROPS__\s*=\s*JSON\.parse\("((?:[^"\\]|\\.)*)"\)/);
  if (!m) return null;
  try {
    const literal = JSON.parse(`"${m[1]}"`) as string;
    return JSON.parse(literal) as CnProps;
  } catch { return null; }
}

function parseSearchResults(html: string): ScrapedListing[] {
  const props = extractInitialProps(html);
  if (!props) return [];
  // Le catalogue de la page nourrit l'adaptateur AVANT la lecture des
  // annonces : les libellés modèle sont ceux du catalogue (par id), pas ceux
  // écrits sur chaque annonce.
  learnFromEntries(catalogEntries(props));
  const items = props.initialResults?.items ?? [];
  const out: ScrapedListing[] = [];
  for (const it of items) {
    const price = Number(it.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const url = typeof it.url === 'string' && it.url ? (it.url.startsWith('http') ? it.url : `https://www.coches.net${it.url}`) : '';
    if (!url) continue;
    const year = Number(it.year), km = Number(it.km), hp = Number(it.hp);
    const bodyToken = it.bodyTypeId != null ? BODY_TOKEN[String(it.bodyTypeId)] : undefined;
    // MODÈLE : libellé du CATALOGUE pour l'id de l'annonce quand on le
    // connaît (constat 21/09, Mach-E ES : le site écrit « Mustang MachE » sur
    // une annonce et « Mustang Mach-E » sur les autres pour le même modelId
    // 1326 — la confirmation structurée tombait à 5/6). L'id fait foi.
    const catalogModel = it.makeId != null && it.modelId != null ? LEARNED_MODEL_LABEL.get(`${it.makeId}|${it.modelId}`) : undefined;
    const model = (catalogModel ?? it.model ?? '').trim() || null;
    const offer = it.offerType?.literal ?? '';
    const provinceId = it.provinceId ?? it.location?.mainProvinceId;
    const provincePrefix = Number.isFinite(Number(provinceId)) && Number(provinceId) > 0 ? String(provinceId).padStart(2, '0') : null;
    const drop = it.priceDrop && Number.isFinite(Number(it.priceDrop.originalPrice))
      ? `Baisse de prix : ${it.priceDrop.originalPrice} € → ${price} € (−${it.priceDrop.percentage ?? '?'} %, il y a ${it.priceDrop.daysSinceUpdate ?? '?'} j)` : '';
    out.push({
      title: (it.title ?? [it.make, it.model].filter(Boolean).join(' ')).trim(),
      description: [offer && `Oferta: ${offer}`, drop, it.photos?.length ? `${it.photos.length} photos` : ''].filter(Boolean).join(' · '),
      price,
      currency: 'EUR',
      // Renting = mensualité (bundle : offerType « Renting ») ; le reste = prix de vente.
      price_type: /renting/i.test(offer) ? 'per-month' : 'one-off',
      year: Number.isFinite(year) && year > 1900 ? year : null,
      mileage: Number.isFinite(km) && km >= 0 ? km : null,
      trim: null,
      listing_url: url,
      brand: it.make?.trim() || null,
      model,
      fuel: it.fuelType?.trim() || (it.fuelTypeId != null ? FUEL_LABEL[String(it.fuelTypeId)] ?? null : null),
      powerDin: Number.isFinite(hp) && hp > 0 ? hp : null,
      vehicleType: bodyToken ? bodyLabel(bodyToken) : null,
      sellerType: it.isProfessional == null ? null : it.isProfessional ? 'Profesional' : 'Particular',
      publishedAt: parsePublishedAt(it.publicationDate ?? it.creationDate),
      postalCode: provincePrefix,
      // Hors TVA UE (décision Channing 21/09) : le régime fiscal du site fait
      // foi (taxTypeId 2 = IGIC → Canaries), la province en repli (35/38
      // Canaries, 51/52 Ceuta / Melilla — IPSI, que le site range sous IVA).
      fiscalTerritory: it.taxTypeId === 2 ? 'Canaries (IGIC)' : fiscalTerritoryOf('ES', provincePrefix),
    });
  }
  return out;
}

/** Total du site : `"totalPages":41,"totalResults":1204` — l'ordre des clés est prouvé ; « totalResults » seul existe aussi par facette d'agrégation. */
function readTotalCount(html: string): number | null {
  const props = extractInitialProps(html);
  const t = props?.initialResults?.totalResults;
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
}

// ─── Construction d'URL ──────────────────────────────────────────────────────

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const pairs: Array<[string, string]> = [];
  const makeId = params.brand ? brandIdFor(params.brand) : undefined;
  if (params.brand && !makeId) {
    warnings.push(`[LINKGEN_WARNING] Coches.net: marque "${params.brand}" sans id appris (cn:make à moissonner) — recherche large`);
  }
  if (makeId) pairs.push(['MakeIds[0]', makeId]);
  const modelId = makeId && params.model ? modelIdFor(makeId, params.model) : undefined;
  if (params.model && makeId && !modelId) {
    warnings.push(`[LINKGEN_WARNING] Coches.net: modèle "${params.model}" sans id appris (cn:model:${makeId}) — page marque, tri structuré en aval`);
  }
  if (modelId) pairs.push(['ModelIds[0]', modelId]);
  // JUMEAU ÉLECTRIQUE (21/09) : paires index-alignées MakeIds[1]/ModelIds[1]
  // — seule forme prouvée (Mokka 1036 + Mokka-e 1333 → 3 annonces ; les
  // formes « 1036,1333 » ou ModelIds[1] seul font TOMBER le filtre modèle :
  // 20 Opel de tous modèles). Jamais sans id appris.
  let electricSibling: string | undefined;
  if (makeId && modelId && params.model && wantsElectricSibling(params.fuel)) {
    for (const [k, label] of LEARNED_MODEL_LABEL) {
      if (!k.startsWith(`${makeId}|`)) continue;
      const sibId = k.slice(makeId.length + 1);
      if (sibId !== modelId && isElectricSiblingOf(label, String(params.model))) {
        pairs.push(['MakeIds[1]', makeId], ['ModelIds[1]', sibId]);
        electricSibling = label;
        break;
      }
    }
  }
  const { yearFrom, yearTo } = resolveYearRange(params);
  if (yearFrom) pairs.push(['MinYear', yearFrom]);
  if (yearTo) pairs.push(['MaxYear', yearTo]);
  const km = Number(params.mileage ?? '');
  if (Number.isFinite(km) && km > 0) pairs.push(['MaxKms', String(km)]);
  const ch = Number(params.minPower ?? params.powerFrom ?? '');
  if (Number.isFinite(ch) && ch > 0) pairs.push(['PowerHpFrom', String(ch)]);
  const chTo = Number(params.powerTo ?? '');
  if (Number.isFinite(chTo) && chTo > 0) pairs.push(['PowerHpTo', String(chTo)]);
  const fuelCode = params.fuel ? FUEL_CODE[String(params.fuel).trim().toUpperCase()] : undefined;
  if (params.fuel && !fuelCode) warnings.push(`[LINKGEN_WARNING] Coches.net: carburant "${params.fuel}" sans code Fueltype2List prouvé — filtre omis`);
  if (fuelCode) pairs.push(['Fueltype2List', fuelCode]);
  const g = String(params.gearbox ?? '').trim().toUpperCase();
  if (/^AUTOMAT|^AUTO$/.test(g)) pairs.push(['TransmissionTypeId', '1']);
  else if (/^MANUEL|^MANUAL/.test(g)) pairs.push(['TransmissionTypeId', '2']);
  const body = params.vehicleType ? BODY_CODE[canonicalizeBody(String(params.vehicleType))] : undefined;
  if (params.vehicleType && !body) warnings.push(`[LINKGEN_WARNING] Coches.net: carrosserie "${params.vehicleType}" sans code ArrBodyType prouvé — filtre omis`);
  if (body) pairs.push(['ArrBodyType', body]);
  const trim = String(params.trim ?? '').trim();
  if (trim) pairs.push(['KeyWords', trim]);
  if (params.sort !== 'relevance') { pairs.push(['fi', 'Price']); pairs.push(['or', '1']); }
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return {
    url: `https://www.coches.net/search/${qs ? `?${qs}` : ''}`,
    warnings,
    modelExpressed: !params.model || Boolean(modelId),
    ...(electricSibling ? { electricSibling } : {}),
  };
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
  const listings = parseSearchResults(html);
  const wantBrand = brandKey(params.brand ?? '');
  const brandHits = wantBrand ? listings.filter((l) => brandKey(l.brand ?? '') === wantBrand).length : listings.length;
  const brandOk = listings.length > 0 && brandHits / listings.length >= 0.8;
  const wantModelKey = params.model ? modelKeyOf(params.model) : '';
  const modelHits = wantModelKey ? listings.filter((l) => modelKeyOf(l.model ?? '') === wantModelKey).length : 0;
  const modelOk = wantModelKey ? modelHits / Math.max(1, listings.length) >= 0.8 : false;
  const issues: SiteValidationResult['issues'] = [];
  if (!brandOk && wantBrand) issues.push({ type: 'brand_missing' });
  if (params.model && !/ModelIds(%5B|\[)0(%5D|\])=\d/.test(url)) issues.push({ type: 'model_not_applied' });
  if (listings.length === 0) issues.push({ type: 'no_listings' });
  return {
    site: 'COCHES', url, listingCount,
    sampleListings: listings.slice(0, 5).map((l) => ({ title: l.title, price: l.price, year: l.year, mileage: l.mileage, fuel: l.fuel ?? '', url: l.listing_url })),
    appliedFilters: {
      brand: brandOk, model: modelOk,
      year: /MinYear=|MaxYear=/.test(url), mileage: /MaxKms=|MinKms=/.test(url),
      fuel: /Fueltype2List=/.test(url), trim: /KeyWords=/.test(url), sort: /[?&]fi=/.test(url),
    },
    score: brandOk ? (modelOk ? 90 : 70) : 30,
    status: listings.length === 0 ? 'invalid' : brandOk ? (modelOk ? 'valid' : 'partial') : 'invalid',
    issues,
    evidence: {
      structuredFieldsAvailable: true,
      fieldsUsed: ['brand', 'model', 'fuel', 'year', 'mileage', 'price', 'publishedAt', 'sellerType'],
      missingFields: ['gearbox', 'trim'],
    },
  };
}

// ─── Ingestion (URL collée) ──────────────────────────────────────────────────

function queryOf(url: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const u = new URL(url);
    for (const [k, v] of u.searchParams.entries()) out.set(k, v);
  } catch { /* URL illisible */ }
  return out;
}

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const out: Partial<SearchCriteria> = {};
  const q = queryOf(url);
  const makeId = q.get('MakeIds[0]');
  if (makeId) {
    const label = LEARNED_BRAND_LABEL.get(makeId) ?? Object.entries(BRAND_ID_SEED).find(([, id]) => id === makeId)?.[0];
    if (label) out.brand = label;
    const modelId = q.get('ModelIds[0]');
    if (modelId) {
      const ml = LEARNED_MODEL_LABEL.get(`${makeId}|${modelId}`)
        ?? Object.entries(MODEL_ID_SEED).find(([k, id]) => id === modelId && k.startsWith(`${makeId}|`))?.[0]?.split('|')[1];
      if (ml) out.model = ml.toUpperCase();
    }
  }
  const num = (name: string) => { const v = q.get(name); return v && /^\d+$/.test(v) ? v : null; };
  const ymin = num('MinYear'); if (ymin) out.yearFrom = ymin;
  const ymax = num('MaxYear'); if (ymax) out.yearTo = ymax;
  const kmax = num('MaxKms'); if (kmax) out.mileage = kmax;
  const pmin = num('PowerHpFrom'); if (pmin) { out.minPower = pmin; out.powerFrom = pmin; }
  const pmax = num('PowerHpTo'); if (pmax) out.powerTo = pmax;
  const fuel = q.get('Fueltype2List'); if (fuel && FUEL_CODE_TO_CANON[fuel]) out.fuel = FUEL_CODE_TO_CANON[fuel];
  const tr = q.get('TransmissionTypeId');
  if (tr === '1') out.gearbox = 'Automatique'; else if (tr === '2') out.gearbox = 'Manuelle';
  const kw = q.get('KeyWords'); if (kw?.trim()) out.trim = kw.trim();
  const body = q.get('ArrBodyType'); if (body && BODY_TOKEN[body]) out.vehicleType = bodyLabel(BODY_TOKEN[body]);
  return out;
}

function extractCandidateSegments(url: string): CandidateSegment[] {
  const GUESS: Record<string, CandidateSegment['guessField']> = {
    'MakeIds[0]': 'brand', 'ModelIds[0]': 'model',
    MinYear: 'year', MaxYear: 'year', MinKms: 'mileage', MaxKms: 'mileage',
    PowerHpFrom: 'power', PowerHpTo: 'power', Fueltype2List: 'fuel',
    TransmissionTypeId: 'gearbox', KeyWords: 'trim', ArrBodyType: 'vehicleType',
  };
  const out: CandidateSegment[] = [];
  for (const [k, v] of queryOf(url)) {
    if (!v) continue;
    out.push({ raw: v, location: 'query', paramName: k, guessField: GUESS[k] });
  }
  return out;
}

// ─── Moisson taxonomie ───────────────────────────────────────────────────────

/** Catalogue COMPLET de la page (listFiltersOptions.vehicles : 165 marques ×
 *  modèles avec ids) + ids portés par les annonces. Champs : cn:make (id →
 *  libellé), cn:model:<makeId> (id → libellé), cn:fuel, cn:body. */
function catalogEntries(props: CnProps): Array<{ field: string; code: string; label: string }> {
  const out: Array<{ field: string; code: string; label: string }> = [];
  const seen = new Set<string>();
  const push = (field: string, code: string, label: string) => {
    const c = String(code ?? '').trim(), l = String(label ?? '').trim();
    if (!c || !l) return;
    const k = `${field}|${c}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ field, code: c, label: l });
  };
  for (const v of props.listFiltersOptions?.vehicles?.options ?? []) {
    push('cn:make', String(v.id), v.label);
    for (const m of v.models ?? []) push(`cn:model:${v.id}`, String(m.id), m.label);
  }
  for (const it of props.initialResults?.items ?? []) {
    if (it.makeId != null && it.make) push('cn:make', String(it.makeId), it.make);
    if (it.makeId != null && it.modelId != null && it.model) push(`cn:model:${it.makeId}`, String(it.modelId), it.model);
    if (it.fuelTypeId != null && it.fuelType) push('cn:fuel', String(it.fuelTypeId), it.fuelType);
    if (it.bodyTypeId != null && BODY_LABEL[String(it.bodyTypeId)]) push('cn:body', String(it.bodyTypeId), BODY_LABEL[String(it.bodyTypeId)]);
  }
  return out;
}

function harvestTaxonomy(html: string): Array<{ field: string; code: string; label: string }> {
  const props = extractInitialProps(html);
  if (!props) return [];
  const out = catalogEntries(props);
  // La moisson nourrit aussi l'adaptateur en session (même scrape).
  learnFromEntries(out);
  return out;
}

function learnFromEntries(entries: Array<{ field: string; code: string; label: string }>): void {
  for (const e of entries) {
    if (e.field === 'cn:make') {
      LEARNED_BRAND_ID.set(brandKey(e.label), e.code);
      LEARNED_BRAND_LABEL.set(e.code, e.label.toUpperCase());
    } else if (e.field.startsWith('cn:model:')) {
      const makeId = e.field.slice('cn:model:'.length);
      LEARNED_MODEL_ID.set(`${makeId}|${modelKeyOf(e.label)}`, e.code);
      LEARNED_MODEL_LABEL.set(`${makeId}|${e.code}`, e.label);
    }
  }
}

function learnEnumValues(field: string, pairs: Array<{ code: string; label: string }>): void {
  learnFromEntries(pairs.map((p) => ({ field, code: p.code, label: p.label })));
}

// ─── Adaptateur ──────────────────────────────────────────────────────────────

export const cochesAdapter: SiteAdapter = {
  key: 'COCHES',
  displayName: 'Coches.net',
  country: 'Spain',
  countryCode: 'ES',
  domain: 'coches.net',
  urlTemplate: URL_TEMPLATE,

  mapBrand: (raw) => brandIdFor(raw) ?? '',
  mapModel: (raw) => raw.trim(),
  mapFuel: (raw) => FUEL_CODE[raw.trim().toUpperCase()] ?? '',
  supportsParam: (p) => p === 'minPower',

  buildSearchUrl,
  // pg=N — PROUVÉ (placeholder de pagination de la page et pg=2 en direct).
  buildPaginatedUrl: (baseUrl: string, pageNumber: number): string =>
    pageNumber <= 1 ? baseUrl : setParamSurgical(baseUrl, 'pg', String(pageNumber)),

  parseSearchResults: (html: string) => parseSearchResults(html),
  scoreSearchResults,
  generateCorrectionHypotheses: () => [],

  // Navigateur + Espagne à chaque essai (reconnaissance 21/09 : brut → 520
  // systématique, navigateur ES → 1,4 Mo). Attente courte dès le 2e essai.
  getFetchProfile: (attempt: number): ZyteProfileOverrides =>
    attempt <= 1
      ? { geolocation: 'ES' }
      : { geolocation: 'ES', actions: [{ action: 'waitForTimeout', timeout: 5 }] },

  detectBlocked: (html: string, hasListings: boolean): boolean =>
    !hasListings && !html.includes('__INITIAL_PROPS__'),

  // totalResults 0 = marché vide déclaré par le site (prouvé : Clase C
  // « Monovolumen » → total 0, items []) ; total > 0 sans annonce parsée =
  // tripwire structure ; page sans JSON = pas de verdict.
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

/** Total du site pour le worker (clé prouvée `initialResults.totalResults`). */
export function cochesTotalCount(html: string): number | null {
  return readTotalCount(html);
}
