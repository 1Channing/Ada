/**
 * Market intelligence data layer: write a snapshot + per-listing observations
 * on each confirmed ingestion, and read/aggregate them for the dashboard
 * (depth, median over time, country comparison, price distribution, velocity).
 *
 * Prices are converted to EUR so cross-country charts are comparable
 * (Bilbasen is DKK). No study/arbitrage logic here — pure market recording.
 */

import { sharedSupabase as supabase } from '../lib/supabaseShared';
import type { Database } from '../lib/database.types';
import { generateInternalRef } from '../lib/internalRefGenerator';
import { canonicalizeFuel, refineFuelToken, FUEL_LABELS } from '../lib/study-core/ingestion';
import type { FuelToken } from '../lib/study-core/ingestion';
import type { ScrapedListing } from '../lib/study-core/types';
import { allSiteAdapters } from '../lib/study-core/marketplaces';
import { fetchAllPages } from '../lib/fetchAllPages';

type ObsInsert = Database['public']['Tables']['market_listing_observations']['Insert'];

export { FUEL_LABELS };
export function fuelLabel(token: string): string {
  return (FUEL_LABELS as Record<string, string>)[token] ?? (token || '—');
}

const DKK_TO_EUR = 0.134;
function toEur(price: number, currency: string): number {
  return currency === 'DKK' ? Math.round(price * DKK_TO_EUR) : price;
}

// ─── Percentiles ──────────────────────────────────────────────────────────────

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export interface MarketSegmentKey {
  site: string;
  country: string;
  brand: string;
  model: string;
  fuel: string;
  trim: string;
}

/**
 * Record one market snapshot + its listing observations for a confirmed
 * segment. Prices normalised to EUR. Silent best-effort (never blocks the
 * ingestion UX).
 */
/**
 * Non-retail price guard: Bilbasen serves "WithoutTax"/engros (wholesale,
 * ex-VAT) prices — a CLA at 2 375 kr in production logs — that must never
 * enter a median or an opportunity. Unknown/absent price types stay in.
 */
function isRetailPrice(l: ScrapedListing): boolean {
  const t = (l.priceType ?? '').toLowerCase();
  return !/withouttax|without tax|engros|wholesale|excl/.test(t);
}

export async function writeMarketSnapshot(params: {
  segment: MarketSegmentKey;
  listings: ScrapedListing[];
  totalCount: number | null;
  sourceUrl: string;
  submittedBy?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { segment, listings, totalCount, sourceUrl, submittedBy } = params;
  const priced = listings.filter((l) => typeof l.price === 'number' && l.price > 0 && isRetailPrice(l));
  if (priced.length === 0) return { ok: false, error: 'no priced listings' };

  const scrapedAt = new Date().toISOString();
  const pricesEur = priced.map((l) => toEur(l.price, l.currency)).sort((a, b) => a - b);
  const avg = Math.round(pricesEur.reduce((s, p) => s + p, 0) / pricesEur.length);

  const { data: snap, error: snapErr } = await supabase
    .from('market_snapshots')
    .insert({
      site: segment.site,
      country: segment.country,
      brand: segment.brand,
      model: segment.model,
      fuel: segment.fuel,
      trim: segment.trim,
      scraped_at: scrapedAt,
      listing_count: totalCount,
      sample_size: priced.length,
      price_min: pricesEur[0],
      price_p25: Math.round(percentile(pricesEur, 0.25)),
      price_median: Math.round(percentile(pricesEur, 0.5)),
      price_p75: Math.round(percentile(pricesEur, 0.75)),
      price_max: pricesEur[pricesEur.length - 1],
      price_avg: avg,
      currency: 'EUR',
      source_url: sourceUrl,
      submitted_by: submittedBy ?? null,
    })
    .select('id')
    .single();

  if (snapErr || !snap) {
    console.warn(`[MARKET_SNAPSHOT] snapshot insert failed for ${segment.country} ${segment.brand} ${segment.model}: ${snapErr?.message ?? 'insert failed'}`);
    return { ok: false, error: snapErr?.message ?? 'insert failed' };
  }

  const observations: ObsInsert[] = priced.map((l) => ({
    snapshot_id: snap.id,
    site: segment.site,
    country: segment.country,
    brand: segment.brand,
    model: segment.model,
    // Per-listing attributes (vary within a snapshot when the search wasn't
    // filtered on them) — this is what lets the dashboard slice by trim/fuel.
    // PHEV refinement: cards label plug-ins as plain "Hybride"; the ad text
    // ("Plug-In", "eHybrid"…) upgrades the token so 'phev' data exists at all.
    fuel: refineFuelToken(canonicalizeFuel(l.fuel ?? ''), `${l.title ?? ''} ${l.description ?? ''} ${l.trim ?? ''}`) || '',
    trim: (l.trim ?? '').trim(),
    internal_ref: generateInternalRef({ listing_url: l.listing_url }),
    price: toEur(l.price, l.currency),
    year: l.year,
    mileage: l.mileage,
    power_din: l.powerDin ?? null,
    gearbox: (l.gearbox ?? '').trim() || null,
    doors: l.doors ?? null,
    seats: l.seats ?? null,
    color: (l.color ?? '').trim() || null,
    seller_type: (l.sellerType ?? '').trim() || null,
    price_type: (l.priceType ?? '').trim() || null,
    listing_url: l.listing_url,
    title: (l.title ?? '').slice(0, 200),
    currency: 'EUR',
    scraped_at: scrapedAt,
  }));

  const { error: obsErr } = await supabase
    .from('market_listing_observations')
    .insert(observations);

  if (obsErr) {
    console.warn(`[MARKET_SNAPSHOT] observations insert failed for ${segment.country} ${segment.brand} ${segment.model} (${observations.length} rows): ${obsErr.message}`);
    return { ok: false, error: obsErr.message };
  }
  console.log(`[MARKET_SNAPSHOT] ✅ recorded ${segment.country} ${segment.brand} ${segment.model} · ${priced.length} annonces (site=${segment.site})`);
  return { ok: true };
}

// ─── Read + aggregate ─────────────────────────────────────────────────────────

export interface Snapshot {
  id: string;
  site: string;
  country: string;
  brand: string;
  model: string;
  fuel: string;
  trim: string;
  scraped_at: string;
  listing_count: number | null;
  sample_size: number;
  price_min: number | null;
  price_p25: number | null;
  price_median: number | null;
  price_p75: number | null;
  price_max: number | null;
  price_avg: number | null;
}

export interface Observation {
  snapshot_id: string;
  site: string;
  country: string;
  brand: string;
  model: string;
  fuel: string;        // per-listing canonical token
  trim: string;         // per-listing version
  internal_ref: string;
  price: number | null;
  year: number | null;
  mileage: number | null;
  power_din: number | null;
  gearbox?: string | null;
  doors?: number | null;
  seats?: number | null;
  color?: string | null;
  seller_type?: string | null;
  price_type?: string | null;
  listing_url: string | null;
  title: string | null;
  scraped_at: string;
}

export interface MarketFilters {
  site?: string;
  country?: string;
  brand?: string;
  model?: string;
  trim?: string;
  fuel?: FuelToken | '';
  gearbox?: string;
  yearMin?: number | null;
  yearMax?: number | null;
  mileageMax?: number | null;
  powerMin?: number | null;
}

const EMPTY_FILTERS: MarketFilters = {};

/** True when only site/country/brand/model are set (no per-listing narrowing). */
export function isCoarseOnly(f: MarketFilters): boolean {
  return !f.trim && !f.fuel && !f.gearbox && f.yearMin == null && f.yearMax == null && f.mileageMax == null && f.powerMin == null;
}

const normText = (s: string | null | undefined) => (s ?? '').toLowerCase();

/**
 * Clé canonique marque/modèle : chaque site écrit le même véhicule à sa façon
 * ('RAV4' Leboncoin, 'RAV-4' slug AS24, 'RAV 4' Marktplaats, 'C-HR'/'CHR') —
 * la clé (MAJ + alphanumérique) les regroupe, l'affichage garde UNE variante
 * représentative (la plus fréquente dans les données).
 */
export function canonKey(v: string): string {
  return (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
const BRAND_KEY_ALIASES: Record<string, string> = { VW: 'VOLKSWAGEN', MERCEDESBENZ: 'MERCEDES' };
export function brandKey(v: string): string {
  const k = canonKey(v);
  return BRAND_KEY_ALIASES[k] ?? k;
}

/** Union dédupliquée par clé canonique — la variante du 1er argument gagne. */
export function canonUnion(primary: string[], secondary: string[], keyFn: (v: string) => string): string[] {
  const seen = new Map<string, string>();
  for (const v of [...primary, ...secondary]) {
    const k = keyFn(v);
    if (!k || seen.has(k)) continue;
    seen.set(k, v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Fuel filter is HIERARCHICAL: « Hybride » is the family (full hybrid +
 * rechargeable + léger), because ads split unpredictably between the three —
 * a strict equality hid the Spanish Golfs stored as 'phev' from a Hybride
 * study. Picking the precise variant ('phev', 'mild_hybrid') stays exact.
 */
export function fuelFilterMatches(obsFuel: string, wanted: string): boolean {
  if (!wanted) return true;
  if (obsFuel === wanted) return true;
  if (wanted === 'hybrid') return obsFuel === 'phev' || obsFuel === 'mild_hybrid';
  return false;
}

/**
 * BOÎTE DE VITESSES — canonisation multilingue.
 *
 * Chaque site écrit la boîte dans sa langue : la base contient 25 graphies
 * pour 3 réalités ('Automatik', 'Boîte automatique', 'Automatisch',
 * 'Automatico', 'Automaat', 'Automatique', 'Automático', 'Automatisk gear'…).
 * Le filtre listait ces 25 graphies et n'en sélectionnait qu'une à la fois :
 * choisir « Automatik » écartait les automatiques françaises, néerlandaises,
 * italiennes… (constat 29/07). On canonise à la LECTURE, la base garde la
 * graphie d'origine.
 *
 * Ordre des tests critique : 'Semiautomatico', 'Halbautomatik' et
 * 'Half/Semi-automaat' contiennent le motif automatique — le semi passe donc
 * en premier. Les libellés commençant par « - » sont des entrées vides des
 * sites (« - Boîte », « - Cambio »), pas des valeurs.
 */
export type GearboxToken = 'automatique' | 'manuelle' | 'semi';

export const GEARBOX_LABELS: Record<GearboxToken, string> = {
  automatique: 'Automatique',
  manuelle: 'Manuelle',
  semi: 'Semi-automatique',
};

export function canonicalizeGearbox(raw: string | null | undefined): GearboxToken | '' {
  // Accents retirés ICI : le normText partagé ne fait que minuscules, or
  // l'espagnol écrit « Automático » (8 966 annonces) — sans dépouiller le
  // 'á', le motif 'automa' ne matche pas et tout le stock espagnol tombe.
  const s = String(raw ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  if (!s || s.startsWith('-')) return '';
  if (s.includes('semi') || s.includes('halb')) return 'semi';
  // 'automa' et non 'automat' : le néerlandais écrit « Automaat » (10 939
  // annonces), qui ne contient PAS 'automat' — elles étaient toutes ignorées.
  if (s.includes('automa')) return 'automatique'; // automatik/automatisch/automatico/automaat/automatisk…
  if (s.includes('manu') || s.includes('schalt') || s.includes('handgeschakeld')) return 'manuelle';
  return '';
}

/**
 * Trim is a CONTAINS match over the listing's version AND its title: sites
 * write finitions their own way ("60 Sportline 150 kW 63 kWh" vs "Sportline"),
 * an exact-equality filter returned 0 for everything. Typing "sportline"
 * matches any ad that carries it anywhere in its text.
 */
/**
 * Dédoublonnage LECTURE des annonces clonées : certaines agences repostent la
 * MÊME voiture dans plusieurs villes (4× « CLA 250e, 24 990 €, 41 764 km » —
 * signalement Channing 23/07), ce qui gonfle artificiellement stock et stats.
 * Conforme au principe directeur : tout est stocké fidèlement, on corrige la
 * lecture. Empreinte = même site, même véhicule (modèle/année/prix/km exact/
 * puissance/boîte/titre) le MÊME JOUR — le même véhicule revu un autre jour
 * reste distinct (c'est le signal de vélocité), la première occurrence gagne.
 */
export function dedupeClonedListings(obs: Observation[]): Observation[] {
  const seen = new Set<string>();
  const out: Observation[] = [];
  for (const o of obs) {
    const day = String(o.scraped_at ?? '').slice(0, 10);
    const key = [
      o.site, brandKey(o.brand), canonKey(o.model), o.year ?? '', o.price ?? '',
      o.mileage ?? '', o.power_din ?? '', normText(o.gearbox), normText(o.title), day,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

/**
 * ÉTAT ACTUEL DU MARCHÉ : une ligne par annonce, dans sa version la plus
 * récemment vue.
 *
 * Remplace l'ancienne définition « observations vues dans les 60 s du dernier
 * scrape » : celle-ci ne tenait que si le filtre visait UN segment scanné d'un
 * seul tenant. Dès que le filtre couvrait plusieurs pays ou sites (Pays =
 * Tous), elle se réduisait au dernier scan d'un seul site — le tableau
 * n'affichait plus que les annonces de ce scan-là (que des EQA françaises de
 * 2024 démarrant à 31 400 €) pendant que les indicateurs, eux, comptaient tout
 * le marché (minimum à 12 990 € en Allemagne). Et comme le « dernier scan »
 * change à chaque étude, le contenu variait tout seul — constat 29/07.
 *
 * L'identité d'une annonce est son URL, à défaut sa référence interne, à
 * défaut son empreinte véhicule (SANS le prix : une baisse de prix ne doit pas
 * créer une seconde annonce, elle doit remplacer l'ancienne).
 */
export function latestPerListing(obs: Observation[]): Observation[] {
  const byListing = new Map<string, Observation>();
  for (const o of obs) {
    const id = (o.listing_url ?? '').trim()
      || (o.internal_ref ?? '').trim()
      || [o.site, brandKey(o.brand), canonKey(o.model), o.year ?? '', o.mileage ?? '', o.power_din ?? '', normText(o.title)].join('|');
    const cur = byListing.get(id);
    if (!cur || String(o.scraped_at ?? '') > String(cur.scraped_at ?? '')) byListing.set(id, o);
  }
  return [...byListing.values()];
}

export function filterObservations(obs: Observation[], f: MarketFilters = EMPTY_FILTERS): Observation[] {
  const trimNeedle = normText(f.trim).trim();
  // Boîte : comparaison sur le TOKEN canonique — « Automatique » retient
  // aussi Automatik, Automatisch, Automatico, Automaat, Automatisk gear…
  const gearboxToken = canonicalizeGearbox(f.gearbox);
  return dedupeClonedListings(obs).filter((o) =>
    (!f.site || o.site === f.site) &&
    (!f.country || o.country === f.country) &&
    (!f.brand || brandKey(o.brand) === brandKey(f.brand)) &&
    (!f.model || canonKey(o.model) === canonKey(f.model)) &&
    (!trimNeedle || normText(o.trim).includes(trimNeedle) || normText(o.title).includes(trimNeedle)) &&
    fuelFilterMatches(o.fuel, f.fuel ?? '') &&
    (!gearboxToken || canonicalizeGearbox(o.gearbox) === gearboxToken) &&
    (f.yearMin == null || (o.year != null && o.year >= f.yearMin)) &&
    (f.yearMax == null || (o.year != null && o.year <= f.yearMax)) &&
    (f.mileageMax == null || (o.mileage != null && o.mileage <= f.mileageMax)) &&
    (f.powerMin == null || (o.power_din != null && o.power_din >= f.powerMin))
  );
}

/** Distinct values for a field among observations, respecting the other filters (cascading). */
export function distinctValues(obs: Observation[], field: keyof Observation, applied: MarketFilters): string[] {
  const scoped = filterObservations(obs, { ...applied, [fieldToFilterKey(field)]: undefined } as MarketFilters);

  // Brand/model: one entry per CANONICAL key, represented by the variant the
  // data uses most ('RAV4' + 'RAV-4' + 'RAV 4' → a single dropdown line).
  if (field === 'brand' || field === 'model') {
    const keyFn = field === 'brand' ? brandKey : canonKey;
    const byKey = new Map<string, Map<string, number>>();
    for (const o of scoped) {
      const raw = String(o[field] ?? '').trim();
      if (!raw) continue;
      const k = keyFn(raw);
      const variants = byKey.get(k) ?? byKey.set(k, new Map()).get(k)!;
      variants.set(raw, (variants.get(raw) ?? 0) + 1);
    }
    return [...byKey.values()]
      .map((variants) => [...variants.entries()].sort((a, b) => b[1] - a[1])[0][0])
      .sort((a, b) => a.localeCompare(b));
  }

  // Boîte : les 25 graphies multilingues de la base se réduisent aux 3
  // réalités — une option par réalité, jamais une par langue.
  if (field === 'gearbox') {
    const set = new Set<GearboxToken>();
    for (const o of scoped) {
      const t = canonicalizeGearbox(o.gearbox);
      if (t) set.add(t);
    }
    return (['automatique', 'manuelle', 'semi'] as GearboxToken[])
      .filter((t) => set.has(t))
      .map((t) => GEARBOX_LABELS[t]);
  }

  const set = new Set<string>();
  for (const o of scoped) {
    const v = String(o[field] ?? '').trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
function fieldToFilterKey(field: keyof Observation): keyof MarketFilters {
  return field as keyof MarketFilters;
}

/**
 * The full universe ADA knows about — not just what has observations yet.
 * Sites/countries come from the registered adapters (everything we cover);
 * brands/models come from the LEARNED mappings (linkgen_mapping_memory). This
 * is what wires the mapping to the Market Intelligence dropdowns, so a segment
 * you've mapped is selectable even before its observations land (the charts
 * then show the "awaiting data" state). Values are uppercased to match the
 * observation convention so a selection filters correctly.
 */
export interface KnownDimensions {
  sites: string[];
  countries: string[];
  brands: string[];
  modelsByBrand: Record<string, string[]>;
  /** Canonical fuel tokens confirmed per `BRAND|MODEL`, plus a flat fallback. */
  fuelsByBrandModel: Record<string, string[]>;
  allFuels: string[];
}

export async function loadKnownDimensions(): Promise<KnownDimensions> {
  const data = await fetchAllPages<{ site: string | null; country: string | null; brand: string | null; model: string | null; fuel: string | null }>(
    (from, to) => supabase
      .from('linkgen_mapping_memory')
      .select('site, country, brand, model, fuel')
      .order('created_at', { ascending: false })
      .range(from, to),
    20_000,
  );

  const sites = new Set<string>();
  const countries = new Set<string>();
  // Brand/model deduped by CANONICAL key, most frequent raw variant wins.
  const brandVariants = new Map<string, Map<string, number>>();
  const modelVariants = new Map<string, Map<string, Map<string, number>>>(); // brandKey → modelKey → raw → n
  const fuelsByBrandModel: Record<string, Set<string>> = {}; // `${brandKey}|${modelKey}`
  const allFuels = new Set<string>();

  const bump = (m: Map<string, number>, raw: string) => m.set(raw, (m.get(raw) ?? 0) + 1);

  for (const r of data) {
    if (r.site) sites.add(r.site);
    if (r.country) countries.add(r.country.toUpperCase());
    const b = (r.brand ?? '').trim().toUpperCase();
    if (!b) continue;
    const bk = brandKey(b);
    bump(brandVariants.get(bk) ?? brandVariants.set(bk, new Map()).get(bk)!, b);
    const m = (r.model ?? '').trim().toUpperCase();
    if (m) {
      const mk = canonKey(m);
      const byModel = modelVariants.get(bk) ?? modelVariants.set(bk, new Map()).get(bk)!;
      bump(byModel.get(mk) ?? byModel.set(mk, new Map()).get(mk)!, m);
      // Fuel is stored as the declared label ('HYBRIDE') — canonicalise it to
      // the token ('hybrid') that observations and the filter use.
      const fuel = canonicalizeFuel(r.fuel ?? '');
      if (fuel) {
        (fuelsByBrandModel[`${bk}|${mk}`] ??= new Set()).add(fuel);
        allFuels.add(fuel);
      }
    }
  }

  // Registered adapters = full site + country coverage, even with zero mappings.
  for (const a of allSiteAdapters()) {
    sites.add(a.key);
    if (a.countryCode) countries.add(a.countryCode.toUpperCase());
  }

  const sortStr = (a: string, b: string) => a.localeCompare(b);
  const rep = (variants: Map<string, number>) => [...variants.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    sites: [...sites].sort(sortStr),
    countries: [...countries].sort(sortStr),
    brands: [...brandVariants.values()].map(rep).sort(sortStr),
    // Keyed by brandKey — callers look up with brandKey(selectedBrand).
    modelsByBrand: Object.fromEntries(
      [...modelVariants.entries()].map(([bk, byModel]) => [bk, [...byModel.values()].map(rep).sort(sortStr)])
    ),
    fuelsByBrandModel: Object.fromEntries(Object.entries(fuelsByBrandModel).map(([k, s]) => [k, [...s]])),
    allFuels: [...allFuels],
  };
}

/** Union of two string lists, deduped and alphabetically sorted. */
export function sortedUnion(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y));
}

// ═════════════════════════════════════════════════════════════════════════════
// LECTURES SCOPÉES (option A, 01/08/2026) — la base trie, le navigateur reçoit
// UNIQUEMENT le segment étudié. Fin des plafonds : 186 467 observations au
// 01/08 (+35 000/j en campagne), tout chargement intégral était condamné.
// Chaque lecture tente d'abord la RPC SQL (migration mi_scoped_reads) et se
// replie sur l'ancienne lecture intégrale tant que la migration n'est pas
// appliquée — le MI ne casse jamais, il accélère quand le SQL est en place.
// ═════════════════════════════════════════════════════════════════════════════

/** Pont RPC typé : les fonctions SQL ne sont pas déclarées dans
 *  database.types (chantier hygiène) — le contrat d'appel est ici. */
const callRpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>)(fn, args);

/** Clés canoniques d'une marque, alias compris (VOLKSWAGEN → aussi VW). */
function brandKeysForQuery(brand: string): string[] {
  const canonical = brandKey(brand);
  const keys = [canonical];
  for (const [alias, target] of Object.entries(BRAND_KEY_ALIASES)) {
    if (target === canonical) keys.push(alias);
  }
  return keys;
}

/** Repli : l'ancienne lecture intégrale, UNE fois par session, partagée. */
let legacyAllPromise: Promise<MarketData> | null = null;
function legacyAll(): Promise<MarketData> {
  legacyAllPromise ??= loadMarketData();
  return legacyAllPromise;
}

export interface DimensionRow {
  site: string; country: string; brand: string; model: string; fuel: string;
  n: number; last_seen: string;
}

/** Dimensions observées (agrégat serveur) — nourrit les menus sans annonces. */
export async function loadObservedDimensions(): Promise<DimensionRow[]> {
  const { data, error } = await callRpc('mi_dimensions');
  if (!error && Array.isArray(data)) return data as DimensionRow[];
  console.warn('[MI_SCOPE] mi_dimensions indisponible (migration à appliquer ?) — repli lecture intégrale:', error?.message);
  const { observations } = await legacyAll();
  const agg = new Map<string, DimensionRow>();
  for (const o of observations) {
    const k = [o.site, o.country, o.brand, o.model, o.fuel].join('|');
    const cur = agg.get(k);
    if (cur) { cur.n++; if (o.scraped_at > cur.last_seen) cur.last_seen = o.scraped_at; }
    else agg.set(k, { site: o.site, country: o.country, brand: o.brand, model: o.model, fuel: o.fuel, n: 1, last_seen: o.scraped_at });
  }
  return [...agg.values()];
}

/** Les snapshots restent une lecture intégrale : ~4 000 lignes, sans danger. */
export async function loadSnapshots(): Promise<Snapshot[]> {
  return fetchAllPages<Snapshot>(
    (from, to) => supabase.from('market_snapshots').select('*').order('scraped_at', { ascending: false }).range(from, to),
    20_000, 'MI_SCOPE',
  );
}

/**
 * Observations d'une étude : marque obligatoire (sans marque il n'y a pas de
 * segment — la page affiche l'invite), modèle et pays optionnels. Les filtres
 * fins (finition, carburant, années, km) restent appliqués côté client par
 * filterObservations, sur ce jeu déjà réduit.
 */
export async function loadObservationsForStudy(f: MarketFilters): Promise<Observation[]> {
  const brand = (f.brand ?? '').trim();
  if (!brand) return [];
  const { data, error } = await callRpc('mi_obs_for_segment', {
    p_brand_keys: brandKeysForQuery(brand),
    p_model_key: (f.model ?? '').trim() ? canonKey(f.model!) : null,
    p_country: (f.country ?? '').trim() || null,
    p_limit: 30_000,
  });
  if (!error && Array.isArray(data)) return data as Observation[];
  console.warn('[MI_SCOPE] mi_obs_for_segment indisponible — repli lecture intégrale:', error?.message);
  const { observations } = await legacyAll();
  return observations.filter((o) =>
    brandKey(o.brand) === brandKey(brand)
    && (!f.model || canonKey(o.model) === canonKey(f.model))
    && (!f.country || o.country === f.country));
}

/** Median/percentiles of the filtered observation prices. */
export function priceStats(obs: Observation[]): { count: number; median: number; p25: number; p75: number; min: number; max: number; avg: number } {
  const prices = obs.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return { count: 0, median: 0, p25: 0, p75: 0, min: 0, max: 0, avg: 0 };
  return {
    count: prices.length,
    median: Math.round(percentile(prices, 0.5)),
    p25: Math.round(percentile(prices, 0.25)),
    p75: Math.round(percentile(prices, 0.75)),
    min: prices[0],
    max: prices[prices.length - 1],
    avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
  };
}

/** Group filtered observations by snapshot time → time series of median + count. */
export function timeSeries(obs: Observation[]): { date: string; median: number; p25: number; p75: number; count: number; ts: number }[] {
  const bySnap = new Map<string, Observation[]>();
  for (const o of obs) {
    const arr = bySnap.get(o.snapshot_id) ?? [];
    arr.push(o);
    bySnap.set(o.snapshot_id, arr);
  }
  const rows = [...bySnap.values()].map((group) => {
    const st = priceStats(group);
    return {
      ts: new Date(group[0].scraped_at).getTime(),
      date: group[0].scraped_at,
      median: st.median,
      p25: st.p25,
      p75: st.p75,
      count: st.count,
    };
  });
  return rows.sort((a, b) => a.ts - b.ts);
}

export interface MarketData {
  snapshots: Snapshot[];
  observations: Observation[];
  /** Non nul si le plafond de lecture a mordu : date de la plus ancienne
   *  observation affichée — tout ce qui précède est absent de la page. */
  truncatedFrom?: string | null;
}

/**
 * Le plafond de 60 000 lignes était atteint depuis les campagnes de masse
 * (170 000 observations en base le 29/07) : la lecture, triée du plus récent
 * au plus ancien, ne montrait plus que les ~2 derniers jours et 42 couples
 * marque/modèle disparaissaient purement de la page. Comme la borne avance à
 * chaque scrape, l'affichage changeait tout seul d'une visite à l'autre —
 * d'où l'impression de résultats aléatoires. Le plafond est relevé, et s'il
 * mord un jour la page le DIT au lieu de tronquer en silence.
 */
export const MARKET_OBS_CAP = 250_000;

export async function loadMarketData(maxObservations = MARKET_OBS_CAP): Promise<MarketData> {
  const [snapshots, observations] = await Promise.all([
    fetchAllPages<Snapshot>(
      (from, to) => supabase.from('market_snapshots').select('*').order('scraped_at', { ascending: false }).range(from, to),
      20_000,
      'MARKET_DATA',
    ),
    fetchAllPages<Observation>(
      (from, to) => supabase.from('market_listing_observations').select('*').order('scraped_at', { ascending: false }).range(from, to),
      maxObservations,
      'MARKET_DATA',
    ),
  ]);
  // Plafond atteint = des observations plus anciennes existent sans être lues.
  const truncatedFrom = observations.length >= maxObservations
    ? (observations[observations.length - 1]?.scraped_at ?? null)
    : null;
  if (truncatedFrom) {
    console.warn(`[MARKET_DATA] plafond ${maxObservations} atteint — rien d'antérieur à ${truncatedFrom} n'est affiché`);
  }
  return { snapshots, observations, truncatedFrom };
}

export function priceHistogramFrom(obs: Observation[], buckets = 12): { range: string; count: number; from: number; to: number }[] {
  const prices = obs.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0);
  if (prices.length === 0) return [];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return [{ range: `${Math.round(min / 1000)}k`, count: prices.length, from: min, to: min }];
  const width = (max - min) / buckets;
  const bins = Array.from({ length: buckets }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const p of prices) bins[Math.min(buckets - 1, Math.floor((p - min) / width))].count += 1;
  return bins.map((b) => ({ range: `${Math.round(b.from / 1000)}–${Math.round(b.to / 1000)}k`, count: b.count, from: b.from, to: b.to }));
}

// A segment label used across the dashboard.
export function segmentLabel(s: { brand: string; model: string; fuel: string; trim: string }): string {
  return [s.brand, s.model, s.fuel, s.trim].map((x) => (x ?? '').trim()).filter(Boolean).join(' · ');
}
export function segmentId(s: { site: string; brand: string; model: string; fuel: string; trim: string }): string {
  return [s.site, s.brand, s.model, s.fuel, s.trim].join('|');
}

// ─── Velocity ─────────────────────────────────────────────────────────────────

export interface VelocityStat {
  segmentId: string;
  label: string;
  site: string;
  country: string;
  soldCount: number;         // observations no longer seen in the latest snapshot
  activeCount: number;        // still present (censored)
  avgDaysToDisappear: number; // proxy for time-to-sell (page-1 sampling caveat)
}

/**
 * Velocity proxy: a listing's lifetime = first_seen → last_seen across the
 * snapshots of its segment. A ref absent from the segment's LATEST snapshot is
 * treated as "gone" (sold/delisted); still-present refs are censored (active).
 *
 * CAVEAT: ingestion scrapes only page 1 (cheapest ~30), so a listing can drop
 * off page 1 without selling. Treat this as a rough signal until the periodic
 * scanner (deeper pages) lands. Needs ≥2 snapshots of a segment to say anything.
 */
export function computeVelocity(data: MarketData): VelocityStat[] {
  const snapById = new Map(data.snapshots.map((s) => [s.id, s]));
  // Group snapshots per segment, find the latest snapshot time per segment.
  const latestBySeg = new Map<string, number>();
  const countryBySeg = new Map<string, string>();
  const siteBySeg = new Map<string, string>();
  for (const s of data.snapshots) {
    const seg = segmentId(s);
    const t = new Date(s.scraped_at).getTime();
    latestBySeg.set(seg, Math.max(latestBySeg.get(seg) ?? 0, t));
    countryBySeg.set(seg, s.country);
    siteBySeg.set(seg, s.site);
  }

  // Per (segment, internal_ref): first/last seen.
  interface Life { first: number; last: number; }
  const lives = new Map<string, Map<string, Life>>();
  for (const o of data.observations) {
    const snap = snapById.get(o.snapshot_id);
    if (!snap) continue;
    const seg = segmentId(snap);
    const t = new Date(o.scraped_at).getTime();
    let m = lives.get(seg);
    if (!m) { m = new Map(); lives.set(seg, m); }
    const cur = m.get(o.internal_ref);
    if (!cur) m.set(o.internal_ref, { first: t, last: t });
    else { cur.first = Math.min(cur.first, t); cur.last = Math.max(cur.last, t); }
  }

  const out: VelocityStat[] = [];
  for (const [seg, refs] of lives) {
    const latest = latestBySeg.get(seg) ?? 0;
    let soldCount = 0, activeCount = 0, sumDays = 0;
    for (const life of refs.values()) {
      const seenAtLatest = life.last >= latest - 60_000; // within 1 min of latest snapshot
      if (seenAtLatest) { activeCount += 1; continue; }
      soldCount += 1;
      sumDays += (life.last - life.first) / 86_400_000;
    }
    out.push({
      segmentId: seg,
      label: segmentLabel({ brand: seg.split('|')[1], model: seg.split('|')[2], fuel: seg.split('|')[3], trim: seg.split('|')[4] }),
      site: siteBySeg.get(seg) ?? '',
      country: countryBySeg.get(seg) ?? '',
      soldCount,
      activeCount,
      avgDaysToDisappear: soldCount > 0 ? Math.round((sumDays / soldCount) * 10) / 10 : 0,
    });
  }
  return out.sort((a, b) => b.soldCount - a.soldCount);
}

/** Minimum observation window before velocity means anything. */
export const VELOCITY_MIN_DAYS = 14;

/**
 * Longest observation window (days) across segments of a filtered slice —
 * powers the "collecte en cours — Xj/14" state before velocity unlocks.
 */
export function velocityCoverageDays(obs: Observation[]): number {
  const groups = new Map<string, number[]>();
  for (const o of obs) {
    const key = segmentId(o);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(new Date(o.scraped_at).getTime());
  }
  let best = 0;
  for (const times of groups.values()) {
    if (times.length < 2) continue;
    best = Math.max(best, (Math.max(...times) - Math.min(...times)) / 86_400_000);
  }
  return Math.floor(best);
}

/**
 * Velocity over an already-filtered observation set, grouped by segment.
 * Same first_seen→last_seen logic as computeVelocity but slice-aware, so it
 * respects the dashboard filters. A segment only qualifies once its window
 * spans ≥ VELOCITY_MIN_DAYS: two scans hours apart produced absurd
 * "sold in 0.2 days" readings.
 */
export function velocityFromObservations(obs: Observation[]): VelocityStat[] {
  const groups = new Map<string, Observation[]>();
  for (const o of obs) {
    const key = segmentId(o);
    const arr = groups.get(key) ?? [];
    arr.push(o);
    groups.set(key, arr);
  }
  const out: VelocityStat[] = [];
  for (const [seg, list] of groups) {
    const times = [...new Set(list.map((o) => new Date(o.scraped_at).getTime()))];
    if (times.length < 2) continue; // need repeated scrapes
    if ((Math.max(...times) - Math.min(...times)) < VELOCITY_MIN_DAYS * 86_400_000) continue;
    const latest = Math.max(...times);
    const lives = new Map<string, { first: number; last: number }>();
    for (const o of list) {
      const t = new Date(o.scraped_at).getTime();
      const cur = lives.get(o.internal_ref);
      if (!cur) lives.set(o.internal_ref, { first: t, last: t });
      else { cur.first = Math.min(cur.first, t); cur.last = Math.max(cur.last, t); }
    }
    let soldCount = 0, activeCount = 0, sumDays = 0;
    for (const life of lives.values()) {
      if (life.last >= latest - 60_000) { activeCount += 1; continue; }
      soldCount += 1;
      sumDays += (life.last - life.first) / 86_400_000;
    }
    const bits = seg.split('|');
    const label = [bits[1], bits[2], fuelLabel(bits[3]), bits[4]]
      .map((x) => (x ?? '').trim()).filter((x) => x && x !== '—').join(' · ');
    out.push({
      segmentId: seg,
      label: label || bits[2],
      site: bits[0],
      country: list[0].country,
      soldCount, activeCount,
      avgDaysToDisappear: soldCount > 0 ? Math.round((sumDays / soldCount) * 10) / 10 : 0,
    });
  }
  return out.sort((a, b) => b.soldCount - a.soldCount);
}

/** Histogram buckets over the latest snapshot's listing prices for a segment. */
export function priceHistogram(observations: Observation[], buckets = 10): { range: string; count: number; from: number }[] {
  const prices = observations.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0);
  if (prices.length === 0) return [];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return [{ range: `${Math.round(min / 1000)}k`, count: prices.length, from: min }];
  const width = (max - min) / buckets;
  const bins = Array.from({ length: buckets }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));
  for (const p of prices) {
    const i = Math.min(buckets - 1, Math.floor((p - min) / width));
    bins[i].count += 1;
  }
  return bins.map((b) => ({
    range: `${Math.round(b.from / 1000)}–${Math.round(b.to / 1000)}k`,
    count: b.count,
    from: b.from,
  }));
}

// ─── Cross-country opportunity alerts ─────────────────────────────────────────
//
// "Objectif omniprésence" : every campaign/ingestion scrape already records
// per-listing observations; this layer mines them for NEW MARKETS — a model
// whose cheap end (median of the 5 cheapest, sorted-ascending page 1 is
// exactly what we scrape) differs by ≥ threshold between two countries.
// Deliberately COARSE (brand+model+fuel), unlike market studies: the goal is
// spotting a market to work, not picking listings.

export interface MarketOpportunity {
  brand: string;
  model: string;
  fuel: string;        // canonical token ('electric'…)
  /** Comparison year — both sides compare THE SAME vintage, never 1998 vs 2022. */
  year: number;
  lowCountry: string;
  lowSite: string;
  lowMedian: number;   // EUR — median of the 5 cheapest
  lowCount: number;
  highCountry: string;
  highSite: string;
  highMedian: number;
  highCount: number;
  deltaEur: number;
}

const OPP_WINDOW_DAYS = 30;
const OPP_MIN_PRICE_EUR = 1000; // wrecks/leasing noise guard

export function opportunityKey(o: MarketOpportunity): string {
  return [o.brand, o.model, o.fuel, o.year, o.lowCountry, o.highCountry].join('|');
}

/** Clé de session où le Market Intelligence lit ses études au montage. */
export const MARKET_STUDIES_KEY = 'ada_market_studies';

/**
 * Un écart du radar → les deux études comparées (pays bas vs pays haut),
 * même carburant et même millésime des deux côtés.
 */
export function studiesFromOpportunity(o: MarketOpportunity): MarketFilters[] {
  const base = { brand: o.brand, model: o.model, fuel: o.fuel as FuelToken, yearMin: o.year, yearMax: o.year };
  return [{ ...base, country: o.lowCountry }, { ...base, country: o.highCountry }];
}

/**
 * « Inspecter » depuis une AUTRE page que le MI (l'Accueil) : la navigation
 * y recharge la page entière, donc l'écart cliqué ne peut pas voyager en
 * mémoire — il était purement perdu et le MI s'ouvrait vierge (constat
 * 29/07). On le dépose dans la session que le MI lit au montage, puis on
 * navigue.
 */
export function inspectOpportunityInMarket(o: MarketOpportunity, navigateTo: (path: string) => void): void {
  try {
    sessionStorage.setItem(MARKET_STUDIES_KEY, JSON.stringify(studiesFromOpportunity(o)));
  } catch { /* session pleine ou navigation privée : le MI s'ouvrira sur ses filtres courants */ }
  navigateTo('/market');
}

export async function loadMarketOpportunities(
  minDelta = 5000,
  minPerCountry = 5,
  /** Si fourni : ne garde que les marchés TOUCHÉS (re-scrapés) depuis cette
   *  date — « opportunités apparues sur la dernière campagne » (accueil).
   *  La comparaison de prix garde toute la fenêtre (il faut les deux pays). */
  touchedSinceIso?: string | null,
): Promise<MarketOpportunity[]> {
  // RPC d'abord : les médianes basses sont calculées EN BASE (mi_cheap_medians)
  // — le front n'apparie plus que quelques centaines de segments au lieu de
  // repaginer 40 000 observations (fenêtre déjà dépassée par les campagnes).
  const since = new Date(Date.now() - OPP_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: medianRows, error: rpcError } = await callRpc('mi_cheap_medians', {
    p_since: since, p_min_price: OPP_MIN_PRICE_EUR,
  });
  if (!rpcError && Array.isArray(medianRows)) {
    type Row = { brand_label: string; model_label: string; fuel: string; year: number; country: string; site: string; median: number | null; cnt: number; last_seen: string };
    const groups = new Map<string, Row[]>();
    for (const r of medianRows as Row[]) {
      if (r.median == null || r.cnt < minPerCountry) continue;
      const key = `${brandKey(r.brand_label)}|${canonKey(r.model_label)}|${r.fuel}|${r.year}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    const out: MarketOpportunity[] = [];
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      if (touchedSinceIso && !rows.some((r) => r.last_seen >= touchedSinceIso)) continue;
      const sides = [...rows].sort((a, b) => (a.median! - b.median!));
      const low = sides[0];
      const high = sides[sides.length - 1];
      const delta = Math.round(high.median! - low.median!);
      if (delta < minDelta) continue;
      out.push({
        brand: low.brand_label.toUpperCase(), model: low.model_label.toUpperCase(),
        fuel: low.fuel, year: low.year,
        lowCountry: low.country, lowSite: low.site, lowMedian: Math.round(low.median!), lowCount: Number(low.cnt),
        highCountry: high.country, highSite: high.site, highMedian: Math.round(high.median!), highCount: Number(high.cnt),
        deltaEur: delta,
      });
    }
    return out.sort((a, b) => (b.deltaEur * Math.min(b.lowCount, b.highCount)) - (a.deltaEur * Math.min(a.lowCount, a.highCount)));
  }
  console.warn('[MI_SCOPE] mi_cheap_medians indisponible — repli calcul client:', rpcError?.message);
  return loadMarketOpportunitiesLegacy(minDelta, minPerCountry, touchedSinceIso);
}

async function loadMarketOpportunitiesLegacy(
  minDelta = 5000,
  minPerCountry = 5,
  touchedSinceIso?: string | null,
): Promise<MarketOpportunity[]> {
  const cutoff = new Date(Date.now() - OPP_WINDOW_DAYS * 86_400_000).toISOString();
  // Paginated: a flat .limit() is silently capped at ~1000 rows by PostgREST.
  const data = await fetchAllPages<{ site: string; country: string; brand: string; model: string; fuel: string; price: number | null; year: number | null }>(
    (from, to) => supabase
      .from('market_listing_observations')
      .select('site, country, brand, model, fuel, price, year, scraped_at')
      .gte('scraped_at', cutoff)
      .order('scraped_at', { ascending: false })
      .range(from, to),
    40_000,
  );

  // Group at brand|model|fuel|YEAR grain: an alert must compare the SAME
  // vintage on both sides (a 1998 911 vs a 2022 911 is an age difference, not
  // an arbitrage). Listings without a year can't be placed — excluded.
  type Side = { prices: number[]; sites: Map<string, number> };
  const groups = new Map<string, Map<string, Side>>();
  const touched = new Set<string>();
  // Canonical grouping keys: 'RAV4' (FR) and 'RAV-4' (AS24 slug) are the SAME
  // car — grouping on raw text split them into incomparable segments and the
  // radar missed real cross-country gaps. Display keeps the first raw form.
  const labels = new Map<string, { brand: string; model: string }>();
  for (const r of data) {
    const price = typeof r.price === 'number' ? r.price : 0;
    if (price < OPP_MIN_PRICE_EUR) continue;
    const brand = (r.brand ?? '').trim().toUpperCase();
    const model = (r.model ?? '').trim().toUpperCase();
    const fuel = (r.fuel ?? '').trim().toLowerCase();
    const country = (r.country ?? '').trim().toUpperCase();
    const year = typeof r.year === 'number' ? r.year : null;
    if (!brand || !model || !fuel || !country || year == null) continue;
    const gKey = `${brandKey(brand)}|${canonKey(model)}|${fuel}|${year}`;
    if (!labels.has(gKey)) labels.set(gKey, { brand, model });
    if (touchedSinceIso && ((r as { scraped_at?: string }).scraped_at ?? '') >= touchedSinceIso) touched.add(gKey);
    const byCountry = groups.get(gKey) ?? new Map<string, Side>();
    const side: Side = byCountry.get(country) ?? { prices: [], sites: new Map<string, number>() };
    side.prices.push(price);
    side.sites.set(r.site, (side.sites.get(r.site) ?? 0) + 1);
    byCountry.set(country, side);
    groups.set(gKey, byCountry);
  }

  const out: MarketOpportunity[] = [];
  for (const [gKey, byCountry] of groups) {
    if (touchedSinceIso && !touched.has(gKey)) continue;
    const [, , fuel, yearStr] = gKey.split('|');
    const { brand, model } = labels.get(gKey)!;
    const sides: Array<{ country: string; median: number; count: number; site: string }> = [];
    for (const [country, side] of byCountry) {
      if (side.prices.length < minPerCountry) continue;
      const cheap = side.prices.sort((a, b) => a - b).slice(0, 5);
      const median = cheap[Math.floor(cheap.length / 2)];
      const site = [...side.sites.entries()].sort((a, b) => b[1] - a[1])[0][0];
      sides.push({ country, median, count: side.prices.length, site });
    }
    if (sides.length < 2) continue;
    sides.sort((a, b) => a.median - b.median);
    const low = sides[0];
    const high = sides[sides.length - 1];
    const delta = Math.round(high.median - low.median);
    if (delta < minDelta) continue;
    out.push({
      brand, model, fuel, year: Number(yearStr),
      lowCountry: low.country, lowSite: low.site, lowMedian: Math.round(low.median), lowCount: low.count,
      highCountry: high.country, highSite: high.site, highMedian: Math.round(high.median), highCount: high.count,
      deltaEur: delta,
    });
  }

  // Priority ordering (no displayed score): bigger gap × more available
  // listings first — a €5,200 gap on 40 cars outranks €6,000 on 2.
  out.sort((a, b) =>
    b.deltaEur * Math.min(b.lowCount, b.highCount) - a.deltaEur * Math.min(a.lowCount, a.highCount));
  return out;
}

/** key → acked delta (EUR). An alert stays hidden while |Δnow − Δacked| < 1000. */
export async function loadOpportunityAcks(): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('market_opportunity_acks')
    .select('brand, model, fuel, year, low_country, high_country, delta_eur')
    .limit(2000);
  const map = new Map<string, number>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    // Year is part of the key: a control on the 2022s never hides the 2019s.
    map.set([r.brand, r.model, r.fuel, r.year, r.low_country, r.high_country].join('|'), Number(r.delta_eur));
  }
  return map;
}

export async function ackOpportunity(o: MarketOpportunity, by: string): Promise<void> {
  await supabase.from('market_opportunity_acks').insert({
    brand: o.brand, model: o.model, fuel: o.fuel, year: o.year,
    low_country: o.lowCountry, high_country: o.highCountry,
    delta_eur: o.deltaEur, acked_by: by,
  });
}
