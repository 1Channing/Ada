/**
 * VITRINES DE NOS CLIENTS FACE À UN MODÈLE DE L'OFFRE (13/11, Channing : « dans Offres → Analyse, sous les relevés
 * marché, une analyse par rapport aux vitrines de nos clients : on choisit un pays, puis un des modèles sélectionnés,
 * et ça propose les clients de ce pays qui en ont — combien, à quels prix, jours de stock ; combien ils en ont vendu,
 * stock moyen, évolution du prix jusqu'à la vente (dernier prix avant disparition). Équivalent = marque, modèle,
 * carburant, année exacte, km ± 15 000, finition si possible (les noms diffèrent d'un pays à l'autre). Proposer aussi
 * les clients qui n'en ont plus en stock parce qu'ils ont tout vendu. »).
 *
 * Deux parties : le CHARGEMENT ciblé (les relevés de vitrine des contacts d'un pays, pour UNE marque — jamais tout le
 * stock de tous les contacts) et l'ANALYSE, pure et testable (`analyzeClients`).
 */
import { supabase } from '../lib/supabase';
import { brandKey, refModelKey } from './marketData';
import { fuelFamily, trimOf, normalizeModel, KM_TOLERANCE, type FuelFamily, type KnownModels } from './stockCompare';
import { powerFromText, samePower } from '../lib/powerText';
import { toEur } from './fxRates';
import type { StockVehicle } from './dealerStock';
import type { NetworkContact } from './network';
import type { OfferVehicle } from '../lib/offers/parseSupplierFile';

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Un véhicule de l'offre, prêt à être comparé. */
export interface LotVehicle { id: string; year: number | null; km: number | null; fuel: FuelFamily | null; trim: string | null; power: number | null; priceHt: number | null }

export const yearOfDate = (iso: string | null | undefined): number | null => { if (!iso) return null; const y = Number(iso.slice(0, 4)); return Number.isFinite(y) && y > 1900 ? y : null; };

export function lotVehiclesOf(vehicles: OfferVehicle[], priceHtOf: (v: OfferVehicle) => number | null): LotVehicle[] {
  return vehicles.map((v) => ({
    id: v.id, year: v.year ?? yearOfDate(v.reg_date), km: v.km,
    fuel: fuelFamily(v.fuel) ?? fuelFamily(v.version), trim: trimOf(v.version), power: v.power_ch ?? powerFromText(v.version), priceHt: priceHtOf(v),
  }));
}

/** Une voiture du client équivalente à l'un des véhicules du lot. */
export interface ClientMatch {
  theirs: StockVehicle;
  priceEur: number | null;
  /** Dernier prix avant disparition (vendu) ou prix courant, en euros. */
  lastEur: number | null;
  firstEur: number | null;
  /** Jours en stock : jusqu'à aujourd'hui (en stock) ou jusqu'à la disparition (vendu). */
  days: number | null;
  fuel: FuelFamily | null; trim: string | null; power: number | null;
  /** Finition comparée : identique, différente (les noms changent d'un pays à l'autre, on garde l'équivalent) ou inconnue. */
  trimState: 'same' | 'different' | 'unknown';
  ourId: string;
}

export interface ClientRow {
  contact: NetworkContact;
  inStock: ClientMatch[];
  sold: ClientMatch[];
  /** Même modèle (marque + modèle), sans condition d'année ni de km : pour dire « il en a 12 au total ». */
  sameModelInStock: number;
  sameModelSold: number;
  priceMin: number | null; priceMedian: number | null;
  daysMedian: number | null;
  soldDaysMedian: number | null;
  soldLastMedian: number | null;
  /** Baisse médiane entre premier prix vu et dernier prix avant disparition (%, négatif = baisse). */
  soldDropPct: number | null;
  /** Stock moyen d'équivalents aux dates des relevés (90 derniers jours). */
  avgStock: number | null;
  lastRunAt: string | null;
  /** Tout vendu : des ventes, plus rien en stock. */
  soldOut: boolean;
}

const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const daysBetween = (from: string | null | undefined, to: string | null | undefined): number | null => {
  if (!from) return null;
  const a = new Date(from).getTime(); const b = to ? new Date(to).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
};

/** Équivalence voiture du client ↔ véhicule du lot : marque, modèle normalisé, année exacte, km ± 15 000, énergie
 *  quand connue des deux côtés, puissance à 10 % quand connue ; la finition est comparée mais ne bloque pas. */
export function matchOne(t: StockVehicle, tf: { fuel: FuelFamily | null; trim: string | null; power: number | null }, o: LotVehicle): ClientMatch['trimState'] | null {
  if (t.year == null || o.year == null || t.year !== o.year) return null;
  if (t.km == null || o.km == null || Math.abs(t.km - o.km) > KM_TOLERANCE) return null;
  if (tf.fuel && o.fuel && tf.fuel !== o.fuel) return null;
  if (samePower(tf.power, o.power) === false) return null;
  if (!tf.trim || !o.trim) return 'unknown';
  return tf.trim === o.trim ? 'same' : 'different';
}

export function analyzeClients(
  contacts: NetworkContact[], vehicles: StockVehicle[], runs: Array<{ contact_id: string; started_at: string }>,
  lot: { brand: string; model: string }, ours: LotVehicle[], known: KnownModels | null,
): ClientRow[] {
  const bKey = brandKey(lot.brand);
  const mKey = refModelKey(lot.brand, normalizeModel(lot.brand, lot.model, known));
  const byContact = new Map<string, StockVehicle[]>();
  for (const v of vehicles) (byContact.get(v.contact_id) ?? byContact.set(v.contact_id, []).get(v.contact_id)!).push(v);
  const runsBy = new Map<string, string[]>();
  for (const r of runs) (runsBy.get(r.contact_id) ?? runsBy.set(r.contact_id, []).get(r.contact_id)!).push(r.started_at);
  const rows: ClientRow[] = [];
  for (const c of contacts) {
    const list = byContact.get(c.id) ?? [];
    const same = list.filter((v) => v.brand && v.model && brandKey(v.brand) === bKey && refModelKey(v.brand, normalizeModel(v.brand, v.model, known)) === mKey);
    if (!same.length) continue;
    const inStock: ClientMatch[] = []; const sold: ClientMatch[] = [];
    for (const t of same) {
      const tf = { fuel: fuelFamily(t.fuel) ?? fuelFamily(t.title), trim: trimOf(t.title), power: t.power_ch ?? powerFromText(t.title) };
      let best: { state: ClientMatch['trimState']; ourId: string } | null = null;
      for (const o of ours) {
        const st = matchOne(t, tf, o);
        if (!st) continue;
        if (!best || (st === 'same' && best.state !== 'same')) best = { state: st, ourId: o.id };
      }
      if (!best) continue;
      const cur = t.currency ?? 'EUR';
      const hist = Array.isArray(t.price_history) ? t.price_history.filter((s) => s && s.price > 0).sort((a, b) => a.at.localeCompare(b.at)) : [];
      const first = hist[0]?.price ?? t.price_first ?? t.price_prev ?? t.price;
      const last = hist.length ? hist[hist.length - 1].price : t.price;
      const m: ClientMatch = {
        theirs: t, priceEur: t.price != null && t.price > 0 ? toEur(t.price, cur) : null,
        lastEur: last != null && last > 0 ? toEur(last, cur) : null, firstEur: first != null && first > 0 ? toEur(first, cur) : null,
        days: daysBetween(t.listed_at ?? t.first_seen_at, t.gone_at), fuel: tf.fuel, trim: tf.trim, power: tf.power, trimState: best.state, ourId: best.ourId,
      };
      (t.gone_at ? sold : inStock).push(m);
    }
    if (!inStock.length && !sold.length) continue;
    const prices = inStock.map((m) => m.priceEur).filter((x): x is number => x != null);
    const since = Date.now() - 90 * 86_400_000;
    const dates = (runsBy.get(c.id) ?? []).filter((d) => new Date(d).getTime() >= since);
    const all = [...inStock, ...sold];
    const avgStock = dates.length
      ? Math.round((dates.reduce((acc, d) => { const tm = new Date(d).getTime(); return acc + all.filter((m) => new Date(m.theirs.first_seen_at).getTime() <= tm && (!m.theirs.gone_at || new Date(m.theirs.gone_at).getTime() > tm)).length; }, 0) / dates.length) * 10) / 10
      : null;
    const drops = sold.map((m) => (m.firstEur && m.lastEur ? Math.round(((m.lastEur - m.firstEur) / m.firstEur) * 1000) / 10 : null)).filter((x): x is number => x != null);
    const sortedRuns = (runsBy.get(c.id) ?? []).sort();
    const lastRun = sortedRuns.length ? sortedRuns[sortedRuns.length - 1] : null;
    rows.push({
      contact: c, inStock: inStock.sort((a, b) => (a.priceEur ?? 1e12) - (b.priceEur ?? 1e12)), sold: sold.sort((a, b) => (b.theirs.gone_at ?? '').localeCompare(a.theirs.gone_at ?? '')),
      sameModelInStock: same.filter((v) => !v.gone_at).length, sameModelSold: same.filter((v) => !!v.gone_at).length,
      priceMin: prices.length ? Math.min(...prices) : null, priceMedian: median(prices),
      daysMedian: median(inStock.map((m) => m.days).filter((x): x is number => x != null)),
      soldDaysMedian: median(sold.map((m) => m.days).filter((x): x is number => x != null)),
      soldLastMedian: median(sold.map((m) => m.lastEur).filter((x): x is number => x != null)),
      soldDropPct: drops.length ? Math.round((drops.reduce((a, b) => a + b, 0) / drops.length) * 10) / 10 : null,
      avgStock, lastRunAt: lastRun, soldOut: inStock.length === 0 && sold.length > 0,
    });
  }
  // Les clients qui en ont d'abord (par nombre d'équivalents en stock), puis ceux qui ont tout vendu (par ventes).
  return rows.sort((a, b) => b.inStock.length - a.inStock.length || b.sold.length - a.sold.length || a.contact.name.localeCompare(b.contact.name));
}

/** Les véhicules relevés (en stock et disparus) des contacts donnés, pour une marque : filtre serveur sur la marque
 *  ou le titre, par pages de 1 000. */
export async function loadCountryBrandVehicles(contactIds: string[], brand: string): Promise<{ vehicles: StockVehicle[]; runs: Array<{ contact_id: string; started_at: string }>; error: string | null }> {
  if (!contactIds.length) return { vehicles: [], runs: [], error: null };
  const word = brand.trim().split(/\s+/)[0].replace(/[%,()]/g, '');
  const vehicles: StockVehicle[] = [];
  for (let i = 0; i < contactIds.length; i += 60) {
    const ids = contactIds.slice(i, i + 60);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await untyped.from('network_stock_vehicles').select('*').in('contact_id', ids)
        .or(`brand.ilike.%${word}%,title.ilike.%${word}%`).order('last_seen_at', { ascending: false }).range(from, from + 999);
      if (error) return { vehicles: [], runs: [], error: /does not exist|schema cache|relation/i.test(error.message) ? 'SQL du 30/09 (network_stock_*) à coller.' : error.message };
      const batch = (data ?? []) as StockVehicle[];
      vehicles.push(...batch);
      if (batch.length < 1000 || vehicles.length >= 50_000) break;
    }
  }
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const runs: Array<{ contact_id: string; started_at: string }> = [];
  for (let i = 0; i < contactIds.length; i += 60) {
    const { data } = await untyped.from('network_stock_runs').select('contact_id, started_at').in('contact_id', contactIds.slice(i, i + 60)).eq('status', 'done').gte('started_at', since).limit(5000);
    runs.push(...((data ?? []) as Array<{ contact_id: string; started_at: string }>));
  }
  return { vehicles, runs, error: null };
}
