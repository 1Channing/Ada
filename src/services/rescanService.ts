/**
 * Monthly re-scan reminders — HUMAN-APPROVED, never automatic.
 *
 * A segment (site × brand × model × fuel × trim) whose LAST snapshot is older
 * than 30 days is "stale": it accumulates in the notification bell until the
 * operator either re-scans it (their click launches a worker campaign with an
 * explicit plan — the approval IS the click) or opts the market out for good
 * ("ce marché ne m'intéresse pas") via a shared table, so it never nags again.
 */

import { supabase } from '../lib/supabase';
import { findSiteAdapterByDomain, getSiteAdapter } from '../lib/study-core/marketplaces';
import type { SiteKey } from '../lib/study-core/marketplaces';

export const RESCAN_AFTER_DAYS = 30;

export interface StaleSegment {
  key: string;                 // site|brand|model|fuel|trim
  site: string;
  country: string;
  brand: string;
  model: string;
  fuel: string;
  trim: string;
  /** Year decoded from the last scanned URL (the segment's vintage pin). */
  year: number | null;
  lastScanAt: string;
  daysSince: number;
  sourceUrl: string | null;
}

const segKey = (r: { site: string; brand: string; model: string; fuel: string; trim: string }) =>
  [r.site, r.brand, r.model, r.fuel, r.trim].join('|');

/** All segments whose latest snapshot is > RESCAN_AFTER_DAYS old, minus opt-outs. */
export async function loadStaleSegments(): Promise<StaleSegment[]> {
  // Latest snapshot per segment — paginated read, newest first, first hit wins.
  const latest = new Map<string, { site: string; country: string; brand: string; model: string; fuel: string; trim: string; scraped_at: string; source_url: string | null }>();
  const PAGE = 1000;
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('site, country, brand, model, fuel, trim, scraped_at, source_url')
      .order('scraped_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data as typeof data & Array<{ site: string; country: string; brand: string; model: string; fuel: string; trim: string; scraped_at: string; source_url: string | null }>) {
      const k = segKey(r);
      if (!latest.has(k)) latest.set(k, r);
    }
    if (data.length < PAGE) break;
  }

  const { data: optRows } = await supabase
    .from('market_rescan_optouts')
    .select('site, brand, model, fuel, trim')
    .limit(5000);
  const optedOut = new Set((optRows ?? []).map((r) => segKey(r as { site: string; brand: string; model: string; fuel: string; trim: string })));

  const now = Date.now();
  const out: StaleSegment[] = [];
  for (const [key, r] of latest) {
    if (optedOut.has(key)) continue;
    if (!r.brand || !r.model) continue;
    const days = Math.floor((now - new Date(r.scraped_at).getTime()) / 86_400_000);
    if (days < RESCAN_AFTER_DAYS) continue;
    // Vintage pin: decode the year the segment was scanned with from its URL.
    let year: number | null = null;
    if (r.source_url) {
      try {
        const pre = findSiteAdapterByDomain(r.source_url)?.prefillCriteriaFromUrl?.(r.source_url);
        const y = Number(pre?.yearFrom ?? '');
        if (y >= 2000 && y <= 2100) year = y;
      } catch { /* keep null */ }
    }
    out.push({
      key, site: r.site, country: r.country, brand: r.brand, model: r.model,
      fuel: r.fuel, trim: r.trim, year,
      lastScanAt: r.scraped_at, daysSince: days, sourceUrl: r.source_url,
    });
  }
  // Oldest first — the most overdue markets at the top.
  return out.sort((a, b) => b.daysSince - a.daysSince);
}

/** Permanently silence a market ("pas intéressé") — shared with the team. */
export async function optOutSegments(segments: StaleSegment[], by: string): Promise<void> {
  if (segments.length === 0) return;
  await supabase.from('market_rescan_optouts').insert(
    segments.map((s) => ({
      site: s.site, country: s.country, brand: s.brand, model: s.model,
      fuel: s.fuel, trim: s.trim, opted_out_by: by || null,
    })),
  );
}

/** Criteria-shaped plan items for the selected segments (worker campaign plan). */
export function buildRescanPlan(segments: StaleSegment[]): Array<{
  site: string; brand: string; model: string; fuel?: string; trim?: string; year?: number;
  kind: 'reinforcement'; reason: string;
}> {
  return segments
    .filter((s) => {
      try { return Boolean(getSiteAdapter(s.site as SiteKey)); } catch { return false; }
    })
    .map((s) => ({
      site: s.site,
      brand: s.brand,
      model: s.model,
      ...(s.fuel ? { fuel: s.fuel } : {}),
      ...(s.trim ? { trim: s.trim } : {}),
      ...(s.year != null ? { year: s.year } : {}),
      kind: 'reinforcement' as const,
      reason: `re-scan mensuel (${s.daysSince} j sans scan)`,
    }));
}
