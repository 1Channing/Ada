/**
 * BEST-SELLERS D'UNE VITRINE (16/11, Channing : « trier de manière à trouver leurs best-sellers, les modèles qu'ils ne
 * refuseront pas, ce sont ceux qu'ils vendent le mieux » — plan validé le même jour).
 *
 * Trois tris, calibrés pour valoir sur toutes les plateformes :
 *  1. BEST-SELLERS : ventes par mois = disparus × 30 ÷ jours d'observation de la vitrine (une vitrine suivie six
 *     semaines a forcément plus de disparus qu'une suivie deux semaines). Badge sur le top 10 % des modèles (≥ 3).
 *  2. À RÉASSORTIR (faible stock, forte demande) : couverture = en stock ÷ ventes par mois, en mois. Retenu quand les
 *     ventes par mois atteignent la médiane des modèles vendus (et ≥ 1) et que la couverture est ≤ 1,5 mois ;
 *     les ruptures (0 en stock, ≥ 3 ventes) en tête.
 *  3. VITE VENDU, PRIX TENU : sur la COHORTE ENTRANTE (entrées après le premier relevé, ou datées par le site — les
 *     voitures déjà là au premier relevé ont un âge inconnu), jours en stock médians ≤ 30 et ≤ médiane de la vitrine,
 *     et moins de 25 % des ventes avec une baisse de prix avant disparition.
 * Garde-fous : 3 disparus minimum par modèle ; vitrine « en calibrage » (pas de badge) sous 14 jours d'observation ou
 * 3 relevés. Disparu ≠ vendu (retrait, transfert) : assumé et écrit dans l'aide.
 */
import { priceMoves, type StockVehicle } from './dealerStock';

export type RankMode = 'volume' | 'bestseller' | 'restock' | 'fast';
export const RANK_LABEL: Record<RankMode, string> = { volume: 'Volume', bestseller: 'Best-sellers', restock: 'À réassortir', fast: 'Vite vendu, prix tenu' };
export const RANK_HELP: Record<RankMode, string> = {
  volume: 'Modèles classés par nombre de voitures vues (en stock + disparues).',
  bestseller: 'Ventes par mois = disparus × 30 ÷ jours d’observation de la vitrine. Badge sur le top 10 % des modèles (au moins 3), 3 disparus minimum. Disparu = vendu ou retiré.',
  restock: 'Couverture = en stock ÷ ventes par mois, en mois de stock. Badge quand le modèle se vend au moins autant que la médiane des modèles vendus (et ≥ 1 par mois) avec 1,5 mois de couverture ou moins ; ruptures (0 en stock, ≥ 3 ventes) en tête.',
  fast: 'Sur les voitures entrées après le premier relevé (ou datées par le site) : jours en stock médians ≤ 30 et ≤ médiane de la vitrine, et moins de 25 % des ventes avec une baisse de prix. 3 ventes minimum.',
};

export const MIN_SALES = 3;
export const COVER_MAX_MONTHS = 1.5;
export const FAST_MAX_DAYS = 30;
export const DROP_SHARE_MAX = 0.25;
export const MIN_WINDOW_DAYS = 14;
export const MIN_READINGS = 3;
export const TOP_SHARE = 0.1;

export interface ShowcaseWindow {
  /** Jours d'observation : du premier relevé (première vue de la plus ancienne voiture) au dernier relevé. */
  days: number;
  readings: number;
  firstAt: string | null;
  lastAt: string | null;
  calibrated: boolean;
  /** Pourquoi pas calibrée (vide si calibrée). */
  reason: string;
}

const DAY = 86_400_000;
const dayDiff = (a: string, b: string): number => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY));

export function observationWindow(vehicles: StockVehicle[], runs: Array<{ status: string; started_at: string }>): ShowcaseWindow {
  const firsts = vehicles.map((v) => v.first_seen_at).filter(Boolean).sort();
  const done = runs.filter((r) => r.status === 'done').map((r) => r.started_at).sort();
  const firstAt = firsts[0] ?? done[0] ?? null;
  const lasts = vehicles.map((v) => v.last_seen_at).filter(Boolean).sort();
  const lastAt = [done[done.length - 1], lasts[lasts.length - 1]].filter(Boolean).sort().pop() ?? null;
  const days = firstAt && lastAt ? Math.max(1, dayDiff(firstAt, lastAt)) : 0;
  const readings = done.length;
  const reasons: string[] = [];
  if (days < MIN_WINDOW_DAYS) reasons.push(`${MIN_WINDOW_DAYS - days} jour${MIN_WINDOW_DAYS - days > 1 ? 's' : ''} d'observation manquant${MIN_WINDOW_DAYS - days > 1 ? 's' : ''}`);
  if (readings < MIN_READINGS) reasons.push(`${MIN_READINGS - readings} relevé${MIN_READINGS - readings > 1 ? 's' : ''} manquant${MIN_READINGS - readings > 1 ? 's' : ''}`);
  return { days, readings, firstAt, lastAt, calibrated: reasons.length === 0, reason: reasons.join(', ') };
}

export interface ModelRow {
  key: string; label: string;
  inStock: number; gone: number;
  medIn: number | null; medGone: number | null;
  /** Jours en stock médians (toutes les disparues, comme avant) et sur la cohorte entrante. */
  medDays: number | null; cohortDays: number | null; cohortSales: number;
  salesPerMonth: number | null;
  /** Mois de stock au rythme des ventes ; null sans vente ; 0 = rupture. */
  coverMonths: number | null;
  /** Part des ventes précédées d'une baisse de prix (0–1), null sans vente au prix connu. */
  dropShare: number | null;
  rotation: number | null;
  badge: boolean;
}

const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

/** Lignes par modèle (marque + modèle), avec les mesures des trois tris ; `badge` posé selon le mode. */
export function rankModels(
  inStock: StockVehicle[], gone: StockVehicle[], win: ShowcaseWindow, mode: RankMode,
  eurOf: (v: StockVehicle) => number | null, daysOf: (v: StockVehicle) => number | null,
): ModelRow[] {
  type Acc = { key: string; label: string; inStock: number; gone: number; inPrices: number[]; gonePrices: number[]; days: number[]; cohort: number[]; withHistory: number; dropped: number };
  const map = new Map<string, Acc>();
  const accOf = (v: StockVehicle): Acc => {
    const b = (v.brand ?? '').toUpperCase().trim(), m = (v.model ?? '').toUpperCase().trim();
    const key = `${b}|${m}`;
    return map.get(key) ?? map.set(key, { key, label: `${b} ${m}`.trim() || '—', inStock: 0, gone: 0, inPrices: [], gonePrices: [], days: [], cohort: [], withHistory: 0, dropped: 0 }).get(key)!;
  };
  const cohortStart = win.firstAt ? new Date(win.firstAt).getTime() + DAY : null;
  for (const v of inStock) { const a = accOf(v); a.inStock++; const p = eurOf(v); if (p != null) a.inPrices.push(p); }
  for (const v of gone) {
    const a = accOf(v); a.gone++;
    const p = eurOf(v); if (p != null) a.gonePrices.push(p);
    const d = daysOf(v); if (d != null) a.days.push(d);
    const entered = Boolean(v.listed_at) || (cohortStart != null && new Date(v.first_seen_at).getTime() >= cohortStart);
    if (entered && d != null) a.cohort.push(d);
    // Part des ventes avec baisse : sur TOUTES les disparues au prix connu (une voiture au prix jamais changé compte
    // comme « prix tenu » — ne compter que celles dont le prix a bougé donnait 100 % partout).
    const pm = priceMoves(v);
    if (pm.first != null || pm.last != null) { a.withHistory++; if (pm.drops > 0) a.dropped++; }
  }
  const month = win.days > 0 ? 30 / win.days : null;
  const rows: ModelRow[] = [...map.values()].map((a) => {
    const spm = month != null && a.gone > 0 ? Math.round(a.gone * month * 10) / 10 : a.gone === 0 ? 0 : null;
    return {
      key: a.key, label: a.label, inStock: a.inStock, gone: a.gone,
      medIn: median(a.inPrices), medGone: median(a.gonePrices), medDays: median(a.days), cohortDays: median(a.cohort), cohortSales: a.cohort.length,
      salesPerMonth: spm,
      coverMonths: spm != null && spm > 0 ? Math.round((a.inStock / spm) * 10) / 10 : null,
      dropShare: a.withHistory > 0 ? a.dropped / a.withHistory : null,
      rotation: a.inStock + a.gone > 0 ? a.gone / (a.inStock + a.gone) : null,
      badge: false,
    };
  });
  const total = (r: ModelRow) => r.inStock + r.gone;
  if (mode === 'volume' || !win.calibrated) {
    const sorted = rows.sort((x, y) => total(y) - total(x) || x.label.localeCompare(y.label));
    if (mode === 'volume') return sorted;
  }
  if (mode === 'bestseller') {
    const sorted = rows.sort((x, y) => (y.salesPerMonth ?? 0) - (x.salesPerMonth ?? 0) || (y.rotation ?? 0) - (x.rotation ?? 0) || total(y) - total(x));
    if (!win.calibrated) return sorted;
    const eligible = sorted.filter((r) => r.gone >= MIN_SALES);
    const top = Math.max(3, Math.ceil(eligible.length * TOP_SHARE));
    eligible.slice(0, top).forEach((r) => { r.badge = true; });
    return sorted;
  }
  if (mode === 'restock') {
    const sold = rows.filter((r) => (r.salesPerMonth ?? 0) > 0).map((r) => r.salesPerMonth as number);
    const floor = Math.max(1, median(sold) ?? 1);
    const score = (r: ModelRow) => (r.gone >= MIN_SALES && (r.salesPerMonth ?? 0) >= floor ? (r.coverMonths ?? 0) : Number.POSITIVE_INFINITY);
    const sorted = rows.sort((x, y) => score(x) - score(y) || (y.salesPerMonth ?? 0) - (x.salesPerMonth ?? 0) || total(y) - total(x));
    if (!win.calibrated) return sorted;
    sorted.forEach((r) => { r.badge = r.gone >= MIN_SALES && (r.salesPerMonth ?? 0) >= floor && (r.coverMonths ?? 0) <= COVER_MAX_MONTHS; });
    return sorted;
  }
  // fast : vite vendu, prix tenu.
  const showcaseDays = median(rows.filter((r) => r.cohortSales >= MIN_SALES && r.cohortDays != null).map((r) => r.cohortDays as number));
  const ok = (r: ModelRow) => r.cohortSales >= MIN_SALES && r.cohortDays != null && r.cohortDays <= FAST_MAX_DAYS && (showcaseDays == null || r.cohortDays <= showcaseDays) && (r.dropShare ?? 0) <= DROP_SHARE_MAX;
  const sorted = rows.sort((x, y) => {
    const ax = x.cohortSales >= MIN_SALES && x.cohortDays != null ? x.cohortDays : Number.POSITIVE_INFINITY;
    const ay = y.cohortSales >= MIN_SALES && y.cohortDays != null ? y.cohortDays : Number.POSITIVE_INFINITY;
    return ax - ay || (x.dropShare ?? 0) - (y.dropShare ?? 0) || total(y) - total(x);
  });
  if (!win.calibrated) return sorted;
  sorted.forEach((r) => { r.badge = ok(r); });
  return sorted;
}
