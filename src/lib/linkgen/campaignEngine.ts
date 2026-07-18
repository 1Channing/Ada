/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CAMPAIGN ENGINE — shared between the browser and the Railway worker
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything a campaign item needs EXCEPT the scrape transport and the UI:
 * knowledge loading, memory-first URL generation, field-by-field confirmation,
 * granular retention, market snapshot, outcome classification. The scrape is
 * injected: the browser passes an edge-function call, the worker passes its
 * local scrapeSearch — same pipeline either way.
 *
 * Uses sharedSupabase (lib/supabaseShared): browser = anon client, worker =
 * service-role client. NO import.meta.env anywhere in this dependency chain.
 */

import { sharedSupabase as supabase } from '../supabaseShared';
import { getSiteAdapter, decomposeUrl } from '../study-core/marketplaces';
import type { SearchCriteria } from '../study-core/marketplaces';
import { analyzeIngestion, INGESTION_MIN_SAMPLE } from '../study-core/ingestion';
import { persistIngestionResult } from './ingestion';
import { generateSearchUrlsWithMemory } from './generator';
import type { SiteKey } from './types';
import { writeMarketSnapshot } from '../../services/marketData';
import type { CampaignKnowledge, CampaignPlanItem } from './campaignPlanner';
import type { ScrapedListing } from '../study-core/types';

export const CAMPAIGN_SUBMITTER = 'Ada';

export type CampaignOutcome =
  | 'confirmed' | 'taxonomy_gap' | 'enum_gap' | 'no_url' | 'insufficient' | 'technical';

export interface CampaignItemResult {
  seq: number;
  site: string;
  brand: string;
  model: string;
  fuel?: string;
  trim?: string;
  kind: CampaignPlanItem['kind'];
  url: string | null;
  outcome: CampaignOutcome;
  confirmedFields: string[];
  rejected: Array<{ field: string; declared: string; reason: string }>;
  detail: string;
  sampleSize: number;
}

export type ScrapeFn = (url: string) => Promise<{ listings: ScrapedListing[]; error: string | null }>;

/** Validated memory → pools (brand/model/fuel/trim per brand+model) + per-site coverage. */
export async function loadCampaignKnowledge(): Promise<CampaignKnowledge> {
  const { data } = await supabase
    .from('linkgen_mapping_memory')
    .select('site, brand, model, fuel, trim, validation_status')
    .eq('validation_status', 'valid')
    .limit(10000);

  const brands = new Set<string>();
  const modelsByBrand: Record<string, Set<string>> = {};
  const fuelsByBrandModel: Record<string, Set<string>> = {};
  const trimsByBrandModel: Record<string, Set<string>> = {};
  const coveredBySite: Record<string, Set<string>> = {};

  for (const r of (data ?? []) as Array<Record<string, string | null>>) {
    const brand = (r.brand ?? '').trim().toUpperCase();
    const model = (r.model ?? '').trim().toUpperCase();
    if (!brand || !model) continue;
    brands.add(brand);
    (modelsByBrand[brand] ??= new Set()).add(model);
    const key = `${brand}|${model}`;
    const fuel = (r.fuel ?? '').trim().toUpperCase();
    if (fuel) (fuelsByBrandModel[key] ??= new Set()).add(fuel);
    const trim = (r.trim ?? '').trim();
    if (trim) (trimsByBrandModel[key] ??= new Set()).add(trim);
    if (r.site) (coveredBySite[r.site] ??= new Set()).add(key);
  }

  const toRec = (rec: Record<string, Set<string>>): Record<string, string[]> =>
    Object.fromEntries(Object.entries(rec).map(([k, s]) => [k, [...s]]));

  return {
    brands: [...brands].sort(),
    modelsByBrand: toRec(modelsByBrand),
    fuelsByBrandModel: toRec(fuelsByBrandModel),
    trimsByBrandModel: toRec(trimsByBrandModel),
    coveredBySite: Object.fromEntries(Object.entries(coveredBySite).map(([k, s]) => [k, s])),
  };
}

/**
 * One campaign study, end to end — identical to a manual ingestion, just
 * triggered automatically and signed 'Ada'.
 */
export async function executeCampaignItem(seq: number, p: CampaignPlanItem, scrape: ScrapeFn): Promise<CampaignItemResult> {
  const base: Omit<CampaignItemResult, 'url' | 'outcome' | 'confirmedFields' | 'rejected' | 'detail' | 'sampleSize'> = {
    seq, site: p.site, brand: p.brand, model: p.model, fuel: p.fuel, trim: p.trim, kind: p.kind,
  };

  const criteria: SearchCriteria = {
    brand: p.brand,
    model: p.model,
    fuel: p.fuel || undefined,
    trim: p.trim || undefined,
  };

  // URL at ITEM time (memory-first) — learnings from earlier items apply here.
  let url: string | null = null;
  try {
    const gen = await generateSearchUrlsWithMemory({
      selectedSites: [p.site as SiteKey],
      brand: p.brand, model: p.model,
      fuel: p.fuel || undefined, trim: p.trim || undefined,
    });
    url = gen[0]?.url && gen[0].url.length > 10 ? gen[0].url : null;
  } catch { url = null; }
  if (!url) {
    return { ...base, url: null, outcome: 'no_url', confirmedFields: [], rejected: [], detail: 'URL non générable pour ce site', sampleSize: 0 };
  }

  const adapter = getSiteAdapter(p.site as SiteKey);
  const { listings, error } = await scrape(url);

  if (error && listings.length === 0) {
    await persistIngestionResult({
      url, site: adapter.key, country: adapter.countryCode, criteria,
      analysis: null, sampleSize: 0, scrapeError: error,
      detectedParams: decomposeUrl(url), submittedBy: CAMPAIGN_SUBMITTER,
    }).catch(() => undefined);
    return { ...base, url, outcome: 'technical', confirmedFields: [], rejected: [], detail: `scrape en échec: ${error}`, sampleSize: 0 };
  }
  if (listings.length < INGESTION_MIN_SAMPLE) {
    return { ...base, url, outcome: 'insufficient', confirmedFields: [], rejected: [], detail: `échantillon ${listings.length} < ${INGESTION_MIN_SAMPLE}`, sampleSize: listings.length };
  }

  const analysis = analyzeIngestion(url, criteria, listings, adapter);

  await persistIngestionResult({
    url, site: adapter.key, country: adapter.countryCode, criteria,
    analysis, sampleSize: listings.length,
    detectedParams: decomposeUrl(url), submittedBy: CAMPAIGN_SUBMITTER,
  }).catch(() => undefined);

  const confirmed = new Set(analysis.confirmedFields);
  if (confirmed.has('brand') && confirmed.has('model') && listings.length > 0) {
    await writeMarketSnapshot({
      segment: {
        site: adapter.key, country: adapter.countryCode,
        brand: p.brand.toUpperCase(), model: p.model.toUpperCase(),
        fuel: confirmed.has('fuel') ? (p.fuel ?? '').toUpperCase() : '',
        trim: confirmed.has('trim') ? (p.trim ?? '') : '',
      },
      listings,
      totalCount: null,
      sourceUrl: url,
      submittedBy: CAMPAIGN_SUBMITTER,
    }).catch(() => undefined);
  }

  const rejected = analysis.rejectedFields.map((c) => ({
    field: c.field, declared: c.declaredValue, reason: c.reason ?? '',
  }));
  let detail = rejected.length
    ? rejected.map((r) => `${r.field} (${r.declared}) : ${r.reason || 'incohérent avec l’échantillon'}`).join(' ; ')
    : `${analysis.confirmedFields.length} champ(s) confirmé(s)`;

  const outcome: CampaignOutcome =
    rejected.some((r) => r.field === 'brand' || r.field === 'model') ? 'taxonomy_gap'
    : rejected.length > 0 ? 'enum_gap'
    : 'confirmed';

  // ── Self-healing: before reporting a gap, try the adapter's own correction
  // hypotheses (H1/H2 — fuel removed, regenerated structured params…), max 2
  // extra scrapes. A hypothesis that confirms brand+model is learned and the
  // item flips to 'confirmé (auto-corrigée)' — no human needed. Criteria the
  // first pass rejected are withdrawn from the retry: the goal is to salvage
  // the core taxonomy, the withheld criterion stays visible as a gap if the
  // site still can't express it.
  if ((outcome === 'taxonomy_gap' || outcome === 'enum_gap') && adapter.generateCorrectionHypotheses) {
    const issueTypes = new Set<string>();
    const rejectedSet = new Set(rejected.map((r) => r.field));
    if (rejectedSet.has('fuel')) { issueTypes.add('fuel_mapping_suspect'); issueTypes.add('fuel_mismatch'); }
    if (rejectedSet.has('model')) { issueTypes.add('model_missing'); issueTypes.add('model_not_applied'); }
    if (rejectedSet.has('brand')) issueTypes.add('brand_missing');

    const reduced: SearchCriteria = { ...criteria };
    for (const f of ['fuel', 'trim', 'gearbox', 'color', 'vehicleType'] as const) {
      if (rejectedSet.has(f)) (reduced as unknown as Record<string, unknown>)[f] = undefined;
    }

    const hypotheses = (adapter.generateCorrectionHypotheses(criteria, issueTypes) ?? [])
      .filter((h) => h.url && h.url !== url)
      .slice(0, 2);
    for (const h of hypotheses) {
      const alt = await scrape(h.url);
      if (alt.error || alt.listings.length < INGESTION_MIN_SAMPLE) continue;
      const altAnalysis = analyzeIngestion(h.url, reduced, alt.listings, adapter);
      const altConfirmed = new Set(altAnalysis.confirmedFields);
      if (!altConfirmed.has('brand') || !altConfirmed.has('model')) continue;

      await persistIngestionResult({
        url: h.url, site: adapter.key, country: adapter.countryCode, criteria: reduced,
        analysis: altAnalysis, sampleSize: alt.listings.length,
        detectedParams: decomposeUrl(h.url), submittedBy: CAMPAIGN_SUBMITTER,
      }).catch(() => undefined);
      await writeMarketSnapshot({
        segment: {
          site: adapter.key, country: adapter.countryCode,
          brand: p.brand.toUpperCase(), model: p.model.toUpperCase(),
          fuel: altConfirmed.has('fuel') ? (reduced.fuel ?? '').toUpperCase() : '',
          trim: altConfirmed.has('trim') ? (reduced.trim ?? '') : '',
        },
        listings: alt.listings, totalCount: null, sourceUrl: h.url, submittedBy: CAMPAIGN_SUBMITTER,
      }).catch(() => undefined);

      const altRejected = altAnalysis.rejectedFields.map((c) => ({
        field: c.field, declared: c.declaredValue, reason: c.reason ?? '',
      }));
      // Criteria withdrawn from the retry stay reported as gaps.
      const stillMissing = rejected.filter((r) => !(r.field === 'brand' || r.field === 'model'));
      const combinedRejected = [...altRejected, ...stillMissing.filter((r) => !altRejected.some((a) => a.field === r.field))];
      return {
        ...base, url: h.url,
        outcome: combinedRejected.length > 0 ? 'enum_gap' : 'confirmed',
        confirmedFields: [...altAnalysis.confirmedFields],
        rejected: combinedRejected,
        detail: `auto-corrigée (${h.reason})${combinedRejected.length ? ' — reste: ' + combinedRejected.map((r) => r.field).join(', ') : ''}`,
        sampleSize: alt.listings.length,
      };
    }
    detail += ' ; auto-correction tentée sans succès';
  }

  return {
    ...base, url, outcome,
    confirmedFields: [...analysis.confirmedFields],
    rejected, detail, sampleSize: listings.length,
  };
}

/** Insert one finished item row (shared write shape). */
export async function insertCampaignItemRow(campaignId: string, r: CampaignItemResult): Promise<void> {
  await supabase.from('linkgen_campaign_items').insert({
    campaign_id: campaignId,
    seq: r.seq,
    site: r.site,
    brand: r.brand,
    model: r.model,
    criteria: { fuel: r.fuel ?? null, trim: r.trim ?? null },
    url: r.url,
    kind: r.kind,
    outcome: r.outcome,
    confirmed_fields: r.confirmedFields,
    rejected: r.rejected,
    detail: r.detail,
    sample_size: r.sampleSize,
    finished_at: new Date().toISOString(),
  });
}
