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
import { brandKey, refModelKey, canonKey, FUEL_TOKEN_TO_CRITERIA } from './marketData';

export const RESCAN_AFTER_DAYS = 30;

// Carburant canonique : les snapshots portent selon le canal la forme CRITÈRE
// ('HYBRIDE'), le token ('hybrid') ou rien — tout ramené au CRITÈRE majuscule.
const fuelC = (v: string | null | undefined): string => {
  const raw = (v ?? '').trim();
  if (!raw) return '';
  return FUEL_TOKEN_TO_CRITERIA[raw.toLowerCase()] ?? raw.toUpperCase();
};

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

// Clé CANONIQUE (constat 27/08 : les clés brutes rendaient les segments
// impérissables — les relances écrivaient 'RAV4'/carburant natif là où la
// liste attendait 'RAV-4'/'HYBRIDE' d'époque : jamais le même « dernier
// scan », la cloche gonflait et chaque relance re-payait du Zyte pour rien).
const segKey = (r: { site: string; brand: string; model: string; fuel?: string | null; trim?: string | null }) =>
  [r.site, brandKey(r.brand ?? ''), refModelKey(r.brand ?? '', r.model ?? ''), fuelC(r.fuel), canonKey(r.trim ?? '')].join('|');

interface SnapRow {
  site: string; country: string; brand: string; model: string;
  fuel: string; trim: string; scraped_at: string; source_url: string | null;
}

/** Bornes d'années décodées de l'URL d'un scan (cache par URL). */
const yearBoundsCache = new Map<string, { from: number | null; to: number | null }>();
function yearBoundsOf(url: string | null): { from: number | null; to: number | null } {
  if (!url) return { from: null, to: null };
  const hit = yearBoundsCache.get(url);
  if (hit) return hit;
  let out: { from: number | null; to: number | null } = { from: null, to: null };
  try {
    const pre = findSiteAdapterByDomain(url)?.prefillCriteriaFromUrl?.(url);
    const f = Number(pre?.yearFrom ?? '');
    const t = Number(pre?.yearTo ?? '');
    out = {
      from: f >= 2000 && f <= 2100 ? f : null,
      to: t >= 2000 && t <= 2100 ? t : null,
    };
  } catch { /* illisible */ }
  yearBoundsCache.set(url, out);
  return out;
}

/**
 * Segments dont AUCUN scan COUVRANT n'a moins de RESCAN_AFTER_DAYS, hors
 * opt-outs. « Couvrant » = même site + même identité canonique marque/modèle,
 * portée carburant (scan sans carburant = tous) et finition (scan sans
 * finition = toutes) englobantes, et millésime épinglé du segment dans la
 * fourchette d'années du scan (scan sans bornes décodables = toutes années).
 * Même doctrine de périmètre que la purge des annonces disparues : un scan
 * quotidien large rafraîchit les segments étroits qu'il recouvre.
 */
export async function loadStaleSegments(): Promise<StaleSegment[]> {
  const rows: SnapRow[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await supabase
      .from('market_snapshots')
      .select('site, country, brand, model, fuel, trim, scraped_at, source_url')
      .order('scraped_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...(data as unknown as SnapRow[]));
    if (data.length < PAGE) break;
  }

  // Dernier snapshot par segment canonique + index par groupe site|marque|modèle.
  const latest = new Map<string, SnapRow>();
  const byGroup = new Map<string, SnapRow[]>();
  const groupOf = (r: SnapRow) => [r.site, brandKey(r.brand), refModelKey(r.brand, r.model)].join('|');
  for (const r of rows) {
    if (!r.brand || !r.model) continue;
    const k = segKey(r);
    if (!latest.has(k)) latest.set(k, r);
    const g = groupOf(r);
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(r); // déjà triés desc
  }

  const { data: optRows } = await supabase
    .from('market_rescan_optouts')
    .select('site, brand, model, fuel, trim')
    .limit(5000);
  const optedOut = new Set((optRows ?? []).map((r) => segKey(r as SnapRow)));

  const now = Date.now();
  const out: StaleSegment[] = [];
  for (const [key, r] of latest) {
    if (optedOut.has(key)) continue;
    const ownDays = Math.floor((now - new Date(r.scraped_at).getTime()) / 86_400_000);
    if (ownDays < RESCAN_AFTER_DAYS) continue;
    // Millésime épinglé du segment (décodé de sa dernière URL).
    const pin = yearBoundsOf(r.source_url).from;
    // Un scan plus récent COUVRANT le segment le rafraîchit — quel que soit
    // le canal qui l'a produit (quotidienne, MI, campagne).
    const segFuel = fuelC(r.fuel);
    const segTrim = canonKey(r.trim ?? '');
    const fresherCover = (byGroup.get(groupOf(r)) ?? []).find((c) => {
      const age = Math.floor((now - new Date(c.scraped_at).getTime()) / 86_400_000);
      if (age >= RESCAN_AFTER_DAYS) return false; // triés desc : on peut sortir tôt, mais find suffit
      const cFuel = fuelC(c.fuel);
      if (cFuel !== '' && cFuel !== segFuel) return false;
      const cTrim = canonKey(c.trim ?? '');
      if (cTrim && cTrim !== segTrim) return false;
      if (pin != null) {
        const b = yearBoundsOf(c.source_url);
        if (b.from != null && pin < b.from) return false;
        if (b.to != null && pin > b.to) return false;
        if (b.to == null && b.from != null && pin < b.from) return false;
      }
      return true;
    });
    if (fresherCover) continue;
    out.push({
      key, site: r.site, country: r.country, brand: r.brand, model: r.model,
      fuel: r.fuel, trim: r.trim, year: pin,
      lastScanAt: r.scraped_at, daysSince: ownDays, sourceUrl: r.source_url,
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
