/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CAMPAIGN PLANNER — PURE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Builds the study list for a mass-ingestion campaign from what ADA already
 * knows. Core idea: "on sait ce qu'on sait" (validated mappings per site) —
 * project those criteria onto the sites where they are NOT yet validated, so
 * each run converts unknowns into either new mappings or a precise manual
 * to-do list.
 *
 * Invariants:
 *  - Fuel/trim variants are ONLY drawn from the same BRAND|MODEL key they were
 *    observed on (a Toyota 'GR Sport' never lands on a VW Golf).
 *  - Exploration (site×brand×model not in memory) is prioritised; a share of
 *    reinforcement re-tests known combos to strengthen confidence.
 *  - Pure: RNG injected, no I/O — the caller loads knowledge and persists.
 */

export interface CampaignKnowledge {
  brands: string[];
  modelsByBrand: Record<string, string[]>;
  /** Declared-label fuels per `BRAND|MODEL` (e.g. 'ELECTRIQUE'), as stored in memory. */
  fuelsByBrandModel: Record<string, string[]>;
  /** Trims per `BRAND|MODEL` — brand-linked by construction. */
  trimsByBrandModel: Record<string, string[]>;
  /** Validated `BRAND|MODEL` combos per site key. */
  coveredBySite: Record<string, Set<string>>;
}

export interface CampaignPlanItem {
  site: string;
  brand: string;
  model: string;
  fuel?: string;
  trim?: string;
  /** Single-year pin (yearFrom = yearTo = year) for year-resolved market data. */
  year?: number;
  kind: 'exploration' | 'reinforcement';
  /** Why this item exists — shown in the live feed. */
  reason: string;
}

export interface CampaignPlanOptions {
  /** Target site keys (adapter keys). */
  sites: string[];
  /** Total study count (the "x200", adjustable). */
  total: number;
  /** 0..1 share of items re-testing already-validated combos. Default 0.15. */
  reinforceShare?: number;
  /** 0..1 share of items carrying a fuel or trim variant (when known). Default 0.4. */
  variantShare?: number;
  rng?: () => number;
}

/** Never pin older than this — pre-2020 stock is not the arbitrage target. */
export const YEAR_PIN_MIN = 2020;

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function planCampaign(k: CampaignKnowledge, opts: CampaignPlanOptions): CampaignPlanItem[] {
  const rng = opts.rng ?? Math.random;
  const total = Math.max(1, Math.floor(opts.total));
  const reinforceShare = opts.reinforceShare ?? 0.15;
  const variantShare = opts.variantShare ?? 0.4;
  const yearMax = new Date().getFullYear();

  // All known brand|model combos (from any site's validated memory).
  const combos: Array<{ brand: string; model: string }> = [];
  for (const brand of k.brands) {
    for (const model of k.modelsByBrand[brand] ?? []) combos.push({ brand, model });
  }
  if (combos.length === 0 || opts.sites.length === 0) return [];

  // Split site×combo space into exploration (not validated there) vs reinforcement.
  const exploration: Array<{ site: string; brand: string; model: string }> = [];
  const reinforcement: Array<{ site: string; brand: string; model: string }> = [];
  for (const site of opts.sites) {
    const covered = k.coveredBySite[site] ?? new Set<string>();
    for (const c of combos) {
      (covered.has(`${c.brand}|${c.model}`) ? reinforcement : exploration)
        .push({ site, ...c });
    }
  }

  const explorationTarget = Math.round(total * (1 - reinforceShare));
  const pickedExp = shuffle(exploration, rng).slice(0, explorationTarget);
  const pickedReinf = shuffle(reinforcement, rng).slice(0, total - pickedExp.length);
  // Backfill from exploration if reinforcement pool ran dry (or vice versa).
  if (pickedExp.length + pickedReinf.length < total) {
    const short = total - pickedExp.length - pickedReinf.length;
    const seen = new Set(pickedExp.map((p) => `${p.site}|${p.brand}|${p.model}`));
    const extra = shuffle(exploration, rng)
      .filter((p) => !seen.has(`${p.site}|${p.brand}|${p.model}`))
      .slice(0, short);
    pickedExp.push(...extra);
  }

  const items: CampaignPlanItem[] = [];
  const push = (
    base: { site: string; brand: string; model: string },
    kind: CampaignPlanItem['kind']
  ) => {
    const key = `${base.brand}|${base.model}`;
    const item: CampaignPlanItem = {
      ...base,
      kind,
      reason: kind === 'exploration'
        ? `${base.brand} ${base.model} jamais validé sur ${base.site}`
        : `renforcement ${base.brand} ${base.model} sur ${base.site}`,
    };
    // Variant: attach a fuel or trim KNOWN FOR THIS EXACT brand|model.
    if (rng() < variantShare) {
      const fuels = k.fuelsByBrandModel[key] ?? [];
      const trims = k.trimsByBrandModel[key] ?? [];
      const pool: Array<['fuel' | 'trim', string]> = [
        ...fuels.map((f): ['fuel' | 'trim', string] => ['fuel', f]),
        ...trims.map((t): ['fuel' | 'trim', string] => ['trim', t]),
      ];
      if (pool.length > 0) {
        const [kindV, value] = pool[Math.floor(rng() * pool.length)];
        if (kindV === 'fuel') { item.fuel = value; item.reason += ` (variante ${value})`; }
        else { item.trim = value; item.reason += ` (finition ${value})`; }
      }
    }
    // MANDATORY year pin (2020..now): an unbounded search is too wide — the
    // sample mixes 2008s with 2023s and the market data is unusable by year.
    const year = YEAR_PIN_MIN + Math.floor(rng() * (yearMax - YEAR_PIN_MIN + 1));
    item.year = year;
    item.reason += ` (année ${year})`;
    items.push(item);
  };

  for (const p of pickedExp) push(p, 'exploration');
  for (const p of pickedReinf) push(p, 'reinforcement');

  return shuffle(items, rng);
}
