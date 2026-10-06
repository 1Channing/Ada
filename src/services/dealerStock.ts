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
  /** Premier prix vu et chaque prix daté (01/10 soir). Absents tant que le SQL n'est pas collé. */
  price_first?: number | null;
  price_history?: Array<{ at: string; price: number }> | null;
  /** Devise des prix du site ('EUR' par défaut, 'DKK' raevhede.dk 06/10). Absente tant que le SQL du 06/10 n'est pas collé. */
  currency?: string | null;
}

/**
 * MOUVEMENTS DE PRIX d'un véhicule : premier prix, prix courant (ou dernier
 * avant disparition), baisses et hausses comptées, écart total. Repli sur
 * price_prev quand l'historique n'est pas encore en base.
 */
export interface PriceMoves { first: number | null; last: number | null; steps: Array<{ at: string; price: number }>; drops: number; raises: number; delta: number | null; pct: number | null }
export function priceMoves(v: StockVehicle): PriceMoves {
  let steps = Array.isArray(v.price_history) ? v.price_history.filter((s) => s && typeof s.price === 'number' && s.price > 0) : [];
  if (steps.length === 0) {
    if (v.price_prev != null && v.price_prev > 0) steps.push({ at: v.first_seen_at, price: v.price_prev });
    if (v.price != null && v.price > 0) steps.push({ at: v.last_seen_at, price: v.price });
  }
  steps = steps.sort((a, b) => a.at.localeCompare(b.at));
  let drops = 0, raises = 0;
  for (let i = 1; i < steps.length; i++) { if (steps[i].price < steps[i - 1].price) drops++; else if (steps[i].price > steps[i - 1].price) raises++; }
  const first = v.price_first ?? steps[0]?.price ?? null;
  const last = steps.length ? steps[steps.length - 1].price : (v.price ?? null);
  const delta = first != null && last != null ? last - first : null;
  return { first, last, steps, drops, raises, delta, pct: delta != null && first ? Math.round((delta / first) * 1000) / 10 : null };
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

/**
 * Dernier relevé RÉUSSI par contact (01/10, constat Channing : « les stocks
 * affichés ne correspondent pas aux stocks réels »). Sur la carte, un
 * stock relevé par ADA se distingue d'un stock saisi à la main le 07/09 :
 * seul le premier est une mesure, et il porte sa date.
 */
export interface LatestStockRun { at: string; total: number | null; provider: string | null }
export async function listLatestStockRuns(): Promise<Map<string, LatestStockRun>> {
  const map = new Map<string, LatestStockRun>();
  const { data, error } = await untyped.from('network_stock_runs').select('contact_id, started_at, total, provider').eq('status', 'done').order('started_at', { ascending: false }).limit(2000);
  if (error) return map; // table absente : rien de relevé, l'affichage reste « déclaré »
  for (const r of (data ?? []) as Array<{ contact_id: string; started_at: string; total: number | null; provider: string | null }>) {
    if (!map.has(r.contact_id)) map.set(r.contact_id, { at: r.started_at, total: r.total, provider: r.provider });
  }
  return map;
}

export async function listStockVehicles(contactId: string): Promise<{ vehicles: StockVehicle[]; error: string | null }> {
  // Par pages de 1 000 : PostgREST plafonne chaque requête (Louwman 3 917
  // véhicules affichés « En stock · 1000 », constat Channing 02/10).
  const vehicles: StockVehicle[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await untyped.from('network_stock_vehicles').select('*').eq('contact_id', contactId).order('last_seen_at', { ascending: false }).order('external_id').range(from, from + 999);
    if (error) return { vehicles: [], error: missing(error.message) ? 'SQL du 30/09 (network_stock_*) à coller.' : error.message };
    const batch = (data ?? []) as StockVehicle[];
    vehicles.push(...batch);
    if (batch.length < 1000 || vehicles.length >= 100_000) break;
  }
  return { vehicles, error: null };
}

/**
 * SUIVI EN ARRIÈRE-PLAN (01/10, demande Channing : « si je vais faire autre
 * chose je ne vois plus la recherche se faire ; indicateur + maintenir le
 * relevé même si on ferme la page »). Le relevé lui-même tourne sur le
 * worker ; ici on garde son SUIVI hors de la fenêtre : fermer la modale ou
 * changer de page n'arrête rien, la carte montre « relevé en cours » et la
 * fenêtre, rouverte, retrouve l'état. Après un rechargement complet du
 * navigateur, c'est la table network_stock_runs (status running, < 20 min)
 * qui dit qu'un relevé tourne encore (listLatestStockRuns → running).
 */
interface ActiveScan { contactId: string; name: string; startedAt: number }
const activeScans = new Map<string, ActiveScan>();
const scanOutcomes = new Map<string, { summary?: StockSummary; error?: string; at: number }>();
const scanListeners = new Set<() => void>();
const notifyScans = () => { for (const l of scanListeners) l(); };
export function subscribeDealerScans(cb: () => void): () => void { scanListeners.add(cb); return () => { scanListeners.delete(cb); }; }
export function isDealerScanning(contactId: string): boolean { return activeScans.has(contactId); }
export function activeDealerScans(): ActiveScan[] { return [...activeScans.values()]; }
/** Dernier bilan (ou erreur) d'un relevé lancé depuis cette page, consommé une fois. */
export function takeDealerScanOutcome(contactId: string): { summary?: StockSummary; error?: string } | null {
  const o = scanOutcomes.get(contactId); if (o) scanOutcomes.delete(contactId); return o ?? null;
}
export function startDealerScan(contactId: string, name: string, url: string, submittedBy: string): void {
  if (activeScans.has(contactId)) return;
  activeScans.set(contactId, { contactId, name, startedAt: Date.now() });
  notifyScans();
  void scanDealerStock(contactId, url, submittedBy)
    .then((summary) => scanOutcomes.set(contactId, { summary, at: Date.now() }))
    .catch((e) => scanOutcomes.set(contactId, { error: e instanceof Error ? e.message : String(e), at: Date.now() }))
    .finally(() => { activeScans.delete(contactId); notifyScans(); });
}

/** Relevés encore en statut running côté base (lancés < 20 min) : visibles même après un rechargement du navigateur. */
export async function listRunningStockRuns(): Promise<Map<string, { at: string }>> {
  const map = new Map<string, { at: string }>();
  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  const { data, error } = await untyped.from('network_stock_runs').select('contact_id, started_at').eq('status', 'running').gte('started_at', since).order('started_at', { ascending: false }).limit(200);
  if (error) return map;
  for (const r of (data ?? []) as Array<{ contact_id: string; started_at: string }>) if (!map.has(r.contact_id)) map.set(r.contact_id, { at: r.started_at });
  return map;
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
