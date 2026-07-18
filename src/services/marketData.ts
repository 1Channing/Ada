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
import { canonicalizeFuel, FUEL_LABELS } from '../lib/study-core/ingestion';
import type { FuelToken } from '../lib/study-core/ingestion';
import type { ScrapedListing } from '../lib/study-core/types';
import { allSiteAdapters } from '../lib/study-core/marketplaces';

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
export async function writeMarketSnapshot(params: {
  segment: MarketSegmentKey;
  listings: ScrapedListing[];
  totalCount: number | null;
  sourceUrl: string;
  submittedBy?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { segment, listings, totalCount, sourceUrl, submittedBy } = params;
  const priced = listings.filter((l) => typeof l.price === 'number' && l.price > 0);
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

  if (snapErr || !snap) return { ok: false, error: snapErr?.message ?? 'insert failed' };

  const observations: ObsInsert[] = priced.map((l) => ({
    snapshot_id: snap.id,
    site: segment.site,
    country: segment.country,
    brand: segment.brand,
    model: segment.model,
    // Per-listing attributes (vary within a snapshot when the search wasn't
    // filtered on them) — this is what lets the dashboard slice by trim/fuel.
    fuel: canonicalizeFuel(l.fuel ?? '') || '',
    trim: (l.trim ?? '').trim(),
    internal_ref: generateInternalRef({ listing_url: l.listing_url }),
    price: toEur(l.price, l.currency),
    year: l.year,
    mileage: l.mileage,
    power_din: l.powerDin ?? null,
    listing_url: l.listing_url,
    title: (l.title ?? '').slice(0, 200),
    currency: 'EUR',
    scraped_at: scrapedAt,
  }));

  const { error: obsErr } = await supabase
    .from('market_listing_observations')
    .insert(observations);

  if (obsErr) return { ok: false, error: obsErr.message };
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
  yearMin?: number | null;
  yearMax?: number | null;
  mileageMax?: number | null;
  powerMin?: number | null;
}

const EMPTY_FILTERS: MarketFilters = {};

/** True when only site/country/brand/model are set (no per-listing narrowing). */
export function isCoarseOnly(f: MarketFilters): boolean {
  return !f.trim && !f.fuel && f.yearMin == null && f.yearMax == null && f.mileageMax == null && f.powerMin == null;
}

export function filterObservations(obs: Observation[], f: MarketFilters = EMPTY_FILTERS): Observation[] {
  return obs.filter((o) =>
    (!f.site || o.site === f.site) &&
    (!f.country || o.country === f.country) &&
    (!f.brand || o.brand === f.brand) &&
    (!f.model || o.model === f.model) &&
    (!f.trim || o.trim === f.trim) &&
    (!f.fuel || o.fuel === f.fuel) &&
    (f.yearMin == null || (o.year != null && o.year >= f.yearMin)) &&
    (f.yearMax == null || (o.year != null && o.year <= f.yearMax)) &&
    (f.mileageMax == null || (o.mileage != null && o.mileage <= f.mileageMax)) &&
    (f.powerMin == null || (o.power_din != null && o.power_din >= f.powerMin))
  );
}

/** Distinct values for a field among observations, respecting the other filters (cascading). */
export function distinctValues(obs: Observation[], field: keyof Observation, applied: MarketFilters): string[] {
  const scoped = filterObservations(obs, { ...applied, [fieldToFilterKey(field)]: undefined } as MarketFilters);
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
  const { data } = await supabase
    .from('linkgen_mapping_memory')
    .select('site, country, brand, model, fuel')
    .limit(10000);

  const sites = new Set<string>();
  const countries = new Set<string>();
  const brands = new Set<string>();
  const modelsByBrand: Record<string, Set<string>> = {};
  const fuelsByBrandModel: Record<string, Set<string>> = {};
  const allFuels = new Set<string>();

  for (const r of (data ?? []) as Array<{ site: string | null; country: string | null; brand: string | null; model: string | null; fuel: string | null }>) {
    if (r.site) sites.add(r.site);
    if (r.country) countries.add(r.country.toUpperCase());
    const b = (r.brand ?? '').trim().toUpperCase();
    if (!b) continue;
    brands.add(b);
    const m = (r.model ?? '').trim().toUpperCase();
    if (m) (modelsByBrand[b] ??= new Set()).add(m);
    // Fuel is stored as the declared label ('HYBRIDE') — canonicalise it to the
    // token ('hybrid') that observations and the filter use.
    const fuel = canonicalizeFuel(r.fuel ?? '');
    if (fuel && m) {
      (fuelsByBrandModel[`${b}|${m}`] ??= new Set()).add(fuel);
      allFuels.add(fuel);
    }
  }

  // Registered adapters = full site + country coverage, even with zero mappings.
  for (const a of allSiteAdapters()) {
    sites.add(a.key);
    if (a.countryCode) countries.add(a.countryCode.toUpperCase());
  }

  const sortStr = (a: string, b: string) => a.localeCompare(b);
  return {
    sites: [...sites].sort(sortStr),
    countries: [...countries].sort(sortStr),
    brands: [...brands].sort(sortStr),
    modelsByBrand: Object.fromEntries(Object.entries(modelsByBrand).map(([b, s]) => [b, [...s].sort(sortStr)])),
    fuelsByBrandModel: Object.fromEntries(Object.entries(fuelsByBrandModel).map(([k, s]) => [k, [...s]])),
    allFuels: [...allFuels],
  };
}

/** Union of two string lists, deduped and alphabetically sorted. */
export function sortedUnion(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y));
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
}

export async function loadMarketData(limit = 5000): Promise<MarketData> {
  const [{ data: snaps }, { data: obs }] = await Promise.all([
    supabase.from('market_snapshots').select('*').order('scraped_at', { ascending: true }).limit(limit),
    supabase.from('market_listing_observations').select('*').order('scraped_at', { ascending: true }).limit(limit * 30),
  ]);
  return {
    snapshots: (snaps ?? []) as unknown as Snapshot[],
    observations: (obs ?? []) as unknown as Observation[],
  };
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

/**
 * Velocity over an already-filtered observation set, grouped by segment.
 * Same first_seen→last_seen logic as computeVelocity but slice-aware, so it
 * respects the dashboard filters. Needs ≥2 distinct scrape times in a group.
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
  return [o.brand, o.model, o.fuel, o.lowCountry, o.highCountry].join('|');
}

export async function loadMarketOpportunities(minDelta = 5000, minPerCountry = 5): Promise<MarketOpportunity[]> {
  const cutoff = new Date(Date.now() - OPP_WINDOW_DAYS * 86_400_000).toISOString();
  const { data } = await supabase
    .from('market_listing_observations')
    .select('site, country, brand, model, fuel, price, scraped_at')
    .gte('scraped_at', cutoff)
    .limit(20000);

  type Side = { prices: number[]; sites: Map<string, number> };
  const groups = new Map<string, Map<string, Side>>();
  for (const r of (data ?? []) as Array<{ site: string; country: string; brand: string; model: string; fuel: string; price: number | null }>) {
    const price = typeof r.price === 'number' ? r.price : 0;
    if (price < OPP_MIN_PRICE_EUR) continue;
    const brand = (r.brand ?? '').trim().toUpperCase();
    const model = (r.model ?? '').trim().toUpperCase();
    const fuel = (r.fuel ?? '').trim().toLowerCase();
    const country = (r.country ?? '').trim().toUpperCase();
    if (!brand || !model || !fuel || !country) continue; // same-fuel comparisons only
    const gKey = `${brand}|${model}|${fuel}`;
    const byCountry = groups.get(gKey) ?? new Map<string, Side>();
    const side: Side = byCountry.get(country) ?? { prices: [], sites: new Map<string, number>() };
    side.prices.push(price);
    side.sites.set(r.site, (side.sites.get(r.site) ?? 0) + 1);
    byCountry.set(country, side);
    groups.set(gKey, byCountry);
  }

  const out: MarketOpportunity[] = [];
  for (const [gKey, byCountry] of groups) {
    const [brand, model, fuel] = gKey.split('|');
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
      brand, model, fuel,
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
    .select('brand, model, fuel, low_country, high_country, delta_eur')
    .limit(2000);
  const map = new Map<string, number>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    map.set([r.brand, r.model, r.fuel, r.low_country, r.high_country].join('|'), Number(r.delta_eur));
  }
  return map;
}

export async function ackOpportunity(o: MarketOpportunity, by: string): Promise<void> {
  await supabase.from('market_opportunity_acks').insert({
    brand: o.brand, model: o.model, fuel: o.fuel,
    low_country: o.lowCountry, high_country: o.highCountry,
    delta_eur: o.deltaEur, acked_by: by,
  });
}
