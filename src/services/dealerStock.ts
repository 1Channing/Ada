/**
 * STOCK D'UNE CONCESSION, côté front (30/09). Le relevé est fait par le
 * worker (mode `dealer_stock` de l'edge ingest-url) ; ici on le déclenche, on
 * attend son bilan, puis on lit les tables.
 */
import { supabase } from '../lib/supabase';

export interface StockVehicle {
  id: string; contact_id: string; external_id: string; url: string | null; title: string | null; brand: string | null; model: string | null;
  price: number | null; price_prev: number | null; km: number | null; year: number | null; fuel: string | null; gearbox: string | null;
  plate: string | null; vin: string | null; body: string | null; image: string | null; listed_at: string | null;
  first_seen_at: string; last_seen_at: string; gone_at: string | null; last_run_id: string | null; gone_run_id: string | null;
  /** price_on_request · expected · reserved · sold · null = en vente (01/10). Absent tant que le SQL du 01/10 n'est pas collé. */
  status?: string | null;
}

/** Libellé court du statut d'une annonce sans prix affiché. */
export const STATUS_LABEL: Record<string, { label: string; title: string; cls: string }> = {
  price_on_request: { label: 'sur demande', title: 'Le site n\'affiche pas de prix (« op aanvraag »)', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  expected: { label: 'attendue', title: 'Annoncée, pas encore livrée (« binnenkort verwacht »)', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  reserved: { label: 'réservée', title: 'Réservée par un client (« gereserveerd »)', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  sold: { label: 'vendue', title: 'Vendue mais encore affichée (« verkocht »)', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};
export interface StockRun {
  id: string; contact_id: string; url: string; provider: string | null; status: string; total: number | null; new_count: number | null;
  gone_count: number | null; price_changes: number | null; pages: number | null; warnings: string[] | null; error: string | null;
  submitted_by: string | null; started_at: string; finished_at: string | null;
}
export interface StockSummary { provider: string; total: number; newCount: number; goneCount: number; priceChanges: number; pages: number; warnings: string[]; runId: string | null }

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /does not exist|relation|schema cache/i.test(m);

export async function listStockRuns(contactId: string): Promise<{ runs: StockRun[]; error: string | null }> {
  const { data, error } = await untyped.from('network_stock_runs').select('*').eq('contact_id', contactId).order('started_at', { ascending: false }).limit(20);
  if (error) return { runs: [], error: missing(error.message) ? 'SQL du 30/09 (network_stock_*) à coller.' : error.message };
  return { runs: (data ?? []) as StockRun[], error: null };
}

export async function listStockVehicles(contactId: string): Promise<{ vehicles: StockVehicle[]; error: string | null }> {
  const { data, error } = await untyped.from('network_stock_vehicles').select('*').eq('contact_id', contactId).order('last_seen_at', { ascending: false }).limit(5000);
  if (error) return { vehicles: [], error: missing(error.message) ? 'SQL du 30/09 (network_stock_*) à coller.' : error.message };
  return { vehicles: (data ?? []) as StockVehicle[], error: null };
}

/** Lance le relevé et attend son bilan (4 s de sondage, 15 min au plus). */
export async function scanDealerStock(contactId: string, url: string, submittedBy: string): Promise<StockSummary> {
  const start = await supabase.functions.invoke('ingest-url', { body: { mode: 'dealer_stock', url, contactId, submittedBy, async: true } });
  if (start.error) throw new Error(start.error.message ?? 'lancement impossible');
  const jobId = (start.data as { jobId?: string } | null)?.jobId;
  if (!jobId) throw new Error((start.data as { message?: string } | null)?.message ?? 'lancement refusé');
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const poll = await supabase.functions.invoke('ingest-url', { body: { jobId } });
    if (poll.error) {
      const status = ((poll.error as { context?: unknown }).context as { status?: number } | undefined)?.status;
      if (status === 404) throw new Error('suivi perdu (worker redémarré) — relance le relevé');
      continue;
    }
    const d = poll.data as { jobStatus?: string; message?: string; summary?: StockSummary } | null;
    if (d?.jobStatus === 'running') continue;
    if (d?.jobStatus === 'error') throw new Error(d.message ?? 'relevé en échec');
    if (d?.summary) return d.summary;
    throw new Error('réponse du worker sans bilan');
  }
  throw new Error('relevé trop long (15 min)');
}
