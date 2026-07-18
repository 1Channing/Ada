/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WORKER-SIDE CAMPAIGN LOOP — runs with the browser CLOSED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The campaign engine (shared with the browser) does the real work; this
 * module owns the server loop: sequential items, heartbeat, stop signal read
 * from the campaign row (the frontend sets status='stopping'), and automatic
 * resume of interrupted campaigns when the worker boots (Railway restarts
 * included). Launch 200 studies, close the laptop, sleep — the mappings and
 * the gap report are waiting in the morning.
 */

import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { planCampaign } from '../src/lib/linkgen/campaignPlanner';
import type { CampaignPlanItem, CampaignPlanOptions } from '../src/lib/linkgen/campaignPlanner';
import {
  loadCampaignKnowledge, executeCampaignItem, insertCampaignItemRow,
} from '../src/lib/linkgen/campaignEngine';
import type { CampaignItemResult, CampaignOutcome, ScrapeFn } from '../src/lib/linkgen/campaignEngine';
import { scrapeSearch } from './scraper';

const PAUSE_BETWEEN_ITEMS_MS = 3000;
const HEARTBEAT_STALE_MS = 120_000;

const scrape: ScrapeFn = async (url) => {
  try {
    const r = await scrapeSearch(url, 'full');
    return { listings: r.listings ?? [], error: r.error ?? null };
  } catch (e) {
    return { listings: [], error: e instanceof Error ? e.message : String(e) };
  }
};

// One campaign at a time per worker process.
let loopBusy = false;

export interface WorkerCampaignStart extends Omit<CampaignPlanOptions, 'rng'> {
  label?: string;
}

export async function startWorkerCampaign(opts: WorkerCampaignStart): Promise<{ started: boolean; campaignId?: string; reason?: string }> {
  if (loopBusy) return { started: false, reason: 'campaign_already_running' };

  const knowledge = await loadCampaignKnowledge();
  const plan = planCampaign(knowledge, opts);
  if (plan.length === 0) {
    return { started: false, reason: 'no_plan — la mémoire ne contient pas encore de mapping validé' };
  }

  const { data: row, error } = await supabase
    .from('linkgen_campaigns')
    .insert({
      label: opts.label ?? `Campagne ${new Date().toISOString().slice(0, 16)}`,
      status: 'running',
      total: plan.length,
      config: JSON.parse(JSON.stringify({
        sites: opts.sites, total: opts.total,
        reinforceShare: opts.reinforceShare, variantShare: opts.variantShare,
        plan, runner: 'worker',
      })),
      last_heartbeat: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !row) return { started: false, reason: error?.message ?? 'insert failed' };

  console.log(`[CAMPAIGN_WORKER] start id=${row.id} total=${plan.length} sites=${opts.sites.join(',')}`);
  void runLoop(row.id, plan, 0);
  return { started: true, campaignId: row.id };
}

/** Boot-time resume: pick up the latest 'running' campaign with a stale heartbeat. */
export async function resumeWorkerCampaigns(): Promise<void> {
  try {
    const { data: camp } = await supabase
      .from('linkgen_campaigns')
      .select('id, status, total, config, last_heartbeat')
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const plan = (camp?.config as { plan?: unknown } | null)?.plan;
    if (!camp || !Array.isArray(plan) || plan.length === 0) return;

    const hb = camp.last_heartbeat ? Date.parse(camp.last_heartbeat) : 0;
    if (Date.now() - hb < HEARTBEAT_STALE_MS) return; // someone else is driving

    const { data: items } = await supabase
      .from('linkgen_campaign_items')
      .select('seq')
      .eq('campaign_id', camp.id);
    const maxSeq = (items ?? []).reduce((m, r) => Math.max(m, (r as { seq: number }).seq), 0);
    if (maxSeq >= plan.length) {
      await supabase.from('linkgen_campaigns').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', camp.id);
      return;
    }
    console.log(`[CAMPAIGN_WORKER] reprise id=${camp.id} à l'étude ${maxSeq + 1}/${plan.length}`);
    void runLoop(camp.id, plan as CampaignPlanItem[], maxSeq);
  } catch (e) {
    console.warn('[CAMPAIGN_WORKER] resume check failed:', e instanceof Error ? e.message : e);
  }
}

async function readStatus(campaignId: string): Promise<string> {
  const { data } = await supabase.from('linkgen_campaigns').select('status').eq('id', campaignId).maybeSingle();
  return data?.status ?? 'running';
}

async function runLoop(campaignId: string, plan: CampaignPlanItem[], startIndex: number): Promise<void> {
  loopBusy = true;
  const counts: Record<CampaignOutcome, number> = {
    confirmed: 0, taxonomy_gap: 0, enum_gap: 0, no_url: 0, insufficient: 0, technical: 0,
  };
  // Rebuild counters from already-done items on resume.
  if (startIndex > 0) {
    const { data: done } = await supabase
      .from('linkgen_campaign_items').select('outcome').eq('campaign_id', campaignId);
    for (const r of done ?? []) {
      const o = (r as { outcome: string | null }).outcome as CampaignOutcome | null;
      if (o && o in counts) counts[o]++;
    }
  }
  let doneCount = startIndex;
  let stopped = false;

  try {
    for (let i = startIndex; i < plan.length; i++) {
      // Stop signal + heartbeat BEFORE the (long) scrape.
      const status = await readStatus(campaignId);
      if (status === 'stopping' || status === 'stopped') { stopped = true; break; }
      await supabase.from('linkgen_campaigns').update({ last_heartbeat: new Date().toISOString() }).eq('id', campaignId);

      const p = plan[i];
      console.log(`[CAMPAIGN_WORKER] #${i + 1}/${plan.length} ${p.site} · ${p.brand} ${p.model}${p.fuel ? ' · ' + p.fuel : ''}${p.trim ? ' · ' + p.trim : ''}`);
      let result: CampaignItemResult;
      try {
        result = await executeCampaignItem(i + 1, p, scrape);
      } catch (e) {
        result = {
          seq: i + 1, site: p.site, brand: p.brand, model: p.model, fuel: p.fuel, trim: p.trim,
          kind: p.kind, url: null, outcome: 'technical', confirmedFields: [], rejected: [],
          detail: `erreur interne: ${e instanceof Error ? e.message : String(e)}`, sampleSize: 0,
        };
      }

      counts[result.outcome]++;
      doneCount++;
      await insertCampaignItemRow(campaignId, result).catch((e) => console.warn('[CAMPAIGN_WORKER] item insert failed:', e?.message ?? e));
      await supabase.from('linkgen_campaigns').update({
        done_count: doneCount,
        confirmed_count: counts.confirmed,
        gap_count: counts.taxonomy_gap + counts.enum_gap,
        technical_count: counts.technical + counts.insufficient + counts.no_url,
        last_heartbeat: new Date().toISOString(),
      }).eq('id', campaignId);

      if (i < plan.length - 1) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_ITEMS_MS));
    }
  } finally {
    loopBusy = false;
    await supabase.from('linkgen_campaigns').update({
      status: stopped ? 'stopped' : 'done',
      finished_at: new Date().toISOString(),
    }).eq('id', campaignId).then(
      () => console.log(`[CAMPAIGN_WORKER] ${stopped ? 'stoppée' : 'terminée'} id=${campaignId} (${doneCount}/${plan.length})`),
      (e) => console.warn('[CAMPAIGN_WORKER] final update failed:', e?.message ?? e)
    );
  }
}
