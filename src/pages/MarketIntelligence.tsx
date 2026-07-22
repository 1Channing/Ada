import { useEffect, useMemo, useState } from 'react';
import {
  Line, LineChart, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ComposedChart,
} from 'recharts';
import { LineChart as LineIcon, RefreshCw, TrendingUp, Gauge, RotateCcw, ExternalLink, Plus, X } from 'lucide-react';
import {
  loadMarketData, loadKnownDimensions, sortedUnion, canonUnion, canonKey, brandKey, filterObservations, distinctValues, priceStats, timeSeries,
  priceHistogramFrom, velocityFromObservations, velocityCoverageDays, VELOCITY_MIN_DAYS, isCoarseOnly, fuelLabel,
} from '../services/marketData';
import type { MarketData, MarketFilters, Observation, Snapshot, VelocityStat, KnownDimensions } from '../services/marketData';
import type { FuelToken } from '../lib/study-core/ingestion';
import { getRefWindowsCached, findRefWindow } from '../services/vehicleRef';
import type { RefWindowMap, RefWindow } from '../services/vehicleRef';
import { OpportunityAlerts } from '../components/OpportunityAlerts';

const SERIES = ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767'];
const BLUE = SERIES[0];
const GRID = '#27272a';
const AXIS = '#a1a1aa';
// Distinct, well-separated hues for the (up to 3) compared studies.
const STUDY_COLORS = ['#3987e5', '#d95926', '#199e70'];
// One LOGICAL colour per country, stable everywhere (charts, legends):
// FR bleu, DK blanc, DE or, IT vert, ES rouge, NL orange, BE violet.
const COUNTRY_COLOR: Record<string, string> = {
  FR: '#3b82f6', DK: '#f4f4f5', DE: '#eab308', IT: '#22c55e', ES: '#ef4444', NL: '#f97316', BE: '#a855f7',
};
const COUNTRY_FLAG: Record<string, string> = {
  FR: '🇫🇷', NL: '🇳🇱', DK: '🇩🇰', DE: '🇩🇪', IT: '🇮🇹', ES: '🇪🇸', BE: '🇧🇪',
};
const FUEL_TOKENS: FuelToken[] = ['petrol', 'diesel', 'hybrid', 'mild_hybrid', 'phev', 'electric', 'hydrogen', 'cng', 'lpg'];

const STUDIES_KEY = 'ada_market_studies';
const LEGACY_FILTERS_KEY = 'ada_market_filters';
const MAX_STUDIES = 3;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
function fmtEur(n: number | null | undefined): string {
  return n == null || n === 0 ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`;
}
const tooltipStyle = { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12, color: '#e4e4e7' };

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

  const refresh = async () => {
    setLoading(true);
    const [d, k] = await Promise.all([loadMarketData(), loadKnownDimensions()]);
    setData(d); setKnown(k); setLoading(false);
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { try { sessionStorage.setItem(STUDIES_KEY, JSON.stringify(studies)); } catch { /* ignore */ } }, [studies]);

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

  // Cascading option lists for the ACTIVE study. Site/country/brand/model are
  // the UNION of what has observations AND what ADA knows (mapped segments +
  // covered sites/countries), so a mapped-but-not-yet-scanned segment stays
  // selectable (charts then show the "awaiting data" state). Trim/fuel stay
  // observation-only (not reliably in the mapping memory). All alphabetical.
  const opts = {
    site: useMemo(() => sortedUnion(distinctValues(obs, 'site', active), known.sites), [obs, active, known]),
    country: useMemo(() => sortedUnion(distinctValues(obs, 'country', active), known.countries), [obs, active, known]),
    // Marque/modèle : une seule entrée par véhicule, quelle que soit la graphie
    // des sites ('RAV4'/'RAV-4'/'RAV 4') — la variante des observations gagne.
    brand: useMemo(() => canonUnion(distinctValues(obs, 'brand', active), known.brands, brandKey), [obs, active, known]),
    model: useMemo(() => {
      const mapped = active.brand ? (known.modelsByBrand[brandKey(active.brand)] ?? []) : Object.values(known.modelsByBrand).flat();
      return canonUnion(distinctValues(obs, 'model', active), mapped, canonKey);
    }, [obs, active, known]),
    trim: useMemo(() => distinctValues(obs, 'trim', active), [obs, active]),
    fuel: useMemo(() => {
      const key = active.brand && active.model ? `${brandKey(active.brand)}|${canonKey(active.model)}` : '';
      const mapped = key ? (known.fuelsByBrandModel[key] ?? []) : known.allFuels;
      return sortedUnion(distinctValues(obs, 'fuel', active), mapped);
    }, [obs, active, known]),
    gearbox: useMemo(() => distinctValues(obs, 'gearbox' as keyof Observation, active), [obs, active]),
  };

  // Per-study derived data (used by both single & comparison views).
  // Colour: the study's COUNTRY colour when it has one (FR bleu, DK blanc…) —
  // instantly readable in a low-vs-high comparison — falling back to the index
  // palette (and never letting two studies share a colour).
  const perStudy = useMemo(() => studies.map((f, i) => {
    const countryColor = f.country ? COUNTRY_COLOR[f.country] : undefined;
    const firstWithCountry = studies.findIndex((x) => x.country === f.country);
    const color = countryColor && firstWithCountry === i ? countryColor : STUDY_COLORS[i] ?? BLUE;
    const filtered = filterObservations(obs, f);
    const latestTs = filtered.length ? Math.max(...filtered.map((o) => new Date(o.scraped_at).getTime())) : 0;
    const latestObs = filtered.filter((o) => Math.abs(new Date(o.scraped_at).getTime() - latestTs) < 60_000);
    return {
      idx: i, filters: f, color, label: studyLabel(f, i),
      filtered, latestObs, stats: priceStats(filtered), series: timeSeries(filtered),
      realDepth: computeRealDepth(data.snapshots, f),
    };
  }), [studies, obs, data.snapshots]);

  const activeFilterCount = Object.values(active).filter((v) => v != null && v !== '').length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3"><LineIcon className="w-6 h-6 text-blue-500" /> Market Intelligence</h1>
          <p className="text-zinc-400 mt-1 text-sm">Profondeur, prix et vélocité du marché — filtrable au grain de l'annonce, jusqu'à 3 études comparées.</p>
        </div>
        <button onClick={refresh} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
        </button>
      </div>

      {/* Radar d'opportunités inter-pays — alimenté par chaque scrape (campagnes incluses).
          Inspecter = ouvrir DIRECTEMENT les deux marchés de l'écart en études
          comparées (pays bas vs pays haut), prêtes à lire côte à côte. */}
      <OpportunityAlerts onInspect={(o) => {
        const base = { brand: o.brand, model: o.model, fuel: o.fuel as FuelToken, yearMin: o.year, yearMax: o.year };
        setStudies([
          { ...base, country: o.lowCountry },
          { ...base, country: o.highCountry },
        ]);
        setActiveIdx(0);
        setPriceBand(null);
      }} />

      {data.observations.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
          Aucune donnée de marché pour l'instant. Chaque ingestion confirmée enregistre les annonces ici.
        </div>
      ) : (
        <>
          {/* Study bar — pick which study you're editing, add/remove up to 3. */}
          <div className="flex flex-wrap items-center gap-2">
            {perStudy.map((s) => (
              <div key={s.idx}
                className={`inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-lg border text-sm cursor-pointer transition
                  ${s.idx === activeIdx ? 'bg-zinc-800 border-zinc-600' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}
                onClick={() => { setActiveIdx(s.idx); setPriceBand(null); }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                <span className={s.idx === activeIdx ? 'text-zinc-100' : 'text-zinc-400'}>{s.label}</span>
                <span className="text-[10px] text-zinc-500">{s.stats.count}</span>
                {studies.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); removeStudy(s.idx); }}
                    className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200" title="Retirer cette étude">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {studies.length < MAX_STUDIES && (
              <button onClick={addStudy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-zinc-700 hover:border-zinc-500 text-sm text-zinc-400 hover:text-zinc-200">
                <Plus className="w-4 h-4" /> Ajouter une étude
              </button>
            )}
          </div>

          {/* Filter panel — edits the ACTIVE study. */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-200 text-sm flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: STUDY_COLORS[activeIdx] ?? BLUE }} />
                Filtres · {studyLabel(active, activeIdx)}
                {activeFilterCount > 0 && <span className="text-zinc-500 font-normal">· {activeFilterCount} actif{activeFilterCount > 1 ? 's' : ''}</span>}
              </h2>
              <button onClick={resetActive} disabled={activeFilterCount === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40">
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
              <div className="mt-2 text-[11px] text-zinc-500">
                Commercialisé {refWin.yearFrom} – {refWin.yearTo ?? 'aujourd’hui'}
                <span className="text-zinc-600"> · référentiel constructeur</span>
              </div>
            )}
          </div>

          {comparing
            ? <ComparisonView perStudy={perStudy} />
            : <SingleStudyView study={perStudy[0]} filters={active} priceBand={priceBand} setPriceBand={setPriceBand} />}
        </>
      )}
    </div>
  );
}

// ─── Single-study dashboard (the full, rich view) ───────────────────────────────

interface StudyDerived {
  idx: number; filters: MarketFilters; color: string; label: string;
  filtered: Observation[]; latestObs: Observation[];
  stats: ReturnType<typeof priceStats>; series: ReturnType<typeof timeSeries>;
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi label="Annonces (filtre)" value={String(stats.count)} />
        <Kpi label="Profondeur marché" value={realDepth != null ? String(realDepth) : '—'} hint={realDepth != null ? 'total site (marque/modèle)' : 'sélectionne marque+modèle'} />
        <Kpi label="Médian" value={fmtEur(stats.median)} />
        <Kpi label="Fourchette p25–p75" value={`${fmtEur(stats.p25)} – ${fmtEur(stats.p75)}`} />
        <Kpi label="Étalement min–max" value={`${fmtEur(stats.min)} – ${fmtEur(stats.max)}`} />
      </div>

      {/* Median over time + depth over time */}
      <div className="grid md:grid-cols-2 gap-6">
        <ChartCard title="Prix médian dans le temps" subtitle="médian + fourchette p25–p75" icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}>
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

        <ChartCard title="Profondeur (annonces observées)" subtitle={isCoarseOnly(filters) ? 'nombre d’annonces vues par scan' : 'échantillon filtré · page 1'} icon={<TrendingUp className="w-4 h-4 text-blue-400" />}>
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
        <ChartCard title="Distribution des prix" subtitle={`dernier scan · ${latestObs.length} annonces${priceBand ? ' · tranche sélectionnée' : ' · clique une barre'}`} icon={<Gauge className="w-4 h-4 text-amber-400" />}>
          {histogram.length === 0 ? <NeedMore text="Pas d'annonces." /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={histogram} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="range" tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={32} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} annonces`, '']} labelFormatter={(l) => `${l} €`} cursor={{ fill: '#ffffff08' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer" onClick={((d: { from?: number; to?: number }) => { if (d?.from != null && d?.to != null) setPriceBand({ from: d.from, to: d.to }); }) as never}>
                  {histogram.map((b) => <Cell key={b.range} fill={priceBand && b.from >= priceBand.from && b.to <= priceBand.to + 1 ? SERIES[3] : BLUE} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Comparaison entre pays" subtitle="prix médian · vue filtrée" icon={<TrendingUp className="w-4 h-4 text-violet-400" />}>
          {countryCompare.length < 2 ? <NeedMore text="Données sur ≥2 pays nécessaires (filtre marque/modèle)." /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={countryCompare} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="country" tick={{ fill: AXIS, fontSize: 12 }} stroke={GRID} tickFormatter={(c) => `${COUNTRY_FLAG[c] ?? ''} ${c}`} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={52} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtEur(v as number), 'Médian']} labelFormatter={(c) => `${COUNTRY_FLAG[c] ?? ''} ${c}`} cursor={{ fill: '#ffffff08' }} />
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
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-zinc-200">Annonces {priceBand && <span className="text-zinc-500 font-normal text-sm">· tranche {Math.round(priceBand.from / 1000)}–{Math.round(priceBand.to / 1000)}k €</span>}</h2>
          {priceBand && <button onClick={() => setPriceBand(null)} className="text-xs text-zinc-400 hover:text-zinc-200">✕ tranche</button>}
        </div>
        <ListingsTable rows={tableRows} />
      </div>
    </>
  );
}

// ─── Comparison view (2–3 studies side by side) ─────────────────────────────────

function ComparisonView({ perStudy }: { perStudy: StudyDerived[] }) {
  const [priceBand, setPriceBand] = useState<{ from: number; to: number } | null>(null);
  const filtersSig = perStudy.map((s) => JSON.stringify(s.filters)).join('|');
  useEffect(() => { setPriceBand(null); }, [filtersSig]);
  const inBand = (p: number | null) => p != null && priceBand != null && p >= priceBand.from && p <= priceBand.to;

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
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 overflow-x-auto">
        <h2 className="font-semibold text-zinc-200 mb-3">Comparaison des études</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-800">
              <th className="py-2 pr-3">Étude</th>
              <th className="py-2 pr-3">Annonces</th>
              <th className="py-2 pr-3">Profondeur</th>
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
                <tr key={s.idx} className="border-b border-zinc-800/50">
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                      <span className="text-zinc-200">{s.label}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-zinc-300">{s.stats.count}</td>
                  <td className="py-2 pr-3 text-zinc-400">{s.realDepth != null ? s.realDepth : '—'}</td>
                  <td className="py-2 pr-3 font-medium text-zinc-100">{fmtEur(s.stats.median)}</td>
                  <td className="py-2 pr-3 text-zinc-400">{fmtEur(s.stats.p25)} – {fmtEur(s.stats.p75)}</td>
                  <td className="py-2 pr-3 text-zinc-400">{fmtEur(s.stats.min)} – {fmtEur(s.stats.max)}</td>
                  <td className="py-2">
                    {s.idx === 0 || delta == null ? <span className="text-zinc-600">—</span>
                      : <span className={delta < 0 ? 'text-emerald-400' : 'text-rose-400'}>{delta < 0 ? '' : '+'}{fmtEur(delta)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Overlaid median over time + grouped medians */}
      <div className="grid md:grid-cols-2 gap-6">
        <ChartCard title="Prix médian dans le temps" subtitle="une courbe par étude" icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}>
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

        <ChartCard title="Prix médian par étude" subtitle="dernier état · comparaison directe" icon={<TrendingUp className="w-4 h-4 text-blue-400" />}>
          {medianBars.length === 0 ? <NeedMore text="Pas encore de prix." /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={medianBars} layout="vertical" margin={{ top: 8, right: 40, bottom: 4, left: 8 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <YAxis type="category" dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={170} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtEur(v as number), 'Médian']} cursor={{ fill: '#ffffff08' }} />
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
        <ChartCard title="Échantillon (dernier scan)" subtitle="annonces observées par étude" icon={<Gauge className="w-4 h-4 text-amber-400" />}>
          <ResponsiveContainer width="100%" height={Math.max(160, sampleBars.length * 48)}>
            <BarChart data={sampleBars} layout="vertical" margin={{ top: 8, right: 40, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} allowDecimals={false} />
              <YAxis type="category" dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={170} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} annonces`, '']} cursor={{ fill: '#ffffff08' }} />
              <Bar dataKey="sample" radius={[0, 4, 4, 0]}>
                {sampleBars.map((b) => <Cell key={b.idx} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <VelocityCard velocity={velocity} coverageDays={velocityCoverage} />
      </div>

      {/* Distribution des prix — comparée, cliquable par tranche */}
      <ChartCard title="Distribution des prix comparée" subtitle={`dernier scan · barres groupées par étude${priceBand ? ' · tranche sélectionnée' : ' · clique une tranche'}`} icon={<Gauge className="w-4 h-4 text-amber-400" />}>
        {dist.rows.length === 0 ? <NeedMore text="Pas d'annonces." /> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dist.rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="range" tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={32} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${v} annonces`, name]} labelFormatter={(l) => `${l} €`} cursor={{ fill: '#ffffff08' }} />
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
        )}
      </ChartCard>

      {/* Annonces par étude — colonnes côte à côte, filtrées par tranche cliquée */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-zinc-200">
            Annonces par étude
            {priceBand && <span className="text-zinc-500 font-normal text-sm"> · tranche {Math.round(priceBand.from / 1000)}–{Math.round(priceBand.to / 1000)}k €</span>}
          </h2>
          {priceBand && <button onClick={() => setPriceBand(null)} className="text-xs text-zinc-400 hover:text-zinc-200">✕ tranche</button>}
        </div>
        <div className="flex gap-4 overflow-x-auto pb-1">
          {perStudy.map((s) => {
            const colRows = [...s.latestObs.filter((o) => !priceBand || inBand(o.price))]
              .sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).slice(0, 60);
            return (
              <div key={s.idx} className="flex-1 min-w-[260px]">
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-zinc-800">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-sm text-zinc-200 truncate">{s.label}</span>
                  <span className="ml-auto text-xs text-zinc-500 shrink-0">{colRows.length}</span>
                </div>
                {colRows.length === 0 ? <p className="text-xs text-zinc-600 py-4 text-center">Aucune annonce.</p> : (
                  <div className="max-h-[440px] overflow-y-auto pr-1">
                    {colRows.map((o, i) => (
                      <div key={o.internal_ref + i} className="py-2 border-b border-zinc-800/40">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium text-zinc-100">{fmtEur(o.price)}</span>
                          {o.listing_url
                            ? <a href={o.listing_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:underline text-xs shrink-0">Ouvrir <ExternalLink className="w-3 h-3" /></a>
                            : <span className="text-zinc-600 text-xs shrink-0">—</span>}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {o.year ?? '—'} · {o.mileage != null ? `${o.mileage.toLocaleString('fr-FR')} km` : '—'} · {fuelLabel(o.fuel)}
                          {o.power_din != null ? ` · ${o.power_din} ch` : ''}{o.gearbox ? ` · ${o.gearbox}` : ''}
                        </div>
                        {(o.trim || o.title) && <div className="text-xs text-zinc-400 truncate mt-0.5">{o.trim || o.title}</div>}
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
      icon={<Gauge className="w-4 h-4 text-rose-400" />}
    >
      {velocity.length === 0 ? (
        coverageDays > 0 ? (
          <div className="h-[140px] flex flex-col items-center justify-center gap-2 text-sm text-zinc-500">
            <div className="w-48 bg-zinc-800 rounded-full h-2 overflow-hidden">
              <div className="bg-rose-500/70 h-2" style={{ width: `${Math.min(100, Math.round((coverageDays / VELOCITY_MIN_DAYS) * 100))}%` }} />
            </div>
            <span>Collecte en cours — {Math.min(coverageDays, VELOCITY_MIN_DAYS)} j / {VELOCITY_MIN_DAYS}</span>
            <span className="text-xs text-zinc-600">La vélocité s'affiche dès {VELOCITY_MIN_DAYS} jours de scans répétés sur un segment.</span>
          </div>
        ) : (
          <NeedMore text="Pas encore de scans répétés sur ce filtre." />
        )
      ) : (
        <div className="space-y-1.5">
          {rows.map((v) => (
            <div key={v.segmentId} className="flex items-center gap-3 text-xs">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COUNTRY_COLOR[v.country] ?? SERIES[5] }} />
              <span className="text-zinc-300 truncate w-44 shrink-0" title={v.label}>{v.label}</span>
              <div className="flex-1 bg-zinc-800/60 rounded-full h-2 overflow-hidden">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${Math.round((v.avgDaysToDisappear / maxDays) * 100)}%`, background: COUNTRY_COLOR[v.country] ?? SERIES[5] }}
                />
              </div>
              <span className="text-zinc-200 font-medium w-12 text-right shrink-0">{v.avgDaysToDisappear} j</span>
              <span className="text-zinc-600 w-28 text-right shrink-0">{v.soldCount} disparues · {v.activeCount} actives</span>
            </div>
          ))}
          {sorted.length > 10 && (
            <button onClick={() => setShowAll((s) => !s)} className="text-xs text-zinc-500 hover:text-zinc-300 pt-1">
              {showAll ? 'Réduire' : `Voir les ${sorted.length - 10} autres`}
            </button>
          )}
        </div>
      )}
    </ChartCard>
  );
}

function ListingsTable({ rows }: { rows: Observation[] }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-500">Aucune annonce.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-800">
            <th className="py-2 pr-3">Prix</th><th className="py-2 pr-3">Année</th><th className="py-2 pr-3">Km</th>
            <th className="py-2 pr-3">Puissance</th><th className="py-2 pr-3">Boîte</th>
            <th className="py-2 pr-3">Finition</th><th className="py-2 pr-3">Carburant</th><th className="py-2">Annonce</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => (
            <tr key={o.internal_ref + i} className="border-b border-zinc-800/50">
              <td className="py-2 pr-3 font-medium text-zinc-100">{fmtEur(o.price)}</td>
              <td className="py-2 pr-3 text-zinc-400">{o.year ?? '—'}</td>
              <td className="py-2 pr-3 text-zinc-400">{o.mileage != null ? `${o.mileage.toLocaleString('fr-FR')} km` : '—'}</td>
              <td className="py-2 pr-3 text-zinc-400">{o.power_din != null ? `${o.power_din} ch` : '—'}</td>
              <td className="py-2 pr-3 text-zinc-400">{o.gearbox || '—'}</td>
              <td className="py-2 pr-3 text-zinc-300">{o.trim || '—'}</td>
              <td className="py-2 pr-3 text-zinc-300">{fuelLabel(o.fuel)}</td>
              <td className="py-2">
                {o.listing_url
                  ? <a href={o.listing_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:underline text-xs">Ouvrir <ExternalLink className="w-3 h-3" /></a>
                  : <span className="text-zinc-600 text-xs">—</span>}
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
      <label className="block text-xs text-zinc-400 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder={placeholder ?? '—'}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm"
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
      <label className="block text-xs text-zinc-400 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm">
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
      <label className="block text-xs text-zinc-400 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm">
        <option value="">Tous</option>
        {present.map((t) => <option key={t} value={t}>{fuelLabel(t)}</option>)}
      </select>
    </div>
  );
}
function NumRange({ label, from, to, onFrom, onTo }: { label: string; from?: number; to?: number; onFrom: (v: number | null) => void; onTo: (v: number | null) => void }) {
  return (
    <div>
      <label className="block text-xs text-zinc-400 mb-1">{label} (min–max)</label>
      <div className="grid grid-cols-2 gap-2">
        <input value={from ?? ''} onChange={(e) => onFrom(e.target.value ? Number(e.target.value) : null)} placeholder="min" className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm" />
        <input value={to ?? ''} onChange={(e) => onTo(e.target.value ? Number(e.target.value) : null)} placeholder="max" className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm" />
      </div>
    </div>
  );
}
function Num({ label, value, onChange }: { label: string; value?: number; onChange: (v: number | null) => void }) {
  return (
    <div>
      <label className="block text-xs text-zinc-400 mb-1">{label}</label>
      <input value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} placeholder="—" className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm" />
    </div>
  );
}
function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
      <div className="text-lg font-bold text-zinc-100 truncate">{value}</div>
      <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
      {hint && <div className="text-[10px] text-zinc-600 mt-0.5">{hint}</div>}
    </div>
  );
}
function ChartCard({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">{icon}<h2 className="font-semibold text-zinc-200">{title}</h2></div>
      {subtitle && <p className="text-xs text-zinc-500 mb-3">{subtitle}</p>}
      {children}
    </div>
  );
}
function NeedMore({ text = 'Au moins 2 scans nécessaires — ré-ingère ce segment plus tard.' }: { text?: string }) {
  return <div className="h-[200px] flex items-center justify-center text-sm text-zinc-600 text-center px-4">{text}</div>;
}
