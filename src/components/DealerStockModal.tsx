import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, X, Loader2 } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listStockRuns, listStockVehicles, scanDealerStock, type StockRun, type StockVehicle } from '../services/dealerStock';

/**
 * STOCK D'UNE CONCESSION DE LA CARTE (30/09, demande Channing) : la liste de
 * leurs voitures telle que le worker l'a relevée, et le DIFF avec le relevé
 * précédent — nouveaux (arrivages), disparus (vendus ou retirés = vélocité),
 * prix changés. « Relever maintenant » relance le worker.
 */
type Tab = 'stock' | 'new' | 'gone' | 'price';
const fmtEur = (n: number | null) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const days = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)) : null);

export function DealerStockModal({ contactId, name, url, onClose }: { contactId: string; name: string; url: string; onClose: () => void }) {
  const { displayName, email } = useAuth();
  const [vehicles, setVehicles] = useState<StockVehicle[]>([]);
  const [runs, setRuns] = useState<StockRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('stock');
  const [query, setQuery] = useState('');

  const load = async () => {
    const [r, v] = await Promise.all([listStockRuns(contactId), listStockVehicles(contactId)]);
    setRuns(r.runs); setVehicles(v.vehicles); setError(r.error ?? v.error);
    setLoading(false);
  };
  useEffect(() => { void load(); }, [contactId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastRun = runs.find((r) => r.status === 'done') ?? null;
  const inStock = useMemo(() => vehicles.filter((v) => !v.gone_at), [vehicles]);
  const fresh = useMemo(() => (lastRun ? inStock.filter((v) => v.last_run_id === lastRun.id && v.first_seen_at >= lastRun.started_at) : []), [inStock, lastRun]);
  const gone = useMemo(() => vehicles.filter((v) => v.gone_at).sort((a, b) => (b.gone_at ?? '').localeCompare(a.gone_at ?? '')), [vehicles]);
  const priced = useMemo(() => (lastRun ? inStock.filter((v) => v.price_prev != null && v.last_run_id === lastRun.id) : []), [inStock, lastRun]);
  // Vélocité : durée médiane en stock des voitures disparues (mise en ligne
  // quand le site la donne, sinon première vue par ADA).
  const velocity = useMemo(() => {
    const d = gone.map((v) => days(v.listed_at ?? v.first_seen_at, v.gone_at)).filter((x): x is number => x != null).sort((a, b) => a - b);
    return d.length >= 3 ? d[Math.floor(d.length / 2)] : null;
  }, [gone]);

  const rows = (tab === 'stock' ? inStock : tab === 'new' ? fresh : tab === 'gone' ? gone : priced)
    .filter((v) => !query.trim() || `${v.title ?? ''} ${v.brand ?? ''} ${v.model ?? ''} ${v.plate ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  const scan = async () => {
    setScanning(true); setError(null); setNotice(null);
    try {
      const s = await scanDealerStock(contactId, url, displayName || email || 'carte');
      setNotice(`${s.total} véhicules relevés (${s.provider}) · ${s.newCount} nouveau${s.newCount > 1 ? 'x' : ''} · ${s.goneCount} disparu${s.goneCount > 1 ? 's' : ''} · ${s.priceChanges} prix changé${s.priceChanges > 1 ? 's' : ''}${s.warnings.length ? ` · ${s.warnings.join(' ; ')}` : ''}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setScanning(false);
  };

  const tabBtn = (t: Tab, label: string, n: number) => (
    <button onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-full text-xs border ${tab === t ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{label} · {n}</button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-slate-900 truncate">Stock de {name}</h3>
            <p className="text-xs text-slate-500 truncate">
              <a href={url} target="_blank" rel="noreferrer" className="hover:underline">{url}</a>
              {lastRun && <> · dernier relevé {new Date(lastRun.started_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ({lastRun.provider}, {lastRun.total} véhicules)</>}
              {velocity != null && <> · <span className="text-emerald-700">vélocité : {velocity} j en stock (médiane des {gone.length} disparus)</span></>}
            </p>
          </div>
          <button onClick={() => void scan()} disabled={scanning} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre disabled:opacity-60 text-white text-sm font-medium">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {scanning ? 'Relevé en cours…' : lastRun ? 'Relever maintenant' : 'Premier relevé'}
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {tabBtn('stock', 'En stock', inStock.length)}
          {tabBtn('new', 'Nouveaux depuis le relevé précédent', fresh.length)}
          {tabBtn('gone', 'Disparus (vendus ?)', gone.length)}
          {tabBtn('price', 'Prix changés', priced.length)}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer : modèle, plaque…" className="ml-auto px-3 py-1.5 rounded-lg border border-slate-300 text-sm w-56" />
        </div>
        {(error || notice) && <p className={`mx-5 mt-2 text-xs ${error ? 'text-red-600' : 'text-emerald-700'}`}>{error ?? notice}</p>}
        <div className="flex-1 overflow-y-auto">
          {loading ? <p className="p-6 text-sm text-slate-500">Chargement…</p> : rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              {vehicles.length === 0 ? 'Aucun relevé pour cette concession. Lance le premier relevé : ADA lit toute la vitrine et, dès le deuxième passage, montre ce qui est arrivé, parti et changé de prix.' : 'Rien dans cette vue.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="px-4 py-2 font-medium">Véhicule</th>
                  <th className="px-3 py-2 font-medium text-right">Prix</th>
                  <th className="px-3 py-2 font-medium text-right">Km</th>
                  <th className="px-3 py-2 font-medium">Année</th>
                  <th className="px-3 py-2 font-medium">Énergie · boîte</th>
                  <th className="px-3 py-2 font-medium">Plaque</th>
                  <th className="px-3 py-2 font-medium">{tab === 'gone' ? 'Parti le · durée' : 'Vu depuis'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      {v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline inline-flex items-center gap-1">{v.title || v.external_id}<ExternalLink className="w-3 h-3 shrink-0" /></a> : (v.title || v.external_id)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {fmtEur(v.price)}
                      {v.price_prev != null && v.price != null && v.price_prev !== v.price && <span className={`ml-1 text-[11px] ${v.price < v.price_prev ? 'text-emerald-700' : 'text-amber-700'}`}>({v.price < v.price_prev ? '−' : '+'}{Math.abs(Math.round(v.price - v.price_prev)).toLocaleString('fr-FR')})</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.km != null ? v.km.toLocaleString('fr-FR') : '—'}</td>
                    <td className="px-3 py-2">{v.year ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{[v.fuel, v.gearbox].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{v.plate ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                      {tab === 'gone'
                        ? <>{fmtDate(v.gone_at)}{days(v.listed_at ?? v.first_seen_at, v.gone_at) != null && <span className="text-slate-400"> · {days(v.listed_at ?? v.first_seen_at, v.gone_at)} j</span>}</>
                        : <>{fmtDate(v.listed_at ?? v.first_seen_at)}{v.listed_at ? '' : <span className="text-slate-400" title="Le site ne donne pas la date de mise en ligne : première vue par ADA"> *</span>}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="px-5 py-2 border-t border-slate-100 text-[11px] text-slate-400">Lecture directe du site vitrine, sans Zyte. « Disparus » = présents au relevé précédent, absents de celui-ci : vendus ou retirés. Les dates marquées * sont la première vue par ADA, pas la mise en ligne.</p>
      </div>
    </div>
  );
}
