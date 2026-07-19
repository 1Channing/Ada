/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CAMPAIGN CLIENT — start/stop/watch (the loop itself runs in the WORKER)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Since campaigns run server-side (Railway worker), the browser only:
 *  - starts one   → edge function campaign-start → worker /campaign/start
 *  - stops one    → flips the campaign row to status='stopping' (the worker
 *                   reads it between items; current item finishes, rest halts)
 *  - watches      → polls the campaign row + items and feeds the zustand
 *                   store the panel renders. Close the browser, reopen at 7am:
 *                   the watcher picks the finished (or still running) campaign
 *                   right back up.
 */

import { supabase } from '../lib/supabase';
import type { CampaignItemResult, CampaignOutcome } from '../lib/linkgen/campaignEngine';
import type { CampaignFilters, CampaignPlanItem } from '../lib/linkgen/campaignPlanner';
import { useCampaignStore, EMPTY_COUNTS } from '../store/campaignStore';

const POLL_MS = 5000;

export interface StartCampaignOptions {
  sites: string[];
  total: number;
  reinforceShare?: number;
  variantShare?: number;
  /** Modular targeting: brands / models / fuels / year window. */
  filters?: CampaignFilters;
  /** 10-page deep pagination (~2× Zyte calls). Off by default. */
  deepScan?: boolean;
  /** Explicit plan (monthly re-scan: the exact segments the operator ticked). */
  plan?: CampaignPlanItem[];
  label?: string;
}

export async function startCampaign(opts: StartCampaignOptions): Promise<{ started: boolean; reason?: string }> {
  const st = useCampaignStore.getState();
  if (st.status === 'running' || st.status === 'planning' || st.status === 'stopping') {
    return { started: false, reason: 'Une campagne tourne déjà' };
  }
  useCampaignStore.setState({
    status: 'planning', error: null, stopRequested: false,
    items: [], counts: { ...EMPTY_COUNTS }, done: 0, total: 0, current: null, campaignId: null,
  });

  try {
    const { data, error } = await supabase.functions.invoke('campaign-start', { body: opts });
    if (error || !data?.started) {
      let reason = data?.reason ?? error?.message ?? 'Lancement impossible';
      const ctx = (error as { context?: unknown } | null)?.context;
      if (ctx instanceof Response) {
        try { const b = await ctx.clone().json(); reason = b?.reason ?? reason; } catch { /* keep */ }
      }
      useCampaignStore.setState({ status: 'error', error: String(reason) });
      return { started: false, reason: String(reason) };
    }
    useCampaignStore.setState({ status: 'running', campaignId: data.campaignId ?? null });
    pollNow(); // fetch totals immediately, then keep watching
    return { started: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    useCampaignStore.setState({ status: 'error', error: reason });
    return { started: false, reason };
  }
}

/**
 * Immediate stop. The worker polls the row every 8s EVEN during a long item
 * (the next Zyte call aborts). We flip EVERY 'running' row to 'stopping' —
 * guessing "the right" id left campaigns unkillable whenever the store's id
 * was stale or the row had already flipped: an emergency stop must stop.
 */
export async function stopCampaign(): Promise<void> {
  useCampaignStore.setState({ status: 'stopping', stopRequested: true });
  const { error } = await supabase
    .from('linkgen_campaigns')
    .update({ status: 'stopping' })
    .eq('status', 'running');
  if (error) {
    console.warn('[CAMPAIGN] stop update failed:', error.message);
    useCampaignStore.setState({ error: `Arrêt non transmis : ${error.message}` });
  }
  pollNow();
}

/** Manual gap resolution — writes resolved_at on the item (by campaign+seq). */
export async function markItemResolved(campaignId: string, seq: number): Promise<void> {
  await supabase
    .from('linkgen_campaign_items')
    .update({ resolved_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
    .eq('seq', seq);
  useCampaignStore.setState((st) => ({
    items: st.items.map((i) => (i.seq === seq ? { ...i, resolvedAt: new Date().toISOString() } : i)),
  }));
}

// ─── Watcher (poll → store) ──────────────────────────────────────────────────

let watcherStarted = false;
let lastSyncKey = '';

function mapItems(rows: Array<Record<string, unknown>>): Array<CampaignItemResult & { resolvedAt?: string | null }> {
  return rows.map((r) => ({
    seq: r.seq as number,
    site: r.site as string,
    brand: r.brand as string,
    model: r.model as string,
    fuel: (r.criteria as { fuel?: string } | null)?.fuel ?? undefined,
    trim: (r.criteria as { trim?: string } | null)?.trim ?? undefined,
    year: (r.criteria as { year?: number } | null)?.year ?? undefined,
    kind: ((r.kind as string) ?? 'exploration') as CampaignItemResult['kind'],
    url: (r.url as string | null) ?? null,
    outcome: ((r.outcome as string) ?? 'technical') as CampaignOutcome,
    confirmedFields: (r.confirmed_fields as string[] | null) ?? [],
    rejected: (r.rejected as CampaignItemResult['rejected']) ?? [],
    detail: (r.detail as string | null) ?? '',
    sampleSize: (r.sample_size as number) ?? 0,
    resolvedAt: (r.resolved_at as string | null) ?? null,
  }));
}

/** A 'running'/'stopping' row whose heartbeat died > 10 min ago is orphaned —
 *  no loop will ever finalise it. Close it out so the UI never hangs. (10 min
 *  because one item can legitimately take several minutes: Zyte retries +
 *  pagination; the heartbeat only beats between items.) */
const ORPHAN_AFTER_MS = 10 * 60 * 1000;

async function syncOnce(): Promise<void> {
  const { data: campRow } = await supabase
    .from('linkgen_campaigns')
    .select('id, status, total, done_count, last_heartbeat')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!campRow) return;
  let camp = campRow;

  if (camp.status === 'running' || camp.status === 'stopping') {
    const hb = camp.last_heartbeat ? Date.parse(camp.last_heartbeat) : 0;
    if (Date.now() - hb > ORPHAN_AFTER_MS) {
      console.warn(`[CAMPAIGN] campagne orpheline ${camp.id} (heartbeat mort) → stopped`);
      await supabase.from('linkgen_campaigns')
        .update({ status: 'stopped', finished_at: new Date().toISOString() })
        .eq('id', camp.id);
      camp = { ...camp, status: 'stopped' };
    }
  }

  const st = useCampaignStore.getState();
  // Don't fight a start in progress (edge call hasn't returned its id yet).
  if (st.status === 'planning' && !st.campaignId) return;

  const syncKey = `${camp.id}|${camp.status}|${camp.done_count}`;
  if (syncKey === lastSyncKey && st.campaignId === camp.id) return; // nothing new

  let { data: itemRows, error: itemsError } = await supabase
    .from('linkgen_campaign_items')
    .select('seq, site, brand, model, criteria, url, kind, outcome, confirmed_fields, rejected, detail, sample_size, resolved_at')
    .eq('campaign_id', camp.id)
    .order('seq');
  if (itemsError) {
    // Most likely the resolved_at migration hasn't run yet — retry without it
    // rather than blanking the live view.
    console.warn('[CAMPAIGN] items select failed, retrying without resolved_at:', itemsError.message);
    const retry = await supabase
      .from('linkgen_campaign_items')
      .select('seq, site, brand, model, criteria, url, kind, outcome, confirmed_fields, rejected, detail, sample_size')
      .eq('campaign_id', camp.id)
      .order('seq');
    itemRows = retry.data as typeof itemRows;
    if (retry.error) {
      console.warn('[CAMPAIGN] items select failed:', retry.error.message);
      return; // keep the last known display, never zero it out
    }
  }
  const items = mapItems((itemRows ?? []) as unknown as Array<Record<string, unknown>>);
  const counts = { ...EMPTY_COUNTS };
  for (const it of items) counts[it.outcome]++;

  const statusMap: Record<string, 'running' | 'stopping' | 'stopped' | 'done'> = {
    running: 'running', stopping: 'stopping', stopped: 'stopped', done: 'done',
  };
  useCampaignStore.setState({
    campaignId: camp.id,
    status: statusMap[camp.status] ?? 'idle',
    total: camp.total,
    done: items.length,
    counts,
    items,
    current: null,
  });
  lastSyncKey = syncKey;
}

function pollNow(): void {
  void syncOnce().catch(() => undefined);
}

/** Called once at app startup — keeps the store mirroring the DB campaign. */
export function startCampaignWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;
  pollNow();
  setInterval(() => {
    const s = useCampaignStore.getState().status;
    // Light when idle/finished (only the 1-row campaign query detects change).
    if (s === 'planning') return;
    pollNow();
  }, POLL_MS);
}
