import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { LineChart as LineIcon, RefreshCw, TrendingUp, Gauge, AlertTriangle } from 'lucide-react';
import {
  loadMarketData, computeVelocity, priceHistogram, segmentId, segmentLabel,
} from '../services/marketData';
import type { MarketData, Snapshot, VelocityStat } from '../services/marketData';

// Validated dark-mode categorical palette (dataviz skill reference), fixed order.
const SERIES = ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767'];
const BLUE = SERIES[0];
const GRID = '#27272a';
const AXIS = '#a1a1aa';

const COUNTRY_COLOR: Record<string, string> = { FR: '#3987e5', NL: '#d95926', DK: '#199e70' };
const COUNTRY_FLAG: Record<string, string> = { FR: '🇫🇷', NL: '🇳🇱', DK: '🇩🇰' };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
function fmtEur(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`;
}

const tooltipStyle = {
  background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12, color: '#e4e4e7',
};

export function MarketIntelligence() {
  const [data, setData] = useState<MarketData>({ snapshots: [], observations: [] });
  const [loading, setLoading] = useState(true);
  const [selectedSeg, setSelectedSeg] = useState<string>('');

  const refresh = async () => {
    setLoading(true);
    const d = await loadMarketData();
    setData(d);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  // Distinct segments present in the data.
  const segments = useMemo(() => {
    const map = new Map<string, { id: string; label: string; site: string; country: string; brand: string; model: string }>();
    for (const s of data.snapshots) {
      const id = segmentId(s);
      if (!map.has(id)) map.set(id, { id, label: segmentLabel(s), site: s.site, country: s.country, brand: s.brand, model: s.model });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  useEffect(() => {
    if (!selectedSeg && segments.length > 0) setSelectedSeg(segments[0].id);
  }, [segments, selectedSeg]);

  const selected = segments.find((s) => s.id === selectedSeg);

  // Time series for the selected segment.
  const segSnaps = useMemo(
    () => data.snapshots.filter((s) => segmentId(s) === selectedSeg).sort((a, b) => a.scraped_at.localeCompare(b.scraped_at)),
    [data, selectedSeg]
  );
  const depthSeries = segSnaps.map((s) => ({ date: fmtDate(s.scraped_at), count: s.listing_count ?? s.sample_size }));
  const priceSeries = segSnaps.map((s) => ({
    date: fmtDate(s.scraped_at),
    median: s.price_median,
    band: [s.price_p25, s.price_p75] as [number | null, number | null],
  }));

  // Latest snapshot observations → price distribution.
  const latestSnap = segSnaps[segSnaps.length - 1] as Snapshot | undefined;
  const histogram = useMemo(() => {
    if (!latestSnap) return [];
    const obs = data.observations.filter((o) => o.snapshot_id === latestSnap.id);
    return priceHistogram(obs, 10);
  }, [data, latestSnap]);

  // Country comparison for the selected brand+model (latest median per country).
  const countryCompare = useMemo(() => {
    if (!selected) return [];
    const byCountry = new Map<string, Snapshot>();
    for (const s of data.snapshots) {
      if (s.brand !== selected.brand || s.model !== selected.model) continue;
      const prev = byCountry.get(s.country);
      if (!prev || s.scraped_at > prev.scraped_at) byCountry.set(s.country, s);
    }
    return [...byCountry.entries()]
      .map(([country, s]) => ({ country, median: s.price_median ?? 0, depth: s.listing_count ?? s.sample_size }))
      .sort((a, b) => a.median - b.median);
  }, [data, selected]);

  const velocity: VelocityStat[] = useMemo(() => computeVelocity(data).filter((v) => v.soldCount > 0), [data]);

  const kpiLatestDepth = latestSnap?.listing_count ?? latestSnap?.sample_size ?? null;
  const kpiLatestMedian = latestSnap?.price_median ?? null;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <LineIcon className="w-6 h-6 text-blue-500" />
            Market Intelligence
          </h1>
          <p className="text-zinc-400 mt-1 text-sm">
            Profondeur, prix et vélocité du marché de l'occasion, construits à partir des ingestions confirmées.
          </p>
        </div>
        <button onClick={refresh} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
        </button>
      </div>

      {data.snapshots.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
          Aucune donnée de marché pour l'instant. Chaque ingestion confirmée (marque + modèle) enregistre
          un instantané ici — lance quelques ingestions et la donnée apparaîtra.
        </div>
      ) : (
        <>
          {/* Segment selector + KPIs */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-zinc-400">Segment :</span>
              <select
                value={selectedSeg}
                onChange={(e) => setSelectedSeg(e.target.value)}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm min-w-[280px]"
              >
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>{COUNTRY_FLAG[s.country] ?? ''} {s.label} · {s.site}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Kpi label="Instantanés" value={String(data.snapshots.length)} />
              <Kpi label="Segments suivis" value={String(segments.length)} />
              <Kpi label="Profondeur (dernier)" value={kpiLatestDepth != null ? String(kpiLatestDepth) : '—'} />
              <Kpi label="Médian (dernier)" value={fmtEur(kpiLatestMedian)} />
            </div>
          </div>

          {/* Depth + median over time */}
          <div className="grid md:grid-cols-2 gap-6">
            <ChartCard title="Profondeur de marché" subtitle={selected?.label} icon={<TrendingUp className="w-4 h-4 text-blue-400" />}>
              {depthSeries.length < 2
                ? <NeedMore />
                : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={depthSeries} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} />
                      <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={44} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} annonces`, 'Profondeur']} />
                      <Line type="monotone" dataKey="count" name="Annonces" stroke={BLUE} strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
            </ChartCard>

            <ChartCard title="Prix médian dans le temps" subtitle="médian + fourchette p25–p75" icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}>
              {priceSeries.length < 2
                ? <NeedMore />
                : (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={priceSeries} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} />
                      <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={56} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={((v: number | number[], name: string) => Array.isArray(v) ? [`${fmtEur(v[0])} – ${fmtEur(v[1])}`, 'p25–p75'] : [fmtEur(v), name]) as never} />
                      <Area type="monotone" dataKey="band" stroke="none" fill={BLUE} fillOpacity={0.14} name="p25–p75" />
                      <Line type="monotone" dataKey="median" stroke={BLUE} strokeWidth={2} dot={{ r: 3 }} name="Médian" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
            </ChartCard>
          </div>

          {/* Price distribution + country comparison */}
          <div className="grid md:grid-cols-2 gap-6">
            <ChartCard title="Distribution des prix" subtitle={`dernier scan · ${latestSnap?.sample_size ?? 0} annonces`} icon={<Gauge className="w-4 h-4 text-amber-400" />}>
              {histogram.length === 0
                ? <NeedMore text="Pas d'annonces dans le dernier instantané." />
                : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={histogram} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="range" tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} interval={0} angle={-30} textAnchor="end" height={50} />
                      <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={32} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} annonces`, '']} labelFormatter={(l) => `${l} €`} cursor={{ fill: '#ffffff08' }} />
                      <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
            </ChartCard>

            <ChartCard title="Comparaison entre pays" subtitle={selected ? `${selected.brand} ${selected.model} · prix médian` : ''} icon={<TrendingUp className="w-4 h-4 text-violet-400" />}>
              {countryCompare.length < 2
                ? <NeedMore text="Ingère ce modèle sur ≥2 pays pour comparer." />
                : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={countryCompare} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="country" tick={{ fill: AXIS, fontSize: 12 }} stroke={GRID} tickFormatter={(c) => `${COUNTRY_FLAG[c] ?? ''} ${c}`} />
                      <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={56} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
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
              <span>
                Signal indicatif : les ingestions ne scrapent que la page 1 (≈30 moins chères), donc une annonce peut
                sortir de la page sans être vendue. Nécessite ≥2 instantanés d'un même segment. S'affinera avec le scan périodique.
              </span>
            </div>
            {velocity.length === 0
              ? <NeedMore text="Pas encore assez d'instantanés répétés pour estimer la vélocité." />
              : (
                <ResponsiveContainer width="100%" height={Math.max(180, velocity.length * 38)}>
                  <BarChart data={velocity} layout="vertical" margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} tickFormatter={(v) => `${v} j`} />
                    <YAxis type="category" dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={180} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, p) => [`${v} jours · ${(p?.payload as VelocityStat).soldCount} disparues / ${(p?.payload as VelocityStat).activeCount} actives`, '']} cursor={{ fill: '#ffffff08' }} />
                    <Bar dataKey="avgDaysToDisappear" radius={[0, 4, 4, 0]}>
                      {velocity.map((v) => <Cell key={v.segmentId} fill={COUNTRY_COLOR[v.country] ?? SERIES[5]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
          </ChartCard>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
      <div className="text-xl font-bold text-zinc-100">{value}</div>
      <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}

function ChartCard({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}<h2 className="font-semibold text-zinc-200">{title}</h2>
      </div>
      {subtitle && <p className="text-xs text-zinc-500 mb-3">{subtitle}</p>}
      {children}
    </div>
  );
}

function NeedMore({ text = 'Au moins 2 instantanés nécessaires — ré-ingère ce segment plus tard.' }: { text?: string }) {
  return <div className="h-[200px] flex items-center justify-center text-sm text-zinc-600 text-center px-4">{text}</div>;
}
