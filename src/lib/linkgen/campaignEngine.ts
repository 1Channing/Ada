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
import type { Json } from '../database.types';
import { getSiteAdapter, decomposeUrl } from '../study-core/marketplaces';
import type { SearchCriteria } from '../study-core/marketplaces';
import { analyzeIngestion, INGESTION_MIN_SAMPLE, canonicalizeFuel, refineFuelToken } from '../study-core/ingestion';
import { persistIngestionResult } from './ingestion';
import { generateSearchUrlsWithMemory } from './generator';
import type { SiteKey } from './types';
import { writeMarketSnapshot, brandKey } from '../../services/marketData';
import { loadRefWindows, getRefWindowsCached, refComboKey, findRefWindow, yearInRefWindow } from '../../services/vehicleRef';
import { YEAR_PIN_MIN } from './campaignPlanner';
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
  year?: number;
  kind: CampaignPlanItem['kind'];
  url: string | null;
  outcome: CampaignOutcome;
  confirmedFields: string[];
  rejected: Array<{ field: string; declared: string; reason: string }>;
  detail: string;
  sampleSize: number;
  /** Boîte noire: full action context recorded on any non-confirmed outcome. */
  dossier?: Record<string, unknown> | null;
}

export type ScrapeFn = (url: string) => Promise<{
  listings: ScrapedListing[];
  error: string | null;
  /** Scrape diagnostics (attempts, mode, block reason…) — worker fills it. */
  diagnostics?: Record<string, unknown> | null;
}>;

/** Compact listing sample for the error dossier — enough to judge, small enough to store. */
function dossierSample(listings: ScrapedListing[]): Array<Record<string, unknown>> {
  return listings.slice(0, 8).map((l) => ({
    title: l.title,
    price: l.price,
    year: l.year,
    fuel: (l as { fuel?: string | null }).fuel ?? null,
    gearbox: (l as { gearbox?: string | null }).gearbox ?? null,
    trim: l.trim ?? null,
  }));
}

/** Validated memory → pools (brand/model/fuel/trim per brand+model) + per-site coverage. */
export async function loadCampaignKnowledge(): Promise<CampaignKnowledge> {
  const { data } = await supabase
    .from('linkgen_mapping_memory')
    .select('site, brand, model, fuel, trim, validation_status')
    .eq('validation_status', 'valid')
    .limit(10000);

  // ── Identité canonique — plusieurs graphies d'un même modèle circulent en
  // mémoire ('YARIS CROSS'/'YARIS-CROSS', 'MERCEDES'/'MERCEDES-BENZ', 'RAV4'/
  // 'RAV-4') et chaque graphie casse ailleurs (slug bilbasen 'yaris-cross' →
  // page marque entière, campagne du 21/07). On regroupe par clé canonique et
  // on élit UNE graphie de référence : la plus fréquente ; à égalité, celle
  // sans tiret (les espaces se traduisent proprement par site), puis la plus
  // courte. La couverture par site est elle aussi comptée en canonique.
  type MemRow = { site: string | null; brand: string; model: string; fuel: string; trim: string };
  const rows: MemRow[] = [];
  for (const r of (data ?? []) as Array<Record<string, string | null>>) {
    const brand = (r.brand ?? '').trim().toUpperCase();
    const model = (r.model ?? '').trim().toUpperCase();
    if (!brand || !model) continue;
    rows.push({
      site: r.site, brand, model,
      fuel: (r.fuel ?? '').trim().toUpperCase(), trim: (r.trim ?? '').trim(),
    });
  }

  const elect = (counts: Map<string, number>): string => {
    return [...counts.entries()].sort((a, b) =>
      b[1] - a[1]
      || Number(a[0].includes('-')) - Number(b[0].includes('-'))
      || a[0].length - b[0].length
      || a[0].localeCompare(b[0]))[0][0];
  };
  const bump = (m: Map<string, Map<string, number>>, key: string, label: string) => {
    const c = m.get(key) ?? new Map<string, number>();
    m.set(key, c);
    c.set(label, (c.get(label) ?? 0) + 1);
  };

  // Clé modèle = refModelKey (canonKey + famille Mercedes + numéraux romains) :
  // 'CLASSE GLC' et 'GLC' sont LE MÊME modèle — la campagne du 22/07 les a
  // étudiés en double avec la clé canonique simple.
  const brandCounts = new Map<string, Map<string, number>>();
  const modelCounts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    bump(brandCounts, brandKey(r.brand), r.brand);
    bump(modelCounts, refComboKey(r.brand, r.model), r.model);
  }
  const brandLabel = new Map([...brandCounts].map(([k, c]) => [k, elect(c)]));
  const modelLabel = new Map([...modelCounts].map(([k, c]) => [k, elect(c)]));

  const brands = new Set<string>();
  const modelsByBrand: Record<string, Set<string>> = {};
  const fuelsByBrandModel: Record<string, Set<string>> = {};
  const trimsByBrandModel: Record<string, Set<string>> = {};
  const coveredBySite: Record<string, Set<string>> = {};

  for (const r of rows) {
    const brand = brandLabel.get(brandKey(r.brand)) ?? r.brand;
    const model = modelLabel.get(refComboKey(r.brand, r.model)) ?? r.model;
    brands.add(brand);
    (modelsByBrand[brand] ??= new Set()).add(model);
    const key = `${brand}|${model}`;
    if (r.fuel) (fuelsByBrandModel[key] ??= new Set()).add(r.fuel);
    if (r.trim) (trimsByBrandModel[key] ??= new Set()).add(r.trim);
    if (r.site) (coveredBySite[r.site] ??= new Set()).add(key);
  }

  const toRec = (rec: Record<string, Set<string>>): Record<string, string[]> =>
    Object.fromEntries(Object.entries(rec).map(([k, s]) => [k, [...s]]));

  // ── Référentiel constructeur (source of truth ~98 %) : fenêtres de
  // commercialisation par modèle + candidats d'EXPANSION (modèles jamais
  // étudiés dont la fenêtre touche la période d'arbitrage). Table absente ou
  // vide → Map vide → comportement strictement identique à avant (fail-open).
  const refWindows: Record<string, { from: number; to: number | null }> = {};
  const refCombos: Array<{ brand: string; model: string }> = [];
  try {
    const refMap = await loadRefWindows();
    const knownKeys = new Set<string>();
    for (const b of brands) {
      for (const m of modelsByBrand[b] ?? []) knownKeys.add(refComboKey(b, m));
    }
    for (const [key, w] of refMap) {
      refWindows[key] = { from: w.yearFrom, to: w.yearTo };
      const active = w.yearTo === null || w.yearTo + 1 >= YEAR_PIN_MIN;
      if (active && !knownKeys.has(key) && w.brandLabel && w.modelLabel) {
        refCombos.push({ brand: w.brandLabel.toUpperCase(), model: w.modelLabel.toUpperCase() });
      }
    }
  } catch { /* référentiel indisponible — la campagne tourne comme avant */ }

  return {
    brands: [...brands].sort(),
    modelsByBrand: toRec(modelsByBrand),
    fuelsByBrandModel: toRec(fuelsByBrandModel),
    trimsByBrandModel: toRec(trimsByBrandModel),
    coveredBySite: Object.fromEntries(Object.entries(coveredBySite).map(([k, s]) => [k, s])),
    refWindows,
    refCombos,
  };
}

/**
 * One campaign study, end to end — identical to a manual ingestion, just
 * triggered automatically and signed 'Ada'.
 */
export async function executeCampaignItem(seq: number, p: CampaignPlanItem, scrape: ScrapeFn): Promise<CampaignItemResult> {
  // Finitions-poubelles héritées de vieilles lacunes ('de', 'e'…) : en dessous
  // de 3 caractères ce n'est jamais une finition réelle, et ça polluait les
  // URLs (kwd=de sur les études CLASSE E). On étudie sans finition plutôt que
  // d'injecter du bruit — et on ne réécrit jamais ce déchet en mémoire.
  const rawTrim = (p.trim ?? '').trim();
  if (rawTrim && rawTrim.length < 3) p = { ...p, trim: '' };

  const base: Omit<CampaignItemResult, 'url' | 'outcome' | 'confirmedFields' | 'rejected' | 'detail' | 'sampleSize'> = {
    seq, site: p.site, brand: p.brand, model: p.model, fuel: p.fuel, trim: p.trim, year: p.year, kind: p.kind,
  };

  const criteria: SearchCriteria = {
    brand: p.brand,
    model: p.model,
    fuel: p.fuel || undefined,
    trim: p.trim || undefined,
    // Year pin: from = to = the same year, so the sample is year-resolved.
    yearFrom: p.year ? String(p.year) : undefined,
    yearTo: p.year ? String(p.year) : undefined,
  };

  // URL at ITEM time (memory-first) — learnings from earlier items apply here.
  let url: string | null = null;
  let urlSource = 'template';
  try {
    const gen = await generateSearchUrlsWithMemory({
      selectedSites: [p.site as SiteKey],
      brand: p.brand, model: p.model,
      fuel: p.fuel || undefined, trim: p.trim || undefined,
      yearFrom: p.year ? String(p.year) : undefined,
      yearTo: p.year ? String(p.year) : undefined,
    });
    url = gen[0]?.url && gen[0].url.length > 10 ? gen[0].url : null;
    urlSource = (gen[0] as { mappingSource?: string } | undefined)?.mappingSource ?? 'template';
  } catch { url = null; }

  // Boîte noire — the FULL action context, not just the error line: what we
  // asked, the URL and where it came from, how the scrape went, what came
  // back, what the analysis concluded. Reviewed daily until nothing is left.
  const mkDossier = (stage: string, extra: Record<string, unknown>): Record<string, unknown> => ({
    stage,
    criteria: { brand: p.brand, model: p.model, fuel: p.fuel ?? null, trim: p.trim ?? null, year: p.year ?? null },
    url, urlSource, ...extra,
  });

  if (!url) {
    return {
      ...base, url: null, outcome: 'no_url', confirmedFields: [], rejected: [],
      detail: 'URL non générable pour ce site', sampleSize: 0,
      dossier: mkDossier('url', {}),
    };
  }

  const adapter = getSiteAdapter(p.site as SiteKey);

  // Sondes d'URLs alternatives (slugs / mmmv) partagées entre « page
  // introuvable » et « repli silencieux » : un candidat dont la page applique
  // réellement le filtre modèle ET dont l'échantillon confirme marque+modèle
  // est appris en mémoire (rétro-guérison incluse) — l'étude repart confirmée.
  const probeAlternates = async (
    issueTypes: Set<string>,
    probeReasons: string[],
  ): Promise<CampaignItemResult | null> => {
    if (!adapter.generateCorrectionHypotheses) return null;
    const probes = (adapter.generateCorrectionHypotheses(criteria, issueTypes) ?? [])
      .filter((h) => h.url && h.url !== url)
      .filter((h, i, arr) => arr.findIndex((x) => x.url === h.url) === i)
      .slice(0, 2);
    probeReasons.push(...probes.map((h) => h.reason));
    for (const h of probes) {
      console.log(`[CAMPAIGN_PROBE] ${p.site} ${p.brand} ${p.model} → ${h.reason}`);
      const alt = await scrape(h.url);
      // La page candidate n'applique pas non plus le filtre modèle → suivante.
      const altVerdict = (alt.diagnostics as { silentFallback?: { modelApplied: boolean } } | null)?.silentFallback;
      if (altVerdict && altVerdict.modelApplied === false) continue;
      if (alt.error || alt.listings.length < INGESTION_MIN_SAMPLE) continue;
      const altAnalysis = analyzeIngestion(h.url, criteria, alt.listings, adapter);
      const altConfirmed = new Set(altAnalysis.confirmedFields);
      if (!altConfirmed.has('brand') || !altConfirmed.has('model')) continue;

      // persistIngestionResult writes the memory row (validated_url =
      // the winning URL) and retro-heals the open gaps of the combo.
      await persistIngestionResult({
        url: h.url, site: adapter.key, country: adapter.countryCode, criteria,
        analysis: altAnalysis, sampleSize: alt.listings.length,
        detectedParams: decomposeUrl(h.url), submittedBy: CAMPAIGN_SUBMITTER,
      }).catch(() => undefined);
      await writeMarketSnapshot({
        segment: {
          site: adapter.key, country: adapter.countryCode,
          brand: p.brand.toUpperCase(), model: p.model.toUpperCase(),
          fuel: altConfirmed.has('fuel') ? (p.fuel ?? '').toUpperCase() : '',
          trim: altConfirmed.has('trim') ? (p.trim ?? '') : '',
        },
        listings: alt.listings, totalCount: null, sourceUrl: h.url, submittedBy: CAMPAIGN_SUBMITTER,
      }).catch(() => undefined);

      const altRejected = altAnalysis.rejectedFields.map((c) => ({
        field: c.field, declared: c.declaredValue, reason: c.reason ?? '',
      }));
      return {
        ...base, url: h.url,
        outcome: altRejected.length > 0 ? 'enum_gap' : 'confirmed',
        confirmedFields: [...altAnalysis.confirmedFields],
        rejected: altRejected,
        detail: `slug auto-corrigé (${h.reason})`,
        sampleSize: alt.listings.length,
      };
    }
    return null;
  };

  const { listings, error, diagnostics } = await scrape(url);

  if (error && listings.length === 0) {
    // Stop hit mid-item: no audit event, no dossier — the campaign loop
    // discards this truncated result and halts.
    if (error === 'CAMPAIGN_STOPPED') {
      return { ...base, url, outcome: 'technical', confirmedFields: [], rejected: [], detail: 'CAMPAIGN_STOPPED', sampleSize: 0 };
    }
    await persistIngestionResult({
      url, site: adapter.key, country: adapter.countryCode, criteria,
      analysis: null, sampleSize: 0, scrapeError: error,
      detectedParams: decomposeUrl(url), submittedBy: CAMPAIGN_SUBMITTER,
    }).catch(() => undefined);
    // A not-found page means the URL PATH is wrong (bad brand/model slug) —
    // that's a mapping problem, not a technical one. Before recording the
    // taxonomy gap, PROBE the adapter's alternate slugs (max 2 scrapes): a
    // candidate whose sample confirms brand+model is learned into memory
    // (which retro-heals the matching open gaps) and the item flips to
    // confirmed — the slug fixed itself, no human needed.
    if (error === 'PAGE_NOT_FOUND') {
      const probeReasons: string[] = [];
      const won = await probeAlternates(new Set(['page_not_found']), probeReasons);
      if (won) return won;
      return {
        ...base, url, outcome: 'taxonomy_gap', confirmedFields: [], rejected: [],
        detail: 'page introuvable — slug marque/modèle à corriger (sondes épuisées)', sampleSize: 0,
        dossier: mkDossier('scrape', { scrape: diagnostics ?? null, probesTried: probeReasons }),
      };
    }
    return {
      ...base, url, outcome: 'technical', confirmedFields: [], rejected: [],
      detail: `scrape en échec: ${error}`, sampleSize: 0,
      dossier: mkDossier('scrape', { scrape: diagnostics ?? null }),
    };
  }
  if (listings.length < INGESTION_MIN_SAMPLE) {
    // A FULL results page with zero listings is a genuinely empty market
    // (server applied the filters and says none) — name it so the daily
    // review reads it as a « Marché vide » candidate, not a mystery.
    const emptyMarket = listings.length === 0 && (diagnostics as { emptyResults?: boolean } | null)?.emptyResults === true;
    // Un vide sur une année HORS fenêtre de commercialisation s'explique tout
    // seul (référentiel ~98 %) — la revue quotidienne n'a plus à l'élucider.
    let emptyDetail = 'marché réellement vide — 0 annonce sur page complète (filtres appliqués)';
    if (emptyMarket && p.year) {
      try {
        const win = findRefWindow(await getRefWindowsCached(), p.brand, p.model);
        if (win && !yearInRefWindow(win, p.year)) {
          emptyDetail = `hors commercialisation — ${p.model} : ${win.yearFrom}–${win.yearTo ?? 'auj.'} (référentiel), vide attendu en ${p.year}`;
        }
      } catch { /* référentiel indisponible — libellé générique */ }
    }
    return {
      ...base, url, outcome: 'insufficient', confirmedFields: [], rejected: [],
      detail: emptyMarket
        ? emptyDetail
        : `échantillon ${listings.length} < ${INGESTION_MIN_SAMPLE}`,
      sampleSize: listings.length,
      dossier: mkDossier('scrape', { scrape: diagnostics ?? null, sample: dossierSample(listings) }),
    };
  }

  // Repli silencieux : le site a servi une page SANS appliquer le filtre
  // modèle (slug inconnu → page marque entière, verdict lu dans les
  // métadonnées de la page). L'échantillon ne décrit PAS le modèle étudié :
  // on n'en ingère RIEN (protection des données), on sonde les URLs
  // alternatives (mmmv/slug régénéré) — sinon lacune avec le diagnostic exact.
  const sfVerdict = (diagnostics as { silentFallback?: { modelApplied: boolean; evidence: string } } | null)?.silentFallback;
  if (criteria.model && sfVerdict && sfVerdict.modelApplied === false) {
    const probeReasons: string[] = [];
    const won = await probeAlternates(new Set(['model_missing']), probeReasons);
    if (won) return won;
    return {
      ...base, url, outcome: 'taxonomy_gap', confirmedFields: [], rejected: [],
      detail: `slug modèle non reconnu par le site — page marque entière servie (${sfVerdict.evidence})`,
      sampleSize: listings.length,
      dossier: mkDossier('filter', {
        scrape: diagnostics ?? null, probesTried: probeReasons, sample: dossierSample(listings),
      }),
    };
  }

  // Marktplaats has NO fuel filter expressible in the URL (neither the hash
  // nor lrp/api carries one), so a fuel-scoped study always analysed a mixed
  // sample and rejected its own fuel. The per-listing STRUCTURED fuel is
  // reliable — apply the filter ourselves, exactly like the site's checkbox
  // would (hybrid family grouped as in the MI), before analysis + snapshot.
  let sampleListings = listings;
  if (p.site === 'MARKTPLAATS' && criteria.fuel) {
    const want = canonicalizeFuel(criteria.fuel);
    if (want) {
      const filtered = listings.filter((l) => {
        const tok = refineFuelToken(canonicalizeFuel(l.fuel ?? ''), `${l.title ?? ''} ${l.description ?? ''}`);
        return tok === want || (want === 'hybrid' && (tok === 'phev' || tok === 'mild_hybrid'));
      });
      // Too few after filtering → keep the mixed sample and let the analysis
      // say honestly that the fuel doesn't confirm.
      if (filtered.length >= INGESTION_MIN_SAMPLE) sampleListings = filtered;
    }
  }

  const analysis = analyzeIngestion(url, criteria, sampleListings, adapter);

  await persistIngestionResult({
    url, site: adapter.key, country: adapter.countryCode, criteria,
    analysis, sampleSize: sampleListings.length,
    detectedParams: decomposeUrl(url), submittedBy: CAMPAIGN_SUBMITTER,
  }).catch(() => undefined);

  const confirmed = new Set(analysis.confirmedFields);
  if (confirmed.has('brand') && confirmed.has('model') && sampleListings.length > 0) {
    const snap = await writeMarketSnapshot({
      segment: {
        site: adapter.key, country: adapter.countryCode,
        brand: p.brand.toUpperCase(), model: p.model.toUpperCase(),
        fuel: confirmed.has('fuel') ? (p.fuel ?? '').toUpperCase() : '',
        trim: confirmed.has('trim') ? (p.trim ?? '') : '',
      },
      listings: sampleListings,
      totalCount: null,
      sourceUrl: url,
      submittedBy: CAMPAIGN_SUBMITTER,
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!snap.ok) {
      console.warn(`[CAMPAIGN_MARKET] snapshot NOT recorded for ${adapter.countryCode} ${p.brand} ${p.model}: ${snap.error}`);
    }
  } else {
    // The Market Intelligence feed is gated on brand+model being confirmed in
    // the sample — surface WHY a scrape with listings produced no market data.
    console.warn(`[CAMPAIGN_MARKET] snapshot skipped for ${adapter.countryCode} ${p.brand} ${p.model} — confirmed=[${[...confirmed].join(',')}] listings=${sampleListings.length}`);
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
    rejected, detail, sampleSize: sampleListings.length,
    dossier: outcome === 'confirmed' ? null : mkDossier('analysis', {
      scrape: diagnostics ?? null,
      sample: dossierSample(sampleListings),
      analysis: compactAnalysis(analysis),
    }),
  };
}

/** Confirmation table, one compact row per field — the heart of the daily review. */
function compactAnalysis(a: unknown): Array<Record<string, unknown>> {
  const confs = (a as { confirmations?: Array<Record<string, unknown>> })?.confirmations ?? [];
  return confs.map((c) => ({
    field: c.field, declared: c.declaredValue, status: c.status,
    matches: c.matchCount, sample: c.sampleSize, method: c.method, reason: c.reason ?? null,
  }));
}

/** Insert one finished item row (shared write shape). */
export async function insertCampaignItemRow(campaignId: string, r: CampaignItemResult): Promise<void> {
  await supabase.from('linkgen_campaign_items').insert({
    campaign_id: campaignId,
    seq: r.seq,
    site: r.site,
    brand: r.brand,
    model: r.model,
    criteria: { fuel: r.fuel ?? null, trim: r.trim ?? null, year: r.year ?? null },
    url: r.url,
    kind: r.kind,
    outcome: r.outcome,
    confirmed_fields: r.confirmedFields,
    rejected: r.rejected,
    detail: r.detail,
    sample_size: r.sampleSize,
    finished_at: new Date().toISOString(),
  });

  // Boîte noire — never blocks the campaign (pre-migration DBs just skip it).
  if (r.dossier && r.outcome !== 'confirmed') {
    let country = '';
    try { country = getSiteAdapter(r.site as SiteKey).countryCode; } catch { /* site inconnu */ }
    const { error } = await supabase.from('linkgen_error_dossiers').insert({
      campaign_id: campaignId,
      seq: r.seq,
      site: r.site,
      country,
      brand: r.brand,
      model: r.model,
      outcome: r.outcome,
      detail: r.detail,
      url: r.url,
      url_source: String((r.dossier as { urlSource?: unknown }).urlSource ?? ''),
      dossier: r.dossier as unknown as Json,
    });
    if (error) console.warn('[BLACKBOX] dossier non enregistré:', error.message);
  }
}
