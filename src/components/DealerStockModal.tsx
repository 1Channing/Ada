import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, X, Loader2 } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listStockRuns, listStockVehicles, STATUS_LABEL, priceMoves, startDealerScan, isDealerScanning, subscribeDealerScans, takeDealerScanOutcome, type StockRun, type StockVehicle } from '../services/dealerStock';
import { currentFx, toEur } from '../services/fxRates';
import { fmtMoney } from '../lib/fx';
import { trimOf, fuelFamily, FUEL_LABEL, type FuelFamily } from '../services/stockCompare';
import { BarChart3 } from 'lucide-react';

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const shortDate = (s: string) => new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
/** Devise du site pour ce véhicule ('EUR' si la colonne n'est pas encore là). */
const curOf = (v: StockVehicle) => (v.currency ?? 'EUR').toUpperCase();
/** Montant dans la devise du site, suivi de l'équivalent € quand le site n'est pas en euros (taux BCE chargé au démarrage). */
function Money({ amount, currency }: { amount: number; currency: string }) {
  if (currency === 'EUR') return <>{eur(amount)}</>;
  const e = toEur(amount, currency);
  return (
    <span title={`${fmtMoney(amount, currency)} sur le site · converti au taux BCE du ${currentFx().date}`}>
      {e != null ? eur(e) : fmtMoney(amount, currency)}
      {e != null && <span className="block text-[11px] font-normal text-slate-400">{fmtMoney(amount, currency)}</span>}
    </span>
  );
}

/** MOUVEMENTS DE PRIX (01/10 soir) : sous le prix courant, le chemin depuis le
 *  premier prix vu (« 32 900 → 31 500 → 29 900 ») et l'écart total. À la
 *  disparition, c'est la réponse à « ont-ils dû baisser pour vendre ? ». */
export function PriceMovesLine({ v }: { v: StockVehicle }) {
  const m = priceMoves(v);
  if (m.steps.length < 2 || m.delta == null) return null;
  const down = m.delta < 0;
  // Mouvements dans la DEVISE DU SITE (06/10) : un taux de change qui bouge
  // n'est pas un prix qui bouge.
  const cur = curOf(v);
  const money = (n: number) => fmtMoney(n, cur);
  return (
    <div className="mt-0.5 text-[11px] leading-tight whitespace-nowrap" title={m.steps.map((s) => `${shortDate(s.at)} : ${money(s.price)}`).join(' · ')}>
      <span className="text-slate-400">{m.steps.map((s) => Math.round(s.price).toLocaleString('fr-FR')).join(' → ')}</span>
      <span className={`ml-1 font-medium ${down ? 'text-emerald-700' : 'text-amber-700'}`}>{down ? '−' : '+'}{money(Math.abs(m.delta))} ({m.pct != null ? `${m.pct > 0 ? '+' : ''}${m.pct.toLocaleString('fr-FR')} %` : ''}{m.drops > 0 ? `, ${m.drops} baisse${m.drops > 1 ? 's' : ''}` : ''}{m.raises > 0 ? `, ${m.raises} hausse${m.raises > 1 ? 's' : ''}` : ''})</span>
    </div>
  );
}

/** Prix absent (01/10) : le statut du site plutôt qu'un 0 € ; sans statut (SQL
 *  du 01/10 pas collé) : « sans prix ». */
export function PriceCell({ v }: { v: StockVehicle }) {
  if (v.price != null && v.price > 0) return <Money amount={v.price} currency={curOf(v)} />;
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
export const fmtStockDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
export const daysBetween = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)) : null);

/** DISTRIBUTION DES PRIX v4 (04/11, Channing : « il y a des traits au milieu qu'on ne comprend pas, choix des
 *  couleurs pas bon, voit ce qui se fait en ligne et on prend ce qui se fait de mieux ») : histogramme à la
 *  manière des outils de référence (Observable Plot / Tremor) — tranches FIXES de 10 000 €, queue « et + »
 *  au-delà du 99e centile, deux séries côte à côte (sélection en bleu, disparus sous les mêmes filtres en
 *  orange, palette validée daltonisme), barres fines à coins arrondis, grille horizontale discrète sans axes,
 *  AUCUN trait dans le tracé : médianes et quartiles dans les tuiles et la légende, détail au survol d'une
 *  tranche (infobulle), vue tableau en un clic. */
const STEP = 10_000;
const SERIES_SEL = '#2a78d6';
const SERIES_GONE = '#eb6834';
export function PriceDistribution({ prices, gone, label }: { prices: number[]; gone: number[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  if (prices.length === 0) return <p className="text-xs text-slate-400">Aucun prix dans la sélection.</p>;
  const q = (xs: number[], f: number) => xs[Math.min(xs.length - 1, Math.floor((xs.length - 1) * f))];
  const min = prices[0], max = prices[prices.length - 1];
  const med = q(prices, 0.5), goneMed = gone.length ? q(gone, 0.5) : null;
  const lo = Math.floor(Math.min(min, gone[0] ?? min) / STEP) * STEP;
  // Dernière tranche pleine = celle du 99e centile (au moins 3 tranches) ; tout ce qui dépasse va dans « et + ».
  const p99 = q(prices, 0.99);
  const hiFull = Math.max(lo + 3 * STEP, Math.ceil((p99 + 1) / STEP) * STEP);
  const nFull = Math.round((hiFull - lo) / STEP);
  const hasTail = max >= hiFull || (gone.length > 0 && gone[gone.length - 1] >= hiFull);
  const n = nFull + (hasTail ? 1 : 0);
  const counts = Array.from({ length: n }, () => 0);
  const goneCounts = Array.from({ length: n }, () => 0);
  const idx = (p: number) => Math.min(n - 1, Math.max(0, Math.floor((p - lo) / STEP)));
  for (const p of prices) counts[idx(p)]++;
  for (const p of gone) goneCounts[idx(p)]++;
  const withGone = gone.length > 0;
  const top = Math.max(...counts, ...goneCounts, 1);
  // Graduations « rondes » (1, 2, 5 × 10^k) : 3 à 5 lignes de grille, jamais de décimales.
  const rawStep = top / 4;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const tickStep = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= rawStep) ?? mag;
  const yMax = Math.ceil(top / tickStep) * tickStep;
  const ticks = Array.from({ length: Math.round(yMax / tickStep) + 1 }, (_, i) => i * tickStep);
  const W = 960, H = 280, padL = 36, padR = 8, padT = 12, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / n;
  const BAR_MAX = 24, GAP = 2;
  const barW = Math.max(3, Math.min(BAR_MAX, (slot - 10 - (withGone ? GAP : 0)) / (withGone ? 2 : 1)));
  const groupW = withGone ? barW * 2 + GAP : barW;
  const yOf = (c: number) => padT + plotH - (c / yMax) * plotH;
  const k = (v: number) => `${Math.round(v / 1000)} k€`;
  const rangeLabel = (i: number) => (hasTail && i === n - 1 ? `${k(lo + i * STEP)} et +` : `${k(lo + i * STEP)}–${k(lo + (i + 1) * STEP)}`);
  const rangeLong = (i: number) => (hasTail && i === n - 1 ? `${fmtMoney(lo + i * STEP, 'EUR')} et plus` : `${fmtMoney(lo + i * STEP, 'EUR')} à ${fmtMoney(lo + (i + 1) * STEP, 'EUR')}`);
  // Barre fine, coins arrondis EN HAUT seulement, ancrée sur la ligne de base.
  const barPath = (x: number, c: number, w: number) => {
    if (c <= 0) return '';
    const y = yOf(c), h = padT + plotH - y, r = Math.min(4, w / 2, h);
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  };
  const labelEvery = n > 14 ? 2 : 1;
  const pct = (c: number, total: number) => (total > 0 ? `${Math.round((c / total) * 100)} %` : '');
  const tile = (title: string, value: string, accent?: string) => (
    <div className="rounded-lg bg-slate-50 px-3 py-1.5 min-w-[92px]">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{title}</div>
      <div className={`text-sm font-semibold ${accent ?? 'text-slate-900'}`}>{value}</div>
    </div>
  );
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-2">
          {tile(`${label} avec prix`, String(prices.length))}
          {tile('minimum', fmtMoney(min, 'EUR'))}
          {tile('quart bas', fmtMoney(q(prices, 0.25), 'EUR'))}
          {tile('médiane', fmtMoney(med, 'EUR'), 'text-brand-encre')}
          {tile('quart haut', fmtMoney(q(prices, 0.75), 'EUR'))}
          {tile('maximum', fmtMoney(max, 'EUR'))}
          {goneMed != null && tile('médiane des disparus', `${fmtMoney(goneMed, 'EUR')}${med > 0 ? ` (${goneMed >= med ? '+' : ''}${Math.round(((goneMed - med) / med) * 100)} %)` : ''}`)}
        </div>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2 shrink-0">{asTable ? 'Voir le graphique' : 'Voir en tableau'}</button>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700 mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SERIES_SEL }} /> {label} aujourd'hui ({prices.length})</span>
        {withGone && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SERIES_GONE }} /> disparus sous les mêmes filtres ({gone.length})</span>}
        <span className="text-slate-500">tranches de {fmtMoney(STEP, 'EUR')}{hasTail ? ' · dernière tranche « et + » : tout ce qui dépasse' : ''}</span>
      </div>
      {asTable ? (
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-1 pr-3 font-medium">Tranche</th><th className="py-1 pr-3 font-medium text-right">{label}</th><th className="py-1 pr-3 font-medium text-right">part</th>{withGone && <><th className="py-1 pr-3 font-medium text-right">disparus</th><th className="py-1 font-medium text-right">part</th></>}</tr></thead>
          <tbody>
            {counts.map((c, i) => (
              <tr key={i} className="border-b border-slate-100 text-slate-800">
                <td className="py-1 pr-3">{rangeLong(i)}</td><td className="py-1 pr-3 text-right tabular-nums">{c}</td><td className="py-1 pr-3 text-right tabular-nums text-slate-500">{pct(c, prices.length)}</td>
                {withGone && <><td className="py-1 pr-3 text-right tabular-nums">{goneCounts[i]}</td><td className="py-1 text-right tabular-nums text-slate-500">{pct(goneCounts[i], gone.length)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'min(42vh, 300px)' }} role="img" aria-label="Distribution des prix par tranches de 10 000 €">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? '#cbd5e1' : '#eef2f7'} />
                <text x={padL - 8} y={yOf(t) + 3} fontSize={11} textAnchor="end" fill="#94a3b8">{t}</text>
              </g>
            ))}
            {counts.map((c, i) => {
              const x0 = padL + i * slot;
              const gx = x0 + (slot - groupW) / 2;
              const lit = hover === i;
              return (
                <g key={i} onMouseEnter={() => setHover(i)}>
                  <rect x={x0} y={padT} width={slot} height={plotH} fill={lit ? '#f1f5f9' : 'transparent'} />
                  <path d={barPath(gx, c, barW)} fill={SERIES_SEL} opacity={hover == null || lit ? 1 : 0.55} />
                  {withGone && <path d={barPath(gx + barW + GAP, goneCounts[i], barW)} fill={SERIES_GONE} opacity={hover == null || lit ? 1 : 0.55} />}
                  {(i % labelEvery === 0 || (hasTail && i === n - 1)) && <text x={x0 + slot / 2} y={H - padB + 17} fontSize={11} textAnchor="middle" fill="#64748b">{rangeLabel(i)}</text>}
                </g>
              );
            })}
          </svg>
          {hover != null && (
            <div className="pointer-events-none absolute top-1 rounded-lg border border-slate-200 bg-white shadow-md px-3 py-2 text-xs text-slate-700 whitespace-nowrap" style={{ left: `${((padL + (hover + 0.5) * slot) / W) * 100}%`, transform: hover > n / 2 ? 'translateX(-105%)' : 'translateX(5%)' }}>
              <div className="font-semibold text-slate-900 mb-0.5">{rangeLong(hover)}</div>
              <div className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: SERIES_SEL }} /> {label} : <strong>{counts[hover]}</strong> <span className="text-slate-500">{pct(counts[hover], prices.length)}</span></div>
              {withGone && <div className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: SERIES_GONE }} /> disparus : <strong>{goneCounts[hover]}</strong> <span className="text-slate-500">{pct(goneCounts[hover], gone.length)}</span></div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DealerStockModal({ contactId, name, url, onClose }: { contactId: string; name: string; url: string; onClose: () => void }) {
  const { displayName, email } = useAuth();
  const [vehicles, setVehicles] = useState<StockVehicle[]>([]);
  const [runs, setRuns] = useState<StockRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('stock');
  const [query, setQuery] = useState('');
  // FILTRES D'ANALYSE (03/11, Channing : « trier par marque, modèle, carburant, année min, année max, finition »)
  // + GRAPHIQUE de distribution des prix sur la sélection.
  const [fBrand, setFBrand] = useState('');
  const [fModel, setFModel] = useState('');
  const [fFuel, setFFuel] = useState<FuelFamily | ''>('');
  const [fYearMin, setFYearMin] = useState<number | null>(null);
  const [fYearMax, setFYearMax] = useState<number | null>(null);
  const [fTrim, setFTrim] = useState('');
  const [showChart, setShowChart] = useState(false);
  // Relevé en cours : lancé depuis cette page (service d'arrière-plan) OU
  // encore « running » côté base (page rechargée pendant le relevé).
  const [localScan, setLocalScan] = useState(() => isDealerScanning(contactId));
  const [serverRunning, setServerRunning] = useState(false);
  const scanning = localScan || serverRunning;

  const load = async () => {
    const [r, v] = await Promise.all([listStockRuns(contactId), listStockVehicles(contactId)]);
    setRuns(r.runs); setVehicles(v.vehicles);
    // Ne JAMAIS effacer un message d'échec par un rechargement (constat
    // Channing 01/10 sur Louwman : « le message s'affiche et disparaît
    // directement ») : le rechargement n'écrit que ses propres erreurs de
    // lecture ; l'échec du dernier relevé est affiché à part, tant que la
    // fenêtre est ouverte (lastFailure ci-dessous).
    if (r.error ?? v.error) setError(r.error ?? v.error);
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
  // Dernier relevé en ÉCHEC, s'il est plus récent que le dernier réussi :
  // affiché tant que la fenêtre est ouverte, jamais effacé par un rechargement.
  const lastFailure = runs[0]?.status === 'failed' ? runs[0] : null;
  const inStock = useMemo(() => vehicles.filter((v) => !v.gone_at), [vehicles]);
  // « Nouveau » = vu pour la première fois PAR ce relevé. Tolérance d'une
  // minute : les relevés antérieurs au 06/10 ont leur started_at posé par la
  // base quelques ms APRÈS la première vue des véhicules (Louwman : 230
  // nouveaux en base, 0 à l'écran).
  const fresh = useMemo(() => (lastRun
    ? inStock.filter((v) => v.last_run_id === lastRun.id && new Date(v.first_seen_at).getTime() >= new Date(lastRun.started_at).getTime() - 60_000)
    : []), [inStock, lastRun]);
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
    const d = gone.map((v) => daysBetween(v.listed_at ?? v.first_seen_at, v.gone_at)).filter((x): x is number => x != null).sort((a, b) => a - b);
    return d.length >= 3 ? d[Math.floor(d.length / 2)] : null;
  }, [gone]);

  // Énergie et finition lues une fois par véhicule (colonne du relevé, sinon le titre).
  const facets = useMemo(() => {
    const m = new Map<string, { fuel: FuelFamily | null; trim: string | null }>();
    for (const v of vehicles) m.set(v.id, { fuel: fuelFamily(v.fuel) ?? fuelFamily(v.title), trim: trimOf(v.title) });
    return m;
  }, [vehicles]);
  const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.map((x) => (x ?? '').trim().toUpperCase()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const brandOptions = useMemo(() => uniq(vehicles.map((v) => v.brand)), [vehicles]);
  const modelOptions = useMemo(() => uniq(vehicles.filter((v) => !fBrand || (v.brand ?? '').toUpperCase() === fBrand).map((v) => v.model)), [vehicles, fBrand]);
  const trimOptions = useMemo(() => uniq(vehicles.filter((v) => (!fBrand || (v.brand ?? '').toUpperCase() === fBrand) && (!fModel || (v.model ?? '').toUpperCase() === fModel)).map((v) => facets.get(v.id)?.trim)), [vehicles, facets, fBrand, fModel]);
  const yearOptions = useMemo(() => [...new Set(vehicles.map((v) => v.year).filter((y): y is number => y != null))].sort((a, b) => a - b), [vehicles]);
  const matchesFilters = (v: StockVehicle): boolean => {
    if (fBrand && (v.brand ?? '').toUpperCase() !== fBrand) return false;
    if (fModel && (v.model ?? '').toUpperCase() !== fModel) return false;
    const f = facets.get(v.id);
    if (fFuel && f?.fuel !== fFuel) return false;
    if (fTrim && (f?.trim ?? '') !== fTrim) return false;
    if (fYearMin != null && (v.year == null || v.year < fYearMin)) return false;
    if (fYearMax != null && (v.year == null || v.year > fYearMax)) return false;
    return true;
  };
  const filtersActive = Boolean(fBrand || fModel || fFuel || fTrim || fYearMin != null || fYearMax != null);
  const rows = (tab === 'stock' ? inStock : tab === 'new' ? fresh : tab === 'gone' ? gone : priced)
    .filter(matchesFilters)
    .filter((v) => !query.trim() || `${v.title ?? ''} ${v.brand ?? ''} ${v.model ?? ''} ${v.plate ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  // Distribution des prix (en euros) de la sélection, et celle des DISPARUS sous les mêmes filtres (ce qui se vend).
  const pricesOf = (list: StockVehicle[]) => list.map((v) => (v.price != null && v.price > 0 ? toEur(v.price, v.currency ?? 'EUR') : null)).filter((p): p is number => p != null).sort((a, b) => a - b);
  const selPrices = useMemo(() => pricesOf(rows), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const gonePrices = useMemo(() => pricesOf(gone.filter(matchesFilters)), [gone, fBrand, fModel, fFuel, fTrim, fYearMin, fYearMax, facets]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[96vw] h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
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
        <div className="px-5 pt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <select value={fBrand} onChange={(e) => { setFBrand(e.target.value); setFModel(''); setFTrim(''); }} className={`px-2 py-1 rounded-lg border bg-white ${fBrand ? 'border-brand-ocean text-brand-encre' : 'border-slate-300'}`}><option value="">Marque : toutes</option>{brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          <select value={fModel} onChange={(e) => { setFModel(e.target.value); setFTrim(''); }} className={`px-2 py-1 rounded-lg border bg-white ${fModel ? 'border-brand-ocean text-brand-encre' : 'border-slate-300'}`}><option value="">Modèle : tous</option>{modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <select value={fFuel} onChange={(e) => setFFuel(e.target.value as FuelFamily | '')} className={`px-2 py-1 rounded-lg border bg-white ${fFuel ? 'border-brand-ocean text-brand-encre' : 'border-slate-300'}`}><option value="">Carburant : tous</option>{(Object.keys(FUEL_LABEL) as FuelFamily[]).map((f) => <option key={f} value={f}>{FUEL_LABEL[f]}</option>)}</select>
          <select value={fYearMin ?? ''} onChange={(e) => setFYearMin(e.target.value === '' ? null : Number(e.target.value))} className={`px-2 py-1 rounded-lg border bg-white ${fYearMin != null ? 'border-brand-ocean text-brand-encre' : 'border-slate-300'}`}><option value="">Année min</option>{yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <select value={fYearMax ?? ''} onChange={(e) => setFYearMax(e.target.value === '' ? null : Number(e.target.value))} className={`px-2 py-1 rounded-lg border bg-white ${fYearMax != null ? 'border-brand-ocean text-brand-encre' : 'border-slate-300'}`}><option value="">Année max</option>{yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <select value={fTrim} onChange={(e) => setFTrim(e.target.value)} className={`px-2 py-1 rounded-lg border bg-white ${fTrim ? 'border-brand-ocean text-brand-encre' : 'border-slate-300'}`}><option value="">Finition : toutes</option>{trimOptions.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          {filtersActive && <button onClick={() => { setFBrand(''); setFModel(''); setFFuel(''); setFYearMin(null); setFYearMax(null); setFTrim(''); }} className="text-brand-ocean hover:underline">Effacer</button>}
          <span className="text-slate-400">{rows.length} véhicule{rows.length > 1 ? 's' : ''}</span>
          <button onClick={() => setShowChart((v) => !v)} className={`ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border ${showChart ? 'bg-brand-ocean border-brand-ocean text-white' : 'border-slate-300 text-brand-ocean hover:bg-blue-50'}`}><BarChart3 className="w-3.5 h-3.5" /> Distribution des prix</button>
        </div>
        {showChart && (
          <div className="mx-5 mt-2">
            <PriceDistribution prices={selPrices} gone={gonePrices} label={tab === 'gone' ? 'disparus' : tab === 'new' ? 'nouveaux' : tab === 'price' ? 'prix bougés' : 'en stock'} />
          </div>
        )}
        {(error || notice) && <p className={`mx-5 mt-2 text-xs ${error ? 'text-red-600' : 'text-emerald-700'}`}>{error ?? notice}</p>}
        {lastFailure && !scanning && lastFailure.error !== error && (
          <p className="mx-5 mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Dernier relevé en échec le {new Date(lastFailure.started_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} : {lastFailure.error ?? 'sans détail'}
          </p>
        )}
        {scanning && (() => {
          // PROGRESSION (03/11) : le worker écrit pages et véhicules lus dans la ligne du relevé toutes les 5 s.
          const cur = runs.find((x) => x.status === 'running');
          const prog = cur && (cur.pages ?? 0) > 0 ? ` — page ${cur.pages}, ${cur.total ?? 0} véhicule${(cur.total ?? 0) > 1 ? 's' : ''} déjà lus (${Math.round((Date.now() - new Date(cur.started_at).getTime()) / 60_000)} min)` : '';
          return <p className="mx-5 mt-2 text-xs text-brand-ocean flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Relevé en cours sur le serveur{prog} : tu peux fermer cette fenêtre ou changer de page, la carte garde l'indicateur et le résultat t'attend ici.</p>;
        })()}
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
                        ? <>{fmtStockDate(v.gone_at)}{daysBetween(v.listed_at ?? v.first_seen_at, v.gone_at) != null && <span className="text-slate-400"> · {daysBetween(v.listed_at ?? v.first_seen_at, v.gone_at)} j</span>}</>
                        : <>{fmtStockDate(v.listed_at ?? v.first_seen_at)}{v.listed_at ? '' : <span className="text-slate-400" title="Le site ne donne pas la date de mise en ligne : première vue par ADA"> *</span>}</>}
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
