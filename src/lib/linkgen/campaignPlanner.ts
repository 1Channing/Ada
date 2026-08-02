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
 *  - Fenêtres de commercialisation (référentiel) : une année hors fenêtre
 *    n'engendre JAMAIS d'étude ; un modèle inconnu du référentiel n'est
 *    JAMAIS filtré (fail-open — le référentiel est fiable à ~98 %, pas 100).
 */

import { refComboKey, refModelKey } from '../../services/vehicleRef';
import { brandKey, canonKey } from '../../services/marketData';
import { comboMotoVerdict, motoFuelTotal, type MotoMap } from '../../services/vehicleMotorisations';

export interface CampaignKnowledge {
  brands: string[];
  modelsByBrand: Record<string, string[]>;
  /** Declared-label fuels per `BRAND|MODEL` (e.g. 'ELECTRIQUE'), as stored in memory. */
  fuelsByBrandModel: Record<string, string[]>;
  /** Trims per `BRAND|MODEL` — brand-linked by construction. */
  trimsByBrandModel: Record<string, string[]>;
  /** Validated `BRAND|MODEL` combos per site key. */
  coveredBySite: Record<string, Set<string>>;
  /**
   * Fenêtres de commercialisation (référentiel constructeur, source of truth
   * ~98 %), clé `refComboKey(brand, model)`. Absence de clé = FAIL-OPEN :
   * aucune année n'est filtrée pour ce modèle.
   */
  refWindows?: Record<string, { from: number; to: number | null }>;
  /**
   * Modèles du référentiel JAMAIS étudiés (aucune mémoire) dont la fenêtre
   * touche la période d'arbitrage — candidats d'expansion automatique des
   * campagnes, injectés en exploration avec une part plafonnée.
   */
  refCombos?: Array<{ brand: string; model: string }>;
  /**
   * Référentiel MOTORISATIONS (EEA, immatriculations UE) — clé
   * `brandKey|refModelKey` → lignes carburant. Absence = fail-open.
   * Phase 1 : sert uniquement à DÉPRIORISER les combos improbables.
   */
  motorisations?: MotoMap;
  /**
   * BAN « marché prouvé vide » (règle Channing 28/07) : clés emptyComboKey
   * des modèle×carburant vidés par ≥ 3 SITES DISTINCTS (vide CONFIRMÉ par
   * les sites eux-mêmes) sans jamais aucun échantillon nulle part. Jamais
   * replanifiés — la file de campagne ne se pollue plus. Recalculé à chaque
   * campagne depuis l'historique : une seule annonce trouvée un jour lève
   * le ban toute seule.
   */
  provenEmptyCombos?: Set<string>;
  /**
   * PREUVE TERRAIN (28/07) : combos modèle×carburant VUS vivants au moins une
   * fois — carburant validé en mémoire par une ingestion, ou le moindre
   * échantillon en historique de campagne. Clé emptyComboKey. La réalité
   * prime sur la donnée : un combo prouvé n'est JAMAIS exclu par le verdict
   * EEA, même à « 0 immatriculation ».
   */
  observedFuelCombos?: Set<string>;
}

/** Clé canonique du ban marché vide — graphies unifiées via refComboKey. */
export const emptyComboKey = (brand: string, model: string, fuel: string): string =>
  `${refComboKey(brand, model)}|${fuel.trim().toUpperCase()}`;

/** Part maximale de l'exploration allouée aux modèles « expansion référentiel »
 *  — les combos issus de notre mémoire restent prioritaires (on maintient ce
 *  qui fonctionne), l'expansion remplit le reste. */
export const REF_EXPANSION_SHARE = 0.3;

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

/**
 * Optional targeting — "tout doit être modulable" : narrow a campaign to
 * specific brands, models, fuels or a year window, in any combination, on any
 * site subset. Examples: hybrids only across every site; one brand across all
 * countries; one model on one site for 2022-2024.
 */
export interface CampaignFilters {
  /** Restrict to these brands (uppercase-insensitive). Empty/absent = all. */
  brands?: string[];
  /** Restrict to these models (uppercase-insensitive). Empty/absent = all. */
  models?: string[];
  /** Force these declared fuel labels (e.g. 'HYBRIDE') — every item carries one. */
  fuels?: string[];
  /** Year-pin window override (clamped to [YEAR_PIN_MIN, current year]). */
  yearMin?: number;
  yearMax?: number;
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
  filters?: CampaignFilters;
  /**
   * MODE DÉCOUVERTE TAXONOMIE (Channing 29/07) : campagne 100 % sans modèle —
   * toutes les marques connues (mémoire ∪ référentiel) × tous les sites
   * demandés, une étude par couple. Chaque page marque livre sa gamme
   * entière via harvestTaxonomy (facettes MP, taxonomy AS24, enums LBC,
   * slugs Bilbasen/mobile.de) ; ensuite les recherches précises profitent
   * du mapping appris. Modèle vide = jamais d'écriture mémoire.
   */
  discoveryOnly?: boolean;
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
  const nowYear = new Date().getFullYear();

  // Targeting filters — comparaison CANONIQUE, pas littérale : cocher
  // « VOLKSWAGEN » doit matcher des combos étiquetés « VW », « GLC » doit
  // matcher « CLASSE GLC » (mêmes clés que le savoir et le référentiel).
  const f = opts.filters ?? {};
  const U = (s: string) => s.trim().toUpperCase();
  const brandSet = new Set((f.brands ?? []).map((b) => brandKey(b)).filter(Boolean));
  const modelSet = new Set(
    (f.models ?? []).flatMap((m) => [canonKey(m), refModelKey('MERCEDES', m)]).filter(Boolean),
  );
  const brandMatches = (b: string) => brandSet.size === 0 || brandSet.has(brandKey(b));
  const modelMatches = (b: string, m: string) =>
    modelSet.size === 0 || modelSet.has(canonKey(m)) || modelSet.has(refModelKey(b, m));

  // ── MODE DÉCOUVERTE TAXONOMIE : toutes les marques × tous les sites ×
  // CHAQUE année de la fourchette ciblée, sans modèle — c'est la page marque
  // qui enseigne. L'année démultiplie exprès (décision Channing 02/08) : sur
  // les sites où la taxonomie s'apprend DEPUIS les annonces (Gaspedaal,
  // Subito), une page marque 2026 n'enseigne que les modèles vendus en 2026 —
  // la boucle 2020→2026 couvre les modèles arrêtés entre-temps. Sans
  // fourchette fournie : année en cours seule (comportement historique).
  if (opts.discoveryOnly) {
    const dMin = Math.max(YEAR_PIN_MIN, Math.min(f.yearMin ?? nowYear, nowYear));
    const dMax = Math.max(dMin, Math.min(f.yearMax ?? nowYear, nowYear));
    const byKey = new Map<string, string>(); // clé canonique → libellé élu
    for (const b of k.brands) byKey.set(brandKey(b), b);
    for (const c of k.refCombos ?? []) {
      const bk2 = brandKey(c.brand);
      if (!byKey.has(bk2)) byKey.set(bk2, c.brand);
    }
    const items: CampaignPlanItem[] = [];
    for (const site of opts.sites) {
      for (const [, brand] of byKey) {
        if (!brandMatches(brand)) continue;
        for (let y = dMin; y <= dMax; y++) {
          items.push({
            site, brand, model: '', year: y, kind: 'exploration',
            reason: `découverte taxonomie — gamme ${brand} ${y} (page marque)`,
          });
        }
      }
    }
    return shuffle(items, rng).slice(0, total);
  }
  const forcedFuels = (f.fuels ?? []).map(U).filter(Boolean);
  const pinMin = Math.max(YEAR_PIN_MIN, Math.min(f.yearMin ?? YEAR_PIN_MIN, nowYear));
  const pinMax = Math.max(pinMin, Math.min(f.yearMax ?? nowYear, nowYear));

  // All known brand|model combos (from any site's validated memory),
  // narrowed by the brand/model targeting when provided.
  const combos: Array<{ brand: string; model: string; fromRef?: boolean }> = [];
  for (const brand of k.brands) {
    if (!brandMatches(brand)) continue;
    for (const model of k.modelsByBrand[brand] ?? []) {
      if (!modelMatches(brand, model)) continue;
      combos.push({ brand, model });
    }
  }
  // Expansion référentiel : modèles jamais étudiés, mêmes filtres de ciblage.
  for (const c of k.refCombos ?? []) {
    if (!brandMatches(c.brand)) continue;
    if (!modelMatches(c.brand, c.model)) continue;
    combos.push({ brand: c.brand, model: c.model, fromRef: true });
  }
  if (combos.length === 0 || opts.sites.length === 0) return [];

  // The ATOMIC study space is site × combo × YEAR (× forced fuel): the year
  // pin is mandatory (an unbounded search mixes 2008s with 2023s), so each
  // year IS a distinct study. Planning at site×combo grain with a random year
  // collapsed "Yaris Cross hybride 2020-2026 sur 4 sites" into 4 studies.
  const years: number[] = [];
  for (let y = pinMin; y <= pinMax; y++) years.push(y);
  const fuelChoices: Array<string | null> = forcedFuels.length > 0 ? forcedFuels : [null];

  type Atom = { site: string; brand: string; model: string; year: number; fuel: string | null; fromRef?: boolean; moto?: string; note?: string };
  const exploration: Atom[] = [];
  const explorationRef: Atom[] = [];
  const reinforcement: Atom[] = [];
  // Combos improbables (motorisations EEA) : JAMAIS exclus — mis de côté, ils
  // ne consomment le budget que s'il reste de la place (phase 1 : dépriorisation).
  const unlikelyPool: Array<{ atom: Atom; kind: CampaignPlanItem['kind'] }> = [];
  for (const site of opts.sites) {
    const covered = k.coveredBySite[site] ?? new Set<string>();
    for (const c of combos) {
      // Fenêtre de commercialisation (référentiel) : les années hors fenêtre
      // ne deviennent jamais des études — marge +1 en sortie (immat tardives).
      // Modèle inconnu du référentiel → AUCUN filtrage (fail-open).
      const win = k.refWindows?.[refComboKey(c.brand, c.model)];
      const comboYears = win
        ? years.filter((y) => y >= win.from && (win.to === null || y <= win.to + 1))
        : years;
      if (comboYears.length === 0) continue; // fenêtre entièrement hors période
      const bucket = c.fromRef ? explorationRef
        : covered.has(`${c.brand}|${c.model}`) ? reinforcement : exploration;
      const bucketKind: CampaignPlanItem['kind'] = bucket === reinforcement ? 'reinforcement' : 'exploration';
      for (const year of comboYears) {
        for (const fuel of fuelChoices) {
          const atom: Atom = { site, ...c, year, fuel };
          // Motorisations (EEA) : un combo carburant×année jamais immatriculé
          // est mis de côté avec sa raison chiffrée — jamais supprimé.
          const verdict = k.motorisations && fuel
            ? comboMotoVerdict(k.motorisations, c.brand, c.model, fuel, year)
            : { unlikely: false as const };
          if (verdict.unlikely) {
            // PREUVE TERRAIN d'abord : un combo déjà vu vivant (ingestion,
            // échantillon de campagne) n'est jamais exclu — la réalité prime.
            const proven = fuel != null && k.observedFuelCombos?.has(emptyComboKey(c.brand, c.model, fuel));
            const severity = (verdict as { severity?: string }).severity;
            if (forcedFuels.length > 0 && severity === 'zero' && !proven) {
              // PHASE 2 (28/07) : ciblage carburant FORCÉ × verdict STRICT
              // « 0 immat. UE, modèle bien couvert » × aucune preuve terrain
              // → le combo n'est pas planifié du tout (M5 électrique, RS7
              // électrique… ne consomment plus la file). Fail-open intact :
              // modèle inconnu / mal couvert / bruit → dépriorisation only.
              if (fuel === 'HYBRIDE' && !fuelChoices.includes('PLUG_IN_HYBRID') && k.motorisations) {
                // Le modèle n'existe qu'en RECHARGEABLE (cas M5 2024) : on
                // étudie la variante qui existe au lieu de jeter le modèle —
                // en repassant le verdict sur la variante (un M5 PHEV 2020
                // n'existe pas non plus, seules les années réelles passent).
                const phev = motoFuelTotal(k.motorisations, c.brand, c.model, 'PLUG_IN_HYBRID');
                const phevVerdict = comboMotoVerdict(k.motorisations, c.brand, c.model, 'PLUG_IN_HYBRID', year);
                if (phev != null && phev > 0 && !phevVerdict.unlikely) {
                  bucket.push({
                    ...atom, fuel: 'PLUG_IN_HYBRID',
                    note: `hybride simple inexistant (0 immat. UE) → étudié en RECHARGEABLE (${phev.toLocaleString('fr-FR')} immat.)`,
                  });
                }
              }
              continue;
            }
            atom.moto = verdict.detail;
            unlikelyPool.push({ atom, kind: bucketKind });
          } else {
            bucket.push(atom);
          }
        }
      }
    }
  }

  // Narrow campaign whose FULL space fits the budget → exhaustive enumeration
  // (all 28 studies, deterministic). Sampling only when the space overflows.
  let picked: Array<{ atom: Atom; kind: CampaignPlanItem['kind'] }>;
  if (exploration.length + explorationRef.length + reinforcement.length <= total) {
    picked = [
      ...exploration.map((atom) => ({ atom, kind: 'exploration' as const })),
      ...explorationRef.map((atom) => ({ atom, kind: 'exploration' as const })),
      ...reinforcement.map((atom) => ({ atom, kind: 'reinforcement' as const })),
    ];
    // FIN DU PASSE-DROIT (28/07) : même en énumération exhaustive, les
    // improbables ne comblent que le budget RESTANT — les petites campagnes
    // ciblées ne les embarquent plus d'office (constat M5/RS7 électriques).
    if (picked.length < total && unlikelyPool.length > 0) {
      picked.push(...shuffle(unlikelyPool, rng).slice(0, total - picked.length));
    }
  } else {
    const atomKey = (a: Atom) => `${a.site}|${a.brand}|${a.model}|${a.year}|${a.fuel ?? ''}`;
    const explorationTarget = Math.round(total * (1 - reinforceShare));
    // L'expansion référentiel est PLAFONNÉE : la mémoire d'abord (on maintient
    // ce qui fonctionne), les modèles jamais étudiés remplissent au plus
    // REF_EXPANSION_SHARE de l'exploration — et tout le reliquat si la
    // mémoire ne suffit pas à remplir la campagne.
    const refTarget = Math.min(Math.round(explorationTarget * REF_EXPANSION_SHARE), explorationRef.length);
    const pickedExpMem = shuffle(exploration, rng).slice(0, explorationTarget - refTarget);
    const pickedExpRef = shuffle(explorationRef, rng)
      .slice(0, Math.max(refTarget, explorationTarget - pickedExpMem.length));
    const pickedExp = [...pickedExpMem, ...pickedExpRef].slice(0, explorationTarget);
    const pickedReinf = shuffle(reinforcement, rng).slice(0, total - pickedExp.length);
    // Backfill from exploration pools if reinforcement ran dry.
    if (pickedExp.length + pickedReinf.length < total) {
      const short = total - pickedExp.length - pickedReinf.length;
      const seen = new Set(pickedExp.map(atomKey));
      const extra = shuffle([...exploration, ...explorationRef], rng)
        .filter((a) => !seen.has(atomKey(a)))
        .slice(0, short);
      pickedExp.push(...extra);
    }
    picked = [
      ...pickedExp.map((atom) => ({ atom, kind: 'exploration' as const })),
      ...pickedReinf.map((atom) => ({ atom, kind: 'reinforcement' as const })),
    ];
    // Dernier recours : les improbables ne remplissent que le budget restant.
    if (picked.length < total && unlikelyPool.length > 0) {
      picked.push(...shuffle(unlikelyPool, rng).slice(0, total - picked.length));
    }
  }

  // ── DÉCOUVERTE DE GAMME (28/07) : une part bornée d'études SANS modèle.
  // La page marque livre sa taxonomie ENTIÈRE en un scrape (facettes modèle
  // Marktplaats, enums u_car_model Leboncoin, gamme AS24/mobile.de) via
  // harvestTaxonomy — le mapping appris rend les études précises fiables dès
  // la campagne suivante. Planifiée pour les couples site×marque dont moins
  // de la moitié des modèles connus est validée. Modèle vide = jamais
  // d'écriture mémoire (garde confirmed.has('model') de l'ingestion).
  const DISCOVERY_SHARE = 0.1;
  const discovery: Atom[] = [];
  const brandsInScope = [...new Set(combos.map((c) => c.brand))];
  const discoveryYear = years.length ? years[years.length - 1] : new Date().getFullYear();
  for (const site of opts.sites) {
    const covered = k.coveredBySite[site] ?? new Set<string>();
    for (const brand of brandsInScope) {
      const models = k.modelsByBrand[brand] ?? [];
      const coveredCount = models.filter((mo) => covered.has(`${brand}|${mo}`)).length;
      if (models.length === 0 || coveredCount < models.length / 2) {
        discovery.push({
          site, brand, model: '', year: discoveryYear, fuel: null,
          note: `découverte gamme — ${models.length - coveredCount}/${models.length || '?'} modèle(s) non validé(s), la page marque apprend la taxonomie du site`,
        });
      }
    }
  }
  if (discovery.length > 0) {
    const slots = Math.min(Math.max(1, Math.round(total * DISCOVERY_SHARE)), discovery.length);
    const discoveryPicked = shuffle(discovery, rng).slice(0, slots)
      .map((atom) => ({ atom, kind: 'exploration' as const }));
    picked = [...discoveryPicked, ...picked.slice(0, Math.max(0, total - discoveryPicked.length))];
  }

  const items: CampaignPlanItem[] = [];
  for (const { atom, kind } of picked) {
    const key = `${atom.brand}|${atom.model}`;
    const item: CampaignPlanItem = {
      site: atom.site, brand: atom.brand, model: atom.model,
      kind,
      reason: atom.fromRef
        ? `${atom.brand} ${atom.model} — nouveau modèle (référentiel), jamais étudié`
        : kind === 'exploration'
          ? `${atom.brand} ${atom.model} jamais validé sur ${atom.site}`
          : `renforcement ${atom.brand} ${atom.model} sur ${atom.site}`,
    };
    if (atom.fuel) {
      // Fuel targeting: EVERY item carries one of the requested fuels — this is
      // how "améliorer nos data sur les hybrides uniquement" works.
      item.fuel = atom.fuel;
      item.reason += ` (ciblage ${atom.fuel})`;
    } else if (rng() < variantShare) {
      // Variant: attach a fuel or trim KNOWN FOR THIS EXACT brand|model.
      const fuels = k.fuelsByBrandModel[key] ?? [];
      const trims = k.trimsByBrandModel[key] ?? [];
      const pool: Array<['fuel' | 'trim', string]> = [
        ...fuels.map((f2): ['fuel' | 'trim', string] => ['fuel', f2]),
        ...trims.map((t): ['fuel' | 'trim', string] => ['trim', t]),
      ];
      if (pool.length > 0) {
        const [kindV, value] = pool[Math.floor(rng() * pool.length)];
        if (kindV === 'fuel') { item.fuel = value; item.reason += ` (variante ${value})`; }
        else { item.trim = value; item.reason += ` (finition ${value})`; }
      }
    }
    item.year = atom.year;
    item.reason += ` (année ${atom.year})`;
    if (atom.moto) item.reason += ` — improbable : ${atom.moto}`;
    if (atom.note) item.reason += ` — ${atom.note}`;
    // BAN marché prouvé vide : ce modèle×carburant a rendu vide-confirmé sur
    // ≥ 3 sites — on ne le replanifie plus (voir CampaignKnowledge).
    if (item.fuel && k.provenEmptyCombos?.has(emptyComboKey(item.brand, item.model, item.fuel))) continue;
    items.push(item);
  }

  return shuffle(items, rng);
}
