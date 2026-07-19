/**
 * Resolution center — every recorded campaign gap, across ALL campaigns,
 * stays reachable and closable. Nothing is lost: a gap the current panel no
 * longer shows (older campaign, page reload) is still here.
 *
 * Ways to close a gap:
 *  - corrected     → fixed elsewhere (re-ingestion confirmed the mapping)
 *  - empty_market  → the URL/mapping is RIGHT but the market has no cars
 *                    (e.g. Golf 2026 on Bilbasen). Learns the mapping into
 *                    memory WITHOUT a sample — human assertion replaces the
 *                    scrape confirmation — so the URL is reusable and the
 *                    planner stops re-testing the combo blindly.
 *  - ignored       → knowingly dismissed (not relevant).
 */

import { supabase } from '../lib/supabase';
import { healOpenGaps } from '../lib/linkgen/gapHealing';
import { getSiteAdapter } from '../lib/study-core/marketplaces';
import type { SiteKey } from '../lib/study-core/marketplaces';

export type GapResolution = 'corrected' | 'empty_market' | 'ignored';

export const RESOLUTION_LABELS: Record<string, string> = {
  corrected: 'corrigée',
  empty_market: 'marché vide — URL validée',
  ignored: 'ignorée',
};

export interface GapItem {
  id: string;
  campaignId: string;
  campaignLabel: string;
  createdAt: string;
  seq: number;
  site: string;
  brand: string;
  model: string;
  criteria: Record<string, unknown> | null;
  url: string | null;
  outcome: string;
  detail: string;
  resolvedAt: string | null;
  resolution: string | null;
}

/** Everything that is NOT a confirmation is a recorded unknown. */
const GAP_OUTCOMES = ['taxonomy_gap', 'enum_gap', 'no_url', 'insufficient', 'technical'];

export async function loadAllGaps(limit = 400): Promise<{ items: GapItem[]; loadError: string | null }> {
  let { data, error } = await supabase
    .from('linkgen_campaign_items')
    .select('id, campaign_id, created_at, seq, site, brand, model, criteria, url, outcome, detail, resolved_at, resolution')
    .in('outcome', GAP_OUTCOMES)
    .order('created_at', { ascending: false })
    .limit(limit);
  let loadError: string | null = null;
  if (error) {
    // The resolved_at/resolution migration hasn't run yet — degrade to the
    // pre-migration shape (BASE columns only, neither resolved_at nor
    // resolution) instead of showing an EMPTY (hence misleading "tout est
    // traité") center. The error stays surfaced so the missing SQL is visible.
    console.warn('[RESOLUTION] loadAllGaps failed, retrying with base columns:', error.message);
    loadError = error.message;
    const retry = await supabase
      .from('linkgen_campaign_items')
      .select('id, campaign_id, created_at, seq, site, brand, model, criteria, url, outcome, detail')
      .in('outcome', GAP_OUTCOMES)
      .order('created_at', { ascending: false })
      .limit(limit);
    data = retry.data as typeof data;
    if (retry.error) {
      return { items: [], loadError: retry.error.message };
    }
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const campaignIds = [...new Set(rows.map((r) => String(r.campaign_id)))];
  const labels = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: camps } = await supabase
      .from('linkgen_campaigns')
      .select('id, label, created_at')
      .in('id', campaignIds);
    for (const c of (camps ?? []) as Array<{ id: string; label: string | null; created_at: string | null }>) {
      labels.set(c.id, c.label || (c.created_at ?? '').slice(0, 16) || c.id.slice(0, 8));
    }
  }

  return {
    loadError,
    items: rows.map((r) => ({
      id: String(r.id),
      campaignId: String(r.campaign_id),
      campaignLabel: labels.get(String(r.campaign_id)) ?? '',
      createdAt: String(r.created_at ?? ''),
      seq: Number(r.seq ?? 0),
      site: String(r.site ?? ''),
      brand: String(r.brand ?? ''),
      model: String(r.model ?? ''),
      criteria: (r.criteria as Record<string, unknown> | null) ?? null,
      url: (r.url as string | null) ?? null,
      outcome: String(r.outcome ?? ''),
      detail: String(r.detail ?? ''),
      resolvedAt: (r.resolved_at as string | null) ?? null,
      resolution: (r.resolution as string | null) ?? null,
    })),
  };
}

/** Count of unresolved gaps — the badge on the resolution-center button. */
export async function countOpenGaps(): Promise<number> {
  const { count, error } = await supabase
    .from('linkgen_campaign_items')
    .select('id', { count: 'exact', head: true })
    .in('outcome', GAP_OUTCOMES)
    .is('resolved_at', null);
  if (!error) return count ?? 0;
  // Pre-migration DB (no resolved_at column): every gap counts as open.
  const retry = await supabase
    .from('linkgen_campaign_items')
    .select('id', { count: 'exact', head: true })
    .in('outcome', GAP_OUTCOMES);
  return retry.count ?? 0;
}

export async function resolveGapItem(id: string, resolution: GapResolution): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('linkgen_campaign_items')
    .update({ resolved_at: new Date().toISOString(), resolution })
    .eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Undo — reopen a gap closed by mistake. */
export async function reopenGapItem(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('linkgen_campaign_items')
    .update({ resolved_at: null, resolution: null })
    .eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * « Marché vide — URL valide » : the operator asserts the tested URL targets
 * the RIGHT brand/model (the market just has nothing to show, e.g. a year
 * with no cars). Writes/reinforces the memory row exactly like a confirmed
 * ingestion would — validated_url included — then closes the gap.
 */
export async function validateEmptyMarket(item: GapItem): Promise<{ ok: boolean; error?: string }> {
  const core = await learnEmptyMarketMapping(item);
  if (!core.ok) return core;

  // Le mapping vient d'être validé : les autres lacunes ouvertes du même
  // combo (autres années/campagnes) sont réparées par la même connaissance.
  await healOpenGaps(item.site, item.brand, item.model).catch(() => 0);

  return resolveGapItem(item.id, 'empty_market');
}

/** Variante pour le rapport d'inconnues du panneau campagne (item repéré par campagne+seq, pas par id). */
export async function validateEmptyMarketForCampaignItem(
  campaignId: string,
  seq: number,
  info: Pick<GapItem, 'site' | 'brand' | 'model' | 'criteria' | 'url'>
): Promise<{ ok: boolean; error?: string }> {
  const core = await learnEmptyMarketMapping(info);
  if (!core.ok) return core;
  await healOpenGaps(info.site, info.brand, info.model).catch(() => 0);
  const { error } = await supabase
    .from('linkgen_campaign_items')
    .update({ resolved_at: new Date().toISOString(), resolution: 'empty_market' })
    .eq('campaign_id', campaignId)
    .eq('seq', seq);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Cœur partagé : écrire/renforcer la ligne mémoire « URL valide, marché vide ». */
async function learnEmptyMarketMapping(
  item: Pick<GapItem, 'site' | 'brand' | 'model' | 'criteria' | 'url'>
): Promise<{ ok: boolean; error?: string }> {
  const brand = item.brand.trim().toUpperCase();
  const model = item.model.trim().toUpperCase();
  if (!brand || !model) return { ok: false, error: 'marque/modèle manquants sur cette lacune' };

  let country = '';
  try { country = getSiteAdapter(item.site as SiteKey)?.countryCode ?? ''; } catch { /* site inconnu */ }

  const crit = (item.criteria ?? {}) as Record<string, unknown>;
  const fuel = String(crit.fuel ?? '').trim().toUpperCase();
  const trimVal = String(crit.trim ?? '').trim();
  const now = new Date().toISOString();

  const { data: rows, error: lookupErr } = await supabase
    .from('linkgen_mapping_memory')
    .select('id, validated_url, human_confirmations')
    .eq('site', item.site)
    .ilike('brand', brand)
    .ilike('model', model)
    .ilike('fuel', fuel)
    .ilike('trim', trimVal)
    .limit(1);
  if (lookupErr) return { ok: false, error: lookupErr.message };

  const existing = rows?.[0] as { id: string; validated_url: string | null; human_confirmations: number | null } | undefined;
  if (existing) {
    const { error } = await supabase
      .from('linkgen_mapping_memory')
      .update({
        validation_status: 'valid',
        source: 'human_verified',
        confidence: 1,
        human_confirmations: (existing.human_confirmations ?? 0) + 1,
        last_confirmed_at: now,
        updated_at: now,
        ...(item.url && !existing.validated_url ? { validated_url: item.url } : {}),
      })
      .eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from('linkgen_mapping_memory')
      .insert({
        site: item.site,
        country,
        brand,
        model,
        fuel,
        trim: trimVal,
        source_url: item.url,
        validated_url: item.url,
        confidence: 1,
        validation_status: 'valid',
        source: 'human_verified',
        human_confirmations: 1,
        last_confirmed_at: now,
        last_checked_at: now,
      });
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}
