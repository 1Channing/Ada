import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, X, Loader2 } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listStockRuns, listStockVehicles, STATUS_LABEL, priceMoves, startDealerScan, isDealerScanning, subscribeDealerScans, takeDealerScanOutcome, type StockRun, type StockVehicle } from '../services/dealerStock';

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const shortDate = (s: string) => new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

/** MOUVEMENTS DE PRIX (01/10 soir) : sous le prix courant, le chemin depuis le
 *  premier prix vu (« 32 900 → 31 500 → 29 900 ») et l'écart total. À la
 *  disparition, c'est la réponse à « ont-ils dû baisser pour vendre ? ». */
function PriceMovesLine({ v }: { v: StockVehicle }) {
  const m = priceMoves(v);
  if (m.steps.length < 2 || m.delta == null) return null;
  const down = m.delta < 0;
  return (
    <div className="mt-0.5 text-[11px] leading-tight whitespace-nowrap" title={m.steps.map((s) => `${shortDate(s.at)} : ${eur(s.price)}`).join(' · ')}>
      <span className="text-slate-400">{m.steps.map((s) => Math.round(s.price).toLocaleString('fr-FR')).join(' → ')}</span>
      <span className={`ml-1 font-medium ${down ? 'text-emerald-700' : 'text-amber-700'}`}>{down ? '−' : '+'}{Math.abs(Math.round(m.delta)).toLocaleString('fr-FR')} € ({m.pct != null ? `${m.pct > 0 ? '+' : ''}${m.pct.toLocaleString('fr-FR')} %` : ''}{m.drops > 0 ? `, ${m.drops} baisse${m.drops > 1 ? 's' : ''}` : ''}{m.raises > 0 ? `, ${m.raises} hausse${m.raises > 1 ? 's' : ''}` : ''})</span>
    </div>
  );
}

/** Prix absent (01/10) : le statut du site plutôt qu'un 0 € ; sans statut (SQL
 *  du 01/10 pas collé) : « sans prix ». */
function PriceCell({ v }: { v: StockVehicle }) {
  if (v.price != null && v.price > 0) return <>{`${Math.round(v.price).toLocaleString('fr-FR')} €`}</>;
  const s = v.status ? STATUS_LABEL[v.status] : undefined;
  return <span title={s?.title ?? 'Le site n\'affiche pas de prix pour cette annonce'} className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-medium ${s?.cls ?? 'bg-amber-50 text-amber-700 border-amber-200'}`}>{s?.label ?? 'sans prix'}</span>;
}

/**
 * STOCK D'UNE CONCESSION DE LA CARTE (30/09, demande Channing) : la liste de
 * leurs voitures telle que le worker l'a relevée, et le DIFF avec le relevé
 * précédent — nouveaux (arrivages), disparus (vendus ou retirés = vélocité),
 * prix changés. « Relever maintenant » relance le worker.
 */
type Tab = 'stock' | 'new' | 'gone' | 'price';
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const days = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)) : null);

export function DealerStockModal({ contactId, name, url, onClose }: { contactId: string; name: string; url: string; onClose: () => void }) {
  const { displayName, email } = useAuth();
  const [vehicles, setVehicles] = useState<StockVehicle[]>([]);
  const [runs, setRuns] = useState<StockRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('stock');
  const [query, setQuery] = useState('');
  // Relevé en cours : lancé depuis cette page (service d'arrière-plan) OU
  // encore « running » côté base (page rechargée pendant le relevé).
  const [localScan, setLocalScan] = useState(() => isDealerScanning(contactId));
  const [serverRunning, setServerRunning] = useState(false);
  const scanning = localScan || serverRunning;

  const load = async () => {
    const [r, v] = await Promise.all([listStockRuns(contactId), listStockVehicles(contactId)]);
    setRuns(r.runs); setVehicles(v.vehicles); setError(r.error ?? v.error);
    const running = r.runs.find((x) => x.status === 'running' && Date.now() - new Date(x.started_at).getTime() < 20 * 60_000);
    setServerRunning(!!running && !isDealerScanning(contactId));
    setLoading(false);
  };
  useEffect(() => { void load(); }, [contactId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Le suivi vit dans le service : la fenêtre ne fait que refléter son état
  // et récupérer le bilan quand il arrive (même si elle a été fermée entre-temps).
  useEffect(() => subscribeDealerScans(() => {
    const now = isDealerScanning(contactId);
    setLocalScan(now);
    if (now) return;
    const o = takeDealerScanOutcome(contactId);
    if (o?.error) setError(o.error);
    if (o?.summary) { const s = o.summary; setNotice(`${s.total} véhicules relevés (${s.provider}) · ${s.newCount} nouveau${s.newCount > 1 ? 'x' : ''} · ${s.goneCount} disparu${s.goneCount > 1 ? 's' : ''} · ${s.priceChanges} prix changé${s.priceChanges > 1 ? 's' : ''}${s.warnings.length ? ` · ${s.warnings.join(' ; ')}` : ''}`); }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [contactId]);
  // Relevé « running » en base sans suivi local (page rechargée) : on relit
  // la table toutes les 5 s jusqu'à sa fin.
  useEffect(() => {
    if (!serverRunning) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRunning]);

  const lastRun = runs.find((r) => r.status === 'done') ?? null;
  const inStock = useMemo(() => vehicles.filter((v) => !v.gone_at), [vehicles]);
  const fresh = useMemo(() => (lastRun ? inStock.filter((v) => v.last_run_id === lastRun.id && v.first_seen_at >= lastRun.started_at) : []), [inStock, lastRun]);
  const gone = useMemo(() => vehicles.filter((v) => v.gone_at).sort((a, b) => (b.gone_at ?? '').localeCompare(a.gone_at ?? '')), [vehicles]);
  // Prix changés = au moins un mouvement depuis l'arrivée (01/10 soir : plus
  // seulement le dernier relevé — l'historique porte toute la vie de l'annonce).
  const priced = useMemo(() => inStock.filter((v) => priceMoves(v).steps.length > 1), [inStock]);
  const noPrice = useMemo(() => inStock.filter((v) => v.price == null || v.price <= 0).length, [inStock]);
  // Bilan des disparus : combien avaient baissé avant de partir, et de combien.
  const goneMoves = useMemo(() => {
    const ms = gone.map(priceMoves).filter((m) => m.first != null && m.last != null);
    const dropped = ms.filter((m) => m.drops > 0);
    const pcts = dropped.map((m) => m.pct).filter((p): p is number => p != null).sort((a, b) => a - b);
    return { total: ms.length, dropped: dropped.length, medianPct: pcts.length ? pcts[Math.floor(pcts.length / 2)] : null };
  }, [gone]);
  // Vélocité : durée médiane en stock des voitures disparues (mise en ligne
  // quand le site la donne, sinon première vue par ADA).
  const velocity = useMemo(() => {
    const d = gone.map((v) => days(v.listed_at ?? v.first_seen_at, v.gone_at)).filter((x): x is number => x != null).sort((a, b) => a - b);
    return d.length >= 3 ? d[Math.floor(d.length / 2)] : null;
  }, [gone]);

  const rows = (tab === 'stock' ? inStock : tab === 'new' ? fresh : tab === 'gone' ? gone : priced)
    .filter((v) => !query.trim() || `${v.title ?? ''} ${v.brand ?? ''} ${v.model ?? ''} ${v.plate ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  const scan = async () => {
    setError(null); setNotice(null);
    startDealerScan(contactId, name, url, displayName || email || 'carte');
    setLocalScan(true);
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
              {goneMoves.total > 0 && <> · <span className="text-slate-700" title="Parmi les véhicules disparus (vendus ou retirés), ceux dont le prix avait baissé au moins une fois entre l'arrivée et la disparition">{goneMoves.dropped}/{goneMoves.total} disparus avaient baissé{goneMoves.medianPct != null ? ` (baisse médiane ${goneMoves.medianPct.toLocaleString('fr-FR')} %)` : ''}</span></>}
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
          {tabBtn('price', 'Prix bougé depuis l\'arrivée', priced.length)}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer : modèle, plaque…" className="ml-auto px-3 py-1.5 rounded-lg border border-slate-300 text-sm w-56" />
        </div>
        {(error || notice) && <p className={`mx-5 mt-2 text-xs ${error ? 'text-red-600' : 'text-emerald-700'}`}>{error ?? notice}</p>}
        {scanning && <p className="mx-5 mt-2 text-xs text-brand-ocean flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Relevé en cours sur le serveur : tu peux fermer cette fenêtre ou changer de page, la carte garde l'indicateur et le résultat t'attend ici.</p>}
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
                      <PriceCell v={v} />
                      {v.status && v.price != null && v.price > 0 && STATUS_LABEL[v.status] && <span title={STATUS_LABEL[v.status].title} className={`ml-1 inline-block px-1 py-0.5 rounded border text-[10px] ${STATUS_LABEL[v.status].cls}`}>{STATUS_LABEL[v.status].label}</span>}
                      <PriceMovesLine v={v} />
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
        <p className="px-5 py-2 border-t border-slate-100 text-[11px] text-slate-400">
          Lecture directe du site vitrine, sans Zyte. « Disparus » = présents au relevé précédent, absents de celui-ci : vendus ou retirés. Les dates marquées * sont la première vue par ADA, pas la mise en ligne.
          {noPrice > 0 && <> · <span className="text-amber-700">{noPrice} annonce{noPrice > 1 ? 's' : ''} sans prix affiché</span> (sur demande, attendue, réservée ou vendue : le site ne donne pas de prix, ADA n'invente pas de 0 €).</>}
        </p>
      </div>
    </div>
  );
}
