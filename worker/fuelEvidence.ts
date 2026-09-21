/**
 * MOISSON « MODÈLE × CARBURANT » PROUVÉE PAR LE MARCHÉ (21/09, décision
 * Channing : « utiliser la taxonomie embarquée d'un site pour confirmer les
 * modèles électriques existants »).
 *
 * Deux sites exposent, pour un carburant et une marque, la liste des modèles
 * AVEC leur nombre d'annonces — pas besoin de lire les annonces :
 *  - coches.net : `initialResults.aggregations` (filterName makeId sur la
 *    page sans marque : 64 marques électriques 2023+ ; filterName model sur
 *    la page d'une marque : Opel → Corsa-e 25, Mokka-e 23, Frontera Electric
 *    29…). Une page navigateur (géoloc ES) par marque.
 *  - Marktplaats : API LRP `facets[key=model].attributeGroup[].histogramCount`
 *    par marque (l2CategoryIds) : Opel NL → Corsa-e 105, Mokka-e 85… Un appel
 *    JSON brut par marque.
 * Écrit dans vehicle_fuel_evidence (upsert par site × carburant × marque ×
 * id modèle du site) : rien n'est jamais supprimé, les comptes se
 * rafraîchissent. Sans la table (migration non collée) : silencieux.
 */

import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { fetchHtmlWithZyte } from './scraper';
import { brandKey } from '../src/services/marketData';
import { modelFamilyKey } from '../src/lib/study-core/business-logic';

const YEAR_MIN = 2023;
const FUEL = 'ELECTRIQUE';
/** Rafraîchissement : la moisson est relancée au-delà de cet âge. */
const STALE_MS = 30 * 86_400_000;

export interface FuelEvidenceRow {
  site: string; country: string; fuel: string;
  brand: string; model: string; brand_key: string; model_key: string;
  site_model_id: string; listing_count: number; year_min: number;
  observed_at: string; updated_at: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rowOf(site: string, country: string, brand: string, model: string, siteModelId: string, count: number): FuelEvidenceRow {
  const now = new Date().toISOString();
  return {
    site, country, fuel: FUEL, brand: brand.trim().toUpperCase(), model: model.trim(),
    brand_key: brandKey(brand), model_key: modelFamilyKey(model), site_model_id: siteModelId,
    listing_count: count, year_min: YEAR_MIN, observed_at: now, updated_at: now,
  };
}

// ─── coches.net ─────────────────────────────────────────────────────────────

interface CnAgg { filterName: string; items: Array<{ id: string | number; totalResults: number }> }
interface CnProps {
  initialResults?: { aggregations?: CnAgg[] };
  listFiltersOptions?: { vehicles?: { options?: Array<{ id: string | number; label: string; models?: Array<{ id: string | number; label: string }> }> } };
}
function cochesProps(html: string): CnProps | null {
  const m = html.match(/__INITIAL_PROPS__\s*=\s*JSON\.parse\("(.*?)"\)\s*;?\s*</s);
  if (!m) return null;
  try { return JSON.parse(JSON.parse(`"${m[1]}"`)) as CnProps; } catch { return null; }
}
async function fetchCoches(url: string): Promise<CnProps | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetchHtmlWithZyte(url, attempt);
    const p = r.html ? cochesProps(r.html) : null;
    if (p?.initialResults?.aggregations) return p;
    await sleep(4000 * attempt);
  }
  return null;
}

export async function harvestCoches(): Promise<FuelEvidenceRow[]> {
  const rows: FuelEvidenceRow[] = [];
  const root = await fetchCoches(`https://www.coches.net/search/?Fueltype2List=3&MinYear=${YEAR_MIN}`);
  if (!root) { console.warn('[FUEL_EVIDENCE] coches.net : page racine illisible — moisson abandonnée'); return rows; }
  const catalog = new Map((root.listFiltersOptions?.vehicles?.options ?? []).map((o) => [String(o.id), o]));
  const makes = root.initialResults?.aggregations?.find((a) => a.filterName === 'makeId')?.items ?? [];
  console.warn(`[FUEL_EVIDENCE] coches.net : ${makes.length} marque(s) avec de l'électrique ${YEAR_MIN}+`);
  for (const mk of makes) {
    const id = String(mk.id);
    const entry = catalog.get(id);
    if (!entry) continue;
    const p = await fetchCoches(`https://www.coches.net/search/?Fueltype2List=3&MinYear=${YEAR_MIN}&MakeIds%5B0%5D=${id}`);
    const models = p?.initialResults?.aggregations?.find((a) => a.filterName === 'model')?.items ?? [];
    const names = new Map((entry.models ?? []).map((m) => [String(m.id), m.label]));
    for (const m of models) {
      const label = names.get(String(m.id));
      if (!label || !m.totalResults) continue;
      rows.push(rowOf('COCHES', 'ES', entry.label, label, String(m.id), m.totalResults));
    }
    await sleep(1500);
  }
  return rows;
}

// ─── Marktplaats (API LRP) ───────────────────────────────────────────────────

interface MpLrp {
  totalResultCount?: number;
  searchCategoryOptions?: Array<{ id: number; key: string; name: string; parentId?: number }>;
  facets?: Array<{ key: string; attributeGroup?: Array<{ attributeValueId: number; attributeValueLabel: string; histogramCount?: number }> }>;
}
async function fetchLrp(url: string): Promise<MpLrp | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetchHtmlWithZyte(url, attempt);
    if (r.html) { try { return JSON.parse(r.html) as MpLrp; } catch { /* pas du JSON — on retente */ } }
    await sleep(3000 * attempt);
  }
  return null;
}

export async function harvestMarktplaats(): Promise<FuelEvidenceRow[]> {
  const rows: FuelEvidenceRow[] = [];
  const base = `https://www.marktplaats.nl/lrp/api/search?l1CategoryId=91&attributesById%5B%5D=11756&attributeRanges%5B%5D=constructionYear%3A${YEAR_MIN}%3A&limit=1`;
  const root = await fetchLrp(base);
  if (!root) { console.warn('[FUEL_EVIDENCE] Marktplaats : API racine illisible — moisson abandonnée'); return rows; }
  const brands = (root.searchCategoryOptions ?? []).filter((c) => c.parentId === 91);
  console.warn(`[FUEL_EVIDENCE] Marktplaats : ${brands.length} marque(s) à interroger, ${root.totalResultCount ?? '?'} annonces électriques ${YEAR_MIN}+`);
  for (const b of brands) {
    const d = await fetchLrp(`${base}&l2CategoryIds=${b.id}`);
    if (!d?.totalResultCount) { await sleep(300); continue; }
    const facet = d.facets?.find((f) => f.key === 'model');
    for (const it of facet?.attributeGroup ?? []) {
      if (!it.histogramCount || /^overige/i.test(it.attributeValueLabel)) continue;
      rows.push(rowOf('MARKTPLAATS', 'NL', b.name, it.attributeValueLabel, String(it.attributeValueId), it.histogramCount));
    }
    await sleep(500);
  }
  return rows;
}

// ─── Persistance + ordonnancement ────────────────────────────────────────────

/** La table existe-t-elle (migration collée) ? null = illisible. */
async function tableState(): Promise<{ exists: boolean; newest: string | null }> {
  const { data, error } = await supabase.from('vehicle_fuel_evidence').select('observed_at').order('observed_at', { ascending: false }).limit(1);
  if (error) return { exists: false, newest: null };
  return { exists: true, newest: data?.[0]?.observed_at ?? null };
}

export async function persistFuelEvidence(rows: FuelEvidenceRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await supabase.from('vehicle_fuel_evidence').upsert(batch, { onConflict: 'site,fuel,brand_key,site_model_id' });
    if (error) { console.warn(`[FUEL_EVIDENCE] écriture échouée (${batch.length} lignes) : ${error.message}`); continue; }
    written += batch.length;
  }
  return written;
}

let running = false;
export async function runFuelEvidenceHarvest(sites: string[] = ['COCHES', 'MARKTPLAATS'], reason = 'manuel'): Promise<{ started: boolean; reason?: string }> {
  if (running) return { started: false, reason: 'moisson déjà en cours' };
  const state = await tableState();
  if (!state.exists) return { started: false, reason: 'table vehicle_fuel_evidence absente (migration 20260921200000 à coller)' };
  running = true;
  void (async () => {
    try {
      console.warn(`[FUEL_EVIDENCE] moisson démarrée (${reason}) : ${sites.join(', ')}`);
      const summary: string[] = [];
      for (const site of sites) {
        const rows = site === 'COCHES' ? await harvestCoches() : site === 'MARKTPLAATS' ? await harvestMarktplaats() : [];
        const written = await persistFuelEvidence(rows);
        const brands = new Set(rows.map((r) => r.brand_key)).size;
        summary.push(`${site} : ${brands} marques, ${rows.length} modèles (${written} écrits)`);
      }
      console.warn(`[FUEL_EVIDENCE] moisson terminée — ${summary.join(' · ')}`);
    } catch (e) {
      console.warn(`[FUEL_EVIDENCE] moisson en échec : ${e instanceof Error ? e.message : e}`);
    } finally { running = false; }
  })();
  return { started: true };
}

/** Garde : au boot puis toutes les 30 min — table présente et moisson absente ou > 30 j → relance. */
export function startFuelEvidenceScheduler(): void {
  const check = async () => {
    try {
      const state = await tableState();
      if (!state.exists) return;
      const age = state.newest ? Date.now() - new Date(state.newest).getTime() : Number.POSITIVE_INFINITY;
      if (age > STALE_MS) await runFuelEvidenceHarvest(undefined, state.newest ? 'rafraîchissement mensuel' : 'première moisson');
    } catch { /* garde silencieuse */ }
  };
  setTimeout(() => void check(), 5 * 60_000);
  setInterval(() => void check(), 30 * 60_000);
}
