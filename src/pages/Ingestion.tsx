import { useState, useEffect } from 'react';
import { Upload, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { findSiteAdapterByDomain, decomposeUrl } from '../lib/study-core/marketplaces';
import type { SiteAdapter, SearchCriteria } from '../lib/study-core/marketplaces';
import { analyzeIngestion, INGESTION_MIN_SAMPLE, INGESTION_CONFIRM_THRESHOLD } from '../lib/study-core/ingestion';
import { collectCandidateSegments, prefillFromSegments } from '../lib/study-core/marketplaces/paramDictionary';
import type { IngestionAnalysis } from '../lib/study-core/ingestion';
import { persistIngestionResult, loadLearnedEnums } from '../lib/linkgen/ingestion';
import { ensureLearnedTaxonomy } from '../lib/linkgen/taxonomy';
import type { PersistIngestionOutcome } from '../lib/linkgen/ingestion';
import { loadContributorNames } from '../services/ingestionHistory';
import { writeMarketSnapshot } from '../services/marketData';
import type { ScrapedListing } from '../lib/study-core/types';

const FUEL_OPTIONS = [
  { value: '', label: '— non filtré —' },
  { value: 'ESSENCE', label: 'Essence' },
  { value: 'DIESEL', label: 'Diesel' },
  { value: 'HYBRIDE', label: 'Hybride (complet)' },
  { value: 'MILD_HYBRID', label: 'Hybride léger (MHEV)' },
  { value: 'PLUG_IN_HYBRID', label: 'Hybride rechargeable' },
  { value: 'ELECTRIQUE', label: 'Électrique' },
  { value: 'HYDROGENE', label: 'Hydrogène' },
  { value: 'GPL', label: 'GPL' },
  { value: 'GNV', label: 'GNV (gaz naturel)' },
];

const FIELD_LABELS: Record<string, string> = {
  brand: 'Marque',
  model: 'Modèle',
  fuel: 'Carburant',
  year: 'Année',
  mileage: 'Kilométrage',
  trim: 'Finition',
  gearbox: 'Boîte de vitesse',
  power: 'Puissance DIN',
  doors: 'Portes',
  seats: 'Places',
  color: 'Couleur',
  vehicleType: 'Type de véhicule',
};

const GEARBOX_OPTIONS = [
  { value: '', label: '— non filtré —' },
  { value: 'Manuelle', label: 'Manuelle' },
  { value: 'Automatique', label: 'Automatique' },
];

// Contributor names remembered on this device, so a typed name is available
// in the dropdown next time without waiting for a DB round-trip / reload.
const LOCAL_NAMES_KEY = 'ada_contributor_names';
function loadLocalNames(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_NAMES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}
function saveLocalName(name: string): void {
  const n = name.trim();
  if (!n) return;
  try {
    const set = new Set(loadLocalNames());
    set.add(n);
    localStorage.setItem(LOCAL_NAMES_KEY, JSON.stringify([...set]));
  } catch { /* ignore quota/privacy-mode errors */ }
}
function mergeNames(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y));
}

// Per-tab working-state snapshot (survives the reload-based navigation).
const INGESTION_SNAPSHOT_KEY = 'ada_ingestion_snapshot';

const MEMORY_ACTION_LABELS: Record<string, { text: string; tone: 'ok' | 'warn' | 'muted' }> = {
  inserted: { text: 'Nouveau mapping enregistré en mémoire (human_verified)', tone: 'ok' },
  reinforced: { text: 'Mapping existant renforcé (confirmation supplémentaire)', tone: 'ok' },
  upgraded_from_csv: { text: 'Mapping CSV existant promu en human_verified', tone: 'ok' },
  conflict_kept_existing: { text: 'Conflit avec un mapping vérifié existant — existant conservé, conflit journalisé', tone: 'warn' },
  none: { text: 'Rien écrit en mémoire (marque + modèle non confirmés tous les deux)', tone: 'muted' },
};

interface FormState {
  brand: string;
  model: string;
  yearFrom: string;
  yearTo: string;
  mileage: string;
  fuel: string;
  trim: string;
  gearbox: string;
  powerFrom: string;
  powerTo: string;
  doors: string;
  seats: string;
  color: string;
  vehicleType: string;
  submittedBy: string;
}

const EMPTY_FORM: FormState = {
  brand: '', model: '', yearFrom: '', yearTo: '', mileage: '', fuel: '', trim: '',
  gearbox: '', powerFrom: '', powerTo: '', doors: '', seats: '', color: '', vehicleType: '',
  submittedBy: '',
};

export function Ingestion({ embedded = false }: { embedded?: boolean } = {}) {
  const [url, setUrl] = useState('');
  const [adapter, setAdapter] = useState<SiteAdapter | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [prefilled, setPrefilled] = useState<string[]>([]);
  const [learned, setLearned] = useState<string[]>([]);
  const [knownNames, setKnownNames] = useState<string[]>([]);

  useEffect(() => {
    // Seed instantly from this device's remembered names, then merge in the
    // names contributed by everyone (from the DB).
    const local = loadLocalNames();
    setKnownNames(local);
    loadContributorNames()
      .then((db) => setKnownNames(mergeNames(local, db)))
      .catch(() => {});
  }, []);

  const rememberName = (name: string) => {
    const n = name.trim();
    if (!n) return;
    saveLocalName(n);
    setKnownNames((prev) => (prev.includes(n) ? prev : mergeNames(prev, [n])));
  };

  // Deep-link support: /ingestion?url=… (campaign gap report's "Corriger"
  // button) pre-fills and analyses the URL immediately.
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('url');
    if (fromQuery) {
      setUrl(fromQuery);
      void handleAnalyzeUrl(fromQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [phase, setPhase] = useState<'idle' | 'form' | 'scraping' | 'done'>('idle');
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [sample, setSample] = useState<ScrapedListing[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, any> | null>(null);
  const [analysis, setAnalysis] = useState<IngestionAnalysis | null>(null);
  const [outcome, setOutcome] = useState<PersistIngestionOutcome | null>(null);
  const [discoveryNote, setDiscoveryNote] = useState<string | null>(null);

  // Persist the in-progress ingestion to sessionStorage so navigating to the
  // History tab (which reloads the page) doesn't wipe the current search /
  // result. sessionStorage is per-tab and purely client-side — zero server
  // involvement, fully isolated between users and even between a user's tabs.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(INGESTION_SNAPSHOT_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.url) setUrl(s.url);
      if (s.form) setForm(s.form);
      if (s.prefilled) setPrefilled(s.prefilled);
      if (s.learned) setLearned(s.learned);
      if (s.sample) setSample(s.sample);
      if (s.analysis) setAnalysis(s.analysis);
      if (s.outcome) setOutcome(s.outcome);
      if (s.scrapeError) setScrapeError(s.scrapeError);
      if (s.url) {
        const a = findSiteAdapterByDomain(s.url);
        if (a) setAdapter(a);
      }
      // An in-flight scrape can't survive a page reload — fall back to the form.
      setPhase(s.phase === 'scraping' ? 'form' : (s.phase ?? 'idle'));
    } catch { /* ignore corrupt snapshot */ }
  }, []);

  useEffect(() => {
    if (phase === 'idle' && !url && !analysis) return; // nothing meaningful yet
    try {
      sessionStorage.setItem(INGESTION_SNAPSHOT_KEY, JSON.stringify({
        url, form, prefilled, learned, phase, scrapeError, sample, analysis, outcome,
      }));
    } catch { /* quota / private mode */ }
  }, [url, form, prefilled, learned, phase, scrapeError, sample, analysis, outcome]);

  const setField = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleAnalyzeUrl = async (overrideUrl?: string) => {
    // Marques/modèles moissonnés → adaptateurs (prefill) : sans ce chargement
    // le navigateur ignore la taxonomie apprise (ms=25200 restait sans marque).
    await ensureLearnedTaxonomy().catch(() => { /* graines seules */ });
    setUrlError(null);
    setAnalysis(null);
    setOutcome(null);
    setScrapeError(null);
    setSample([]);
    setDiagnostics(null);
    setLearned([]);

    const trimmedUrl = (overrideUrl ?? url).trim();
    if (!trimmedUrl) return;

    const found = findSiteAdapterByDomain(trimmedUrl);
    if (!found) {
      setAdapter(null);
      setPhase('idle');
      setUrlError('Marketplace non supporté — sites connus : ' +
        'Leboncoin (FR), Marktplaats (NL), Bilbasen (DK).');
      return;
    }

    const pre = found.prefillCriteriaFromUrl?.(trimmedUrl) ?? {};
    const next: FormState = {
      ...EMPTY_FORM,
      submittedBy: form.submittedBy,
      brand: pre.brand ? String(pre.brand) : '',
      model: pre.model ? String(pre.model) : '',
      yearFrom: pre.yearFrom ? String(pre.yearFrom) : '',
      yearTo: pre.yearTo ? String(pre.yearTo) : '',
      mileage: pre.mileage ? String(pre.mileage) : '',
      fuel: pre.fuel ? String(pre.fuel) : '',
      trim: pre.trim ? String(pre.trim) : '',
      gearbox: pre.gearbox ? String(pre.gearbox) : '',
      powerFrom: pre.powerFrom ? String(pre.powerFrom) : '',
      powerTo: pre.powerTo ? String(pre.powerTo) : '',
      doors: pre.doors ? String(pre.doors) : '',
      seats: pre.seats ? String(pre.seats) : '',
      color: pre.color ? String(pre.color) : '',
      vehicleType: pre.vehicleType ? String(pre.vehicleType) : '',
    };

    // Generic numeric prefill: any unclaimed URL param the dictionary
    // recognises (hpfrom, doorcount…) carries a transparent value — fill the
    // fields the adapter's own prefill left empty.
    const allSegments = collectCandidateSegments(found, trimmedUrl);
    const generic = prefillFromSegments(allSegments);
    for (const [field, value] of Object.entries(generic)) {
      const key = field as keyof FormState;
      if (value && key in next && !next[key]) (next[key] as string) = value;
    }

    // Auto-recognise enum codes we've already learned (gearbox=2 → Automatique)
    // for fields the readable prefill couldn't fill. Best-effort — a lookup
    // failure never blocks the form.
    const learnedFields: string[] = [];
    try {
      const segments = allSegments;
      const learned = await loadLearnedEnums(found.key, segments);
      for (const [field, label] of Object.entries(learned)) {
        if (label && !next[field as keyof FormState]) {
          (next[field as keyof FormState] as string) = label;
          learnedFields.push(field);
        }
      }
    } catch (e) {
      console.warn('[INGESTION] learned-enum prefill failed:', e);
    }

    setAdapter(found);
    setForm(next);
    setPrefilled(Object.entries({
      brand: next.brand, model: next.model, yearFrom: next.yearFrom,
      yearTo: next.yearTo, mileage: next.mileage, fuel: next.fuel, trim: next.trim,
      gearbox: next.gearbox, power: next.powerFrom, doors: next.doors,
      seats: next.seats, color: next.color, vehicleType: next.vehicleType,
    }).filter(([, v]) => v).map(([k]) => k));
    setLearned(learnedFields);
    setPhase('form');
  };

  const handleVerify = async () => {
    if (!adapter) return;
    // Mode DÉCOUVERTE (modèle vide) : on scrape pour apprendre la taxonomie
    // embarquée (mobile.de : marques/modèles des annonces) — AUCUNE écriture
    // mémoire/snapshot, rien de certain à mémoriser au grain marque+modèle.
    const discovery = !form.model.trim();
    setPhase('scraping');
    setScrapeError(null);
    setAnalysis(null);
    setOutcome(null);
    setDiscoveryNote(null);
    // Remember a typed name so it's selectable next time (this device + DB).
    rememberName(form.submittedBy);

    const criteria: SearchCriteria = {
      brand: form.brand.trim(),
      model: form.model.trim(),
      yearFrom: form.yearFrom.trim() || undefined,
      yearTo: form.yearTo.trim() || undefined,
      mileage: form.mileage.trim() || undefined,
      fuel: form.fuel || undefined,
      trim: form.trim.trim() || undefined,
      gearbox: form.gearbox || undefined,
      powerFrom: form.powerFrom.trim() || undefined,
      powerTo: form.powerTo.trim() || undefined,
      doors: form.doors.trim() || undefined,
      seats: form.seats.trim() || undefined,
      color: form.color.trim() || undefined,
      vehicleType: form.vehicleType.trim() || undefined,
    };

    const detectedParams = decomposeUrl(url.trim());

    // Long full-mode scrapes (browser + pagination) outlive HTTP proxy
    // timeouts, so the worker runs them as a JOB: start → poll until done.
    const invokeWithDetail = async (body: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke('ingest-url', { body });
      return { data, error };
    };
    const runIngestJob = async (): Promise<{ data: any; error: any }> => {
      // criteria + submittedBy → the WORKER runs the whole pipeline (analysis,
      // memory/journal retention, market snapshot) server-side: once the job
      // is accepted, closing the browser loses nothing — like a campaign.
      const start = await invokeWithDetail({
        url: url.trim(), async: true,
        criteria, submittedBy: form.submittedBy.trim() || undefined,
      });
      if (start.error) return start;
      const jobId = start.data?.jobId;
      // Older worker without job support answers synchronously — use as-is.
      if (!jobId) return start;
      const DEADLINE = Date.now() + 12 * 60 * 1000;
      while (Date.now() < DEADLINE) {
        await new Promise((r) => setTimeout(r, 4000));
        const poll = await invokeWithDetail({ jobId });
        if (poll.error) return poll;
        if (poll.data?.jobStatus === 'running') continue;
        if (poll.data?.jobStatus === 'error') {
          return { data: null, error: new Error(poll.data?.message ?? 'scrape en échec côté worker') };
        }
        return poll; // done — payload has the same shape as the sync response
      }
      return { data: null, error: new Error('Délai dépassé (12 min) — le scrape tourne peut-être encore côté worker') };
    };

    try {
      const { data, error } = await runIngestJob();

      if (error) {
        // supabase-js reports a useless generic message on non-2xx; the real
        // cause (WORKER_URL missing, worker 404/401, worker_unreachable…) is
        // in the relayed response body. Surface it.
        let detail = error.message ?? 'Edge Function error';
        const ctx = (error as { context?: unknown }).context;
        if (ctx instanceof Response) {
          const status = ctx.status;
          try {
            const body = await ctx.clone().json();
            detail = `[${status}] ${body?.message || body?.error || JSON.stringify(body)}`;
          } catch {
            try {
              const text = await ctx.clone().text();
              if (text) detail = `[${status}] ${text}`;
            } catch { detail = `[${status}] ${detail}`; }
          }
        }
        throw new Error(detail);
      }

      const listings: ScrapedListing[] = data?.listings ?? [];
      const remoteError: string | null = data?.error ?? null;
      const diag = (data?.diagnostics ?? null) as Record<string, any> | null;
      setSample(listings);
      setDiagnostics(diag);

      // The worker already ran the whole pipeline server-side (persisted:true)
      // — the frontend only DISPLAYS; writing again would double every count.
      const serverPersisted = data?.persisted === true;

      if (remoteError && listings.length === 0) {
        setScrapeError(`${remoteError}${data?.errorReason ? ` — ${data.errorReason}` : ''}`);
        if (discovery) { setPhase('done'); return; }
        const persistResult = serverPersisted
          ? (data?.persistOutcome ?? null)
          : await persistIngestionResult({
              url: url.trim(),
              site: adapter.key,
              country: adapter.countryCode,
              criteria,
              analysis: null,
              sampleSize: 0,
              scrapeError: remoteError,
              detectedParams,
              submittedBy: form.submittedBy.trim() || undefined,
              scrapeDiagnostics: diag,
            });
        setOutcome(persistResult);
        setPhase('done');
        return;
      }

      // Découverte : pas d'analyse ni de rétention — la taxonomie a été
      // apprise côté worker pendant le scrape, on affiche le bilan et le
      // sample, c'est tout.
      if (discovery) {
        const learned = Number(data?.taxonomyLearned ?? 0);
        const harvested = Number(data?.taxonomyHarvested ?? 0);
        setDiscoveryNote(
          `Découverte : ${listings.length} annonce(s) scrapée(s) — taxonomie embarquée : ` +
          (harvested > 0
            ? `${harvested} code(s) lu(s), ${learned} nouveau(x) appris dans le dictionnaire (visibles sur la cartographie).`
            : 'aucun référentiel lu sur cette page.'),
        );
        setPhase('done');
        return;
      }

      // analyzeIngestion is pure — re-running it locally on the same sample
      // reproduces exactly what the worker persisted, for display.
      const result = analyzeIngestion(url.trim(), criteria, listings, adapter);
      setAnalysis(result);

      const persistResult = serverPersisted
        ? (data?.persistOutcome ?? null)
        : await persistIngestionResult({
            url: url.trim(),
            site: adapter.key,
            country: adapter.countryCode,
            criteria,
            analysis: result,
            sampleSize: listings.length,
            detectedParams,
            submittedBy: form.submittedBy.trim() || undefined,
            scrapeDiagnostics: diag,
          });
      setOutcome(persistResult);

      // Record a market snapshot only for a confirmed segment (brand + model),
      // so market intelligence data is attributed to a known vehicle — same
      // certainty bar as the mapping memory. Best-effort, never blocks the UX.
      // (Server-persisted jobs already wrote it worker-side.)
      const confirmed = new Set(result.confirmedFields);
      if (!serverPersisted && confirmed.has('brand') && confirmed.has('model') && listings.length > 0) {
        writeMarketSnapshot({
          segment: {
            site: adapter.key,
            country: adapter.countryCode,
            brand: form.brand.trim().toUpperCase(),
            model: form.model.trim().toUpperCase(),
            fuel: confirmed.has('fuel') ? (form.fuel || '').toUpperCase() : '',
            trim: confirmed.has('trim') ? form.trim.trim() : '',
          },
          listings,
          totalCount: (data?.totalCount ?? null) as number | null,
          sourceUrl: url.trim(),
          submittedBy: form.submittedBy.trim() || undefined,
        }).catch((e) => console.warn('[MARKET] snapshot write failed:', e));
      }

      setPhase('done');
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : String(err));
      setPhase('done');
    }
  };

  // Modèle OPTIONNEL : vide = ingestion « découverte » (scrape + apprentissage
  // de la taxonomie embarquée, sans écriture mémoire) — utile pour apprendre
  // toute une gamme d'un coup via une URL marque entière (mobile.de).
  const canVerify = phase === 'form' || phase === 'done'
    ? form.brand.trim().length > 0
    : false;

  return (
    <div className={embedded ? 'w-full space-y-6' : 'max-w-5xl mx-auto space-y-6'}>
      {!embedded && <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Upload className="w-6 h-6 text-blue-500" />
          Ingestion
        </h1>
        <p className="text-slate-600 mt-1 text-sm">
          Collez une URL de recherche filtrée manuellement sur un marketplace. ADA scrape la page,
          confirme empiriquement chaque critère (min {INGESTION_MIN_SAMPLE} annonces, ≥{INGESTION_CONFIRM_THRESHOLD * 100}% de cohérence)
          et ne mémorise que les correspondances certaines.
        </p>
      </div>}

      {/* URL bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <label className="block text-sm font-medium text-slate-700">URL de recherche marketplace</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyzeUrl(); }}
            placeholder="https://www.marktplaats.nl/toyota/f/yaris+hybride/1232+13838/"
            className="flex-1 bg-white border border-slate-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => handleAnalyzeUrl()}
            disabled={!url.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg font-medium text-sm"
          >
            Analyser
          </button>
        </div>
        {urlError && (
          <p className="text-sm text-red-600 flex items-center gap-2"><XCircle className="w-4 h-4" />{urlError}</p>
        )}
        {adapter && phase !== 'idle' && (
          <p className="text-sm text-slate-600">
            Site détecté : <span className="text-slate-900 font-medium">{adapter.displayName}</span> ({adapter.country})
            {prefilled.length > 0
              ? <> — champs pré-remplis depuis l'URL : <span className="text-emerald-600">{prefilled.join(', ')}</span>. Vérifiez et complétez.</>
              : <> — URL à identifiants opaques : saisissez les critères que vous aviez filtrés.</>}
            {learned.length > 0 && (
              <> <br />🧠 reconnus depuis un apprentissage précédent : <span className="text-sky-600">{learned.map((f) => FIELD_LABELS[f] ?? f).join(', ')}</span>.</>
            )}
          </p>
        )}
      </div>

      {/* Declared criteria form */}
      {adapter && phase !== 'idle' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Critères déclarés (ce que vous aviez filtré sur le site)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Marque *</label>
              <input value={form.brand} onChange={setField('brand')}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Modèle <span className="text-slate-500">(vide = découverte : apprend la gamme, sans mémorisation)</span></label>
              <input value={form.model} onChange={setField('model')}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Année min</label>
              <input value={form.yearFrom} onChange={setField('yearFrom')} placeholder="2021"
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Année max</label>
              <input value={form.yearTo} onChange={setField('yearTo')} placeholder="2023"
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Km max</label>
              <input value={form.mileage} onChange={setField('mileage')} placeholder="80000"
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Carburant</label>
              <select value={form.fuel} onChange={setField('fuel')}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                {FUEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Finition</label>
              <input value={form.trim} onChange={setField('trim')} placeholder="GR Sport"
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Boîte de vitesse</label>
              <select value={form.gearbox} onChange={setField('gearbox')}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                {GEARBOX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Puissance DIN min (ch)</label>
              <input value={form.powerFrom} onChange={setField('powerFrom')} placeholder="160"
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Puissance DIN max (ch)</label>
              <input value={form.powerTo} onChange={setField('powerTo')} placeholder="—"
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Nombre de portes</label>
              <input value={form.doors} onChange={setField('doors')} placeholder="5"
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Nombre de places</label>
              <input value={form.seats} onChange={setField('seats')} placeholder="5"
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Couleur</label>
              <input value={form.color} onChange={setField('color')} placeholder="Noir"
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Type de véhicule</label>
              <input value={form.vehicleType} onChange={setField('vehicleType')} placeholder="Berline"
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className={`block text-xs mb-1 ${form.submittedBy.trim() ? 'text-slate-600' : 'text-amber-600/90'}`}>
                Votre nom {form.submittedBy.trim() ? '(audit, optionnel)' : '— pense à te sélectionner'}
              </label>
              <input
                value={form.submittedBy}
                onChange={setField('submittedBy')}
                list="known-contributors"
                placeholder="Choisir ou saisir…"
                className={`w-full bg-white rounded-lg px-3 py-2 text-sm focus:outline-none border transition-colors ${
                  form.submittedBy.trim()
                    ? 'border-slate-300 focus:border-blue-500'
                    : 'border-amber-600/60 ring-1 ring-amber-600/25 focus:border-amber-500'
                }`} />
              <datalist id="known-contributors">
                {knownNames.map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>
          </div>
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <span className="text-emerald-600">↑</span>
            Tri : <span className="text-slate-700">prix croissant</span> — l'échantillon est toujours pris sur les moins chères (page 1).
          </p>
          <button
            onClick={handleVerify}
            disabled={!canVerify || phase === 'scraping'}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg font-medium text-sm"
          >
            {phase === 'scraping' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {phase === 'scraping' ? 'Scraping de découverte en cours…' : 'Vérifier par scraping'}
          </button>
          {phase === 'scraping' && (
            <p className="text-xs text-slate-500">
              L'ingestion tourne côté serveur — vous pouvez fermer le navigateur, le résultat
              sera enregistré et visible dans l'Historique.
            </p>
          )}
        </div>
      )}

      {/* Découverte taxonomie (ingestion sans modèle) */}
      {discoveryNote && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 text-sm text-emerald-700 flex items-start gap-2">
          <Upload className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Ingestion de découverte (sans modèle)</p>
            <p className="text-emerald-600/80">{discoveryNote}</p>
            <p className="text-emerald-600/60 mt-1">Aucune écriture en mémoire de mapping — seul le dictionnaire de taxonomie a été enrichi.</p>
          </div>
        </div>
      )}

      {/* Scrape error */}
      {scrapeError && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-4 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Scraping de découverte échoué — rien n'a été mémorisé.</p>
            <p className="text-red-600/80">{scrapeError}</p>
            <p className="text-red-600/60 mt-1">La tentative a été journalisée pour audit.</p>
          </div>
        </div>
      )}

      {/* Scrape diagnostics (observability) */}
      {diagnostics && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-slate-800 text-sm">Diagnostic de scraping</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <DiagChip label="Mode" value={diagnostics.mode === 'raw' ? 'raw (éco)' : diagnostics.mode ?? '—'} tone={diagnostics.mode === 'raw' ? 'good' : 'neutral'} />
            <DiagChip label="Tentatives" value={String(diagnostics.attempts ?? '—')} tone={(diagnostics.attempts ?? 1) > 1 ? 'warn' : 'good'} />
            <DiagChip label="Annonces" value={String(diagnostics.listingCount ?? 0)} />
            <DiagChip label="Total site" value={diagnostics.totalCount != null ? String(diagnostics.totalCount) : '—'} />
            <DiagChip label="HTML" value={diagnostics.htmlLength ? `${Math.round(diagnostics.htmlLength / 1000)} Ko` : '—'} />
            {diagnostics.fromCache && <DiagChip label="Cache" value="réutilisé" tone="good" />}
            {diagnostics.emptyResults && <DiagChip label="Résultat" value="0 (recherche vide)" tone="warn" />}
            {diagnostics.blocked && <DiagChip label="Bloqué" value={diagnostics.blockReason ?? 'oui'} tone="bad" />}
          </div>
          {diagnostics.fieldsPresent && Object.keys(diagnostics.fieldsPresent).length > 0 && (
            <div>
              <div className="text-xs text-slate-500 mb-1.5">Couverture d'extraction (part des annonces avec le champ)</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5">
                {Object.entries(diagnostics.fieldsPresent as Record<string, number>).map(([field, frac]) => (
                  <div key={field} className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 w-16 shrink-0">{field}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.round(frac * 100)}%`, background: frac >= 0.9 ? '#10b981' : frac >= 0.5 ? '#c98500' : '#ef4444' }} />
                    </div>
                    <span className="text-[10px] text-slate-500 w-8 text-right">{Math.round(frac * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {analysis && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">
            Confirmation champ par champ — échantillon de {sample.length} annonces
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-4">Champ</th>
                  <th className="py-2 pr-4">Déclaré</th>
                  <th className="py-2 pr-4">Méthode</th>
                  <th className="py-2 pr-4">Cohérence</th>
                  <th className="py-2 pr-4">Verdict</th>
                  <th className="py-2">Détail</th>
                </tr>
              </thead>
              <tbody>
                {analysis.confirmations.map((c) => (
                  <tr key={c.field} className="border-b border-slate-200">
                    <td className="py-2 pr-4 font-medium">{FIELD_LABELS[c.field] ?? c.field}</td>
                    <td className="py-2 pr-4 text-slate-700">{c.declaredValue}</td>
                    <td className="py-2 pr-4 text-slate-600">{c.method === 'structured' ? 'donnée structurée' : 'texte'}</td>
                    <td className="py-2 pr-4 text-slate-700">{c.matchCount}/{c.sampleSize}</td>
                    <td className="py-2 pr-4">
                      {c.status === 'confirmed'
                        ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-4 h-4" />retenu</span>
                        : <span className="inline-flex items-center gap-1 text-red-600"><XCircle className="w-4 h-4" />jeté</span>}
                    </td>
                    <td className="py-2 text-slate-500 text-xs">{c.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-sm text-slate-600">
            URL validée réutilisable telle quelle :{' '}
            {analysis.validatedUrl
              ? <span className="text-emerald-600">oui</span>
              : <span className="text-amber-600">non (au moins un champ jeté — seuls les fragments confirmés sont mémorisés)</span>}
          </div>

          {sample.length > 0 && (
            <details className="text-sm text-slate-500">
              <summary className="cursor-pointer hover:text-slate-700">Aperçu de l'échantillon ({Math.min(sample.length, 5)} premières annonces)</summary>
              <ul className="mt-2 space-y-1">
                {sample.slice(0, 5).map((l, i) => (
                  <li key={i} className="truncate">
                    {l.title} — {l.price.toLocaleString('fr-FR')} {l.currency} · {l.year ?? '?'} · {l.mileage != null ? `${l.mileage.toLocaleString('fr-FR')} km` : '? km'}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Memory outcome */}
      {outcome && (
        <div className={`border rounded-xl p-4 text-sm flex items-start gap-2 ${
          MEMORY_ACTION_LABELS[outcome.memoryAction]?.tone === 'ok'
            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
            : MEMORY_ACTION_LABELS[outcome.memoryAction]?.tone === 'warn'
              ? 'bg-amber-50 border-amber-300 text-amber-700'
              : 'bg-white border-slate-200 text-slate-600'
        }`}>
          {MEMORY_ACTION_LABELS[outcome.memoryAction]?.tone === 'warn'
            ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
          <div>
            <p className="font-medium">{MEMORY_ACTION_LABELS[outcome.memoryAction]?.text ?? outcome.memoryAction}</p>
            {outcome.conflicts.length > 0 && (
              <ul className="mt-1 text-xs opacity-80">
                {outcome.conflicts.map((c, i) => (
                  <li key={i}>{FIELD_LABELS[c.field] ?? c.field} : existant {c.existing} ≠ proposé {c.incoming}</li>
                ))}
              </ul>
            )}
            {outcome.memoryError && <p className="text-xs text-red-600 mt-1">Erreur d'écriture mémoire : {outcome.memoryError}</p>}
            {outcome.eventError && <p className="text-xs text-red-600 mt-1">Erreur d'écriture audit : {outcome.eventError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function DiagChip({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const toneCls = tone === 'good' ? 'text-emerald-700 border-emerald-300'
    : tone === 'warn' ? 'text-amber-700 border-amber-300'
    : tone === 'bad' ? 'text-red-700 border-red-300'
    : 'text-slate-700 border-slate-300';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-white ${toneCls}`}>
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
