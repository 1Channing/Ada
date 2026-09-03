import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Filter, Loader2, Link2, AlertTriangle, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { allSiteAdapters, findSiteAdapterByDomain } from '../lib/study-core/marketplaces';
import type { SiteKey } from '../lib/study-core/marketplaces';
import { generateSearchUrlsWithMemory } from '../lib/linkgen/generator';
import { CRITERIA_DETECTORS } from '../lib/linkgen/grammar';
import { getRefWindowsCached, type RefWindowMap } from '../services/vehicleRef';
import { brandKey } from '../services/marketData';

/**
 * BIBLIOTHÈQUE (GO Channing 03/09) — remplace « Lacunes assumées ».
 * Entrer dans le savoir d'UN site et voir, à plat, ce qu'il sait et ce qu'il
 * ne sait pas — indépendamment des études — puis combler le trou à l'endroit
 * même où on le voit (coller l'URL humaine → ADA apprend).
 *
 * La RÉFÉRENCE n'est pas un site (La Centrale a la grammaire la plus complète
 * mais le dictionnaire le plus pauvre) : c'est le canon ADA lui-même —
 *  1. le registre des CRITÈRES : chaque critère est évalué EN DIRECT en
 *     générant l'URL du site avec ce critère posé et en lisant l'URL produite
 *     (même détecteurs que la profondeur conditionnelle du worker) — natif /
 *     post-filtre (le worker trie après) / absent ;
 *  2. le RÉFÉRENTIEL constructeur (marques, modèles) croisé avec le
 *     dictionnaire moissonné du site, filtrable « Recherche active » ;
 *  3. la SANTÉ du savoir : dictionnaire, mémoire d'URLs, dernière moisson.
 * Une grammaire proposée par URL collée reste « en attente de preuve » tant
 * qu'un scrape chiffré ne l'a pas confirmée (point 1 acté par Channing).
 */

interface StudyLike { brand: string; model: string | null; source_country: string; target_country: string; active?: boolean }

interface DictRow { field: string; code: string; label: string; updated_at: string }
interface MemoryRow { brand: string; model: string; validation_status: string; updated_at: string }

// Champ « marque » et forme du code « modèle » (marque;… ou MARQUE_…) par site —
// conventions RÉELLES des dictionnaires (inventaire base 03/09).
const BRAND_FIELD: Record<string, string> = {
  LEBONCOIN: 'u_car_brand', LACENTRALE: 'lc:make', MOBILE_DE: 'ms:make', GASPEDAAL: 'gp:brand',
  BILBASEN: 'bb:filter:Make', BLOCKET: 'bl:brand', SUBITO: 'sb:brand', JOFOGAS: 'jf:brand',
};
const MODEL_FIELD_PREFIX: Record<string, string> = {
  LEBONCOIN: 'u_car_model', LACENTRALE: 'lc:model:', MOBILE_DE: 'ms:model', MARKTPLAATS: 'model_facet',
  GASPEDAAL: 'gp:model:', BILBASEN: 'bb:model', BLOCKET: 'bl:model:', SUBITO: 'sb:model:', JOFOGAS: 'jf:model:',
};
const siteFamily = (key: string) => (key.startsWith('AUTOSCOUT') ? 'AUTOSCOUT' : key);

// Critères du canon ADA + comment le worker les couvre quand le site ne les
// pose pas nativement (post-filtres durs prouvés : boîte, carrosserie,
// puissance, finition sur le titre).
const CANON: Array<{ key: string; label: string; postFilter: boolean; hint: string }> = [
  { key: 'année', label: 'Année (min–max)', postFilter: false, hint: 'fregfrom/regdate/bmin…' },
  { key: 'km', label: 'Kilométrage max', postFilter: false, hint: 'kmto/mileage/kmax…' },
  { key: 'carburant', label: 'Carburant', postFilter: false, hint: 'fuel/energies/hybride…' },
  { key: 'rechargeable', label: 'Hybride rechargeable (sous-type)', postFilter: true, hint: 'fuel=8, facette 13956, plug_hyb — sinon famille hybride + tri par titre' },
  { key: 'boîte', label: 'Boîte automatique', postFilter: true, hint: 'gear=A/gearbox=2… — sinon post-filtre dur' },
  { key: 'puissance', label: 'Puissance min', postFilter: true, hint: 'powerfrom/pw/horse_power_din… — sinon post-filtre' },
  { key: 'finition', label: 'Finition (texte)', postFilter: true, hint: 'kwd/trefw/versions/text… — sinon filtre sur le titre' },
  { key: 'carrosserie', label: 'Carrosserie (8 types LBC)', postFilter: true, hint: 'vehicle_type/body/categories/crs… — sinon post-filtre dur' },
  { key: 'société', label: 'Véhicule société', postFilter: true, hint: 'voituresociete/80/bedrijfswagen — sinon post-filtre' },
];
type Status = 'natif' | 'post-filtre' | 'absent';

export function SiteLibrary({ studies }: { studies: StudyLike[] }) {
  const sites = useMemo(() => allSiteAdapters()
    .map((a) => ({ key: String(a.key), name: a.displayName, country: a.countryCode, domain: a.domain }))
    .sort((x, y) => x.country.localeCompare(y.country) || x.name.localeCompare(y.name)), []);
  const [siteKey, setSiteKey] = useState<string>(sites[0]?.key ?? '');
  const site = sites.find((s) => s.key === siteKey) ?? sites[0];

  const [dict, setDict] = useState<DictRow[] | null>(null);
  const [memory, setMemory] = useState<MemoryRow[] | null>(null);
  const [registry, setRegistry] = useState<Array<{ key: string; status: Status; url: string | null }> | null>(null);
  const [ref, setRef] = useState<RefWindowMap | null>(null);
  const [activeOnly, setActiveOnly] = useState(true);
  const [openBrand, setOpenBrand] = useState<string | null>(null);

  useEffect(() => { getRefWindowsCached().then(setRef).catch(() => setRef(new Map())); }, []);

  // ── Chargement par site : dictionnaire (paginé), mémoire, registre ──
  useEffect(() => {
    if (!site) return;
    let cancelled = false;
    setDict(null); setMemory(null); setRegistry(null); setOpenBrand(null);
    (async () => {
      const rows: DictRow[] = [];
      for (let from = 0; from < 6000; from += 1000) {
        const { data } = await supabase.from('linkgen_enum_mappings')
          .select('field, code, label, updated_at').eq('site', site.key).range(from, from + 999);
        if (!data || data.length === 0) break;
        rows.push(...(data as DictRow[]));
        if (data.length < 1000) break;
      }
      if (cancelled) return;
      setDict(rows);
      const { data: mem } = await supabase.from('linkgen_mapping_memory')
        .select('brand, model, validation_status, updated_at').eq('site', site.key)
        .order('updated_at', { ascending: false }).limit(500);
      if (cancelled) return;
      setMemory((mem ?? []) as MemoryRow[]);
      // Support d'évaluation : une marque/modèle que le site CONNAÎT (mémoire
      // d'abord, sinon une étude active du pays, sinon Toyota seule).
      const seed = (mem?.[0] as MemoryRow | undefined)
        ?? studies.find((s) => s.source_country === site.country || s.target_country === site.country)
        ?? { brand: 'TOYOTA', model: '' };
      setRegistry(await evaluateRegistry(site.key as SiteKey, seed.brand, seed.model ?? ''));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.key]);

  // ── Marques / modèles : dictionnaire ↔ référentiel ──
  const learned = useMemo(() => {
    const brands = new Map<string, string>();          // brandKey → label
    const models = new Map<string, Set<string>>();     // brandKey → modelKeys (softs)
    if (!dict || !site) return { brands, models };
    const fam = siteFamily(site.key);
    const bf = BRAND_FIELD[fam] ?? (fam === 'AUTOSCOUT' ? 'as:make' : '');
    const mp = MODEL_FIELD_PREFIX[fam] ?? (fam === 'AUTOSCOUT' ? 'as:model' : '');
    // Codes marque → label (mobile.de / AutoScout encodent le modèle par id de marque).
    const brandById = new Map<string, string>();
    for (const r of dict) {
      if (bf && r.field === bf) { brands.set(brandKey(r.label), r.label); brandById.set(r.code, r.label); }
    }
    for (const r of dict) {
      if (!mp) continue;
      let brandLabel: string | null = null;
      if (mp.endsWith(':')) { if (!r.field.startsWith(mp)) continue; brandLabel = r.field.slice(mp.length); }
      else if (r.field === mp) {
        // « audi;100;563 » / « aiways;u5 » / « 1100;14 » (id) / « ALFA ROMEO_Junior »
        const semi = r.code.split(';')[0];
        brandLabel = r.code.includes(';') ? (brandById.get(semi) ?? semi) : r.code.split('_')[0];
      } else continue;
      if (!brandLabel) continue;
      const bk = brandKey(brandLabel);
      if (!brands.has(bk)) brands.set(bk, brandLabel);
      (models.get(bk) ?? models.set(bk, new Set()).get(bk)!).add(soft(r.label));
    }
    return { brands, models };
  }, [dict, site]);

  const activeBrands = useMemo(() => new Set(studies.filter((s) => s.active !== false).map((s) => brandKey(s.brand))), [studies]);
  const activeModels = useMemo(() => new Set(studies.filter((s) => s.active !== false && s.model).map((s) => `${brandKey(s.brand)}|${soft(s.model!)}`)), [studies]);

  const refBrands = useMemo(() => {
    const out = new Map<string, { label: string; models: Map<string, string> }>();
    if (!ref) return out;
    for (const [k, w] of ref) {
      const bk = k.split('|')[0];
      const e = out.get(bk) ?? out.set(bk, { label: w.brandLabel, models: new Map() }).get(bk)!;
      e.models.set(soft(w.modelLabel), w.modelLabel);
    }
    return out;
  }, [ref]);

  const brandRows = useMemo(() => {
    const keys = new Set<string>([...refBrands.keys(), ...learned.brands.keys()]);
    return [...keys]
      .filter((bk) => !activeOnly || activeBrands.has(bk))
      .map((bk) => {
        const label = refBrands.get(bk)?.label ?? learned.brands.get(bk) ?? bk;
        const refModels = refBrands.get(bk)?.models ?? new Map<string, string>();
        const got = learned.models.get(bk) ?? new Set<string>();
        const wanted = [...refModels.keys()].filter((m) => !activeOnly || activeModels.has(`${bk}|${m}`));
        const missing = wanted.filter((m) => !got.has(m));
        return { bk, label, known: learned.brands.has(bk) || got.size > 0, got, refModels, wanted, missing };
      })
      .sort((a, b) => Number(b.missing.length > 0) - Number(a.missing.length > 0) || a.label.localeCompare(b.label));
  }, [refBrands, learned, activeOnly, activeBrands, activeModels]);

  const lastHarvest = dict?.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '') || null;
  const memStats = (memory ?? []).reduce((acc, m) => { acc[m.validation_status] = (acc[m.validation_status] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  if (!site) return <p className="text-sm text-slate-500 py-8 text-center">Aucun site enregistré.</p>;

  return (
    <div className="space-y-5">
      {/* ── Sélecteur de site ── */}
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="w-5 h-5 text-emerald-600" />
        <select value={siteKey} onChange={(e) => setSiteKey(e.target.value)} className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
          {sites.map((s) => <option key={s.key} value={s.key}>{s.country} · {s.name}</option>)}
        </select>
        <span className="text-xs text-slate-500">{site.domain}</span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          <Filter className="w-3.5 h-3.5" /> Recherche active seulement
        </label>
      </div>

      {/* ── 3. Santé du savoir (en tête : la jauge d'un coup d'œil) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Entrées de dictionnaire" value={dict ? String(dict.length) : '…'} hint={lastHarvest ? `dernière moisson ${new Date(lastHarvest).toLocaleDateString('fr-FR')}` : 'jamais moissonné'} />
        <Kpi label="Marques apprises" value={dict ? String(learned.brands.size) : '…'} hint={`référentiel : ${refBrands.size}`} />
        <Kpi label="URLs humaines en mémoire" value={memory ? String(memory.length) : '…'} hint={memory ? Object.entries(memStats).map(([k, n]) => `${n} ${k}`).join(' · ') || '—' : ''} />
        <Kpi label="Critères natifs" value={registry ? `${registry.filter((r) => r.status === 'natif').length}/${CANON.length}` : '…'} hint={registry ? `${registry.filter((r) => r.status === 'post-filtre').length} post-filtre · ${registry.filter((r) => r.status === 'absent').length} absent` : ''} />
      </div>

      {/* ── 1. Registre des critères ── */}
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Registre des critères</h3>
        <p className="text-xs text-slate-500 mb-3">Évalué en direct : ADA génère l'URL de ce site avec chaque critère posé et lit l'URL produite. <b>Natif</b> = le site filtre lui-même · <b>Post-filtre</b> = le site ne sait pas, ADA trie après le scrape (page plus large, profondeur réduite) · <b>Absent</b> = le critère est perdu.</p>
        {!registry ? <p className="text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> génération…</p> : (
          <ul className="divide-y divide-slate-100">
            {CANON.map((c) => {
              const r = registry.find((x) => x.key === c.key);
              const st: Status = r?.status ?? 'absent';
              return (
                <li key={c.key} className="py-2 flex items-center gap-3 text-sm">
                  <StatusPill status={st} />
                  <span className="text-slate-800 w-56 shrink-0">{c.label}</span>
                  <span className="text-xs text-slate-400 truncate flex-1">{c.hint}</span>
                  {r?.url && st === 'natif' && (
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-brand-ocean hover:underline shrink-0">voir l'URL</a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <TeachUrl site={site} onLearned={() => setSiteKey((k) => k)} label="Le site sait filtrer un critère marqué post-filtre ou absent ? Colle une URL humaine qui porte ce filtre — ADA en apprend la forme." />
      </section>

      {/* ── 2. Marques / modèles ── */}
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Marques et modèles</h3>
        <p className="text-xs text-slate-500 mb-3">
          Référentiel constructeur ↔ dictionnaire moissonné du site.{activeOnly ? ' Limité aux marques et modèles des études quotidiennes actives (« Recherche active »).' : ' Tout le référentiel.'}
          {siteFamily(site.key) === 'SKELBIU' && ' Skelbiu : recherche par mots-clés, pas de dictionnaire de modèles — rien à apprendre ici.'}
          {siteFamily(site.key) === 'MARKTPLAATS' && ' Marktplaats : la marque vit dans le chemin (jamais moissonnée), seuls les modèles sont appris.'}
        </p>
        {!dict || !ref ? <p className="text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> chargement…</p> : brandRows.length === 0 ? (
          <p className="text-xs text-slate-400">Aucune marque{activeOnly ? ' en recherche active' : ''}.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {brandRows.map((b) => {
              const open = openBrand === b.bk;
              return (
                <li key={b.bk} className="py-1.5">
                  <button onClick={() => setOpenBrand(open ? null : b.bk)} className="w-full flex items-center gap-2 text-left text-sm">
                    <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span className="font-medium text-slate-800">{b.label}</span>
                    {!b.known && <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5">marque inconnue du site</span>}
                    <span className="ml-auto text-xs text-slate-500">
                      {b.got.size} modèle{b.got.size > 1 ? 's' : ''} appris
                      {b.missing.length > 0 && <span className="text-amber-700"> · {b.missing.length} manquant{b.missing.length > 1 ? 's' : ''}</span>}
                    </span>
                  </button>
                  {open && (
                    <div className="ml-6 mt-1.5 mb-1 grid md:grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-slate-500 mb-1">Appris sur le site ({b.got.size})</p>
                        <p className="text-slate-700 leading-5">{[...b.got].sort().join(' · ') || '—'}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 mb-1">Manquants vs référentiel ({b.missing.length}{activeOnly ? ', recherche active' : ''})</p>
                        <p className="text-amber-800 leading-5">{b.missing.map((m) => b.refModels.get(m) ?? m).sort().join(' · ') || '— rien à combler'}</p>
                        {b.missing.length > 0 && <p className="text-slate-400 mt-1">Remède : colle ci-dessous l'URL humaine d'une recherche {b.label} de ce modèle — ADA apprend le slug.</p>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <TeachUrl site={site} onLearned={() => setSiteKey((k) => k)} label="Un modèle manque ? Colle l'URL humaine de sa recherche sur ce site (marque + modèle) — ADA moissonne la page et apprend le slug." />
      </section>
    </div>
  );
}

// ─── Évaluation dynamique du registre ────────────────────────────────────────

async function evaluateRegistry(site: SiteKey, brand: string, model: string) {
  const base = { selectedSites: [site], brand, model };
  const gen = async (extra: Record<string, unknown>) => {
    try {
      const g = await generateSearchUrlsWithMemory({ ...base, ...extra } as never);
      return g[0]?.url && g[0].url.length > 10 ? g[0].url : null;
    } catch { return null; }
  };
  const out: Array<{ key: string; status: Status; url: string | null }> = [];
  const test = async (key: string, extra: Record<string, unknown>, detector: string, postFilter: boolean) => {
    const url = await gen(extra);
    const native = !!url && CRITERIA_DETECTORS[detector]?.test(url);
    out.push({ key, status: native ? 'natif' : postFilter ? 'post-filtre' : 'absent', url });
  };
  await test('année', { yearFrom: '2022', yearTo: '2024' }, 'année', false);
  await test('km', { mileage: 90000 }, 'km', false);
  await test('carburant', { fuel: 'HYBRIDE' }, 'carburant', false);
  // Rechargeable : natif seulement si l'URL PLUG_IN diffère de l'URL HYBRIDE.
  const hyb = await gen({ fuel: 'HYBRIDE' });
  const phev = await gen({ fuel: 'PLUG_IN_HYBRID' });
  out.push({ key: 'rechargeable', status: hyb && phev && hyb !== phev ? 'natif' : 'post-filtre', url: phev });
  await test('boîte', { gearbox: 'AUTOMATIQUE' }, 'boîte', true);
  await test('puissance', { minPower: 150 }, 'puissance', true);
  await test('finition', { trim: 'GR Sport' }, 'finition', true);
  await test('carrosserie', { vehicleType: 'suv' }, 'carrosserie', true);
  await test('société', { vehicleType: 'societe' }, 'carrosserie', true);
  return out;
}

// ─── Geste : coller une URL humaine → ADA apprend ─────────────────────────────

function TeachUrl({ site, onLearned, label }: { site: { key: string; domain: string; country: string }; onLearned: () => void; label: string }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  const teach = async () => {
    const u = url.trim();
    if (!u.startsWith('http')) { setMsg({ kind: 'err', text: "Colle l'URL complète (https://…)" }); return; }
    const adapter = findSiteAdapterByDomain(u);
    if (!adapter || String(adapter.key) !== site.key) {
      setMsg({ kind: 'err', text: `Cette URL n'est pas une URL ${site.domain} — la bibliothèque ouverte est celle de ce site.` });
      return;
    }
    // Les critères que l'URL EXPRIME, relus par l'adaptateur (jamais devinés) :
    // c'est ce que l'ingestion confirmera contre les annonces.
    const pre = adapter.prefillCriteriaFromUrl?.(u) ?? {};
    if (!pre.brand) { setMsg({ kind: 'err', text: "ADA ne lit pas de marque dans cette URL — colle une recherche marque (+ modèle) du site." }); return; }
    setBusy(true); setMsg(null);
    try {
      const start = await supabase.functions.invoke('ingest-url', {
        body: { url: u, async: true, criteria: { model: '', ...pre }, submittedBy: 'Bibliothèque' },
      });
      if (start.error) throw new Error(start.error.message);
      const jobId = (start.data as { jobId?: string } | null)?.jobId;
      if (!jobId) throw new Error('worker sans mode job');
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const poll = await supabase.functions.invoke('ingest-url', { body: { jobId } });
        const d = poll.data as { jobStatus?: string; message?: string; listings?: unknown[]; taxonomyLearned?: unknown[]; persistOutcome?: { memoryAction?: string } } | null;
        if (d?.jobStatus === 'running') continue;
        if (d?.jobStatus === 'error') throw new Error(d.message ?? 'scrape en échec');
        const n = d?.listings?.length ?? 0;
        const learned = Array.isArray(d?.taxonomyLearned) ? d!.taxonomyLearned!.length : 0;
        const mem = d?.persistOutcome?.memoryAction ?? '—';
        setMsg({
          kind: n > 0 ? 'ok' : 'warn',
          text: n > 0
            ? `${n} annonce(s) lue(s), ${learned} entrée(s) de dictionnaire apprise(s), mémoire : ${mem}. Grammaire PROPOSÉE — elle devient native quand une étude chiffrée la confirme (gate).`
            : `Page lue mais 0 annonce — rien appris (URL trop stricte, ou page servie sans résultats). Vérifie l'URL dans ton navigateur.`,
        });
        onLearned();
        return;
      }
      throw new Error('Délai dépassé (10 min)');
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-xs text-slate-500 mb-1.5">{label}</p>
      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`https://${site.domain}/…`} className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <button onClick={() => void teach()} disabled={busy || !url.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Apprendre
        </button>
      </div>
      {msg && (
        <p className={`text-xs mt-2 rounded-lg px-3 py-2 border ${msg.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : msg.kind === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{msg.text}</p>
      )}
    </div>
  );
}

// ─── Petits rendus ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: Status }) {
  if (status === 'natif') return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 w-24 justify-center shrink-0"><CheckCircle2 className="w-3 h-3" /> natif</span>;
  if (status === 'post-filtre') return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 w-24 justify-center shrink-0"><Filter className="w-3 h-3" /> post-filtre</span>;
  return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5 w-24 justify-center shrink-0"><AlertTriangle className="w-3 h-3" /> absent</span>;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="text-lg font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
      {hint && <div className="text-[10px] text-slate-400 mt-0.5 truncate" title={hint}>{hint}</div>}
    </div>
  );
}

const soft = (v: string) => v.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
