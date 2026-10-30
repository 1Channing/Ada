/**
 * JOFOGAS.HU (auto.jofogas.hu) — adaptateur v1 (02/08/2026), écrit sur PREUVE.
 *
 * Étalon : paires d'URLs humaines Channing du 02/08 soir :
 *   /magyarorszag/auto/toyota/rav-4-/hibrid?me=90000&re=2023&rs=2000
 *   … + finition   : &q=gr%20sport
 *   … + prix asc   : &sp=1
 *   … diesel       : /toyota/rav-4-/dizel?…
 *   … page 2       : &o=2
 *   … sans modèle  : /toyota/dizel?…
 * → grammaire /magyarorszag/auto/{brand}/{model}/{fuel} (segments polymorphes
 *   comme Subito — même plateforme), me=km max, rs/re=années, q=texte, sp=1
 *   prix croissant, o=N pagination.
 *
 * Recon 02/08 (rec-jofogas*.json) : page HTML pure (aucun blob JSON), annonces
 * en MICRODATA schema.org par carte `reListElement` :
 *   meta itemprop=name/url · a.subject href=fiche .htm · itemprop=price
 *   content= (HUF) · vehicle-brand / vehicle-model / vehicle-fuel /
 *   vehicle-reg-date · badge-company_ad = pro.
 *
 * MODÈLE : slug réel « rav-4- » (tiret FINAL non dérivable mécaniquement) —
 * jamais inventé : les graines PROUVÉES par URL humaine posent le segment
 * (MODEL_PATH_SLUG) ; sinon l'identifiant du site mo_cars, appris des
 * annonces (30/10) ; sinon page marque + tri structuré en aval. Prix en HUF
 * (converti EUR).
 */

import type {
  SiteAdapter, SearchCriteria, BuildUrlResult,
  SiteValidationResult, ZyteProfileOverrides, CandidateSegment,
} from './types';
import type { ScrapedListing } from '../types';
import { parsePublishedAt } from '../parsers/shared';
import { jofogasSeller } from '../parsers/seller';
import { resolveYearRange } from './urlTemplate';
import { modelFamilyKey } from '../business-logic';
import { bodyLabel } from '../bodyTypes';

const URL_TEMPLATE = 'https://auto.jofogas.hu/magyarorszag/auto/{brand}/{fuel}?me={mileage}&rs={yearFrom}&re={yearTo}';

// Slugs carburant PROUVÉS par URLs humaines (hibrid, dizel — 02/08 ;
// elektromos, benzin — 26/08 : /tesla/model-3/elektromos, /…/benzin).
const FUEL_SLUG: Record<string, string> = {
  HYBRIDE: 'hibrid', HYBRID: 'hibrid', HIBRID: 'hibrid',
  PLUG_IN_HYBRID: 'hibrid', MILD_HYBRID: 'hibrid',
  DIESEL: 'dizel', DIZEL: 'dizel',
  ELECTRIQUE: 'elektromos', ELECTRIC: 'elektromos', ELEKTROMOS: 'elektromos',
  ESSENCE: 'benzin', PETROL: 'benzin', GASOLINE: 'benzin', BENZIN: 'benzin',
};
const FUEL_PATH_TO_CANON: Record<string, string> = {
  hibrid: 'HYBRIDE', dizel: 'DIESEL', elektromos: 'ELECTRIQUE', benzin: 'ESSENCE',
};

// Slugs MODÈLE du chemin — grammaire /magyarorszag/auto/{brand}/{model}/{fuel}
// PROUVÉE par URLs humaines 26/08 (/toyota/rav-4-/hibrid, /tesla/model-3/
// elektromos). Le slug n'est PAS dérivable mécaniquement (« rav-4- » porte un
// tiret FINAL qu'aucun slugify ne produit) → seules les graines prouvées
// posent le segment ; modèle inconnu = page marque + tri structuré en aval
// (comportement v1 conservé). La voie URL apprise couvre le reste.
const MODEL_PATH_SLUG: Record<string, string> = {
  'TOYOTA|RAV4': 'rav-4-',
  'TESLA|MODEL3': 'model-3',
};
const canonKey = (v: string) =>
  (v ?? '').toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Z0-9]/g, '');
const brandKey = (v: string) => {
  const k = canonKey(v);
  return k === 'MERCEDESBENZ' ? 'MERCEDES' : k === 'VW' ? 'VOLKSWAGEN' : k;
};

// IDENTIFIANT MODÈLE DU SITE (mo_cars) — PROUVÉ live 30/10 :
//   /toyota/hibrid?mo_cars=33&me=90000&rs=2021&re=2024 → 2/2 RAV 4 hybrides ;
//   /toyota/hibrid?mo_cars=49&rs=2020 → 14/14 C-HR hybrides.
// L'identifiant est propre à la marque (1..N) et vient du SITE lui-même : le
// paramètre model_cars de chaque annonce ({ value: '33', label: 'RAV 4' }),
// moissonné en jf:modelid:<marque>. Jamais déduit d'un libellé (la moisson
// jf:model:* — slugify du libellé — reste un relevé, jamais posé dans l'URL).
const LEARNED_MODEL_ID: Record<string, string> = {};
const LEARNED_MODEL_LABEL: Record<string, string> = {};
const learnedModelId = (brand: string, model: string): string | undefined =>
  LEARNED_MODEL_ID[`${brandKey(brand)}|${canonKey(model)}`];

const slugify = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

type JfParam = { key?: string; values?: Array<{ value?: unknown; label?: unknown }> };
type JfAd = {
  url?: string; subject?: string; body?: string; company_ad?: boolean;
  price?: { value?: unknown }; parameters?: JfParam[]; list_time?: { value?: unknown };
};

/**
 * Page Next.js (relevé 17/10 sur auto.jofogas.hu : plus aucune carte
 * `reListElement`) : les annonces vivent dans __NEXT_DATA__ →
 * props.pageProps.adList.ads, chacune avec ses paramètres structurés
 * (brand_cars, model_cars, regdate, mileage, fuel, car_type, zipcode, city)
 * et son vendeur (company_ad, company_name, account_list_id, profileData).
 */
function parseNextAds(html: string): ScrapedListing[] | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let ads: JfAd[];
  try {
    const data = JSON.parse(m[1]) as { props?: { pageProps?: { adList?: { ads?: unknown } } } };
    const list = data.props?.pageProps?.adList?.ads;
    if (!Array.isArray(list)) return null;
    ads = list as JfAd[];
  } catch { return null; }
  const param = (ad: JfAd, key: string, field: 'value' | 'label'): string | null => {
    const v = ad.parameters?.find((p) => p.key === key)?.values?.[0]?.[field];
    return v == null ? null : String(v).trim() || null;
  };
  const out: ScrapedListing[] = [];
  for (const ad of ads) {
    const price = Number(ad.price?.value);
    const url = ad.url ?? '';
    if (!Number.isFinite(price) || price <= 0 || !url) continue;
    const year = Number(param(ad, 'regdate', 'value'));
    const mileage = Number(param(ad, 'mileage', 'value'));
    const listed = Number(ad.list_time?.value);
    out.push({
      title: ad.subject ?? '', description: (ad.body ?? '').replace(/<br\s*\/?>/gi, ' ').slice(0, 300),
      price, currency: 'HUF', price_type: 'one-off',
      year: Number.isFinite(year) && year > 1900 ? year : null,
      mileage: Number.isFinite(mileage) && mileage > 0 ? mileage : null,
      trim: null, listing_url: url,
      brand: param(ad, 'brand_cars', 'label'), model: param(ad, 'model_cars', 'label'),
      fuel: param(ad, 'fuel', 'label'), vehicleType: param(ad, 'car_type', 'label'),
      sellerType: ad.company_ad ? 'pro' : 'private',
      publishedAt: Number.isFinite(listed) && listed > 0 ? parsePublishedAt(new Date(listed * 1000).toISOString()) : null,
      seller: jofogasSeller(ad),
    });
  }
  return out;
}

/** Cartes microdata `reListElement` — champs 100 % structurés (ancienne page) ; la page Next.js d'abord. */
function parseSearchResults(html: string): ScrapedListing[] {
  const fromNext = parseNextAds(html);
  if (fromNext && fromNext.length > 0) return fromNext;
  const out: ScrapedListing[] = [];
  const cards = html.split(/class="[^"]*reListElement[^"]*"/).slice(1);
  for (const c of cards) {
    const title = c.match(/itemprop="name" content="([^"]*)"/)?.[1] ?? '';
    const url = c.match(/<a class="subject\s*"[^>]*href="([^"]+\.htm)"/)?.[1] ?? '';
    const priceRaw = c.match(/itemprop="price" content="(\d+)"/)?.[1];
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) continue;
    const brand = c.match(/class="vehicle-brand">([^<]*)</)?.[1]?.trim() ?? null;
    const model = c.match(/class="vehicle-model">\s*([^<]*)</)?.[1]?.trim() ?? null;
    const fuel = c.match(/class="vehicle-fuel"[^>]*>([^<]*)</)?.[1]?.trim() ?? null;
    const year = Number(c.match(/class="vehicle-reg-date"[^>]*>(\d{4})</)?.[1]);
    out.push({
      title, description: '', price, currency: 'HUF', price_type: 'one-off',
      year: Number.isFinite(year) ? year : null,
      mileage: null, // absent des cartes (me= filtre côté serveur)
      trim: null, listing_url: url,
      brand, model, fuel,
      sellerType: /badge-company_ad/.test(c) ? 'pro' : null,
      // Carte datée « 2026. 06. 19 » ou relative ma/tegnap (sonde 28/08).
      publishedAt: parsePublishedAt(
        c.match(/\b(\d{4}\.\s*\d{2}\.\s*\d{2})\b/)?.[1]
        ?? c.match(/>\s*(ma|tegnap)\s*[,<]/i)?.[1],
      ),
    });
  }
  return out;
}

/** Les identifiants modèle des annonces Next.js : { marque, id, libellé } (model_cars). */
function nextModelIds(html: string): Array<{ brand: string; id: string; label: string }> {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return [];
  let ads: JfAd[];
  try {
    const list = (JSON.parse(m[1]) as { props?: { pageProps?: { adList?: { ads?: unknown } } } }).props?.pageProps?.adList?.ads;
    if (!Array.isArray(list)) return [];
    ads = list as JfAd[];
  } catch { return []; }
  const out: Array<{ brand: string; id: string; label: string }> = [];
  for (const ad of ads) {
    const val = (key: string) => ad.parameters?.find((p) => p.key === key)?.values?.[0];
    const brand = String(val('brand_cars')?.label ?? '').trim();
    const id = String(val('model_cars')?.value ?? '').trim();
    const label = String(val('model_cars')?.label ?? '').trim();
    if (brand && /^\d+$/.test(id) && label) out.push({ brand, id, label });
  }
  return out;
}

/** Moisson : marque/modèle/carburant structurés des cartes (labels du site). */
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
    if (brand) push('jf:brand', slugify(brand), brand);
    if (brand && model) push(`jf:model:${slugify(brand)}`, slugify(model), model);
    const fuel = (l.fuel ?? '').trim();
    if (fuel) push('jf:fuel', slugify(fuel), fuel);
  }
  for (const x of nextModelIds(html)) push(`jf:modelid:${slugify(x.brand)}`, x.id, x.label);
  return out;
}

/** Réinjection du dictionnaire : seuls les identifiants modèle du site (jf:modelid:<marque>) servent à l'URL. */
function learnEnumValues(field: string, pairs: Array<{ code: string; label: string }>): void {
  const m = field.match(/^jf:modelid:(.+)$/);
  if (!m) return;
  const bk = brandKey(m[1]);
  for (const p of pairs) {
    if (!/^\d+$/.test(p.code) || !p.label) continue;
    const key = `${bk}|${canonKey(p.label)}`;
    if (!LEARNED_MODEL_ID[key]) { LEARNED_MODEL_ID[key] = p.code; LEARNED_MODEL_LABEL[`${bk}|${p.code}`] = p.label; }
  }
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const brandSlug = slugify(params.brand || '');
  const fuelSlug = params.fuel ? FUEL_SLUG[String(params.fuel).trim().toUpperCase()] : undefined;
  if (params.fuel && !fuelSlug) {
    warnings.push(`[LINKGEN_WARNING] Jofogas: carburant "${params.fuel}" sans slug prouvé — filtre omis`);
  }
  const modelSlug = params.model
    ? MODEL_PATH_SLUG[`${canonKey(params.brand || '')}|${canonKey(params.model)}`]
    : undefined;
  // Sans graine de chemin : l'identifiant du site appris (mo_cars), en query.
  const modelId = params.model && !modelSlug ? learnedModelId(params.brand || '', params.model) : undefined;
  if (params.model && !modelSlug && !modelId) {
    warnings.push('[LINKGEN_WARNING] Jofogas: modèle sans slug de chemin prouvé ni identifiant mo_cars appris — page marque, tri structuré en aval');
  }
  const qs = new URLSearchParams();
  if (modelId) qs.set('mo_cars', modelId);
  if (params.mileage) qs.set('me', String(params.mileage));
  // Finition texte libre — URL humaine ?q=gr%20sport.
  if (params.trim && String(params.trim).trim()) qs.set('q', String(params.trim).trim().toLowerCase());
  const { yearFrom, yearTo } = resolveYearRange(params);
  // ANNÉES TOUJOURS POSÉES (constat Channing 01/08 : sans elles le site
  // bloque la recherche) — défaut large 2000→ si l'appelant n'en donne pas.
  qs.set('rs', yearFrom || '2000');
  if (yearTo) qs.set('re', yearTo);
  // Tri prix croissant sp=1 (paire d'URLs humaines) ; découverte = défaut du site.
  if (params.sort !== 'relevance') qs.set('sp', '1');
  const path = `/magyarorszag/auto/${brandSlug}${modelSlug ? `/${modelSlug}` : ''}${fuelSlug ? `/${fuelSlug}` : ''}`;
  return {
    url: `https://auto.jofogas.hu${path}?${qs.toString()}`, warnings,
    modelExpressed: !params.model || Boolean(modelSlug || modelId),
  };
}

function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
  const listings = parseSearchResults(html);
  const wantBrand = (params.brand ?? '').trim().toLowerCase();
  const brandHits = wantBrand ? listings.filter((l) => (l.brand ?? '').toLowerCase().includes(wantBrand)).length : listings.length;
  const brandOk = listings.length > 0 && brandHits / listings.length >= 0.8;
  const wantModelKey = params.model ? modelFamilyKey(params.model) : '';
  const modelHits = wantModelKey ? listings.filter((l) => modelFamilyKey(l.model) === wantModelKey).length : 0;
  const issues: SiteValidationResult['issues'] = [];
  if (!brandOk && wantBrand) issues.push({ type: 'brand_missing' });
  const modelPosed = Boolean(params.model
    && (MODEL_PATH_SLUG[`${canonKey(params.brand || '')}|${canonKey(params.model || '')}`] || learnedModelId(params.brand || '', params.model || '')));
  if (params.model && !modelPosed) issues.push({ type: 'model_not_applied' }); // ni slug de chemin prouvé, ni mo_cars appris
  if (listings.length === 0) issues.push({ type: 'no_listings' });
  return {
    site: 'JOFOGAS', url, listingCount,
    sampleListings: listings.slice(0, 5).map((l) => ({ title: l.title, price: l.price, year: l.year, mileage: l.mileage, fuel: l.fuel ?? '', url: l.listing_url })),
    appliedFilters: {
      brand: brandOk, model: wantModelKey ? modelHits / Math.max(1, listings.length) >= 0.8 : false,
      year: true, mileage: true,
      fuel: Boolean(params.fuel && FUEL_SLUG[String(params.fuel).toUpperCase()]), trim: false, sort: true,
    },
    score: brandOk ? 70 : 30,
    status: listings.length === 0 ? 'invalid' : brandOk ? 'partial' : 'invalid',
    issues,
    evidence: { structuredFieldsAvailable: true, fieldsUsed: ['brand', 'model', 'fuel', 'year', 'price'], missingFields: ['mileage'] },
  };
}

// Slugs carrosserie du chemin (URLs humaines 30/08) — multi par + dans le
// même segment (/suv+terepjaro = SUV, « on combine les deux »).
const BODY_PATH_TO_TOKEN: Record<string, string> = {
  sedan: 'berline', 'coupe-10': 'coupe', 'cabrio-3': 'cabriolet',
  ferdehatu: 'citadine', kisbusz: 'monospace', kombi: 'break',
  suv: 'suv', terepjaro: 'suv',
};

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const out: Partial<SearchCriteria> = {};
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('auto');
    const isBodySeg = (s: string) => s.split('+').every((t) => BODY_PATH_TO_TOKEN[t.toLowerCase()]);
    // /auto/sedan (sans marque) : une carrosserie n'est pas une marque.
    if (i >= 0 && segs[i + 1] && !isBodySeg(segs[i + 1])) {
      out.brand = segs[i + 1].replace(/-/g, ' ').trim().toUpperCase();
    }
    for (const seg of segs.slice(i + 1)) {
      const canon = FUEL_PATH_TO_CANON[seg];
      if (seg === segs[i + 1] && out.brand) continue; // la marque déjà lue
      if (canon) out.fuel = canon;
      else if (isBodySeg(seg)) {
        const toks = [...new Set(seg.split('+').map((t) => BODY_PATH_TO_TOKEN[t.toLowerCase()]))];
        if (toks.length === 1) out.vehicleType = bodyLabel(toks[0]);
      } else if (out.brand && !out.model) out.model = seg.replace(/-+/g, ' ').trim().toUpperCase();
    }
    // mo_cars : l'identifiant du site, relu par le dictionnaire appris.
    const mo = u.searchParams.get('mo_cars');
    const moLabel = mo && out.brand ? LEARNED_MODEL_LABEL[`${brandKey(out.brand)}|${mo}`] : undefined;
    if (moLabel && !out.model) out.model = moLabel.toUpperCase();
    const q = u.searchParams.get('q');
    if (q) out.trim = q;
    const rs = u.searchParams.get('rs'), re = u.searchParams.get('re'), me = u.searchParams.get('me');
    if (rs && /^\d{4}$/.test(rs)) out.yearFrom = rs;
    if (re && /^\d{4}$/.test(re)) out.yearTo = re;
    if (me && /^\d+$/.test(me)) out.mileage = me;
  } catch { /* URL illisible */ }
  return out;
}

function extractCandidateSegments(url: string): CandidateSegment[] {
  const out: CandidateSegment[] = [];
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('auto');
    if (i >= 0 && segs[i + 1]) out.push({ raw: segs[i + 1], location: 'path', paramName: '_path:brand', guessField: 'brand' });
    for (const seg of segs.slice(i + 2)) {
      const isFuel = Boolean(FUEL_PATH_TO_CANON[seg]);
      out.push({ raw: seg, location: 'path', paramName: isFuel ? '_path:fuel' : '_path:model', guessField: isFuel ? 'fuel' : 'model' });
    }
    for (const [p, f] of [['mo_cars', 'model'], ['rs', 'year'], ['re', 'year'], ['me', 'mileage']] as const) {
      const v = u.searchParams.get(p);
      if (v) out.push({ raw: v, location: 'query', paramName: p, guessField: f });
    }
  } catch { /* ignore */ }
  return out;
}

export const jofogasAdapter: SiteAdapter = {
  key: 'JOFOGAS',
  displayName: 'Jófogás',
  country: 'Hungary',
  countryCode: 'HU',
  domain: 'jofogas.hu',
  urlTemplate: URL_TEMPLATE,

  mapBrand: (raw) => slugify(raw),
  mapModel: (raw) => raw.trim(),
  mapFuel: (raw) => FUEL_SLUG[raw.trim().toUpperCase()] ?? '',
  supportsParam: () => false,

  buildSearchUrl,
  // Pagination o=N — PROUVÉE par paire d'URLs humaines (page 2 : &o=2).
  buildPaginatedUrl: (baseUrl: string, pageNumber: number): string => {
    if (pageNumber <= 1) return baseUrl;
    try {
      const u = new URL(baseUrl);
      u.searchParams.set('o', String(pageNumber));
      return u.toString();
    } catch { return baseUrl; }
  },
  parseSearchResults: (html: string) => parseSearchResults(html),
  scoreSearchResults,
  generateCorrectionHypotheses: () => [],
  getFetchProfile: (): ZyteProfileOverrides => ({}),

  harvestTaxonomy,
  learnEnumValues,
  prefillCriteriaFromUrl,
  extractCandidateSegments,
};
