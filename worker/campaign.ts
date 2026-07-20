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

/**
 * deep = up to 10 pages (~300 listings) instead of 5/100 — opt-in per campaign.
 * stopFlag: when the operator hits stop MID-item, the very next Zyte call
 * (retry, probe, next page) refuses to start instead of finishing a long item.
 */
const mkScrape = (deep: boolean, stopFlag: { stop: boolean }): ScrapeFn => async (url) => {
  if (stopFlag.stop) return { listings: [], error: 'CAMPAIGN_STOPPED' };
  try {
    const r = await scrapeSearch(url, deep ? 'deep' : 'full');
    // Diagnostics feed the error dossiers (boîte noire) — full action context.
    return {
      listings: r.listings ?? [],
      error: r.error ?? null,
      diagnostics: (r.diagnostics ?? null) as unknown as Record<string, unknown> | null,
    };
  } catch (e) {
    return { listings: [], error: e instanceof Error ? e.message : String(e) };
  }
};

// One campaign at a time per worker process.
let loopBusy = false;

export interface WorkerCampaignStart extends Omit<CampaignPlanOptions, 'rng'> {
  label?: string;
  /** 10-page pagination instead of 5 (more depth, ~2× Zyte calls). */
  deepScan?: boolean;
  /**
   * Explicit plan override — the monthly re-scan sends the EXACT stale
   * segments the operator ticked; the planner is bypassed entirely.
   */
  plan?: CampaignPlanItem[];
}

export async function startWorkerCampaign(opts: WorkerCampaignStart): Promise<{ started: boolean; campaignId?: string; reason?: string }> {
  if (loopBusy) return { started: false, reason: 'campaign_already_running' };

  let plan: CampaignPlanItem[];
  if (Array.isArray(opts.plan) && opts.plan.length > 0) {
    plan = opts.plan;
  } else {
    const knowledge = await loadCampaignKnowledge();
    plan = planCampaign(knowledge, opts);
  }
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
        filters: opts.filters, deepScan: opts.deepScan === true,
        plan, runner: 'worker',
      })),
      last_heartbeat: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !row) return { started: false, reason: error?.message ?? 'insert failed' };

  console.log(`[CAMPAIGN_WORKER] start id=${row.id} total=${plan.length} deep=${opts.deepScan === true} sites=${opts.sites.join(',')}`);
  void runLoop(row.id, plan, 0, opts.deepScan === true);
  return { started: true, campaignId: row.id };
}

/**
 * Boot-time housekeeping:
 *  - campaigns stuck in 'stopping' with no live loop → finalise to 'stopped'
 *    (the stop was requested; honour it) so the UI never hangs on
 *    « arrêt en cours… » forever;
 *  - latest 'running' campaign with a stale heartbeat → resume it;
 *  - 'running' campaigns with NO stored plan (pre-worker era) → finalise
 *    'stopped', they cannot be resumed.
 */
export async function resumeWorkerCampaigns(): Promise<void> {
  try {
    const { data: rows } = await supabase
      .from('linkgen_campaigns')
      .select('id, status, total, config, last_heartbeat')
      .in('status', ['running', 'stopping'])
      .order('created_at', { ascending: false });
    if (!rows || rows.length === 0) {
      console.log('[CAMPAIGN_WORKER] boot: aucune campagne à reprendre');
      return;
    }

    let resumed = false;
    for (const camp of rows) {
      const hb = camp.last_heartbeat ? Date.parse(camp.last_heartbeat) : 0;
      const fresh = Date.now() - hb < HEARTBEAT_STALE_MS;
      const plan = (camp.config as { plan?: unknown } | null)?.plan;
      const resumable = Array.isArray(plan) && plan.length > 0;

      if (camp.status === 'stopping' || !resumable) {
        if (fresh) continue; // a live loop will finalise it itself
        await supabase.from('linkgen_campaigns')
          .update({ status: 'stopped', finished_at: new Date().toISOString() })
          .eq('id', camp.id);
        console.log(`[CAMPAIGN_WORKER] boot: campagne orpheline ${camp.id} (${camp.status}${resumable ? '' : ', sans plan'}) → stopped`);
        continue;
      }

      // status 'running' + plan present
      if (fresh || resumed) continue; // driven elsewhere / one loop max
      const { data: items } = await supabase
        .from('linkgen_campaign_items')
        .select('seq')
        .eq('campaign_id', camp.id);
      const maxSeq = (items ?? []).reduce((m, r) => Math.max(m, (r as { seq: number }).seq), 0);
      if (maxSeq >= (plan as unknown[]).length) {
        await supabase.from('linkgen_campaigns').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', camp.id);
        continue;
      }
      console.log(`[CAMPAIGN_WORKER] reprise id=${camp.id} à l'étude ${maxSeq + 1}/${(plan as unknown[]).length}`);
      resumed = true;
      const deep = (camp.config as { deepScan?: boolean } | null)?.deepScan === true;
      void runLoop(camp.id, plan as CampaignPlanItem[], maxSeq, deep);
    }
  } catch (e) {
    console.warn('[CAMPAIGN_WORKER] resume check failed:', e instanceof Error ? e.message : e);
  }
}

async function readStatus(campaignId: string): Promise<string> {
  const { data } = await supabase.from('linkgen_campaigns').select('status').eq('id', campaignId).maybeSingle();
  return data?.status ?? 'running';
}

async function runLoop(campaignId: string, plan: CampaignPlanItem[], startIndex: number, deepScan = false): Promise<void> {
  loopBusy = true;
  // A deep item (Cloudflare retries with backoffs, 404 probes, 10-page
  // pagination) can legitimately run for MINUTES. Reading the stop signal only
  // between items made « Arrêt immédiat » feel dead, and a heartbeat that only
  // beat between items let the frontend's orphan check kill live campaigns.
  // This side-channel polls every 8s: it flips stopFlag (the next Zyte call
  // aborts the item) and keeps the heartbeat fresh DURING long items.
  const stopFlag = { stop: false };
  const signalTimer = setInterval(() => {
    void (async () => {
      try {
        const status = await readStatus(campaignId);
        if (status === 'stopping' || status === 'stopped') stopFlag.stop = true;
        else await supabase.from('linkgen_campaigns').update({ last_heartbeat: new Date().toISOString() }).eq('id', campaignId);
      } catch { /* transient read failure — next tick retries */ }
    })();
  }, 8000);
  const scrape = mkScrape(deepScan, stopFlag);
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
  // Cloudflare blocks are transient and session-scoped: logs showed all 4
  // attempts (locale flip, sibling host, cache-buster, browser) refused at
  // one moment. Items blocked in the main pass get ONE more chance at the
  // END of the campaign, after a cool-down — by then the edge decision and
  // Zyte's exit pool have moved on.
  const blockedForRepass: Array<{ p: CampaignPlanItem; seq: number }> = [];
  const waitWithStop = async (ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until && !stopFlag.stop) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  };

  try {
    for (let i = startIndex; i < plan.length; i++) {
      // Stop signal + heartbeat BEFORE the (long) scrape.
      const status = await readStatus(campaignId);
      if (stopFlag.stop || status === 'stopping' || status === 'stopped') { stopped = true; break; }
      await supabase.from('linkgen_campaigns').update({ last_heartbeat: new Date().toISOString() }).eq('id', campaignId);

      const p = plan[i];
      console.log(`[CAMPAIGN_WORKER] #${i + 1}/${plan.length} ${p.site} · ${p.brand} ${p.model}${p.fuel ? ' · ' + p.fuel : ''}${p.trim ? ' · ' + p.trim : ''}${p.year ? ' · ' + p.year : ''}`);
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

      // Item interrupted mid-flight by the stop: honour it, don't record a
      // truncated result (the segment stays intact for a future run).
      if (result.detail.includes('CAMPAIGN_STOPPED')) { stopped = true; break; }

      counts[result.outcome]++;
      doneCount++;
      if (result.outcome === 'technical' && result.detail.includes('TARGET_BLOCKED')) {
        blockedForRepass.push({ p, seq: result.seq });
      }
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

    // ── Second-chance pass over Cloudflare-blocked items ──────────────────
    if (!stopped && blockedForRepass.length > 0) {
      const repass = blockedForRepass.slice(0, 40); // bounded Zyte budget
      console.log(`[CAMPAIGN_WORKER] 2e passe anti-blocage: ${repass.length} étude(s) bloquée(s) re-tentée(s) après refroidissement`);
      await waitWithStop(120_000);
      for (const { p, seq } of repass) {
        if (stopFlag.stop) { stopped = true; break; }
        let retry: CampaignItemResult;
        try {
          retry = await executeCampaignItem(seq, p, scrape);
        } catch { continue; }
        if (retry.detail.includes('CAMPAIGN_STOPPED')) { stopped = true; break; }
        if (retry.outcome === 'technical') continue; // toujours bloquée — la ligne d'origine reste
        // Récupérée : la ligne d'origine est REMPLACÉE (même campagne+seq)
        // et les compteurs suivent — le blocage n'était qu'un incident.
        counts.technical--;
        counts[retry.outcome]++;
        console.log(`[CAMPAIGN_WORKER] 2e passe ✅ #${seq} ${p.site} ${p.brand} ${p.model} → ${retry.outcome}`);
        await supabase.from('linkgen_campaign_items').update({
          url: retry.url,
          outcome: retry.outcome,
          confirmed_fields: retry.confirmedFields,
          rejected: retry.rejected,
          detail: `${retry.detail} (récupérée en 2e passe anti-blocage)`,
          sample_size: retry.sampleSize,
          finished_at: new Date().toISOString(),
        }).eq('campaign_id', campaignId).eq('seq', seq);
        await supabase.from('linkgen_campaigns').update({
          confirmed_count: counts.confirmed,
          gap_count: counts.taxonomy_gap + counts.enum_gap,
          technical_count: counts.technical + counts.insufficient + counts.no_url,
          last_heartbeat: new Date().toISOString(),
        }).eq('id', campaignId);
        await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_ITEMS_MS));
      }
    }
  } finally {
    clearInterval(signalTimer);
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
