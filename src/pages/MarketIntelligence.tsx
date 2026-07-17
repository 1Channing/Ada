import { useEffect, useMemo, useState } from 'react';
import {
  Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, ComposedChart,
} from 'recharts';
import { LineChart as LineIcon, RefreshCw, TrendingUp, Gauge, AlertTriangle, RotateCcw, ExternalLink } from 'lucide-react';
import {
  loadMarketData, filterObservations, distinctValues, priceStats, timeSeries,
  priceHistogramFrom, velocityFromObservations, isCoarseOnly, fuelLabel,
} from '../services/marketData';
import type { MarketData, MarketFilters, Observation, VelocityStat } from '../services/marketData';
import type { FuelToken } from '../lib/study-core/ingestion';

const SERIES = ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767'];
const BLUE = SERIES[0];
const GRID = '#27272a';
const AXIS = '#a1a1aa';
const COUNTRY_COLOR: Record<string, string> = { FR: '#3987e5', NL: '#d95926', DK: '#199e70' };
const COUNTRY_FLAG: Record<string, string> = { FR: '🇫🇷', NL: '🇳🇱', DK: '🇩🇰' };
const FUEL_TOKENS: FuelToken[] = ['petrol', 'diesel', 'hybrid', 'mild_hybrid', 'phev', 'electric', 'hydrogen', 'cng', 'lpg'];

const FILTERS_KEY = 'ada_market_filters';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
function fmtEur(n: number | null | undefined): string {
  return n == null || n === 0 ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`;
}
const tooltipStyle = { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12, color: '#e4e4e7' };

export function MarketIntelligence() {
  const [data, setData] = useState<MarketData>({ snapshots: [], observations: [] });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<MarketFilters>(() => {
    try { return JSON.parse(sessionStorage.getItem(FILTERS_KEY) || '{}'); } catch { return {}; }
  });
  const [priceBand, setPriceBand] = useState<{ from: number; to: number } | null>(null);

  const refresh = async () => { setLoading(true); setData(await loadMarketData()); setLoading(false); };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* ignore */ } }, [filters]);

  const set = (patch: Partial<MarketFilters>) => { setFilters((f) => ({ ...f, ...patch })); setPriceBand(null); };
  const reset = () => { setFilters({}); setPriceBand(null); };

  const obs = data.observations;
  const filtered = useMemo(() => filterObservations(obs, filters), [obs, filters]);

  // Cascading option lists (each respects the other active filters).
  const opts = {
    site: useMemo(() => distinctValues(obs, 'site', filters), [obs, filters]),
    country: useMemo(() => distinctValues(obs, 'country', filters), [obs, filters]),
    brand: useMemo(() => distinctValues(obs, 'brand', filters), [obs, filters]),
    model: useMemo(() => distinctValues(obs, 'model', filters), [obs, filters]),
    trim: useMemo(() => distinctValues(obs, 'trim', filters), [obs, filters]),
    fuel: useMemo(() => distinctValues(obs, 'fuel', filters), [obs, filters]),
  };

  const stats = useMemo(() => priceStats(filtered), [filtered]);
  const series = useMemo(() => timeSeries(filtered).map((r) => ({
    date: fmtDate(r.date), median: r.median, band: [r.p25, r.p75] as [number, number], count: r.count,
  })), [filtered]);

  // Latest snapshot observations (for the price distribution + listings table).
  const latestObs = useMemo(() => {
    if (filtered.length === 0) return [];
    const latestTs = Math.max(...filtered.map((o) => new Date(o.scraped_at).getTime()));
    return filtered.filter((o) => Math.abs(new Date(o.scraped_at).getTime() - latestTs) < 60_000);
  }, [filtered]);
  const histogram = useMemo(() => priceHistogramFrom(latestObs, 12), [latestObs]);

  const countryCompare = useMemo(() => {
    const byCountry = new Map<string, Observation[]>();
    for (const o of latestObs) { const a = byCountry.get(o.country) ?? []; a.push(o); byCountry.set(o.country, a); }
    return [...byCountry.entries()].map(([country, list]) => ({ country, median: priceStats(list).median }))
      .filter((c) => c.median > 0).sort((a, b) => a.median - b.median);
  }, [latestObs]);

  const velocity = useMemo(() => velocityFromObservations(filtered).filter((v) => v.soldCount > 0), [filtered]);

  // Real market depth (site's reported total) for the coarse segment, latest.
  const realDepth = useMemo(() => {
    if (!filters.brand || !filters.model) return null;
    const matching = data.snapshots.filter((s) =>
      (!filters.site || s.site === filters.site) && (!filters.country || s.country === filters.country) &&
      s.brand === filters.brand && s.model === filters.model && s.listing_count != null);
    if (matching.length === 0) return null;
    return matching.sort((a, b) => b.scraped_at.localeCompare(a.scraped_at))[0].listing_count;
  }, [data, filters]);

  // Listings table (latest snapshot, optionally narrowed to a clicked price bucket).
  const tableRows = useMemo(() => {
    let rows = latestObs;
    if (priceBand) rows = rows.filter((o) => o.price != null && o.price >= priceBand.from && o.price <= priceBand.to);
    return [...rows].sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).slice(0, 60);
  }, [latestObs, priceBand]);

  const activeFilterCount = Object.values(filters).filter((v) => v != null && v !== '').length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3"><LineIcon className="w-6 h-6 text-blue-500" /> Market Intelligence</h1>
          <p className="text-zinc-400 mt-1 text-sm">Profondeur, prix et vélocité du marché — filtrable au grain de l'annonce, temps réel.</p>
        </div>
        <button onClick={refresh} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
        </button>
      </div>

      {data.observations.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
          Aucune donnée de marché pour l'instant. Chaque ingestion confirmée enregistre les annonces ici.
        </div>
      ) : (
        <>
          {/* Filter panel */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-200 text-sm">Filtres {activeFilterCount > 0 && <span className="text-zinc-500 font-normal">· {activeFilterCount} actif{activeFilterCount > 1 ? 's' : ''}</span>}</h2>
              <button onClick={reset} disabled={activeFilterCount === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40">
                <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Select label="Site" value={filters.site ?? ''} options={opts.site} onChange={(v) => set({ site: v || undefined })} />
              <Select label="Pays" value={filters.country ?? ''} options={opts.country} onChange={(v) => set({ country: v || undefined })} flag />
              <Select label="Marque" value={filters.brand ?? ''} options={opts.brand} onChange={(v) => set({ brand: v || undefined })} />
              <Select label="Modèle" value={filters.model ?? ''} options={opts.model} onChange={(v) => set({ model: v || undefined })} />
              <Select label="Finition" value={filters.trim ?? ''} options={opts.trim} onChange={(v) => set({ trim: v || undefined })} />
              <SelectFuel label="Carburant" value={filters.fuel ?? ''} options={opts.fuel} onChange={(v) => set({ fuel: (v || undefined) as FuelToken | undefined })} />
              <NumRange label="Année" from={filters.yearMin ?? undefined} to={filters.yearMax ?? undefined}
                onFrom={(v) => set({ yearMin: v })} onTo={(v) => set({ yearMax: v })} />
              <div className="grid grid-cols-2 gap-2">
                <Num label="Km max" value={filters.mileageMax ?? undefined} onChange={(v) => set({ mileageMax: v })} />
                <Num label="Puiss. min" value={filters.powerMin ?? undefined} onChange={(v) => set({ powerMin: v })} />
              </div>
            </div>
          </div>

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
          <ChartCard title="Vélocité — proxy de vitesse de vente" subtitle="jours avant qu'une annonce disparaisse (moyenne)" icon={<Gauge className="w-4 h-4 text-rose-400" />}>
            <div className="flex items-start gap-2 text-xs text-amber-300/80 mb-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Signal indicatif : page 1 (≈30 moins chères) seulement, donc une annonce peut sortir sans être vendue. Nécessite ≥2 scans d'un même segment. S'affinera avec le scan périodique.</span>
            </div>
            {velocity.length === 0 ? <NeedMore text="Pas encore assez de scans répétés." /> : (
              <ResponsiveContainer width="100%" height={Math.max(160, velocity.length * 34)}>
                <BarChart data={velocity} layout="vertical" margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} tickFormatter={(v) => `${v} j`} />
                  <YAxis type="category" dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={200} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, p) => [`${v} jours · ${(p?.payload as VelocityStat).soldCount} disparues / ${(p?.payload as VelocityStat).activeCount} actives`, '']} cursor={{ fill: '#ffffff08' }} />
                  <Bar dataKey="avgDaysToDisappear" radius={[0, 4, 4, 0]}>
                    {velocity.map((v) => <Cell key={v.segmentId} fill={COUNTRY_COLOR[v.country] ?? SERIES[5]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Listings table */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-zinc-200">Annonces {priceBand && <span className="text-zinc-500 font-normal text-sm">· tranche {Math.round(priceBand.from / 1000)}–{Math.round(priceBand.to / 1000)}k €</span>}</h2>
              {priceBand && <button onClick={() => setPriceBand(null)} className="text-xs text-zinc-400 hover:text-zinc-200">✕ tranche</button>}
            </div>
            {tableRows.length === 0 ? <p className="text-sm text-zinc-500">Aucune annonce.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500 border-b border-zinc-800">
                      <th className="py-2 pr-3">Prix</th><th className="py-2 pr-3">Année</th><th className="py-2 pr-3">Km</th>
                      <th className="py-2 pr-3">Finition</th><th className="py-2 pr-3">Carburant</th><th className="py-2">Annonce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((o, i) => (
                      <tr key={o.internal_ref + i} className="border-b border-zinc-800/50">
                        <td className="py-2 pr-3 font-medium text-zinc-100">{fmtEur(o.price)}</td>
                        <td className="py-2 pr-3 text-zinc-400">{o.year ?? '—'}</td>
                        <td className="py-2 pr-3 text-zinc-400">{o.mileage != null ? `${o.mileage.toLocaleString('fr-FR')} km` : '—'}</td>
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
            )}
          </div>
        </>
      )}
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
