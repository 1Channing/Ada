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
 * jamais inventé : v1 sans modèle en URL (page marque + tri structuré en
 * aval), la voie URL apprise porte les modèles. Prix en HUF (converti EUR).
 */

import type {
  SiteAdapter, SearchCriteria, BuildUrlResult,
  SiteValidationResult, ZyteProfileOverrides, CandidateSegment,
} from './types';
import type { ScrapedListing } from '../types';
import { resolveYearRange } from './urlTemplate';
import { modelKeyLoose } from '../business-logic';

const URL_TEMPLATE = 'https://auto.jofogas.hu/magyarorszag/auto/{brand}/{fuel}?me={mileage}&rs={yearFrom}&re={yearTo}';

// Slugs carburant PROUVÉS par URLs humaines (hibrid, dizel — 02/08).
const FUEL_SLUG: Record<string, string> = {
  HYBRIDE: 'hibrid', HYBRID: 'hibrid', HIBRID: 'hibrid',
  PLUG_IN_HYBRID: 'hibrid', MILD_HYBRID: 'hibrid',
  DIESEL: 'dizel', DIZEL: 'dizel',
};
const FUEL_PATH_TO_CANON: Record<string, string> = { hibrid: 'HYBRIDE', dizel: 'DIESEL' };

const slugify = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Cartes microdata `reListElement` — champs 100 % structurés. */
function parseSearchResults(html: string): ScrapedListing[] {
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
    });
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
  return out;
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];
  const brandSlug = slugify(params.brand || '');
  const fuelSlug = params.fuel ? FUEL_SLUG[String(params.fuel).trim().toUpperCase()] : undefined;
  if (params.fuel && !fuelSlug) {
    warnings.push(`[LINKGEN_WARNING] Jofogas: carburant "${params.fuel}" sans slug prouvé — filtre omis`);
  }
  if (params.model) {
    warnings.push('[LINKGEN_WARNING] Jofogas v1: modèle non posé en URL (slug « rav-4- » à tiret final non dérivable) — page marque, tri structuré en aval');
  }
  const qs = new URLSearchParams();
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
  const path = `/magyarorszag/auto/${brandSlug}${fuelSlug ? `/${fuelSlug}` : ''}`;
  return { url: `https://auto.jofogas.hu${path}?${qs.toString()}`, warnings };
}

function scoreSearchResults(html: string, url: string, params: SearchCriteria, listingCount: number): SiteValidationResult {
  const listings = parseSearchResults(html);
  const wantBrand = (params.brand ?? '').trim().toLowerCase();
  const brandHits = wantBrand ? listings.filter((l) => (l.brand ?? '').toLowerCase().includes(wantBrand)).length : listings.length;
  const brandOk = listings.length > 0 && brandHits / listings.length >= 0.8;
  const wantModelKey = params.model ? modelKeyLoose(params.model) : '';
  const modelHits = wantModelKey ? listings.filter((l) => modelKeyLoose(l.model) === wantModelKey).length : 0;
  const issues: SiteValidationResult['issues'] = [];
  if (!brandOk && wantBrand) issues.push({ type: 'brand_missing' });
  if (params.model) issues.push({ type: 'model_not_applied' }); // v1 : jamais posé en URL
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

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const out: Partial<SearchCriteria> = {};
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('auto');
    if (i >= 0 && segs[i + 1]) out.brand = segs[i + 1].replace(/-/g, ' ').trim().toUpperCase();
    for (const seg of segs.slice(i + 2)) {
      const canon = FUEL_PATH_TO_CANON[seg];
      if (canon) out.fuel = canon;
      else if (!out.model) out.model = seg.replace(/-+/g, ' ').trim().toUpperCase();
    }
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
    for (const [p, f] of [['rs', 'year'], ['re', 'year'], ['me', 'mileage']] as const) {
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
  prefillCriteriaFromUrl,
  extractCandidateSegments,
};
