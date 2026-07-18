/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CAMPAIGN RUNNER — mass ingestion engine (singleton, outside React)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sequential loop: one scrape at a time (cost control, no site hammering, no
 * interference with manual ingestions), 1 pause between items. Each item runs
 * THE SAME pipeline as a manual ingestion — memory-first URL generation,
 * /ingest-url scrape, field-by-field confirmation, granular retention, market
 * snapshot — so everything a campaign learns is immediately reusable by the
 * Link Gen and the Ingestion prefill, including by the LATER items of the
 * same campaign (URL generation happens at item time, not at planning time).
 */

import { supabase } from '../lib/supabase';
import { getSiteAdapter } from '../lib/study-core/marketplaces';
import type { SearchCriteria } from '../lib/study-core/marketplaces';
import { analyzeIngestion, INGESTION_MIN_SAMPLE } from '../lib/study-core/ingestion';
import { decomposeUrl } from '../lib/study-core/marketplaces';
import { persistIngestionResult } from '../lib/linkgen/ingestion';
import { generateSearchUrlsWithMemory } from '../lib/linkgen/generator';
import type { SiteKey } from '../lib/linkgen/types';
import { writeMarketSnapshot } from './marketData';
import { planCampaign } from '../lib/linkgen/campaignPlanner';
import type { CampaignKnowledge, CampaignPlanOptions } from '../lib/linkgen/campaignPlanner';
import { useCampaignStore, EMPTY_COUNTS } from '../store/campaignStore';
import type { CampaignItemResult, CampaignOutcome } from '../store/campaignStore';
import type { ScrapedListing } from '../lib/study-core/types';

const PAUSE_BETWEEN_ITEMS_MS = 3000;
/**
 * Campaign ingestions are signed 'Ada' — she appears in the contributor
 * leaderboard (links ingested / mappings written) like any human operator,
 * and the mapping tree shows what she learned on her own in violet.
 */
const CAMPAIGN_SUBMITTER = 'Ada';

// ─── Knowledge loading ────────────────────────────────────────────────────────

/** Validated memory → pools (brand/model/fuel/trim per brand+model) + per-site coverage. */
export async function loadCampaignKnowledge(): Promise<CampaignKnowledge> {
  const { data } = await supabase
    .from('linkgen_mapping_memory')
    .select('site, brand, model, fuel, trim, validation_status')
    .eq('validation_status', 'valid')
    .limit(10000);

  const brands = new Set<string>();
  const modelsByBrand: Record<string, Set<string>> = {};
  const fuelsByBrandModel: Record<string, Set<string>> = {};
  const trimsByBrandModel: Record<string, Set<string>> = {};
  const coveredBySite: Record<string, Set<string>> = {};

  for (const r of (data ?? []) as Array<Record<string, string | null>>) {
    const brand = (r.brand ?? '').trim().toUpperCase();
    const model = (r.model ?? '').trim().toUpperCase();
    if (!brand || !model) continue;
    brands.add(brand);
    (modelsByBrand[brand] ??= new Set()).add(model);
    const key = `${brand}|${model}`;
    const fuel = (r.fuel ?? '').trim().toUpperCase();
    if (fuel) (fuelsByBrandModel[key] ??= new Set()).add(fuel);
    const trim = (r.trim ?? '').trim();
    if (trim) (trimsByBrandModel[key] ??= new Set()).add(trim);
    if (r.site) (coveredBySite[r.site] ??= new Set()).add(key);
  }

  const toRec = (rec: Record<string, Set<string>>): Record<string, string[]> =>
    Object.fromEntries(Object.entries(rec).map(([k, s]) => [k, [...s]]));

  return {
    brands: [...brands].sort(),
    modelsByBrand: toRec(modelsByBrand),
    fuelsByBrandModel: toRec(fuelsByBrandModel),
    trimsByBrandModel: toRec(trimsByBrandModel),
    coveredBySite: Object.fromEntries(Object.entries(coveredBySite).map(([k, s]) => [k, s])),
  };
}

// ─── Scrape call (same edge function as the Ingestion page) ──────────────────

async function invokeIngestUrl(url: string): Promise<{ listings: ScrapedListing[]; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('ingest-url', { body: { url } });
    if (error) return { listings: [], error: error.message ?? 'edge error' };
    return { listings: (data?.listings ?? []) as ScrapedListing[], error: data?.error ?? null };
  } catch (e) {
    return { listings: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Stop-aware pause ────────────────────────────────────────────────────────

async function pause(ms: number): Promise<void> {
  const step = 250;
  for (let waited = 0; waited < ms; waited += step) {
    if (useCampaignStore.getState().stopRequested) return;
    await new Promise((r) => setTimeout(r, step));
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function stopCampaign(): void {
  const st = useCampaignStore.getState();
  if (st.status === 'running' || st.status === 'planning') {
    useCampaignStore.setState({ stopRequested: true, status: 'stopping' });
  }
}

export interface StartCampaignOptions extends Omit<CampaignPlanOptions, 'rng'> {
  label?: string;
}

/**
 * Fire-and-forget: kicks the loop and returns immediately. The store is the
 * single source of truth for progress; the DB rows are the durable record.
 */
export async function startCampaign(opts: StartCampaignOptions): Promise<{ started: boolean; reason?: string }> {
  const st = useCampaignStore.getState();
  if (st.status === 'running' || st.status === 'planning' || st.status === 'stopping') {
    return { started: false, reason: 'Une campagne tourne déjà' };
  }

  useCampaignStore.setState({
    status: 'planning', error: null, stopRequested: false,
    items: [], counts: { ...EMPTY_COUNTS }, done: 0, total: 0, current: null, campaignId: null,
  });

  const knowledge = await loadCampaignKnowledge();
  const plan = planCampaign(knowledge, opts);
  if (plan.length === 0) {
    useCampaignStore.setState({ status: 'error', error: 'Aucune étude planifiable — la mémoire ne contient pas encore de mapping validé.' });
    return { started: false, reason: 'no plan' };
  }

  const { data: row, error: insErr } = await supabase
    .from('linkgen_campaigns')
    .insert({
      label: opts.label ?? `Campagne ${new Date().toLocaleString('fr-FR')}`,
      status: 'running',
      total: plan.length,
      // The FULL plan is stored so a page reload can resume the run exactly
      // where it stopped (resumeRunningCampaignIfAny). JSON round-trip strips
      // undefined values and satisfies the Json column type.
      config: JSON.parse(JSON.stringify({
        sites: opts.sites, total: opts.total,
        reinforceShare: opts.reinforceShare, variantShare: opts.variantShare,
        plan,
      })),
      last_heartbeat: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (insErr || !row) {
    useCampaignStore.setState({ status: 'error', error: `Création campagne impossible: ${insErr?.message}` });
    return { started: false, reason: insErr?.message };
  }

  useCampaignStore.setState({ status: 'running', total: plan.length, campaignId: row.id });

  // Detached loop — deliberately not awaited.
  void runLoop(row.id, plan, 0);
  return { started: true };
}

/**
 * Resume a campaign left in status 'running' — a full page reload (History
 * tab, F5…) kills the in-browser loop, but the plan lives in the campaign
 * row, so the app picks the run back up on startup, live tracking included.
 * Heartbeat guard: if another tab refreshed it < 2 min ago, that tab is
 * still driving — don't double-run.
 */
let resumeAttempted = false;
export async function resumeRunningCampaignIfAny(): Promise<void> {
  if (resumeAttempted) return;
  resumeAttempted = true;
  if (useCampaignStore.getState().status !== 'idle') return;
  useCampaignStore.setState({ status: 'planning' }); // reserve against races

  const release = () => useCampaignStore.setState({ status: 'idle' });
  const { data: camp } = await supabase
    .from('linkgen_campaigns')
    .select('id, status, total, config, last_heartbeat')
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const plan = (camp?.config as { plan?: unknown } | null)?.plan;
  if (!camp || !Array.isArray(plan) || plan.length === 0) { release(); return; }

  const hb = camp.last_heartbeat ? Date.parse(camp.last_heartbeat) : 0;
  if (Date.now() - hb < 120_000) { release(); return; } // another tab is on it

  const { data: items } = await supabase
    .from('linkgen_campaign_items')
    .select('seq, site, brand, model, criteria, url, kind, outcome, confirmed_fields, rejected, detail, sample_size')
    .eq('campaign_id', camp.id)
    .order('seq');
  const doneItems: CampaignItemResult[] = (items ?? []).map((r) => ({
    seq: r.seq, site: r.site, brand: r.brand, model: r.model,
    fuel: (r.criteria as { fuel?: string } | null)?.fuel ?? undefined,
    trim: (r.criteria as { trim?: string } | null)?.trim ?? undefined,
    kind: (r.kind as CampaignItemResult['kind']) ?? 'exploration',
    url: r.url, outcome: (r.outcome ?? 'technical') as CampaignOutcome,
    confirmedFields: r.confirmed_fields ?? [],
    rejected: (r.rejected as CampaignItemResult['rejected']) ?? [],
    detail: r.detail ?? '', sampleSize: r.sample_size,
  }));
  const counts = { ...EMPTY_COUNTS };
  for (const it of doneItems) counts[it.outcome]++;
  const maxSeq = doneItems.reduce((m, it) => Math.max(m, it.seq), 0);
  if (maxSeq >= plan.length) {
    // Everything ran but the final status write was lost — close it out.
    await supabase.from('linkgen_campaigns').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', camp.id);
    release();
    return;
  }

  useCampaignStore.setState({
    campaignId: camp.id, status: 'running', total: plan.length,
    done: doneItems.length, counts, items: doneItems,
    stopRequested: false, error: null, current: null,
  });
  console.log(`[CAMPAIGN] reprise de la campagne ${camp.id} à l'étude ${maxSeq + 1}/${plan.length}`);
  void runLoop(camp.id, plan as ReturnType<typeof planCampaign>, maxSeq);
}

// ─── The loop ────────────────────────────────────────────────────────────────

async function runLoop(campaignId: string, plan: ReturnType<typeof planCampaign>, startIndex: number): Promise<void> {
  for (let i = startIndex; i < plan.length; i++) {
    if (useCampaignStore.getState().stopRequested) break;
    const p = plan[i];
    useCampaignStore.setState({ current: { seq: i + 1, site: p.site, brand: p.brand, model: p.model, reason: p.reason } });
    // Heartbeat BEFORE the (long) scrape, so a parallel tab won't double-run.
    await supabase.from('linkgen_campaigns').update({ last_heartbeat: new Date().toISOString() }).eq('id', campaignId);

    const result = await runOneItem(i + 1, p);

    // Store + DB, then counters.
    useCampaignStore.setState((st) => ({
      items: [...st.items, result],
      done: st.done + 1,
      counts: { ...st.counts, [result.outcome]: st.counts[result.outcome] + 1 },
    }));
    const stNow = useCampaignStore.getState();
    await supabase.from('linkgen_campaign_items').insert({
      campaign_id: campaignId,
      seq: result.seq,
      site: result.site,
      brand: result.brand,
      model: result.model,
      criteria: { fuel: result.fuel ?? null, trim: result.trim ?? null },
      url: result.url,
      kind: result.kind,
      outcome: result.outcome,
      confirmed_fields: result.confirmedFields,
      rejected: result.rejected,
      detail: result.detail,
      sample_size: result.sampleSize,
      finished_at: new Date().toISOString(),
    });
    await supabase.from('linkgen_campaigns').update({
      done_count: stNow.done,
      confirmed_count: stNow.counts.confirmed,
      gap_count: stNow.counts.taxonomy_gap + stNow.counts.enum_gap,
      technical_count: stNow.counts.technical + stNow.counts.insufficient + stNow.counts.no_url,
      last_heartbeat: new Date().toISOString(),
    }).eq('id', campaignId);

    if (i < plan.length - 1) await pause(PAUSE_BETWEEN_ITEMS_MS);
  }

  const stopped = useCampaignStore.getState().stopRequested;
  useCampaignStore.setState({ status: stopped ? 'stopped' : 'done', current: null, stopRequested: false });
  await supabase.from('linkgen_campaigns').update({
    status: stopped ? 'stopped' : 'done',
    finished_at: new Date().toISOString(),
  }).eq('id', campaignId);
}

async function runOneItem(seq: number, p: ReturnType<typeof planCampaign>[number]): Promise<CampaignItemResult> {
  const base: Omit<CampaignItemResult, 'url' | 'outcome' | 'confirmedFields' | 'rejected' | 'detail' | 'sampleSize'> = {
    seq, site: p.site, brand: p.brand, model: p.model, fuel: p.fuel, trim: p.trim, kind: p.kind,
  };

  const criteria: SearchCriteria = {
    brand: p.brand,
    model: p.model,
    fuel: p.fuel || undefined,
    trim: p.trim || undefined,
  };

  // URL at ITEM time (memory-first) — learnings from earlier items apply here.
  let url: string | null = null;
  try {
    const gen = await generateSearchUrlsWithMemory({
      selectedSites: [p.site as SiteKey],
      brand: p.brand, model: p.model,
      fuel: p.fuel || undefined, trim: p.trim || undefined,
    });
    url = gen[0]?.url && gen[0].url.length > 10 ? gen[0].url : null;
  } catch { url = null; }
  if (!url) {
    return { ...base, url: null, outcome: 'no_url', confirmedFields: [], rejected: [], detail: 'URL non générable pour ce site', sampleSize: 0 };
  }

  const adapter = getSiteAdapter(p.site as SiteKey);
  const { listings, error } = await invokeIngestUrl(url);

  if (error && listings.length === 0) {
    // Audit trail identical to a failed manual ingestion.
    await persistIngestionResult({
      url, site: adapter.key, country: adapter.countryCode, criteria,
      analysis: null, sampleSize: 0, scrapeError: error,
      detectedParams: decomposeUrl(url), submittedBy: CAMPAIGN_SUBMITTER,
    }).catch(() => undefined);
    return { ...base, url, outcome: 'technical', confirmedFields: [], rejected: [], detail: `scrape en échec: ${error}`, sampleSize: 0 };
  }
  if (listings.length < INGESTION_MIN_SAMPLE) {
    return { ...base, url, outcome: 'insufficient', confirmedFields: [], rejected: [], detail: `échantillon ${listings.length} < ${INGESTION_MIN_SAMPLE}`, sampleSize: listings.length };
  }

  const analysis = analyzeIngestion(url, criteria, listings, adapter);

  // Same granular retention as a manual ingestion (only confirmed pairs stick).
  await persistIngestionResult({
    url, site: adapter.key, country: adapter.countryCode, criteria,
    analysis, sampleSize: listings.length,
    detectedParams: decomposeUrl(url), submittedBy: CAMPAIGN_SUBMITTER,
  }).catch(() => undefined);

  const confirmed = new Set(analysis.confirmedFields);
  if (confirmed.has('brand') && confirmed.has('model') && listings.length > 0) {
    await writeMarketSnapshot({
      segment: {
        site: adapter.key, country: adapter.countryCode,
        brand: p.brand.toUpperCase(), model: p.model.toUpperCase(),
        fuel: confirmed.has('fuel') ? (p.fuel ?? '').toUpperCase() : '',
        trim: confirmed.has('trim') ? (p.trim ?? '') : '',
      },
      listings,
      totalCount: null,
      sourceUrl: url,
      submittedBy: CAMPAIGN_SUBMITTER,
    }).catch(() => undefined);
  }

  const rejected = analysis.rejectedFields.map((c) => ({
    field: c.field, declared: c.declaredValue, reason: c.reason ?? '',
  }));
  const detail = rejected.length
    ? rejected.map((r) => `${r.field} (${r.declared}) : ${r.reason || 'incohérent avec l’échantillon'}`).join(' ; ')
    : `${analysis.confirmedFields.length} champ(s) confirmé(s)`;

  const outcome: CampaignOutcome =
    rejected.some((r) => r.field === 'brand' || r.field === 'model') ? 'taxonomy_gap'
    : rejected.length > 0 ? 'enum_gap'
    : 'confirmed';

  return {
    ...base, url, outcome,
    confirmedFields: [...analysis.confirmedFields],
    rejected, detail, sampleSize: listings.length,
  };
}
