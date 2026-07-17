/**
 * Market intelligence data layer: write a snapshot + per-listing observations
 * on each confirmed ingestion, and read/aggregate them for the dashboard
 * (depth, median over time, country comparison, price distribution, velocity).
 *
 * Prices are converted to EUR so cross-country charts are comparable
 * (Bilbasen is DKK). No study/arbitrage logic here — pure market recording.
 */

import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { generateInternalRef } from '../lib/internalRefGenerator';
import type { ScrapedListing } from '../lib/study-core/types';

type ObsInsert = Database['public']['Tables']['market_listing_observations']['Insert'];

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
    brand: segment.brand,
    model: segment.model,
    fuel: segment.fuel,
    trim: segment.trim,
    internal_ref: generateInternalRef({ listing_url: l.listing_url }),
    price: toEur(l.price, l.currency),
    year: l.year,
    mileage: l.mileage,
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
  brand: string;
  model: string;
  fuel: string;
  trim: string;
  internal_ref: string;
  price: number | null;
  year: number | null;
  mileage: number | null;
  scraped_at: string;
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
