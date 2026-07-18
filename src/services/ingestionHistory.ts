/**
 * Data loaders for the Ingestion History page: the ingestion journal, the
 * contributor leaderboard / name list, and the learned-mapping tree that
 * feeds the radial graph. Read-only; all tables are already RLS-readable.
 */

import { supabase } from '../lib/supabase';
import { allSiteAdapters } from '../lib/study-core/marketplaces';

export interface IngestionEventRow {
  id: string;
  created_at: string;
  submitted_url: string;
  site: string;
  submitted_by: string | null;
  declared_criteria: Record<string, unknown> | null;
  retained: Array<{ field: string; declared: string }> | null;
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
  const [{ data: memData }, { data: enumData }, { data: eventData }] = await Promise.all([
    supabase
      .from('linkgen_mapping_memory')
      .select('site, country, brand, model, fuel, trim, validation_status, source, human_confirmations, confidence, last_confirmed_at'),
    supabase
      .from('linkgen_enum_mappings')
      .select('site, field, label, confirmations'),
    // Attribution: which mappings were written by Ada (campaigns) vs humans.
    supabase
      .from('linkgen_ingestion_events')
      .select('site, submitted_by, declared_criteria, memory_action')
      .not('memory_action', 'is', null)
      .limit(5000),
  ]);

  const rows = (memData ?? []) as unknown as MemoryRow[];
  const enums = (enumData ?? []) as unknown as EnumRow[];

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
    // Variant leaf = fuel/trim combination (only when present)
    const variantBits = [row.fuel, row.trim].map((s) => (s ?? '').trim()).filter(Boolean);
    const status = statusOf(row);
    const weight = Math.max(1, row.human_confirmations ?? 0);
    const attributionKey = (fuel: string, trim: string) =>
      `${row.site}|${U(row.brand)}|${U(row.model)}|${U(fuel)}|${U(trim)}`;
    if (variantBits.length > 0) {
      const adaOnly = isAdaOnly(attributionKey(row.fuel ?? '', row.trim ?? ''));
      model.children.push({
        id: `variant:${modelKey}|${variantBits.join('+')}`,
        label: variantBits.join(' · '),
        kind: 'variant',
        status,
        weight,
        children: [],
        adaOnly,
        meta: {
          confirmations: row.human_confirmations ?? 0,
          confidence: row.confidence ?? 0,
          statut: row.validation_status ?? '',
          source: row.source ?? '',
          ...(adaOnly ? { appris_par: 'Ada (campagne)' } : {}),
        },
      });
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

  // Facettes apprises (enum dictionary) as a per-site branch
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
    for (const e of list) {
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
    if (facetGroup.children.length > 0) siteNode.children.push(facetGroup);
  }

  // Roll statuses/weights up
  const rollup = (n: TreeNode): void => {
    if (n.children.length === 0) return;
    n.children.forEach(rollup);
    if (n.status === 'group') n.status = bestStatus(n.children);
    n.weight = Math.max(n.weight, ...n.children.map((c) => c.weight));
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
