import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Line, LineChart, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ComposedChart,
  ScatterChart, Scatter,
} from 'recharts';
import { LineChart as LineIcon, RefreshCw, TrendingUp, Gauge, RotateCcw, ExternalLink, Plus, X, MoreHorizontal, Loader2 } from 'lucide-react';
import {
  loadKnownDimensions, sortedUnion, canonUnion, brandKey, refModelKey, filterObservations, distinctValues, priceStats, timeSeries,
  priceHistogramFrom, velocityFromObservations, velocityCoverageDays, VELOCITY_MIN_DAYS, isCoarseOnly, fuelLabel,
  studiesFromOpportunity, MARKET_STUDIES_KEY, latestPerListing, canonicalizeGearbox, GEARBOX_LABELS,
  loadSnapshots, loadObservedDimensions, loadObservationsForStudy, attackPrice, FUEL_TOKEN_TO_CRITERIA,
  pruneVanishedListings,
} from '../services/marketData';
import { generateSearchUrlsWithMemory } from '../lib/linkgen/generator';
import { allSiteAdapters } from '../lib/study-core/marketplaces';
import type { SiteKey } from '../lib/linkgen/types';
import { supabase } from '../lib/supabase';
import type { DimensionRow } from '../services/marketData';
import type { MarketData, MarketFilters, Observation, Snapshot, VelocityStat, KnownDimensions } from '../services/marketData';
import type { FuelToken } from '../lib/study-core/ingestion';
import { getRefWindowsCached, findRefWindow } from '../services/vehicleRef';
import type { RefWindowMap, RefWindow } from '../services/vehicleRef';
import { OpportunityAlerts } from '../components/OpportunityAlerts';

const SERIES = ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767'];
const BLUE = SERIES[0];
const GRID = '#e2e8f0';
const AXIS = '#64748b';
// Distinct, well-separated hues for the (up to 3) compared studies.
const STUDY_COLORS = ['#3987e5', '#d95926', '#199e70'];
// One LOGICAL colour per country, stable everywhere (charts, legends):
// FR bleu, DK blanc, DE or, IT vert, ES rouge, NL orange, BE violet,
// SE bleu ciel, HU bordeaux, LT vert forêt.
const COUNTRY_COLOR: Record<string, string> = {
  FR: '#2C5F9E', DK: '#0F766E', DE: '#CA8A04', IT: '#22c55e', ES: '#ef4444', NL: '#f97316', BE: '#a855f7',
  SE: '#0284c7', HU: '#9f1239', LT: '#15803d',
};
const COUNTRY_FLAG: Record<string, string> = {
  FR: '🇫🇷', NL: '🇳🇱', DK: '🇩🇰', DE: '🇩🇪', IT: '🇮🇹', ES: '🇪🇸', BE: '🇧🇪',
  HU: '🇭🇺', LT: '🇱🇹', SE: '🇸🇪',
};
const FUEL_TOKENS: FuelToken[] = ['petrol', 'diesel', 'hybrid', 'mild_hybrid', 'phev', 'electric', 'hydrogen', 'cng', 'lpg'];

// Clé partagée avec le service : l'Accueil y dépose l'écart cliqué avant de
// naviguer (la navigation recharge la page, rien ne voyage en mémoire).
const STUDIES_KEY = MARKET_STUDIES_KEY;
const LEGACY_FILTERS_KEY = 'ada_market_filters';
// 6 depuis le 04/08 (demande Channing : le nuage prix/km doit accueillir plus
// de 3 comparaisons) — au-delà de STUDY_COLORS, les couleurs continuent sur
// la palette SERIES, jamais recyclées entre études affichées.
const MAX_STUDIES = 6;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
/** Boîte affichée dans la langue de l'app, pas dans celle du site d'origine. */
function gearboxLabel(raw: string | null | undefined): string {
  const t = canonicalizeGearbox(raw);
  return t ? GEARBOX_LABELS[t] : '';
}
function fmtEur(n: number | null | undefined): string {
  return n == null || n === 0 ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`;
}
const tooltipStyle = { background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 12, color: '#0f172a', boxShadow: '0 8px 24px rgba(15,23,42,.12)' };

function studyLabel(f: MarketFilters, i: number): string {
  const parts = [
    f.country ? `${COUNTRY_FLAG[f.country] ?? ''} ${f.country}`.trim() : '',
    f.brand || '',
    f.model || '',
    f.trim || '',
    f.fuel ? fuelLabel(f.fuel) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : `Étude ${i + 1}`;
}

/** Site's reported total depth for a study's coarse segment (latest snapshot). */
function computeRealDepth(snapshots: Snapshot[], f: MarketFilters): number | null {
  if (!f.brand || !f.model) return null;
  const matching = snapshots.filter((s) =>
    (!f.site || s.site === f.site) && (!f.country || s.country === f.country) &&
    s.brand === f.brand && s.model === f.model && s.listing_count != null);
  if (matching.length === 0) return null;
  return matching.sort((a, b) => b.scraped_at.localeCompare(a.scraped_at))[0].listing_count;
}

function loadStudies(): MarketFilters[] {
  try {
    const raw = sessionStorage.getItem(STUDIES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr.slice(0, MAX_STUDIES);
    }
    // Migrate the pre-comparison single-filter key.
    const legacy = sessionStorage.getItem(LEGACY_FILTERS_KEY);
    if (legacy) return [JSON.parse(legacy)];
  } catch { /* ignore */ }
  return [{}];
}

export function MarketIntelligence() {
  const [data, setData] = useState<MarketData>({ snapshots: [], observations: [] });
  const [loading, setLoading] = useState(true);
  const [studies, setStudies] = useState<MarketFilters[]>(loadStudies);
  const [activeIdx, setActiveIdx] = useState(0);
  const [priceBand, setPriceBand] = useState<{ from: number; to: number } | null>(null);

  const [known, setKnown] = useState<KnownDimensions>({ sites: [], countries: [], brands: [], modelsByBrand: {}, fuelsByBrandModel: {}, allFuels: [] });

  // Dimensions observées (agrégat serveur) : nourrit les menus marque/modèle/
  // pays même quand AUCUNE observation n'est chargée — le chargement de masse
  // n'existe plus, chaque étude ne reçoit que SON segment.
  const [dims, setDims] = useState<DimensionRow[]>([]);

  const refresh = async () => {
    setLoading(true);
    const [snaps, k, d] = await Promise.all([loadSnapshots(), loadKnownDimensions(), loadObservedDimensions()]);
    setData((prev) => ({ ...prev, snapshots: snaps }));
    setKnown(k);
    setDims(d);
    setLoading(false);
    // Un rafraîchissement recharge aussi les segments : vider le cache PUIS
    // relancer le chargement scopé (scopeRetryTick), qui bumpera l'epoch une
    // fois les données fraîches en place. SURTOUT ne pas bumper l'epoch ici :
    // au montage, refresh() finit souvent APRÈS les chargements de segment —
    // vider + réafficher immédiatement montrait une page à 0 annonce que rien
    // ne venait recharger (constat 01/08 : « tout disparaît par moments, un
    // aller-retour répare »). Les lignes affichées restent donc à l'écran
    // jusqu'à l'arrivée des fraîches.
    scopeCache.current.clear();
    setScopeRetryTick((t) => t + 1);
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { try { sessionStorage.setItem(STUDIES_KEY, JSON.stringify(studies)); } catch { /* ignore */ } }, [studies]);
  // Keep-alive (étage 3) : « Inspecter » un écart depuis une autre page ne
  // remonte plus le composant — l'événement applique les études déposées.
  useEffect(() => {
    const apply = () => { setStudies(loadStudies()); setActiveIdx(0); };
    window.addEventListener('ada:open-market-studies', apply);
    return () => window.removeEventListener('ada:open-market-studies', apply);
  }, []);

  // ── Chargement SCOPÉ : une requête par segment (marque[/modèle][/pays]),
  //    mémoïsée pour la session. Les réponses en désordre ne peuvent pas se
  //    marcher dessus : chaque scope écrit dans SA case, l'affichage est la
  //    concaténation des cases vivantes. ─────────────────────────────────────
  const scopeCache = useRef(new Map<string, Observation[]>());
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const [scopeLoading, setScopeLoading] = useState(false);
  // Scopes en ÉCHEC de chargement (timeout base…) : surtout ne pas mettre un
  // tableau vide en cache — la page montrait « 0 annonce » pour un segment
  // plein (FR/AUDI/Q5, 01/08 : statement timeout à froid puis cache collant).
  // L'échec s'affiche, et « Réessayer » relance la lecture.
  const [scopeErrors, setScopeErrors] = useState<Map<string, string>>(new Map());
  const [scopeRetryTick, setScopeRetryTick] = useState(0);
  const scopeOf = (f: MarketFilters) =>
    (f.brand ?? '').trim()
      ? `${brandKey(f.brand!)}|${(f.model ?? '').trim() ? refModelKey(f.brand!, f.model!) : ''}|${(f.country ?? '').trim() || ''}`
      : '';
  const scopesKey = studies.map(scopeOf).filter(Boolean).sort().join(';');
  // Chargements en vol : le montage et un Rafraîchir peuvent viser les mêmes
  // segments à quelques secondes d'écart — pas deux fois la même requête.
  const inflightScopes = useRef(new Set<string>());
  // Charge UN scope, indépendamment de tout cycle de rendu : le résultat est
  // rangé par sa CLÉ, il est valable quel que soit l'effet qui l'a demandé.
  // JAMAIS d'annulation ici — l'ancienne version « annulait » les chargements
  // quand refresh() relançait l'effet en plein vol : l'instance annulée jetait
  // ses lignes, la nouvelle voyait les scopes « en vol » et ne faisait rien →
  // « Chargement du segment… » pour toujours (constat 01/08, plusieurs minutes).
  const ensureScope = async (f: MarketFilters) => {
    const s = scopeOf(f);
    if (!s || scopeCache.current.has(s) || inflightScopes.current.has(s)) return;
    inflightScopes.current.add(s);
    setScopeLoading(true);
    try {
      const rows = await loadObservationsForStudy(f);
      scopeCache.current.set(s, rows);
      setScopeErrors((prev) => { const n = new Map(prev); n.delete(s); return n; });
    } catch (e) {
      setScopeErrors((prev) => new Map(prev).set(s, `${studyLabel(f, 0)} — ${e instanceof Error ? e.message : String(e)}`));
    } finally {
      inflightScopes.current.delete(s);
      setScopeLoading(inflightScopes.current.size > 0);
      setScopeEpoch((e) => e + 1); // affichage progressif : chaque scope arrive quand il est prêt
    }
  };

  useEffect(() => {
    // Purge des scopes plus regardés par personne (mémoire bornée).
    const wanted = new Set(scopesKey.split(';').filter(Boolean));
    for (const key of [...scopeCache.current.keys()]) if (!wanted.has(key)) scopeCache.current.delete(key);
    setScopeErrors((prev) => {
      const next = new Map(prev);
      for (const key of [...next.keys()]) if (!wanted.has(key)) next.delete(key);
      return next;
    });
    studies.forEach((f) => { void ensureScope(f); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopesKey, studies.length, scopeRetryTick]);

  useEffect(() => {
    const rows: Observation[] = [];
    const seenScope = new Set<string>();
    for (const f of studies) {
      const s = scopeOf(f);
      if (!s || seenScope.has(s)) continue;
      seenScope.add(s);
      rows.push(...(scopeCache.current.get(s) ?? []));
    }
    setData((prev) => ({ ...prev, observations: rows }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeEpoch, scopesKey]);

  const comparing = studies.length > 1;
  const active = studies[Math.min(activeIdx, studies.length - 1)] ?? {};

  const setActive = (patch: Partial<MarketFilters>) => {
    setStudies((arr) => arr.map((f, i) => (i === activeIdx ? { ...f, ...patch } : f)));
    setPriceBand(null);
  };
  const resetActive = () => { setStudies((arr) => arr.map((f, i) => (i === activeIdx ? {} : f))); setPriceBand(null); };
  const addStudy = () => {
    if (studies.length >= MAX_STUDIES) return;
    setStudies((arr) => [...arr, { ...arr[activeIdx] }]); // clone current as a starting point
    setActiveIdx(studies.length);
    setPriceBand(null);
  };
  const removeStudy = (i: number) => {
    if (studies.length <= 1) return;
    setStudies((arr) => arr.filter((_, k) => k !== i));
    setActiveIdx((cur) => (cur >= i && cur > 0 ? cur - 1 : cur));
    setPriceBand(null);
  };

  const obs = data.observations;

  // ── Menu ⋯ par étude + « Mettre à jour » ────────────────────────────────────
  //
  // Résilient à la navigation (constat 01/08 : quitter la page tuait le suivi
  // ET la reprise d'affichage, alors que le scrape server-side aboutissait) :
  //   1. TOUS les jobs du segment démarrent immédiatement côté worker ;
  //   2. leurs jobIds sont persistés en sessionStorage ;
  //   3. au montage, la page reprend le polling là où il en était — le
  //      spinner remouline et le rechargement final a bien lieu.
  // Job inconnu au retour (worker redémarré, TTL 15 min dépassé) = fail-open :
  // le scrape a très probablement abouti, on recharge et on n'alarme pas.
  const [menuIdx, setMenuIdx] = useState<number | null>(null);
  const [updating, setUpdating] = useState<Map<string, { label: string; msg: string }>>(new Map());
  const setUpd = (scope: string, v: { label: string; msg: string } | null) =>
    setUpdating((m) => { const n = new Map(m); if (v == null) n.delete(scope); else n.set(scope, v); return n; });
  const trackedScopes = useRef(new Set<string>());

  const readPendingUpdates = (): PendingUpdate[] => {
    try {
      const arr = JSON.parse(sessionStorage.getItem(MI_UPDATES_KEY) ?? '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  };
  const removePendingUpdate = (scope: string) => {
    try {
      sessionStorage.setItem(MI_UPDATES_KEY, JSON.stringify(readPendingUpdates().filter((p) => p.scope !== scope)));
    } catch { /* ignore */ }
  };

  const trackUpdate = (pu: PendingUpdate) => {
    if (trackedScopes.current.has(pu.scope)) return;
    trackedScopes.current.add(pu.scope);
    void (async () => {
      const remaining = new Map(pu.jobs.map((j) => [j.jobId, j.site]));
      const errors: string[] = [];
      // 20 min : les mises à jour partagent la file Zyte avec les campagnes —
      // pendant une campagne active, un scrape MI passe derrière et peut
      // légitimement dépasser les 12 min de l'ancien délai (constat 04/08 :
      // « échec : délai dépassé » alors que les snapshots ENYAQ ont atterri).
      const deadline = pu.startedAt + 20 * 60 * 1000;
      // Campagne active = files d'attente plus longues : on l'annonce.
      let campSuffix = '';
      try {
        const { data: camp } = await supabase.from('linkgen_campaigns').select('id').eq('status', 'running').limit(1);
        if (camp && camp.length > 0) campSuffix = ' · campagne active en parallèle, cela peut prendre plus de temps';
      } catch { /* indication seulement */ }
      setUpd(pu.scope, { label: pu.label, msg: `scrape en cours — 0/${pu.jobs.length} site(s) terminé(s)${campSuffix}` });
      while (remaining.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        for (const [jobId, site] of [...remaining]) {
          const poll = await supabase.functions.invoke('ingest-url', { body: { jobId } });
          if (poll.error) {
            const status = ((poll.error as { context?: unknown }).context as { status?: number } | undefined)?.status;
            // 404 = job purgé/worker redémarré : le scrape a pu aboutir — fail-open.
            if (status === 404) remaining.delete(jobId);
            // 502 = worker injoignable (redéploiement Railway en cours) : le
            // spinner semblait mouliner sans raison pendant ces fenêtres —
            // on AFFICHE l'état au lieu de laisser croire à un blocage.
            else if (status === 502) setUpd(pu.scope, { label: pu.label, msg: 'worker en redéploiement — reprise automatique du suivi…' });
            continue; // autre erreur (réseau…) : on retente au tour suivant
          }
          const d = poll.data as { jobStatus?: string; message?: string } | null;
          if (d?.jobStatus === 'running') continue;
          if (d?.jobStatus === 'error') errors.push(`${site} : ${d?.message ?? 'échec'}`);
          remaining.delete(jobId);
        }
        setUpd(pu.scope, { label: pu.label, msg: `scrape en cours — ${pu.jobs.length - remaining.size}/${pu.jobs.length} site(s) terminé(s)${campSuffix}` });
      }
      // Délai de garde atteint ≠ échec : le worker CONTINUE côté serveur et
      // écrit ses snapshots quand il finit (vérifié le 04/08 : les données
      // ENYAQ ont atterri après l'ancien message « échec »). On l'annonce
      // comme un suivi interrompu, pas comme un scrape raté.
      const stillRunning = [...remaining.values()];
      // Quoi qu'il arrive : recharger — des scrapes ont pu écrire.
      setUpd(pu.scope, { label: pu.label, msg: 'rechargement des données…' });
      try {
        const [rows, snaps] = await Promise.all([loadObservationsForStudy(pu.filters), loadSnapshots()]);
        scopeCache.current.set(pu.scope, rows);
        setData((prev) => ({ ...prev, snapshots: snaps }));
        setScopeEpoch((e) => e + 1);
      } catch {
        errors.push('rechargement échoué — utilise Rafraîchir');
      }
      removePendingUpdate(pu.scope);
      trackedScopes.current.delete(pu.scope);
      if (errors.length > 0) setUpd(pu.scope, { label: pu.label, msg: `échec : ${errors.join(' · ')}` });
      else if (stillRunning.length > 0) {
        setUpd(pu.scope, { label: pu.label, msg: `scrapes toujours en cours côté serveur (${stillRunning.join(', ')}) — les données s'ajouteront d'elles-mêmes, utilise Rafraîchir dans quelques minutes` });
      } else setUpd(pu.scope, null);
    })();
  };

  // Reprise au montage : navigation = rechargement complet de la page, seul le
  // sessionStorage survit — les mises à jour en cours y sont reprises.
  useEffect(() => { readPendingUpdates().forEach(trackUpdate); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const updateStudy = async (idx: number) => {
    const f = studies[idx];
    const scope = scopeOf(f);
    if (!f?.country || !f?.brand || !scope || updating.has(scope)) return;
    setMenuIdx(null);
    const label = studyLabel(f, idx);
    setUpd(scope, { label, msg: 'génération des URLs…' });
    try {
      const targets = (await generateStudyUrls(f)).filter((t): t is { site: string; url: string } => Boolean(t.url));
      if (targets.length === 0) {
        setUpd(scope, { label, msg: 'échec : aucune URL générable pour ce segment (mapping absent)' });
        return;
      }
      // Tous les jobs partent MAINTENANT : dès cet instant, fermer la page ne
      // perd rien — le worker scrape, la persistance est server-side.
      const jobs = await Promise.all(targets.map(async (t) => ({ site: t.site, jobId: await startIngestJob(t.url, f) })));
      const pu: PendingUpdate = { scope, label, filters: f, jobs, startedAt: Date.now() };
      try {
        sessionStorage.setItem(MI_UPDATES_KEY, JSON.stringify([...readPendingUpdates().filter((p) => p.scope !== scope), pu]));
      } catch { /* ignore */ }
      trackUpdate(pu);
    } catch (e) {
      setUpd(scope, { label, msg: `échec : ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  // Fenêtre de commercialisation (référentiel constructeur) du modèle actif —
  // affichée discrètement sous les filtres. Chargée une fois, cache module.
  const [refWindows, setRefWindows] = useState<RefWindowMap | null>(null);
  useEffect(() => {
    getRefWindowsCached().then(setRefWindows).catch(() => setRefWindows(null));
  }, []);
  const refWin: RefWindow | null = useMemo(
    () => (refWindows && active.brand && active.model
      ? findRefWindow(refWindows, active.brand, active.model)
      : null),
    [refWindows, active.brand, active.model],
  );

  // Dimensions OBSERVÉES (agrégat serveur) reprofilées comme les « known » :
  // sans elles, aucun menu ne saurait ce qui existe puisque plus aucune
  // observation n'est chargée tant qu'une marque n'est pas choisie.
  const dimsAgg = useMemo(() => {
    const sites = new Set<string>(); const countries = new Set<string>();
    const brands: string[] = []; const modelsByBrand: Record<string, string[]> = {};
    const fuelsByBrandModel: Record<string, Set<string>> = {}; const allFuels = new Set<string>();
    for (const r of dims) {
      if (r.site) sites.add(r.site);
      if (r.country) countries.add(r.country.toUpperCase());
      const b = (r.brand ?? '').trim(); if (!b) continue;
      brands.push(b.toUpperCase());
      const m = (r.model ?? '').trim();
      if (m) {
        (modelsByBrand[brandKey(b)] ??= []).push(m.toUpperCase());
        if (r.fuel) {
          (fuelsByBrandModel[`${brandKey(b)}|${refModelKey(b, m)}`] ??= new Set()).add(r.fuel);
          allFuels.add(r.fuel);
        }
      }
    }
    return {
      sites: [...sites], countries: [...countries], brands,
      modelsByBrand, allFuels: [...allFuels],
      fuelsByBrandModel: Object.fromEntries(Object.entries(fuelsByBrandModel).map(([k, s]) => [k, [...s]])),
    };
  }, [dims]);

  // Cascading option lists for the ACTIVE study. Site/country/brand/model are
  // the UNION of what has observations AND what ADA knows (mapped segments +
  // covered sites/countries), so a mapped-but-not-yet-scanned segment stays
  // selectable (charts then show the "awaiting data" state). Trim/gearbox stay
  // observation-only (per-listing text). All alphabetical.
  const opts = {
    site: useMemo(() => sortedUnion(distinctValues(obs, 'site', active), sortedUnion(known.sites, dimsAgg.sites)), [obs, active, known, dimsAgg]),
    country: useMemo(() => sortedUnion(distinctValues(obs, 'country', active), sortedUnion(known.countries, dimsAgg.countries)), [obs, active, known, dimsAgg]),
    // Marque/modèle : une seule entrée par véhicule, quelle que soit la graphie
    // des sites ('RAV4'/'RAV-4'/'RAV 4') — la variante des observations gagne.
    brand: useMemo(() => canonUnion(distinctValues(obs, 'brand', active), canonUnion(dimsAgg.brands, known.brands, brandKey), brandKey), [obs, active, known, dimsAgg]),
    model: useMemo(() => {
      const bk = active.brand ? brandKey(active.brand) : '';
      const mapped = bk
        ? [...(dimsAgg.modelsByBrand[bk] ?? []), ...(known.modelsByBrand[bk] ?? [])]
        : [...Object.values(dimsAgg.modelsByBrand).flat(), ...Object.values(known.modelsByBrand).flat()];
      // Fusion par IDENTITÉ modèle : « CLA » et « CLASSE CLA » = une seule
      // entrée de menu (la variante des observations gagne l'affichage).
      return canonUnion(distinctValues(obs, 'model', active), mapped, (m) => refModelKey(active.brand ?? '', m));
    }, [obs, active, known, dimsAgg]),
    trim: useMemo(() => distinctValues(obs, 'trim', active), [obs, active]),
    fuel: useMemo(() => {
      const key = active.brand && active.model ? `${brandKey(active.brand)}|${refModelKey(active.brand, active.model)}` : '';
      const mapped = key
        ? [...(dimsAgg.fuelsByBrandModel[key] ?? []), ...(known.fuelsByBrandModel[key] ?? [])]
        : [...dimsAgg.allFuels, ...known.allFuels];
      return sortedUnion(distinctValues(obs, 'fuel', active), mapped);
    }, [obs, active, known, dimsAgg]),
    gearbox: useMemo(() => distinctValues(obs, 'gearbox' as keyof Observation, active), [obs, active]),
  };

  // Per-study derived data (used by both single & comparison views).
  // Colour: the study's COUNTRY colour when it has one (FR bleu, DK blanc…) —
  // instantly readable in a low-vs-high comparison — falling back to the index
  // palette (and never letting two studies share a colour).
  const perStudy = useMemo(() => studies.map((f, i) => {
    const countryColor = f.country ? COUNTRY_COLOR[f.country] : undefined;
    const firstWithCountry = studies.findIndex((x) => x.country === f.country);
    const color = countryColor && firstWithCountry === i ? countryColor : STUDY_COLORS[i] ?? SERIES[i % SERIES.length];
    const filtered = filterObservations(obs, f);
    // État actuel du marché : une ligne par annonce, dans sa version la plus
    // récente — MOINS les annonces absentes du dernier scan de leur segment
    // (disparues = très probablement vendues ou retirées). Les indicateurs LE
    // décrivent (mêmes chiffres que le tableau du dessous) ; l'historique
    // complet reste dans `filtered` pour les courbes et la vélocité, qui ont
    // besoin de chaque passage, disparitions comprises.
    const latestObs = pruneVanishedListings(latestPerListing(filtered), data.snapshots);
    return {
      idx: i, filters: f, color, label: studyLabel(f, i),
      filtered, latestObs, stats: priceStats(latestObs), series: timeSeries(filtered),
      attack: attackPrice(latestObs),
      realDepth: computeRealDepth(data.snapshots, f),
    };
  }), [studies, obs, data.snapshots]);

  const activeFilterCount = Object.values(active).filter((v) => v != null && v !== '').length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3"><LineIcon className="w-6 h-6 text-blue-500" /> Market Intelligence</h1>
          <p className="text-slate-600 mt-1 text-sm">Profondeur, prix et vélocité du marché — filtrable au grain de l'annonce, jusqu'à 3 études comparées.</p>
        </div>
        <button onClick={refresh} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading || scopeLoading ? 'animate-spin' : ''}`} /> Rafraîchir
        </button>
      </div>

      {/* Plafond de lecture atteint : le dire au lieu de tronquer en silence —
          une page qui perd des modèles sans prévenir passe pour aléatoire. */}
      {data.truncatedFrom && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800">
          Volume maximal atteint : seules les observations postérieures au{' '}
          <span className="font-semibold">
            {new Date(data.truncatedFrom).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
          </span>{' '}
          sont affichées. Les scrapes plus anciens existent en base mais ne sont pas chargés ici.
        </div>
      )}

      {/* Radar d'opportunités inter-pays — alimenté par chaque scrape (campagnes incluses).
          Inspecter = ouvrir DIRECTEMENT les deux marchés de l'écart en études
          comparées (pays bas vs pays haut), prêtes à lire côte à côte. */}
      <OpportunityAlerts onInspect={(o) => {
        setStudies(studiesFromOpportunity(o));
        setActiveIdx(0);
        setPriceBand(null);
      }} />

      {/* Barre d'études + filtres TOUJOURS visibles : en chargement scopé,
          aucune observation n'existe tant qu'une marque n'est pas choisie —
          les cacher derrière « aucune donnée » rendait le choix impossible. */}
      {(
        <>
          {/* Study bar — pick which study you're editing, add/remove up to 3. */}
          <div className="flex flex-wrap items-center gap-2">
            {perStudy.map((s) => (
              <div key={s.idx}
                className={`inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-lg border text-sm cursor-pointer transition
                  ${s.idx === activeIdx ? 'bg-slate-200 border-slate-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}
                onClick={() => { setActiveIdx(s.idx); setPriceBand(null); }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                <span className={s.idx === activeIdx ? 'text-slate-900' : 'text-slate-600'}>{s.label}</span>
                <span className="text-[10px] text-slate-500">{s.stats.count}</span>
                <span className="relative">
                  <button onClick={(e) => { e.stopPropagation(); setMenuIdx(menuIdx === s.idx ? null : s.idx); }}
                    className="p-0.5 rounded hover:bg-slate-300 text-slate-500 hover:text-slate-800" title="Actions">
                    {(() => {
                      const upd = updating.get(scopeOf(s.filters));
                      return upd && !upd.msg.startsWith('échec')
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                        : <MoreHorizontal className="w-3.5 h-3.5" />;
                    })()}
                  </button>
                  {menuIdx === s.idx && (
                    // Mobile : feuille ancrée en bas d'écran — ajouts max-md: seulement (inertes sur PC).
                    <span className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[190px] max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:mt-0 max-md:z-50 max-md:rounded-t-2xl max-md:rounded-b-none max-md:shadow-2xl max-md:max-h-[70vh] max-md:overflow-y-auto max-md:py-2"
                      onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => updateStudy(s.idx)}
                        disabled={!s.filters.country || !s.filters.brand || updating.has(scopeOf(s.filters))}
                        className="w-full text-left px-3 py-1.5 max-md:py-3 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-2">
                        <RefreshCw className="w-3.5 h-3.5" /> Mettre à jour
                      </button>
                      {(!s.filters.country || !s.filters.brand) && (
                        <span className="block px-3 pb-1 text-[10px] text-slate-400">choisis un pays et une marque</span>
                      )}
                    </span>
                  )}
                </span>
                {studies.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); removeStudy(s.idx); }}
                    className="p-0.5 rounded hover:bg-slate-300 text-slate-500 hover:text-slate-800" title="Retirer cette étude">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {studies.length < MAX_STUDIES && (
              <button onClick={addStudy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 hover:border-slate-400 text-sm text-slate-600 hover:text-slate-800">
                <Plus className="w-4 h-4" /> Ajouter une étude
              </button>
            )}
          </div>

          {/* Progression des mises à jour lancées depuis le menu ⋯ (elles
              survivent à la navigation : reprise depuis sessionStorage). */}
          {[...updating.entries()].map(([scope, u]) => (
            <p key={scope} className={`text-xs flex items-center gap-2 ${u.msg.startsWith('échec') ? 'text-rose-600' : 'text-slate-500'}`}>
              {!u.msg.startsWith('échec') && <Loader2 className="w-3 h-3 animate-spin" />}
              Mise à jour « {u.label} » : {u.msg}
              {u.msg.startsWith('échec') && (
                <button onClick={() => setUpd(scope, null)} className="text-slate-500 hover:text-slate-800">✕</button>
              )}
            </p>
          ))}

          {/* Segments dont la LECTURE a échoué (timeout base…) : le dire au
              lieu d'afficher un faux zéro, et permettre de réessayer. */}
          {scopeErrors.size > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-3">
              <span>
                Chargement impossible pour : {[...scopeErrors.values()].join(' · ')} — les chiffres affichés excluent ce(s) segment(s).
              </span>
              <button onClick={() => setScopeRetryTick((t) => t + 1)}
                className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-amber-100 hover:bg-amber-200 border border-amber-300">
                <RefreshCw className="w-3.5 h-3.5" /> Réessayer
              </button>
            </div>
          )}

          {/* Filter panel — edits the ACTIVE study. */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: STUDY_COLORS[activeIdx] ?? BLUE }} />
                Filtres · {studyLabel(active, activeIdx)}
                {activeFilterCount > 0 && <span className="text-slate-500 font-normal">· {activeFilterCount} actif{activeFilterCount > 1 ? 's' : ''}</span>}
              </h2>
              <button onClick={resetActive} disabled={activeFilterCount === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-200 hover:bg-slate-300 disabled:opacity-40">
                <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Select label="Site" value={active.site ?? ''} options={opts.site} onChange={(v) => setActive({ site: v || undefined })} />
              <Select label="Pays" value={active.country ?? ''} options={opts.country} onChange={(v) => setActive({ country: v || undefined })} flag />
              <Select label="Marque" value={active.brand ?? ''} options={opts.brand} onChange={(v) => setActive({ brand: v || undefined })} />
              <Select label="Modèle" value={active.model ?? ''} options={opts.model} onChange={(v) => setActive({ model: v || undefined })} />
              {/* Finition en texte libre « contient » (finition OU titre) —
                  « Sportline » matche « 60 Sportline 150 kW 63 kWh ». */}
              <TextFilter label="Finition (contient)" value={active.trim ?? ''} suggestions={opts.trim}
                placeholder="Sportline, GR Sport…" onChange={(v) => setActive({ trim: v || undefined })} />
              <SelectFuel label="Carburant" value={active.fuel ?? ''} options={opts.fuel} onChange={(v) => setActive({ fuel: (v || undefined) as FuelToken | undefined })} />
              <Select label="Boîte" value={active.gearbox ?? ''} options={opts.gearbox} onChange={(v) => setActive({ gearbox: v || undefined })} />
              <NumRange label="Année" from={active.yearMin ?? undefined} to={active.yearMax ?? undefined}
                onFrom={(v) => setActive({ yearMin: v })} onTo={(v) => setActive({ yearMax: v })} />
              <div className="grid grid-cols-2 gap-2">
                <Num label="Km max" value={active.mileageMax ?? undefined} onChange={(v) => setActive({ mileageMax: v })} />
                <Num label="Puiss. min" value={active.powerMin ?? undefined} onChange={(v) => setActive({ powerMin: v })} />
              </div>
            </div>
            {refWin && (
              <div className="mt-2 text-[11px] text-slate-500">
                Commercialisé {refWin.yearFrom} – {refWin.yearTo ?? 'aujourd’hui'}
                <span className="text-slate-400"> · référentiel constructeur</span>
              </div>
            )}
          </div>

          {!active.brand ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
              Choisis une <span className="text-slate-700 font-medium">marque</span> (et idéalement un modèle) :
              le Market Intelligence charge alors ce segment — et uniquement lui, quelle que soit la taille de la base.
            </div>
          ) : scopeLoading && obs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
              Chargement du segment {active.brand}{active.model ? ` ${active.model}` : ''}…
            </div>
          ) : obs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
              Aucune observation pour ce segment. Chaque scrape (études quotidiennes, campagnes, ingestions) en enregistre ici.
            </div>
          ) : comparing
            ? <ComparisonView perStudy={perStudy} />
            : <SingleStudyView study={perStudy[0]} filters={active} priceBand={priceBand} setPriceBand={setPriceBand} />}
        </>
      )}
    </div>
  );
}

// ─── URLs directes de l'étude ───────────────────────────────────────────────────

function gearboxCriteria(f: MarketFilters): 'AUTOMATIQUE' | 'MANUELLE' | undefined {
  const t = canonicalizeGearbox(f.gearbox);
  return t === 'automatique' ? 'AUTOMATIQUE' : t === 'manuelle' ? 'MANUELLE' : undefined;
}

/**
 * Les liens de recherche que le LinkGen génère depuis les filtres actifs, un
 * par site du pays sélectionné (Pays=FR → Leboncoin + AutoScout FR…).
 * Partagé entre le bouton « URLs » et « Mettre à jour » : ce qui s'affiche est
 * exactement ce qui se scrape.
 */
async function generateStudyUrls(filters: MarketFilters): Promise<{ site: string; url: string | null }[]> {
  const sites = allSiteAdapters()
    .filter((a) => (a as { countryCode?: string }).countryCode === filters.country)
    .filter((a) => !filters.site || a.key === filters.site);
  const out: { site: string; url: string | null }[] = [];
  for (const site of sites) {
    let url: string | null = null;
    try {
      const gen = await generateSearchUrlsWithMemory({
        selectedSites: [site.key as SiteKey],
        brand: filters.brand!, model: filters.model || '',
        fuel: filters.fuel ? FUEL_TOKEN_TO_CRITERIA[filters.fuel] : undefined,
        trim: filters.trim || undefined,
        yearFrom: filters.yearMin != null ? String(filters.yearMin) : undefined,
        yearTo: filters.yearMax != null ? String(filters.yearMax) : undefined,
        mileage: filters.mileageMax ?? undefined,
        gearbox: gearboxCriteria(filters),
      });
      url = gen[0]?.url && gen[0].url.length > 10 ? gen[0].url : null;
    } catch { url = null; }
    out.push({ site: site.key, url });
  }
  return out;
}

/**
 * DÉMARRE un scrape côté worker via l'edge ingest-url (mode job, même contrat
 * que la page Ingestion : analyse, rétention mémoire et snapshot marché
 * tournent server-side) et rend le jobId sans attendre — le suivi appartient
 * au caller, qui le persiste pour survivre à la navigation.
 */
async function startIngestJob(url: string, f: MarketFilters): Promise<string> {
  const criteria = {
    brand: f.brand ?? '', model: f.model ?? '',
    yearFrom: f.yearMin != null ? String(f.yearMin) : undefined,
    yearTo: f.yearMax != null ? String(f.yearMax) : undefined,
    mileage: f.mileageMax != null ? String(f.mileageMax) : undefined,
    fuel: f.fuel ? FUEL_TOKEN_TO_CRITERIA[f.fuel] : undefined,
    trim: f.trim || undefined,
    gearbox: gearboxCriteria(f),
  };
  const start = await supabase.functions.invoke('ingest-url', {
    body: { url, async: true, criteria, submittedBy: 'Market Intelligence' },
  });
  if (start.error) throw new Error(start.error.message ?? 'edge ingest-url en échec');
  const jobId = (start.data as { jobId?: string } | null)?.jobId;
  if (!jobId) throw new Error('worker sans mode job — réponse synchrone inattendue');
  return jobId;
}

/** Mise à jour en cours, persistée en sessionStorage (survit à la navigation). */
interface PendingUpdate {
  scope: string;
  label: string;
  filters: MarketFilters;
  jobs: { site: string; jobId: string }[];
  startedAt: number;
}
const MI_UPDATES_KEY = 'ada_mi_updates';

/**
 * Bouton « URLs » : déroule les liens par site. Sans pays ni marque, aucune
 * URL ne veut dire quelque chose : bouton absent.
 */
function StudyLinks({ filters }: { filters: MarketFilters }) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<{ site: string; url: string | null }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const sig = JSON.stringify(filters);
  useEffect(() => { setLinks(null); setOpen(false); }, [sig]);
  if (!filters.country || !filters.brand) return null;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || links || busy) return;
    setBusy(true);
    try {
      setLinks(await generateStudyUrls(filters));
    } finally { setBusy(false); }
  };

  return (
    <span className="relative inline-flex shrink-0">
      <button onClick={toggle} title="URLs de recherche générées depuis les filtres"
        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600">
        <ExternalLink className="w-3 h-3" /> URLs
      </button>
      {open && (
        <span className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-2 min-w-[230px] space-y-1 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:mt-0 max-md:z-50 max-md:rounded-t-2xl max-md:rounded-b-none max-md:shadow-2xl max-md:max-h-[70vh] max-md:overflow-y-auto max-md:p-3">
          {busy && <span className="block text-xs text-slate-500 px-1 py-0.5">Génération…</span>}
          {!busy && links?.length === 0 && <span className="block text-xs text-slate-500 px-1 py-0.5">Aucun site pour ce pays.</span>}
          {!busy && links?.map((l) => (
            <span key={l.site} className="flex items-center justify-between gap-3 px-1 py-0.5">
              <span className="text-xs text-slate-700">{l.site}</span>
              {l.url
                ? <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">Ouvrir <ExternalLink className="w-3 h-3" /></a>
                : <span className="text-slate-400 text-xs">indisponible</span>}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

// ─── Single-study dashboard (the full, rich view) ───────────────────────────────

interface StudyDerived {
  idx: number; filters: MarketFilters; color: string; label: string;
  filtered: Observation[]; latestObs: Observation[];
  stats: ReturnType<typeof priceStats>; series: ReturnType<typeof timeSeries>;
  /** Médiane des N moins chères (N adaptatif) — le prix pour être compétitif. */
  attack: ReturnType<typeof attackPrice>;
  realDepth: number | null;
}

function SingleStudyView({ study, filters, priceBand, setPriceBand }:
  { study: StudyDerived; filters: MarketFilters; priceBand: { from: number; to: number } | null; setPriceBand: (b: { from: number; to: number } | null) => void }) {
  const { filtered, latestObs, stats, realDepth } = study;

  const series = useMemo(() => study.series.map((r) => ({
    date: fmtDate(r.date), median: r.median, band: [r.p25, r.p75] as [number, number], count: r.count,
  })), [study.series]);
  const histogram = useMemo(() => priceHistogramFrom(latestObs, 12), [latestObs]);

  const countryCompare = useMemo(() => {
    const byCountry = new Map<string, Observation[]>();
    for (const o of latestObs) { const a = byCountry.get(o.country) ?? []; a.push(o); byCountry.set(o.country, a); }
    return [...byCountry.entries()].map(([country, list]) => ({ country, median: priceStats(list).median }))
      .filter((c) => c.median > 0).sort((a, b) => a.median - b.median);
  }, [latestObs]);

  const velocity = useMemo(() => velocityFromObservations(filtered).filter((v) => v.soldCount > 0), [filtered]);
  const velocityCoverage = useMemo(() => velocityCoverageDays(filtered), [filtered]);

  const tableRows = useMemo(() => {
    let rows = latestObs;
    if (priceBand) rows = rows.filter((o) => o.price != null && o.price >= priceBand.from && o.price <= priceBand.to);
    return [...rows].sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).slice(0, 60);
  }, [latestObs, priceBand]);

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <Kpi label="Annonces (filtre)" value={String(stats.count)} />
        <Kpi label="Profondeur marché" value={realDepth != null ? String(realDepth) : '—'} hint={realDepth != null ? 'total site (marque/modèle)' : 'sélectionne marque+modèle'} />
        <Kpi label="Prix d'attaque" value={study.attack ? fmtEur(study.attack.price) : '—'} hint={study.attack ? `médiane des ${study.attack.window} moins chères` : undefined} />
        <Kpi label="Médian" value={fmtEur(stats.median)} hint="ensemble du marché filtré" />
        <Kpi label="Fourchette p25–p75" value={`${fmtEur(stats.p25)} – ${fmtEur(stats.p75)}`} />
        <Kpi label="Étalement min–max" value={`${fmtEur(stats.min)} – ${fmtEur(stats.max)}`} />
      </div>

      {/* Median over time + depth over time */}
      <div className="grid md:grid-cols-2 gap-6">
        <ChartCard title="Prix médian dans le temps" subtitle="médian + fourchette p25–p75" icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}>
          {series.length < 2 ? <NeedMore /> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={52} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={((v: number | number[], name: string) => Array.isArray(v) ? [`${fmtEur(v[0])} – ${fmtEur(v[1])}`, 'p25–p75'] : [fmtEur(v), name === 'median' ? 'Médian' : name]) as never} />
                <Area type="monotone" dataKey="band" stroke="none" fill={BLUE} fillOpacity={0.14} />
                <Line type="monotone" dataKey="median" stroke={BLUE} strokeWidth={2} dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Profondeur (annonces observées)" subtitle={isCoarseOnly(filters) ? 'nombre d’annonces vues par scan' : 'échantillon filtré · page 1'} icon={<TrendingUp className="w-4 h-4 text-blue-600" />}>
          {series.length < 2 ? <NeedMore /> : (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={40} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} annonces`, 'Observées']} />
                <Line type="monotone" dataKey="count" stroke={SERIES[4]} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Distribution + country comparison */}
      <div className="grid md:grid-cols-2 gap-6">
        <ChartCard title="Distribution des prix" subtitle={`dernier scan · ${latestObs.length} annonces${priceBand ? ' · tranche sélectionnée' : ' · clique une barre'}`} icon={<Gauge className="w-4 h-4 text-amber-600" />}>
          {histogram.length === 0 ? <NeedMore text="Pas d'annonces." /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={histogram} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="range" tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={32} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} annonces`, '']} labelFormatter={(l) => `${l} €`} cursor={{ fill: '#0f172a0a' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer" onClick={((d: { from?: number; to?: number }) => { if (d?.from != null && d?.to != null) setPriceBand({ from: d.from, to: d.to }); }) as never}>
                  {histogram.map((b) => <Cell key={b.range} fill={priceBand && b.from >= priceBand.from && b.to <= priceBand.to + 1 ? SERIES[3] : BLUE} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Comparaison entre pays" subtitle="prix médian · vue filtrée" icon={<TrendingUp className="w-4 h-4 text-violet-600" />}>
          {countryCompare.length < 2 ? <NeedMore text="Données sur ≥2 pays nécessaires (filtre marque/modèle)." /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={countryCompare} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="country" tick={{ fill: AXIS, fontSize: 12 }} stroke={GRID} tickFormatter={(c) => `${COUNTRY_FLAG[c] ?? ''} ${c}`} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={52} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtEur(v as number), 'Médian']} labelFormatter={(c) => `${COUNTRY_FLAG[c] ?? ''} ${c}`} cursor={{ fill: '#0f172a0a' }} />
                <Bar dataKey="median" radius={[4, 4, 0, 0]}>
                  {countryCompare.map((c) => <Cell key={c.country} fill={COUNTRY_COLOR[c.country] ?? BLUE} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Velocity */}
      <VelocityCard velocity={velocity} coverageDays={velocityCoverage} />

      {/* Listings table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Annonces {priceBand && <span className="text-slate-500 font-normal text-sm">· tranche {Math.round(priceBand.from / 1000)}–{Math.round(priceBand.to / 1000)}k €</span>}</h2>
          <span className="inline-flex items-center gap-3">
            {priceBand && <button onClick={() => setPriceBand(null)} className="text-xs text-slate-600 hover:text-slate-800">✕ tranche</button>}
            <StudyLinks filters={filters} />
          </span>
        </div>
        <ListingsTable rows={tableRows} />
      </div>
    </>
  );
}

// ─── Comparison view (2–3 studies side by side) ─────────────────────────────────

function ComparisonView({ perStudy }: { perStudy: StudyDerived[] }) {
  const [priceBand, setPriceBand] = useState<{ from: number; to: number } | null>(null);
  // Distribution ↔ nuage prix/km : deux lectures du même marché filtré.
  const [priceView, setPriceView] = useState<'dist' | 'scatter'>('dist');
  const filtersSig = perStudy.map((s) => JSON.stringify(s.filters)).join('|');
  useEffect(() => { setPriceBand(null); }, [filtersSig]);
  const inBand = (p: number | null) => p != null && priceBand != null && p >= priceBand.from && p <= priceBand.to;

  // Nuage prix × kilométrage (04/08) : chaque annonce de l'état actuel du
  // marché est un point — exactement les mêmes données filtrées/purgées que
  // la liste et les indicateurs (tout filtre du MI redessine le nuage). Une
  // annonce sans kilométrage lisible n'est pas plaçable : comptée à part.
  const scatterData = useMemo(() => perStudy.map((s) => ({
    idx: s.idx, label: s.label, color: s.color,
    points: s.latestObs
      .filter((o) => typeof o.price === 'number' && o.price > 0 && typeof o.mileage === 'number' && o.mileage >= 0)
      .map((o) => ({ x: o.mileage as number, y: o.price as number, o })),
    noKm: s.latestObs.filter((o) => !(typeof o.mileage === 'number' && o.mileage >= 0)).length,
  })), [perStudy]);
  const scatterNoKm = scatterData.reduce((n, s) => n + s.noKm, 0);
  const scatterCount = scatterData.reduce((n, s) => n + s.points.length, 0);

  // Shared-axis price distribution: common buckets across every study's latest
  // scan, counted per study (grouped bars) — click a bucket to filter listings.
  const dist = useMemo(() => {
    const priced = perStudy.map((s) => s.latestObs.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0));
    const all = priced.flat();
    if (all.length === 0) return { rows: [] as Record<string, number | string>[] };
    const min = Math.min(...all), max = Math.max(...all);
    const B = 12;
    if (min === max) {
      const row: Record<string, number | string> = { range: `${Math.round(min / 1000)}k`, from: min, to: min };
      perStudy.forEach((_s, i) => { row[`s${i}`] = priced[i].length; });
      return { rows: [row] };
    }
    const width = (max - min) / B;
    const rows = Array.from({ length: B }, (_, bi) => {
      const from = min + bi * width, to = min + (bi + 1) * width;
      const row: Record<string, number | string> = { range: `${Math.round(from / 1000)}–${Math.round(to / 1000)}k`, from, to };
      perStudy.forEach((_s, i) => {
        row[`s${i}`] = priced[i].filter((p) => Math.min(B - 1, Math.floor((p - min) / width)) === bi).length;
      });
      return row;
    });
    return { rows };
  }, [perStudy]);

  // Overlaid median-over-time: union of scan dates, one median column per study.
  const mergedSeries = useMemo(() => {
    const byTs = new Map<number, Record<string, number | string | null>>();
    perStudy.forEach((s) => s.series.forEach((r) => {
      const row = byTs.get(r.ts) ?? { ts: r.ts, date: fmtDate(r.date) };
      row[`m${s.idx}`] = r.median || null;
      byTs.set(r.ts, row);
    }));
    return [...byTs.values()].sort((a, b) => (a.ts as number) - (b.ts as number));
  }, [perStudy]);
  const seriesHasDepth = mergedSeries.length >= 2;

  const medianBars = useMemo(() =>
    perStudy.map((s) => ({ label: s.label, median: s.stats.median, color: s.color, idx: s.idx })).filter((b) => b.median > 0),
    [perStudy]);

  const sampleBars = useMemo(() =>
    perStudy.map((s) => ({ label: s.label, sample: s.latestObs.length, color: s.color, idx: s.idx })),
    [perStudy]);

  // Velocity across the union of all studies' observations (deduped).
  const { velocity, velocityCoverage } = useMemo(() => {
    const seen = new Set<string>();
    const union: Observation[] = [];
    for (const s of perStudy) for (const o of s.filtered) {
      const k = `${o.snapshot_id}|${o.internal_ref}`;
      if (seen.has(k)) continue; seen.add(k); union.push(o);
    }
    return {
      velocity: velocityFromObservations(union).filter((v) => v.soldCount > 0),
      velocityCoverage: velocityCoverageDays(union),
    };
  }, [perStudy]);

  return (
    <>
      {/* Comparison stats table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 overflow-x-auto">
        <h2 className="font-semibold text-slate-800 mb-3">Comparaison des études</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-3">Étude</th>
              <th className="py-2 pr-3">Annonces</th>
              <th className="py-2 pr-3">Profondeur</th>
              <th className="py-2 pr-3">Prix d'attaque</th>
              <th className="py-2 pr-3">Médian</th>
              <th className="py-2 pr-3">p25–p75</th>
              <th className="py-2 pr-3">min–max</th>
              <th className="py-2">Δ vs 1<sup>re</sup></th>
            </tr>
          </thead>
          <tbody>
            {perStudy.map((s) => {
              const base = perStudy[0].stats.median;
              const delta = base > 0 && s.stats.median > 0 ? s.stats.median - base : null;
              return (
                <tr key={s.idx} className="border-b border-slate-200">
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                      <span className="text-slate-800">{s.label}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-slate-700">{s.stats.count}</td>
                  <td className="py-2 pr-3 text-slate-600">{s.realDepth != null ? s.realDepth : '—'}</td>
                  <td className="py-2 pr-3 font-medium text-slate-900">
                    {s.attack ? <>{fmtEur(s.attack.price)} <span className="text-xs text-slate-400 font-normal">/ {s.attack.window}</span></> : '—'}
                  </td>
                  <td className="py-2 pr-3 font-medium text-slate-900">{fmtEur(s.stats.median)}</td>
                  <td className="py-2 pr-3 text-slate-600">{fmtEur(s.stats.p25)} – {fmtEur(s.stats.p75)}</td>
                  <td className="py-2 pr-3 text-slate-600">{fmtEur(s.stats.min)} – {fmtEur(s.stats.max)}</td>
                  <td className="py-2">
                    {s.idx === 0 || delta == null ? <span className="text-slate-400">—</span>
                      : <span className={delta < 0 ? 'text-emerald-600' : 'text-rose-600'}>{delta < 0 ? '' : '+'}{fmtEur(delta)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-slate-400 mt-2">
          Prix d'attaque = médiane des N annonces les moins chères (N : 3 en dessous de 20 annonces, 5 jusqu'à 99, 8 au-delà) —
          le prix auquel une annonce est réellement compétitive. Le médian, lui, décrit l'ensemble du marché filtré.
        </p>
      </div>

      {/* Overlaid median over time + grouped medians */}
      <div className="grid md:grid-cols-2 gap-6">
        <ChartCard title="Prix médian dans le temps" subtitle="une courbe par étude" icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}>
          {!seriesHasDepth ? <NeedMore /> : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={mergedSeries} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={52} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [fmtEur(v as number), perStudy[Number(String(name).slice(1))]?.label ?? name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(name) => perStudy[Number(String(name).slice(1))]?.label ?? name} />
                {perStudy.map((s) => (
                  <Line key={s.idx} type="monotone" dataKey={`m${s.idx}`} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Prix médian par étude" subtitle="dernier état · comparaison directe" icon={<TrendingUp className="w-4 h-4 text-blue-600" />}>
          {medianBars.length === 0 ? <NeedMore text="Pas encore de prix." /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={medianBars} layout="vertical" margin={{ top: 8, right: 40, bottom: 4, left: 8 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <YAxis type="category" dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={170} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtEur(v as number), 'Médian']} cursor={{ fill: '#0f172a0a' }} />
                <Bar dataKey="median" radius={[0, 4, 4, 0]}>
                  {medianBars.map((b) => <Cell key={b.idx} fill={b.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Sample depth per study + velocity */}
      <div className="grid md:grid-cols-2 gap-6">
        <ChartCard title="Échantillon (dernier scan)" subtitle="annonces observées par étude" icon={<Gauge className="w-4 h-4 text-amber-600" />}>
          <ResponsiveContainer width="100%" height={Math.max(160, sampleBars.length * 48)}>
            <BarChart data={sampleBars} layout="vertical" margin={{ top: 8, right: 40, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} allowDecimals={false} />
              <YAxis type="category" dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={170} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} annonces`, '']} cursor={{ fill: '#0f172a0a' }} />
              <Bar dataKey="sample" radius={[0, 4, 4, 0]}>
                {sampleBars.map((b) => <Cell key={b.idx} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <VelocityCard velocity={velocity} coverageDays={velocityCoverage} />
      </div>

      {/* Prix comparés — deux lectures commutables du même marché filtré :
          distribution (tranches cliquables) ↔ nuage prix × kilométrage
          (chaque point = une annonce, clic = ouvrir). */}
      <ChartCard
        title={priceView === 'dist' ? 'Distribution des prix comparée' : 'Nuage prix × kilométrage'}
        subtitle={priceView === 'dist'
          ? `dernier scan · barres groupées par étude${priceBand ? ' · tranche sélectionnée' : ' · clique une tranche'}`
          : `dernier scan · chaque point = une annonce · clique un point pour ouvrir l'annonce${scatterNoKm > 0 ? ` · ${scatterNoKm} sans km non plaçable(s)` : ''}`}
        icon={<Gauge className="w-4 h-4 text-amber-600" />}
        action={(
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs shrink-0" role="tablist">
            {([['dist', 'Distribution'], ['scatter', 'Nuage prix / km']] as const).map(([v, lbl]) => (
              <button
                key={v}
                role="tab"
                aria-selected={priceView === v}
                onClick={() => setPriceView(v)}
                className={`px-2.5 py-1.5 transition-colors ${priceView === v
                  ? 'bg-slate-800 text-white font-medium'
                  : 'bg-white text-slate-600 hover:text-slate-800'}`}
              >
                {lbl}
              </button>
            ))}
          </div>
        )}
      >
        {priceView === 'dist' ? (
          dist.rows.length === 0 ? <NeedMore text="Pas d'annonces." /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dist.rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="range" tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={32} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${v} annonces`, name]} labelFormatter={(l) => `${l} €`} cursor={{ fill: '#0f172a0a' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {perStudy.map((s, i) => (
                  // fill sur la Bar (pas seulement les Cells) : c'est lui que la
                  // légende utilise — sans lui, carrés noirs.
                  <Bar key={s.idx} dataKey={`s${i}`} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} cursor="pointer"
                    onClick={((d: { from?: number; to?: number }) => {
                      if (d?.from == null || d?.to == null) return;
                      setPriceBand((cur) => (cur && cur.from === d.from && cur.to === d.to ? null : { from: d.from as number, to: d.to as number }));
                    }) as never}>
                    {dist.rows.map((r, ri) => (
                      <Cell key={ri} fill={s.color}
                        fillOpacity={priceBand && !(Number(r.from) >= priceBand.from && Number(r.to) <= priceBand.to + 1) ? 0.25 : 1} />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          )
        ) : (
          scatterCount === 0 ? <NeedMore text="Pas d'annonce avec prix ET kilométrage sur la sélection." /> : (
            <ResponsiveContainer width="100%" height={340}>
              <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis
                  type="number" dataKey="x" name="Kilométrage"
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                  tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID}
                  domain={[0, 'dataMax']}
                />
                <YAxis
                  type="number" dataKey="y" name="Prix"
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k€`}
                  tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={46}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  cursor={{ stroke: AXIS, strokeDasharray: '3 3' }}
                  content={({ active: act, payload }) => {
                    if (!act || !payload || payload.length === 0) return null;
                    const p = payload[0].payload as { x: number; y: number; o: Observation } | undefined;
                    if (!p?.o) return null;
                    const s = scatterData.find((sd) => sd.points.some((pt) => pt.o === p.o));
                    return (
                      <div style={tooltipStyle} className="px-3 py-2 max-w-[260px]">
                        {s && (
                          <p className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                            <span className="truncate">{s.label}</span>
                          </p>
                        )}
                        <p className="font-semibold text-slate-900">{fmtEur(p.y)} <span className="font-normal text-slate-500">· {Math.round(p.x / 1000)} 000 km</span></p>
                        <p className="text-xs text-slate-600">
                          {[p.o.year, p.o.fuel ? fuelLabel(p.o.fuel) : '', gearboxLabel(p.o.gearbox)].filter(Boolean).join(' · ')}
                        </p>
                        {(p.o.trim || p.o.title) && <p className="text-xs text-slate-500 truncate">{p.o.trim || p.o.title}</p>}
                        {p.o.listing_url?.startsWith('http') && <p className="text-[10px] text-blue-600 mt-1">clic → ouvrir l'annonce</p>}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {scatterData.map((s, i) => (
                  <Scatter
                    key={s.idx} name={s.label} data={s.points} fill={s.color}
                    isAnimationActive={false} cursor="pointer"
                    // Identité DOUBLE : couleur pays + FORME par étude (cercle,
                    // carré, triangle, losange…) — deux pays aux teintes proches
                    // (ES rouge / NL orange) restent séparables, et l'anneau
                    // blanc garde les chevauchements lisibles. Cible ≥ 8 px.
                    shape={(props: { cx?: number; cy?: number; fill?: string }) => scatterMark(i, props)}
                    onClick={((pt: { o?: Observation }) => {
                      const url = pt?.o?.listing_url;
                      if (url?.startsWith('http')) window.open(url, '_blank', 'noopener');
                    }) as never}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          )
        )}
      </ChartCard>

      {/* Annonces par étude — colonnes côte à côte, filtrées par tranche cliquée */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-800">
            Annonces par étude
            {priceBand && <span className="text-slate-500 font-normal text-sm"> · tranche {Math.round(priceBand.from / 1000)}–{Math.round(priceBand.to / 1000)}k €</span>}
          </h2>
          {priceBand && <button onClick={() => setPriceBand(null)} className="text-xs text-slate-600 hover:text-slate-800">✕ tranche</button>}
        </div>
        <div className="flex gap-4 overflow-x-auto pb-1">
          {perStudy.map((s) => {
            const colRows = [...s.latestObs.filter((o) => !priceBand || inBand(o.price))]
              .sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).slice(0, 60);
            return (
              <div key={s.idx} className="flex-1 min-w-[260px]">
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-200">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-sm text-slate-800 truncate">{s.label}</span>
                  <span className="ml-auto inline-flex items-center gap-2 shrink-0">
                    <StudyLinks filters={s.filters} />
                    <span className="text-xs text-slate-500">{colRows.length}</span>
                  </span>
                </div>
                {colRows.length === 0 ? <p className="text-xs text-slate-400 py-4 text-center">Aucune annonce.</p> : (
                  <div className="max-h-[440px] overflow-y-auto pr-1">
                    {colRows.map((o, i) => (
                      <div key={o.internal_ref + i} className="py-2 border-b border-slate-200">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium text-slate-900">{fmtEur(o.price)}</span>
                          {o.listing_url?.startsWith('http')
                            ? <a href={o.listing_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs shrink-0">Ouvrir <ExternalLink className="w-3 h-3" /></a>
                            : <span className="text-slate-400 text-xs shrink-0">—</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {o.year ?? '—'} · {o.mileage != null ? `${o.mileage.toLocaleString('fr-FR')} km` : '—'} · {fuelLabel(o.fuel)}
                          {o.power_din != null ? ` · ${o.power_din} ch` : ''}{gearboxLabel(o.gearbox) ? ` · ${gearboxLabel(o.gearbox)}` : ''}
                        </div>
                        {(o.trim || o.title) && <div className="text-xs text-slate-600 truncate mt-0.5">{o.trim || o.title}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function VelocityCard({ velocity, coverageDays }: { velocity: VelocityStat[]; coverageDays: number }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...velocity].sort((a, b) => b.soldCount - a.soldCount);
  const rows = showAll ? sorted : sorted.slice(0, 10);
  const maxDays = Math.max(1, ...rows.map((v) => v.avgDaysToDisappear));

  return (
    <ChartCard
      title="Vélocité — proxy de vitesse de vente"
      subtitle={`fenêtre d'observation ≥ ${VELOCITY_MIN_DAYS} j par segment · page 1 seulement (une annonce peut sortir sans être vendue)`}
      icon={<Gauge className="w-4 h-4 text-rose-600" />}
    >
      {velocity.length === 0 ? (
        coverageDays > 0 ? (
          <div className="h-[140px] flex flex-col items-center justify-center gap-2 text-sm text-slate-500">
            <div className="w-48 bg-slate-200 rounded-full h-2 overflow-hidden">
              <div className="bg-rose-100 h-2" style={{ width: `${Math.min(100, Math.round((coverageDays / VELOCITY_MIN_DAYS) * 100))}%` }} />
            </div>
            <span>Collecte en cours — {Math.min(coverageDays, VELOCITY_MIN_DAYS)} j / {VELOCITY_MIN_DAYS}</span>
            <span className="text-xs text-slate-400">La vélocité s'affiche dès {VELOCITY_MIN_DAYS} jours de scans répétés sur un segment.</span>
          </div>
        ) : (
          <NeedMore text="Pas encore de scans répétés sur ce filtre." />
        )
      ) : (
        <div className="space-y-1.5">
          {rows.map((v) => (
            <div key={v.segmentId} className="flex items-center gap-3 text-xs">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COUNTRY_COLOR[v.country] ?? SERIES[5] }} />
              <span className="text-slate-700 truncate w-44 shrink-0" title={v.label}>{v.label}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${Math.round((v.avgDaysToDisappear / maxDays) * 100)}%`, background: COUNTRY_COLOR[v.country] ?? SERIES[5] }}
                />
              </div>
              <span className="text-slate-800 font-medium w-12 text-right shrink-0">{v.avgDaysToDisappear} j</span>
              <span className="text-slate-400 w-28 text-right shrink-0">{v.soldCount} disparues · {v.activeCount} actives</span>
            </div>
          ))}
          {sorted.length > 10 && (
            <button onClick={() => setShowAll((s) => !s)} className="text-xs text-slate-500 hover:text-slate-700 pt-1">
              {showAll ? 'Réduire' : `Voir les ${sorted.length - 10} autres`}
            </button>
          )}
        </div>
      )}
    </ChartCard>
  );
}

function ListingsTable({ rows }: { rows: Observation[] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">Aucune annonce.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-3">Prix</th><th className="py-2 pr-3">Année</th><th className="py-2 pr-3">Km</th>
            <th className="py-2 pr-3">Puissance</th><th className="py-2 pr-3">Boîte</th>
            <th className="py-2 pr-3">Finition</th><th className="py-2 pr-3">Carburant</th><th className="py-2">Annonce</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => (
            <tr key={o.internal_ref + i} className="border-b border-slate-200">
              <td className="py-2 pr-3 font-medium text-slate-900">{fmtEur(o.price)}</td>
              <td className="py-2 pr-3 text-slate-600">{o.year ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-600">{o.mileage != null ? `${o.mileage.toLocaleString('fr-FR')} km` : '—'}</td>
              <td className="py-2 pr-3 text-slate-600">{o.power_din != null ? `${o.power_din} ch` : '—'}</td>
              <td className="py-2 pr-3 text-slate-600">{gearboxLabel(o.gearbox) || '—'}</td>
              <td className="py-2 pr-3 text-slate-700">{o.trim || '—'}</td>
              <td className="py-2 pr-3 text-slate-700">{fuelLabel(o.fuel)}</td>
              <td className="py-2">
                {o.listing_url?.startsWith('http')
                  ? <a href={o.listing_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">Ouvrir <ExternalLink className="w-3 h-3" /></a>
                  : <span className="text-slate-400 text-xs">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Free-text filter with datalist suggestions — CONTAINS semantics downstream. */
function TextFilter({ label, value, suggestions, placeholder, onChange }:
  { label: string; value: string; suggestions: string[]; placeholder?: string; onChange: (v: string) => void }) {
  const listId = `textfilter-${label.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <div>
      <label className="block text-xs text-slate-600 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder={placeholder ?? '—'}
        className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
      />
      <datalist id={listId}>
        {suggestions.slice(0, 60).map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}

function Select({ label, value, options, onChange, flag }: { label: string; value: string; options: string[]; onChange: (v: string) => void; flag?: boolean }) {
  return (
    <div>
      <label className="block text-xs text-slate-600 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm">
        <option value="">Tous</option>
        {options.map((o) => <option key={o} value={o}>{flag ? `${COUNTRY_FLAG[o] ?? ''} ${o}` : o}</option>)}
      </select>
    </div>
  );
}
function SelectFuel({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const present = FUEL_TOKENS.filter((t) => options.includes(t));
  return (
    <div>
      <label className="block text-xs text-slate-600 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm">
        <option value="">Tous</option>
        {present.map((t) => <option key={t} value={t}>{fuelLabel(t)}</option>)}
      </select>
    </div>
  );
}
function NumRange({ label, from, to, onFrom, onTo }: { label: string; from?: number; to?: number; onFrom: (v: number | null) => void; onTo: (v: number | null) => void }) {
  return (
    <div>
      <label className="block text-xs text-slate-600 mb-1">{label} (min–max)</label>
      <div className="grid grid-cols-2 gap-2">
        <input value={from ?? ''} onChange={(e) => onFrom(e.target.value ? Number(e.target.value) : null)} placeholder="min" className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <input value={to ?? ''} onChange={(e) => onTo(e.target.value ? Number(e.target.value) : null)} placeholder="max" className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
      </div>
    </div>
  );
}
function Num({ label, value, onChange }: { label: string; value?: number; onChange: (v: number | null) => void }) {
  return (
    <div>
      <label className="block text-xs text-slate-600 mb-1">{label}</label>
      <input value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} placeholder="—" className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
    </div>
  );
}
function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="text-lg font-bold text-slate-900 truncate">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      {hint && <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}
/** Marque du nuage : la FORME suit l'ordre de l'étude (encodage secondaire —
 *  la couleur seule ne suffit pas quand deux pays ont des teintes proches). */
function scatterMark(order: number, { cx, cy, fill }: { cx?: number; cy?: number; fill?: string }) {
  if (cx == null || cy == null) return <g />;
  const common = { fill, fillOpacity: 0.8, stroke: '#ffffff', strokeWidth: 1.5 } as const;
  switch (order % 4) {
    case 1: return <rect x={cx - 4} y={cy - 4} width={8} height={8} rx={1.5} {...common} />;
    case 2: return <path d={`M ${cx} ${cy - 5} L ${cx + 4.5} ${cy + 4} L ${cx - 4.5} ${cy + 4} Z`} {...common} />;
    case 3: return <path d={`M ${cx} ${cy - 5.5} L ${cx + 5.5} ${cy} L ${cx} ${cy + 5.5} L ${cx - 5.5} ${cy} Z`} {...common} />;
    default: return <circle cx={cx} cy={cy} r={4.5} {...common} />;
  }
}

function ChartCard({ title, subtitle, icon, action, children }: { title: string; subtitle?: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}<h2 className="font-semibold text-slate-800">{title}</h2>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {subtitle && <p className="text-xs text-slate-500 mb-3">{subtitle}</p>}
      {children}
    </div>
  );
}
function NeedMore({ text = 'Au moins 2 scans nécessaires — ré-ingère ce segment plus tard.' }: { text?: string }) {
  return <div className="h-[200px] flex items-center justify-center text-sm text-slate-400 text-center px-4">{text}</div>;
}
