/**
 * TRUTH CENTER — briques 3b / 4 / 5 (GO Channing 03/09).
 * Tournent en service_role à la FIN de chaque vague d'études (après balayage
 * et diagnostic 3a), jamais pendant. Zéro scrape, zéro LLM : lectures DB +
 * génération d'URL pure.
 *
 *  5. BADGE DE CONFIANCE par segment (site, pays, marque, modèle) —
 *     composantes lisibles, toutes issues de données existantes :
 *       fraîcheur (âge du dernier snapshot), profondeur honnête (total site
 *       + échantillon), URL complète (critères de l'étude exprimés),
 *       dossiers ouverts, cohérence inter-sites (médiane vs pays).
 *  4. CAS DORÉS — au premier passage, l'état PROUVÉ du registre (chaque
 *     valeur native de chaque site, marque seule) est figé en cas dorés ;
 *     ensuite chaque vague les rejoue. Un échec = régression de grammaire :
 *     dossier signal 'golden_fail' + BLOCAGE des auto-validations de
 *     mappings du site (validator) tant qu'un cas échoue.
 *  3b. ROUTINE DU MATIN — un digest par jour : études passées/échouées,
 *     annonces nouvelles et baisses, dossiers (nouveaux/résolus), segments
 *     douteux, sites en échec (Zyte/blocages), taxonomie apprise, veille
 *     légale. Lu par le Truth Center et l'Accueil.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { generateSearchUrlsWithMemory } from '../src/lib/linkgen/generator';
import { missingUrlCriteria, CRITERIA_DETECTORS } from '../src/lib/linkgen/grammar';
import { allSiteAdapters } from '../src/lib/study-core/marketplaces';
import { brandKey, refModelKey } from '../src/services/marketData';
import type { SiteKey, LinkGenParams } from '../src/lib/linkgen/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const ENGINE = 'ADA (règles)';

// ─── Outils ──────────────────────────────────────────────────────────────────

const parisDay = (d = new Date()) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }); // YYYY-MM-DD
const daysAgo = (iso: string | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity);

async function genUrl(site: string, params: Partial<LinkGenParams>): Promise<string | null> {
  try {
    const g = await generateSearchUrlsWithMemory({ selectedSites: [site as SiteKey], brand: '', model: '', ...params } as LinkGenParams);
    return g[0]?.url && g[0].url.length > 10 ? g[0].url : null;
  } catch { return null; }
}

interface StudyRow {
  id: string; label: string; brand: string; model: string | null; fuel: string | null;
  trim: string | null; trim_target: string | null; year_min: number | null; year_max: number | null;
  mileage_max: number | null; gearbox: string | null; power_min: number | null; vehicle_type?: string | null;
  source_country: string; target_country: string; active: boolean; last_run_at: string | null;
}

function studyParams(s: StudyRow, site: string, side: 'source' | 'cible'): LinkGenParams {
  return {
    selectedSites: [site as SiteKey],
    brand: s.brand, model: s.model || '',
    fuel: s.fuel || undefined,
    trim: (side === 'source' ? s.trim : s.trim_target) || undefined,
    yearFrom: s.year_min != null ? String(s.year_min) : undefined,
    yearTo: s.year_max != null ? String(s.year_max) : undefined,
    mileage: s.mileage_max ?? undefined,
    gearbox: s.gearbox || undefined,
    minPower: s.power_min != null ? String(s.power_min) : undefined,
    vehicleType: s.vehicle_type || undefined,
  } as LinkGenParams;
}

// ═══ 5. BADGE DE CONFIANCE ════════════════════════════════════════════════════

export async function runConfidence(reason: string): Promise<number> {
  const { data: studies } = await sb.from('daily_searches').select('*').eq('active', true);
  const list = (studies ?? []) as StudyRow[];
  if (list.length === 0) return 0;
  const sites = allSiteAdapters().map((a) => ({ key: String(a.key), country: (a as { countryCode: string }).countryCode }));

  // Segments = chaque étude × chaque site de ses deux pays.
  const segments = new Map<string, { site: string; country: string; brand: string; model: string; study: StudyRow; side: 'source' | 'cible' }>();
  for (const s of list) {
    for (const side of ['source', 'cible'] as const) {
      const country = side === 'source' ? s.source_country : s.target_country;
      for (const site of sites.filter((x) => x.country === country)) {
        const key = `${site.key}|${country}|${s.brand.toUpperCase()}|${(s.model ?? '').toUpperCase()}`;
        if (!segments.has(key)) segments.set(key, { site: site.key, country, brand: s.brand.toUpperCase(), model: (s.model ?? '').toUpperCase(), study: s, side });
      }
    }
  }

  // Dossiers ouverts par segment.
  const { data: dossiers } = await sb.from('truth_dossiers').select('site,country,brand,model,layer,status').is('resolved_at', null);
  const openBy = new Map<string, { n: number; dict: boolean }>();
  for (const d of (dossiers ?? []) as Array<{ site: string; country: string; brand: string; model: string; layer: string }>) {
    const k = `${d.site}|${d.country}|${brandKey(d.brand)}|${refModelKey(d.brand, d.model ?? '')}`;
    const e = openBy.get(k) ?? { n: 0, dict: false };
    e.n += 1; if (d.layer === 'dictionnaire') e.dict = true;
    openBy.set(k, e);
  }
  // Médianes du tableau MI (cohérence inter-sites).
  const { data: med } = await sb.from('mi_dashboard_medians').select('brand_label,model_label,country,site,median,cnt,last_seen').is('year', null).is('fuel', null);
  const medRows = (med ?? []) as Array<{ brand_label: string; model_label: string; country: string; site: string; median: number | null; cnt: number; last_seen: string | null }>;

  const rows: Array<Record<string, unknown>> = [];
  for (const seg of segments.values()) {
    const comp: Record<string, unknown> = {};
    let score = 0;
    // Dernier snapshot du segment — celui de CETTE étude d'abord (segment_key,
    // 05/09), sinon le dernier du modèle (avant migration / ingestions).
    type Snap = { scraped_at: string; listing_count: number | null; sample_size: number; price_median: number | null };
    let snap: Snap | null = null;
    const own = await sb.from('market_snapshots')
      .select('scraped_at,listing_count,sample_size,price_median')
      .eq('site', seg.site).eq('country', seg.country).eq('brand', seg.brand).eq('model', seg.model)
      .eq('segment_key', `study:${seg.study.id}`)
      .order('scraped_at', { ascending: false }).limit(1);
    if (!own.error && own.data?.[0]) snap = own.data[0] as Snap;
    if (!snap) {
      const { data: snaps } = await sb.from('market_snapshots')
        .select('scraped_at,listing_count,sample_size,price_median')
        .eq('site', seg.site).eq('country', seg.country).eq('brand', seg.brand).eq('model', seg.model)
        .order('scraped_at', { ascending: false }).limit(1);
      snap = (snaps?.[0] ?? null) as Snap | null;
    }
    const age = daysAgo(snap?.scraped_at);
    const fresh = age <= 1.5 ? 30 : age <= 3 ? 20 : age <= 7 ? 10 : 0;
    comp.fraicheur = { jours: Number.isFinite(age) ? Math.round(age * 10) / 10 : null, points: fresh };
    score += fresh;
    // Profondeur HONNÊTE : le total du site est connu et notre échantillon le
    // couvre (≥ 10, ou tout le marché quand il est plus petit — un vide
    // prouvé par le site est honnête, pas douteux : « PHEV 2025 GT line
    // ≥ 250 ch : 0 » est la vérité, constat Sportage 05/09).
    const depth = !snap ? 0
      : snap.listing_count == null ? (snap.sample_size > 0 ? 10 : 0)
      : (snap.sample_size >= 10 || snap.sample_size >= snap.listing_count) ? 20
      : snap.sample_size > 0 ? 10 : 0;
    comp.profondeur = { total_site: snap?.listing_count ?? null, echantillon: snap?.sample_size ?? 0, points: depth };
    score += depth;
    // URL complète : les critères de l'étude sont-ils tous exprimés ?
    const url = await genUrl(seg.site, studyParams(seg.study, seg.site, seg.side));
    const missing = url ? missingUrlCriteria(url, studyParams(seg.study, seg.site, seg.side)) : ['aucune URL'];
    const urlPts = !url ? 0 : Math.max(0, 20 - 5 * missing.length);
    comp.url = { manquants: missing, points: urlPts };
    score += urlPts;
    // Dossiers ouverts.
    const od = openBy.get(`${seg.site}|${seg.country}|${brandKey(seg.brand)}|${refModelKey(seg.brand, seg.model)}`);
    const dossierPts = od ? -Math.min(30, 15 * od.n) - (od.dict ? 10 : 0) : 15;
    comp.dossiers = { ouverts: od?.n ?? 0, dictionnaire: od?.dict ?? false, points: dossierPts };
    score += dossierPts;
    // Cohérence inter-sites (même pays, même segment) : médiane vs autres.
    const mine = medRows.find((r) => r.site === seg.site && r.country === seg.country && brandKey(r.brand_label) === brandKey(seg.brand) && refModelKey(r.brand_label, r.model_label) === refModelKey(seg.brand, seg.model));
    const others = medRows.filter((r) => r.site !== seg.site && r.country === seg.country && brandKey(r.brand_label) === brandKey(seg.brand) && refModelKey(r.brand_label, r.model_label) === refModelKey(seg.brand, seg.model) && r.median);
    let coh = 15;
    if (mine?.median && others.length > 0) {
      const ref = others.reduce((s, r) => s + (r.median ?? 0), 0) / others.length;
      const gap = Math.abs(mine.median - ref) / ref;
      coh = gap > 0.35 ? -15 : gap > 0.2 ? 0 : 15;
      comp.coherence = { mediane: mine.median, pays: Math.round(ref), ecart_pct: Math.round(gap * 100), points: coh };
    } else comp.coherence = { points: coh, note: others.length === 0 ? 'seul site du pays sur ce segment' : 'pas de médiane' };
    score += coh;
    score = Math.max(0, Math.min(100, score));
    rows.push({
      site: seg.site, country: seg.country, brand: seg.brand, model: seg.model,
      score, label: score >= 75 ? 'fiable' : score >= 45 ? 'a_surveiller' : 'douteux',
      components: comp, computed_at: new Date().toISOString(),
    });
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from('truth_confidence').upsert(rows.slice(i, i + 200), { onConflict: 'site,country,brand,model' });
    if (error) { console.warn('[TRUTH_CONF] upsert :', error.message); break; }
  }
  const doubtful = rows.filter((r) => r.label === 'douteux').length;
  console.warn(`[TRUTH_CONF] ${rows.length} segment(s) notés (${reason}) — ${doubtful} douteux`);
  return rows.length;
}

// ═══ 4. CAS DORÉS ═════════════════════════════════════════════════════════════

const GOLDEN_VALUES: Array<{ criterion: string; label: string; extra: Record<string, unknown>; distinctFrom?: Record<string, unknown> }> = [
  { criterion: 'année', label: 'Année 2022–2024', extra: { yearFrom: '2022', yearTo: '2024' } },
  { criterion: 'km', label: 'Km ≤ 90 000', extra: { mileage: 90000 } },
  { criterion: 'carburant', label: 'Essence', extra: { fuel: 'ESSENCE' } },
  { criterion: 'carburant', label: 'Diesel', extra: { fuel: 'DIESEL' } },
  { criterion: 'carburant', label: 'Hybride', extra: { fuel: 'HYBRIDE' } },
  { criterion: 'carburant', label: 'Hybride rechargeable', extra: { fuel: 'PLUG_IN_HYBRID' }, distinctFrom: { fuel: 'HYBRIDE' } },
  { criterion: 'carburant', label: 'Électrique', extra: { fuel: 'ELECTRIQUE' } },
  { criterion: 'carburant', label: 'GPL', extra: { fuel: 'GPL' } },
  { criterion: 'boîte', label: 'Automatique', extra: { gearbox: 'AUTOMATIQUE' } },
  { criterion: 'boîte', label: 'Manuelle', extra: { gearbox: 'MANUELLE' } },
  { criterion: 'puissance', label: 'Puissance ≥ 150 ch', extra: { minPower: 150 } },
  { criterion: 'finition', label: 'Finition « GR Sport »', extra: { trim: 'GR Sport' } },
  ...['suv', 'berline', 'break', 'citadine', 'monospace', 'coupe', 'cabriolet', 'societe'].map((v) => ({ criterion: 'carrosserie', label: `Carrosserie ${v}`, extra: { vehicleType: v } })),
];

/** Évalue un cas : l'URL générée doit CHANGER quand la valeur est posée (et
 *  différer de la famille pour un sous-type) — même preuve que la Bibliothèque. */
async function evaluateGolden(site: string, params: Record<string, unknown>, criterion: string): Promise<{ pass: boolean; url: string | null; detail: string }> {
  const { extra, distinctFrom, ...base } = params as { extra: Record<string, unknown>; distinctFrom?: Record<string, unknown>; brand: string; model?: string };
  const ref = await genUrl(site, base);
  const url = await genUrl(site, { ...base, ...extra });
  if (!url) return { pass: false, url, detail: 'aucune URL générée' };
  let changed = !!ref && url !== ref;
  if (changed && distinctFrom) { const fam = await genUrl(site, { ...base, ...distinctFrom }); changed = !!fam && url !== fam; }
  const detected = !!CRITERIA_DETECTORS[criterion]?.test(url);
  const pass = changed || (detected && !ref);
  return { pass, url, detail: pass ? 'valeur posée dans l’URL' : `la valeur ne change plus l’URL (${ref ? 'identique à la base' : 'base introuvable'})` };
}

export async function runGolden(reason: string): Promise<{ total: number; failed: number }> {
  const { data: existing } = await sb.from('truth_golden').select('id,site,params,criterion,label');
  const cases = (existing ?? []) as Array<{ id: string; site: string; params: Record<string, unknown>; criterion: string; label: string }>;
  // Premier passage : figer l'état PROUVÉ d'aujourd'hui (marque seule, une
  // marque connue de la mémoire du site sinon Toyota).
  if (cases.length === 0) {
    const seeds: Array<Record<string, unknown>> = [];
    for (const a of allSiteAdapters()) {
      const site = String(a.key);
      const { data: mem } = await sb.from('linkgen_mapping_memory').select('brand').eq('site', site).eq('validation_status', 'valid').order('updated_at', { ascending: false }).limit(1);
      const brand = String((mem?.[0] as { brand?: string } | undefined)?.brand ?? 'TOYOTA');
      for (const v of GOLDEN_VALUES) {
        const params = { brand, model: '', extra: v.extra, ...(v.distinctFrom ? { distinctFrom: v.distinctFrom } : {}) };
        const r = await evaluateGolden(site, params, v.criterion);
        if (r.pass) seeds.push({ site, label: v.label, params, criterion: v.criterion, source: 'auto', created_by: ENGINE, last_run_at: new Date().toISOString(), last_status: 'pass', last_url: r.url, last_detail: 'figé au premier passage' });
      }
    }
    if (seeds.length) { const { error } = await sb.from('truth_golden').insert(seeds); if (error) console.warn('[TRUTH_GOLDEN] seed :', error.message); }
    console.warn(`[TRUTH_GOLDEN] premier passage : ${seeds.length} cas doré(s) figé(s) (${reason})`);
    return { total: seeds.length, failed: 0 };
  }
  let failed = 0;
  for (const c of cases) {
    const r = await evaluateGolden(c.site, c.params, c.criterion);
    if (!r.pass) failed += 1;
    await sb.from('truth_golden').update({ last_run_at: new Date().toISOString(), last_status: r.pass ? 'pass' : 'fail', last_url: r.url, last_detail: r.detail }).eq('id', c.id);
    if (!r.pass) {
      // Régression de grammaire → dossier (statut existant jamais écrasé).
      await sb.from('truth_dossiers').upsert({
        site: c.site, country: '', brand: String((c.params as { brand?: string }).brand ?? ''), model: '', fuel: '',
        signal: 'golden_fail', layer: 'grammaire', doubt_score: 90, priority: 0,
        summary: `Cas doré en échec : ${c.label} — ${r.detail}`,
        details: { golden_id: c.id, criterion: c.criterion, url: r.url, diagnosed_by: ENGINE },
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'site,country,brand,model,fuel,signal', ignoreDuplicates: false });
    }
  }
  console.warn(`[TRUTH_GOLDEN] ${cases.length} cas rejoué(s) (${reason}) — ${failed} en échec`);
  return { total: cases.length, failed };
}

// ═══ 3b. ROUTINE DU MATIN ═════════════════════════════════════════════════════

export async function runDigest(reason: string): Promise<void> {
  const day = parisDay();
  const since = `${day}T00:00:00+02:00`;
  const q = async (table: string, build: (b: any) => any) => { const { data } = await build(sb.from(table)); return (data ?? []) as Array<Record<string, any>>; };

  const studies = await q('daily_searches', (b) => b.select('id,label,brand,model,active,last_run_at,source_country,target_country').eq('active', true));
  const passed = studies.filter((s) => s.last_run_at && parisDay(new Date(s.last_run_at)) === day);
  const hits = await q('daily_search_hits', (b) => b.select('kind,status,price_gap,site,first_seen_at,last_seen_at,search_id').gte('first_seen_at', since));
  const drops = await q('daily_search_hits', (b) => b.select('id').eq('kind', 'price_drop').gte('last_seen_at', since));
  const newDossiers = await q('truth_dossiers', (b) => b.select('site,brand,model,signal,summary').gte('first_detected_at', since));
  const resolved = await q('truth_dossiers', (b) => b.select('site,brand,model,signal').gte('resolved_at', since));
  const open = await q('truth_dossiers', (b) => b.select('id,signal').is('resolved_at', null));
  const doubtful = await q('truth_confidence', (b) => b.select('site,country,brand,model,score,components').eq('label', 'douteux').order('score', { ascending: true }).limit(15));
  const golden = await q('truth_golden', (b) => b.select('site,label,last_status,last_detail').eq('last_status', 'fail'));
  const logs = await q('worker_logs', (b) => b.select('message').gte('created_at', since).limit(3000));
  const zyte = logs.filter((l) => /Zyte API error/.test(l.message)).length;
  const blocked = logs.filter((l) => /Blocked:|page de blocage/.test(l.message)).length;
  const legalFail = logs.filter((l) => /LEGAL_WATCH\].*(échec|credit)/.test(l.message)).length;
  const taxo = await q('linkgen_enum_mappings', (b) => b.select('site').gte('created_at', since).limit(2000));
  const taxoBySite: Record<string, number> = {};
  for (const t of taxo) taxoBySite[t.site] = (taxoBySite[t.site] ?? 0) + 1;

  const payload = {
    etudes: { actives: studies.length, passees: passed.length, non_passees: studies.filter((s) => !passed.includes(s)).map((s) => s.label || `${s.brand} ${s.model ?? ''}`.trim()) },
    annonces: { nouvelles: hits.filter((h) => h.kind === 'new').length, baisses: drops.length, par_site: hits.reduce((acc, h) => { acc[h.site] = (acc[h.site] ?? 0) + 1; return acc; }, {} as Record<string, number>) },
    dossiers: { ouverts: open.length, nouveaux: newDossiers.map((d) => `${d.brand} ${d.model} · ${d.site} · ${d.signal}`), resolus: resolved.length },
    segments_douteux: doubtful.map((d) => ({ segment: `${d.brand} ${d.model} · ${d.site} ${d.country}`, score: d.score })),
    cas_dores_en_echec: golden.map((g) => `${g.site} · ${g.label} — ${g.last_detail}`),
    sites: { erreurs_zyte: zyte, pages_bloquees: blocked },
    taxonomie_apprise: taxoBySite,
    veille_legale: legalFail > 0 ? `${legalFail} échec(s) (crédits API ?)` : 'ok',
  };
  const summary = [
    `${passed.length}/${studies.length} études passées`,
    `${payload.annonces.nouvelles} nouvelle(s) annonce(s), ${drops.length} baisse(s)`,
    `${open.length} dossier(s) ouvert(s) (+${newDossiers.length}, −${resolved.length})`,
    `${doubtful.length} segment(s) douteux`,
    golden.length ? `${golden.length} cas doré(s) EN ÉCHEC` : 'cas dorés OK',
    zyte + blocked ? `${zyte} erreur(s) Zyte, ${blocked} blocage(s)` : 'sites OK',
  ].join(' · ');
  const { error } = await sb.from('truth_digests').upsert({ day, generated_at: new Date().toISOString(), summary, payload }, { onConflict: 'day' });
  if (error) console.warn('[TRUTH_DIGEST] :', error.message);
  else console.warn(`[TRUTH_DIGEST] ${day} (${reason}) : ${summary}`);
}

/** Enchaînement de fin de vague : badge → cas dorés → digest. Fail-open. */
export async function runTruthLoop(reason: string): Promise<void> {
  try { await runConfidence(reason); } catch (e) { console.warn('[TRUTH_CONF] échec :', e instanceof Error ? e.message : e); }
  try { await runGolden(reason); } catch (e) { console.warn('[TRUTH_GOLDEN] échec :', e instanceof Error ? e.message : e); }
  try { await runDigest(reason); } catch (e) { console.warn('[TRUTH_DIGEST] échec :', e instanceof Error ? e.message : e); }
}
