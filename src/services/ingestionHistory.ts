/**
 * Data loaders for the Ingestion History page: the ingestion journal, the
 * contributor leaderboard / name list, and the learned-mapping tree that
 * feeds the radial graph. Read-only; all tables are already RLS-readable.
 */

import { supabase } from '../lib/supabase';
import { allSiteAdapters } from '../lib/study-core/marketplaces';
import { fetchAllPages } from '../lib/fetchAllPages';

export interface IngestionEventRow {
  id: string;
  created_at: string;
  submitted_url: string;
  site: string;
  submitted_by: string | null;
  declared_criteria: Record<string, unknown> | null;
  retained: Array<{ field: string; declared: string; method?: string; matchCount?: number; sampleSize?: number }> | null;
  discarded: Array<{ field: string; declared: string; reason: string }> | null;
  memory_action: string | null;
  sample_size: number;
  scrape_error: string | null;
}

export interface Contributor {
  name: string;
  total: number;      // ingestion attempts
  written: number;    // attempts that wrote/reinforced a mapping
}

export async function loadIngestionEvents(limit = 500): Promise<IngestionEventRow[]> {
  const { data, error } = await supabase
    .from('linkgen_ingestion_events')
    .select('id, created_at, submitted_url, site, submitted_by, declared_criteria, retained, discarded, memory_action, sample_size, scrape_error')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[HISTORY] loadIngestionEvents failed:', error.message);
    return [];
  }
  return (data ?? []) as unknown as IngestionEventRow[];
}

const WROTE_ACTIONS = new Set(['inserted', 'reinforced', 'upgraded_from_csv']);

/** Distinct contributor names + counts, ranked. Powers the leaderboard AND the name dropdown. */
export function computeContributors(events: IngestionEventRow[]): Contributor[] {
  const map = new Map<string, Contributor>();
  for (const e of events) {
    const name = (e.submitted_by ?? '').trim();
    if (!name) continue;
    const c = map.get(name) ?? { name, total: 0, written: 0 };
    c.total += 1;
    if (e.memory_action && WROTE_ACTIONS.has(e.memory_action)) c.written += 1;
    map.set(name, c);
  }
  return [...map.values()].sort((a, b) => b.written - a.written || b.total - a.total);
}

export interface GlobalIngestionStats {
  totalEvents: number;
  totalWritten: number;
  contributors: Contributor[];
}

/**
 * Leaderboard + KPI totals over the WHOLE events table, not just the journal
 * window. Computing them from the latest 500 events made colleagues' scores
 * SHRINK whenever an Ada campaign flooded the recent window (their older
 * events fell out of the 500), and pinned "liens ingérés" at 500. Aggregates
 * are paginated over a 2-column projection so the payload stays small.
 */
export async function loadGlobalStats(): Promise<GlobalIngestionStats> {
  const map = new Map<string, Contributor>();
  let totalEvents = 0;
  let totalWritten = 0;

  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await supabase
      .from('linkgen_ingestion_events')
      .select('submitted_by, memory_action')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn('[HISTORY] loadGlobalStats page failed:', error.message);
      break;
    }
    const rows = (data ?? []) as Array<{ submitted_by: string | null; memory_action: string | null }>;
    for (const r of rows) {
      totalEvents += 1;
      const wrote = Boolean(r.memory_action && WROTE_ACTIONS.has(r.memory_action));
      if (wrote) totalWritten += 1;
      const name = (r.submitted_by ?? '').trim();
      if (!name) continue;
      const c = map.get(name) ?? { name, total: 0, written: 0 };
      c.total += 1;
      if (wrote) c.written += 1;
      map.set(name, c);
    }
    if (rows.length < PAGE) break;
  }

  return {
    totalEvents,
    totalWritten,
    contributors: [...map.values()].sort((a, b) => b.written - a.written || b.total - a.total),
  };
}

/** Just the distinct known names (for the Ingestion form dropdown). */
export async function loadContributorNames(): Promise<string[]> {
  const { data, error } = await supabase
    .from('linkgen_ingestion_events')
    .select('submitted_by')
    .not('submitted_by', 'is', null)
    .limit(2000);
  if (error) return [];
  const set = new Set<string>();
  for (const r of data ?? []) {
    const n = ((r as { submitted_by: string | null }).submitted_by ?? '').trim();
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ─── Mapping tree (radial graph source) ───────────────────────────────────────

export type MappingStatus = 'valid' | 'partial' | 'pending' | 'invalid' | 'csv' | 'group';

export interface TreeNode {
  id: string;
  label: string;
  kind: 'root' | 'site' | 'brand' | 'model' | 'variant' | 'facet';
  status: MappingStatus;
  /** Reinforcement weight (human_confirmations) — drives node size. */
  weight: number;
  children: TreeNode[];
  meta?: Record<string, string | number>;
  /** True when ONLY Ada (campaign runs) confirmed this mapping — rendered violet. */
  adaOnly?: boolean;
}

interface MemoryRow {
  site: string;
  country: string | null;
  brand: string;
  model: string;
  fuel: string | null;
  trim: string | null;
  validation_status: string | null;
  source: string | null;
  human_confirmations: number | null;
  confidence: number | null;
  last_confirmed_at: string | null;
}

interface EnumRow {
  site: string;
  field: string;
  code: string;
  label: string;
  confirmations: number | null;
}

function statusOf(row: MemoryRow): MappingStatus {
  if (row.source === 'human_verified' && row.validation_status === 'valid') return 'valid';
  const s = (row.validation_status ?? 'pending') as MappingStatus;
  if (s === 'valid' || s === 'partial' || s === 'invalid') return s;
  if (row.source === 'csv_import') return 'csv';
  return 'pending';
}

/** Roll a child's status up to a parent group (best status wins). */
const STATUS_RANK: Record<MappingStatus, number> = {
  valid: 5, partial: 4, csv: 3, pending: 2, invalid: 1, group: 0,
};
function bestStatus(children: TreeNode[]): MappingStatus {
  return children.reduce<MappingStatus>((acc, c) =>
    STATUS_RANK[c.status] > STATUS_RANK[acc] ? c.status : acc, 'group');
}

/**
 * Build the Site → Brand → Model → variant(fuel/trim) hierarchy from the
 * learned mappings, plus a per-site "facettes" branch listing enum values
 * learned (gearbox/color/…).
 */
export async function loadMappingTree(): Promise<TreeNode> {
  // Lectures PAGINÉES obligatoires : PostgREST plafonne à 1000 lignes en
  // silence. Le dictionnaire de taxonomie dépasse les 13 000 entrées depuis
  // les campagnes de découverte — sans pagination la carto n'en voyait que
  // 1000, et le compteur « modèles couverts » restait figé pendant qu'Ada
  // apprenait des milliers de modèles (constat 29/07).
  const [rows, enums, eventData] = await Promise.all([
    fetchAllPages<MemoryRow>(
      (from, to) => supabase
        .from('linkgen_mapping_memory')
        .select('site, country, brand, model, fuel, trim, validation_status, source, human_confirmations, confidence, last_confirmed_at')
        .order('last_confirmed_at', { ascending: false })
        .range(from, to),
      50_000, 'MAPPING_TREE',
    ),
    fetchAllPages<EnumRow>(
      (from, to) => supabase
        .from('linkgen_enum_mappings')
        .select('site, field, code, label, confirmations')
        .order('confirmations', { ascending: false })
        .range(from, to),
      100_000, 'MAPPING_TREE',
    ),
    // Attribution: which mappings were written by Ada (campaigns) vs humans.
    fetchAllPages<Record<string, unknown>>(
      (from, to) => supabase
        .from('linkgen_ingestion_events')
        .select('site, submitted_by, declared_criteria, memory_action')
        .not('memory_action', 'is', null)
        .order('created_at', { ascending: false })
        .range(from, to),
      20_000, 'MAPPING_TREE',
    ),
  ]);

  // Keys (model + variant grain) confirmed by Ada vs by at least one human.
  // A node is "Ada seule" when Ada wrote it and no human ever did.
  const adaKeys = new Set<string>();
  const humanKeys = new Set<string>();
  const U = (s: unknown) => String(s ?? '').trim().toUpperCase();
  for (const e of (eventData ?? []) as Array<{ site: string; submitted_by: string | null; declared_criteria: unknown; memory_action: string | null }>) {
    if (!e.memory_action || !WROTE_ACTIONS.has(e.memory_action)) continue;
    const c = (e.declared_criteria ?? {}) as Record<string, unknown>;
    const modelKey = `${e.site}|${U(c.brand)}|${U(c.model)}`;
    const variantKey = `${modelKey}|${U(c.fuel)}|${U(c.trim)}`;
    const target = (e.submitted_by ?? '').trim() === 'Ada' ? adaKeys : humanKeys;
    target.add(modelKey);
    target.add(variantKey);
  }
  const isAdaOnly = (key: string) => adaKeys.has(key) && !humanKeys.has(key);

  const root: TreeNode = { id: 'root', label: 'ADA', kind: 'root', status: 'group', weight: 0, children: [] };
  const siteMap = new Map<string, TreeNode>();
  const brandMap = new Map<string, TreeNode>();
  const modelMap = new Map<string, TreeNode>();

  const getSite = (site: string): TreeNode => {
    let n = siteMap.get(site);
    if (!n) {
      n = { id: `site:${site}`, label: site, kind: 'site', status: 'group', weight: 0, children: [] };
      siteMap.set(site, n);
      root.children.push(n);
    }
    return n;
  };

  // Seed EVERY registered site adapter so the map reflects ADA's full coverage,
  // not just sites that already have learned data. Sites with no mappings yet
  // stay empty and render as "En attente" (see the pending pass after rollup).
  for (const adapter of allSiteAdapters()) getSite(adapter.key);

  for (const row of rows) {
    const site = getSite(row.site);
    const brandKey = `${row.site}|${row.brand}`;
    let brand = brandMap.get(brandKey);
    if (!brand) {
      brand = { id: `brand:${brandKey}`, label: row.brand || '(marque ?)', kind: 'brand', status: 'group', weight: 0, children: [] };
      brandMap.set(brandKey, brand);
      site.children.push(brand);
    }
    const modelKey = `${brandKey}|${row.model}`;
    let model = modelMap.get(modelKey);
    if (!model) {
      model = { id: `model:${modelKey}`, label: row.model || '(modèle ?)', kind: 'model', status: 'group', weight: 0, children: [] };
      modelMap.set(modelKey, model);
      brand.children.push(model);
    }
    // Hierarchy: Modèle → Carburant → Finition. Fuel and trim are SEPARATE
    // levels so the tree reads "quelles finitions pour quel carburant" — a
    // trim with no known fuel hangs directly under the model, a fuel with no
    // trim stays a leaf.
    const fuelVal = (row.fuel ?? '').trim();
    const trimVal = (row.trim ?? '').trim();
    const status = statusOf(row);
    const weight = Math.max(1, row.human_confirmations ?? 0);
    const attributionKey = (fuel: string, trim: string) =>
      `${row.site}|${U(row.brand)}|${U(row.model)}|${U(fuel)}|${U(trim)}`;
    if (fuelVal || trimVal) {
      const adaOnly = isAdaOnly(attributionKey(row.fuel ?? '', row.trim ?? ''));
      const leafMeta = {
        confirmations: row.human_confirmations ?? 0,
        confidence: row.confidence ?? 0,
        statut: row.validation_status ?? '',
        source: row.source ?? '',
        ...(adaOnly ? { appris_par: 'Ada (campagne)' } : {}),
      };
      let parent = model;
      if (fuelVal) {
        const fuelId = `fuel:${modelKey}|${fuelVal}`;
        let fuelNode = parent.children.find((c) => c.id === fuelId);
        if (!fuelNode) {
          fuelNode = { id: fuelId, label: fuelVal, kind: 'variant', status: 'group', weight: 0, children: [] };
          parent.children.push(fuelNode);
        }
        if (!trimVal) {
          // Fuel-only row: the fuel node itself carries the leaf data.
          fuelNode.status = STATUS_RANK[status] > STATUS_RANK[fuelNode.status] ? status : fuelNode.status;
          fuelNode.weight = Math.max(fuelNode.weight, weight);
          if (adaOnly && fuelNode.children.length === 0) fuelNode.adaOnly = true;
          fuelNode.meta = leafMeta;
        }
        parent = fuelNode;
      }
      if (trimVal) {
        parent.children.push({
          id: `variant:${modelKey}|${fuelVal}|${trimVal}`,
          label: trimVal,
          kind: 'variant',
          status,
          weight,
          children: [],
          adaOnly,
          meta: leafMeta,
        });
      }
    } else {
      // No variant → the model node itself carries the status/weight
      model.status = STATUS_RANK[status] > STATUS_RANK[model.status] ? status : model.status;
      model.weight = Math.max(model.weight, weight);
      const adaOnly = isAdaOnly(`${row.site}|${U(row.brand)}|${U(row.model)}`);
      if (adaOnly) model.adaOnly = true;
      model.meta = {
        confirmations: row.human_confirmations ?? 0,
        statut: row.validation_status ?? '',
        source: row.source ?? '',
        ...(adaOnly ? { appris_par: 'Ada (campagne)' } : {}),
      };
    }
  }

  // Dictionnaire enum : deux natures distinctes.
  //  • TAXONOMIE (champs `…:make` / `…:model`, ex. mobile.de ms:make) →
  //    rendue dans la MÊME hiérarchie Site → Marque → Modèle que les autres
  //    sites (fusion avec les nœuds issus de la mémoire), libellés humains
  //    sans préfixe technique. Affichage pur — campagnes et MI lisent la
  //    table directement, rien ne change pour eux.
  //  • FACETTES (boîte/couleur/carburant…) → branche « Facettes apprises ».
  const enumBySite = new Map<string, EnumRow[]>();
  for (const e of enums) {
    const arr = enumBySite.get(e.site) ?? [];
    arr.push(e);
    enumBySite.set(e.site, arr);
  }
  const FACET_LABEL: Record<string, string> = { gearbox: 'Boîte', color: 'Couleur', vehicleType: 'Type', fuel: 'Carburant' };
  for (const [site, list] of enumBySite) {
    const siteNode = getSite(site);
    const facetGroup: TreeNode = { id: `facets:${site}`, label: 'Facettes apprises', kind: 'facet', status: 'group', weight: 0, children: [] };

    // 1er passage : marques de la taxonomie (code → libellé), pour rattacher
    // ensuite chaque modèle (code `makeId;modelId`) à sa marque.
    const makeLabelByCode = new Map<string, string>();
    for (const e of list) {
      if (e.field.endsWith(':make')) makeLabelByCode.set(e.code, e.label);
    }
    const taxoBrandNode = (label: string): TreeNode => {
      const key = `${site}|${U(label)}`;
      let brand = brandMap.get(key);
      if (!brand) {
        // `catalog:` = REPLIÉ par défaut dans MappingRadialTree : une gamme
        // taxonomie (jusqu'à 114 modèles/marque, moisson AS24) ne déplie plus
        // ses chapelets — constat mobile 29/07. Les marques déjà présentes
        // via la mémoire (études réelles) restent dépliées, elles.
        brand = { id: `catalog:brand:${key}`, label, kind: 'brand', status: 'group', weight: 0, children: [] };
        brandMap.set(key, brand);
        siteNode.children.push(brand);
      }
      return brand;
    };

    /**
     * Marque + label modèle d'une entrée taxonomie, selon la grammaire du
     * champ — chaque site encode différemment (29/07) :
     *  - `{x}:model`  : code `makeId;modelId`, marque via le dico `{x}:make`
     *  - `model_facet`: code `brandSlug;slug;id` (Marktplaats)
     *  - `bb:model`   : code `brandSlug;modelSlug` (Bilbasen)
     *  - `u_car_model`: code `BRAND_Model` (Leboncoin)
     */
    const resolveTaxoModel = (e: { field: string; code: string; label: string }): { brandLabel: string | null; modelLabel: string } | null => {
      if (e.field.endsWith(':model')) {
        const makeLabel = makeLabelByCode.get(e.code.split(';')[0] ?? '');
        return { brandLabel: makeLabel ?? null, modelLabel: e.label };
      }
      if (e.field === 'model_facet' || e.field === 'bb:model') {
        const brandSlug = e.code.split(';')[0] ?? '';
        return brandSlug ? { brandLabel: brandSlug.replace(/-/g, ' ').toUpperCase(), modelLabel: e.label } : null;
      }
      if (e.field === 'u_car_model') {
        const i = e.code.indexOf('_');
        return i > 0 ? { brandLabel: e.code.slice(0, i).toUpperCase(), modelLabel: e.label } : null;
      }
      return null;
    };

    for (const e of list) {
      if (e.field.endsWith(':make')) {
        // Marque seule : rangée après la boucle dans le groupe replié
        // « Marques connues » si aucun modèle ne s'y rattache.
        continue;
      }
      const taxo = resolveTaxoModel(e);
      if (taxo) {
        // Marque irrésolue (dico marques pas encore moissonné) : on n'affiche
        // PAS de nœud « (marque ?) » — l'entrée reste au dictionnaire et
        // apparaîtra dès que la marque est apprise (prochain scrape du site).
        if (!taxo.brandLabel) continue;
        const brand = taxoBrandNode(taxo.brandLabel);
        const modelKey = `${site}|${U(taxo.brandLabel)}|${U(taxo.modelLabel)}`;
        let model = modelMap.get(modelKey);
        if (!model) {
          model = {
            id: `model:${modelKey}`, label: taxo.modelLabel, kind: 'model', status: 'valid',
            weight: Math.max(1, e.confirmations ?? 0), children: [],
            meta: { confirmations: e.confirmations ?? 0, source: 'taxonomie du site' },
          };
          modelMap.set(modelKey, model);
          brand.children.push(model);
        }
      } else {
        facetGroup.children.push({
          id: `facet:${site}|${e.field}|${e.label}`,
          label: `${FACET_LABEL[e.field] ?? e.field} : ${e.label}`,
          kind: 'facet',
          status: 'valid',
          weight: Math.max(1, e.confirmations ?? 0),
          children: [],
          meta: { confirmations: e.confirmations ?? 0 },
        });
      }
    }
    // Marques connues sans modèle rattaché : visibles mais regroupées dans un
    // nœud REPLIÉ par défaut (id `catalog:` — voir MappingRadialTree), pour
    // montrer la couverture sans noyer la carte sous 178 points.
    const orphanMakes = [...makeLabelByCode.values()]
      .filter((label) => !brandMap.has(`${site}|${U(label)}`))
      .sort((a, b) => a.localeCompare(b));
    if (orphanMakes.length > 0) {
      siteNode.children.push({
        id: `catalog:${site}`,
        label: `Marques connues (${orphanMakes.length})`,
        kind: 'brand',
        status: 'valid',
        weight: 1,
        children: orphanMakes.map((label) => ({
          id: `catalogmake:${site}|${label}`,
          label,
          kind: 'brand',
          status: 'valid',
          weight: 1,
          children: [],
          meta: { source: 'taxonomie du site' },
        })),
      });
    }
    if (facetGroup.children.length > 0) siteNode.children.push(facetGroup);
  }

  // Roll statuses/weights up. adaOnly rolls up too: the tree opens at
  // site/brand level, so Ada's work must be visible there — a parent whose
  // ENTIRE learned descendance is Ada-only renders violet as well.
  const rollup = (n: TreeNode): void => {
    if (n.children.length === 0) return;
    n.children.forEach(rollup);
    if (n.status === 'group') n.status = bestStatus(n.children);
    n.weight = Math.max(n.weight, ...n.children.map((c) => c.weight));
    if (n.kind !== 'root' && n.kind !== 'site' && !n.adaOnly) {
      // A model carrying its OWN human-learned row keeps its status colour
      // even when all its variants are Ada's.
      const ownHumanRow = n.kind === 'model' && n.meta && !n.adaOnly;
      if (!ownHumanRow) {
        n.adaOnly = n.children.length > 0 && n.children.every((c) => c.adaOnly === true);
      }
    }
  };
  rollup(root);

  // Seeded sites with no learned mapping yet → mark "En attente" (grey) so the
  // legend reads right (rollup leaves empty nodes at 'group').
  for (const site of root.children) {
    if (site.children.length === 0) site.status = 'pending';
  }

  // Stable alphabetical ordering
  const sortRec = (n: TreeNode): void => {
    n.children.sort((a, b) => a.label.localeCompare(b.label));
    n.children.forEach(sortRec);
  };
  sortRec(root);

  return root;
}

export function countMappings(node: TreeNode): { models: number; variants: number; valid: number } {
  let models = 0, variants = 0, valid = 0;
  const walk = (n: TreeNode) => {
    if (n.kind === 'model') models += 1;
    if (n.kind === 'variant') variants += 1;
    if (n.status === 'valid' && (n.kind === 'variant' || n.kind === 'model')) valid += 1;
    n.children.forEach(walk);
  };
  walk(node);
  return { models, variants, valid };
}
