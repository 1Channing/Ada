/**
 * VITRINE (03/11, décision Channing : « un seul onglet entre relevé de stock et comparer, harmonisé et propre »).
 * Une fenêtre par contact, plein écran, quatre onglets qui partagent les mêmes filtres, la même recherche et la
 * colonne « Marché en direct » :
 *   Stock    — en stock / nouveaux / disparus / prix bougés (ex-« Stock relevé ») ;
 *   Comparer — leur stock face à nos ventes ou nos offres (ex-« Comparer ») ;
 *   Analyse  — vélocité, baisses avant disparition, distribution des prix, tableau par modèle ;
 *   Relevés  — historique des passages, fréquence auto, « Relever maintenant » avec progression.
 * Les services et le worker ne changent pas : cette fenêtre ne fait que réunir ce qui existait.
 */
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, X, Loader2, BarChart3, Scale, Boxes, ListChecks, Radar, Filter, ArrowDownWideNarrow, ArrowUpNarrowWide, Info } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listStockRuns, listStockVehicles, STATUS_LABEL, priceMoves, startDealerScan, isDealerScanning, subscribeDealerScans, takeDealerScanOutcome, setShowcaseUnreadable, type StockRun, type StockVehicle } from '../services/dealerStock';
import { toEur, loadFxRates } from '../services/fxRates';
import { fmtMoney } from '../lib/fx';
import { FUEL_LABEL, compareStock, commonModels, loadOurOffers, loadOurSales, theirsFuelTrim, SALES_THRESHOLD_EUR, OFFERS_THRESHOLD_EUR, KM_TOLERANCE, type FuelFamily, type OurVehicle, type KnownModels } from '../services/stockCompare';
import { PriceDistribution, PriceCell, PriceMovesLine, fmtStockDate, daysBetween } from './DealerStockModal';
import { MatchRows, Kpi, sortMatches, SORT_LABEL, FaceToFace, groupByOurs, type SortKey, type Mode } from './StockCompareModal';
import { LiveMarketColumn, type LivePick } from './LiveMarketColumn';
import { OFFER_COUNTRIES } from '../services/offers';
import { COUNTRY_VAT, countryVat } from '../lib/offers/vat';
import { listRefBrandModels } from '../services/workflow';
import { loadLearnedModelsByBrand, mergeKnownModels } from '../lib/offers/knownModels';
import { setStockFrequency } from '../services/network';

type Tab = 'stock' | 'compare' | 'analyse' | 'runs';
const ROTATION_HELP = 'Rotation = disparus ÷ (en stock + disparus), sur toutes les voitures de ce modèle vues par Ada depuis le premier relevé. 30 % = trois voitures sur dix ont quitté la vitrine (vendues ou retirées) depuis qu\'Ada la suit. Plus c\'est haut, plus le modèle tourne vite chez ce vendeur.';
const DAYS_HELP = 'Jours en stock (médiane) : pour les voitures disparues de ce modèle, le temps entre la mise en ligne (ou la première vue par Ada si le site ne donne pas la date) et la disparition. Si Ada n\'a vu la vitrine que deux fois, toutes les durées valent l\'écart entre ces deux relevés.';
type StockView = 'in' | 'new' | 'gone' | 'price';
/** TRI DU STOCK (03/11, Channing : « date d'ajout croissant / décroissant, alphabétique, prix croissant / décroissant »). */
type StockSort = 'date_desc' | 'date_asc' | 'alpha' | 'price_asc' | 'price_desc' | 'km_asc' | 'year_desc';
const STOCK_SORT_LABEL: Record<StockSort, string> = { date_desc: 'Date d\'ajout ↓ (récents d\'abord)', date_asc: 'Date d\'ajout ↑ (anciens d\'abord)', alpha: 'Alphabétique', price_asc: 'Prix ↑', price_desc: 'Prix ↓', km_asc: 'Kilométrage ↑', year_desc: 'Année ↓' };
type Freq = 'daily' | 'weekly' | 'off';
const FREQ_LABEL: Record<Freq, string> = { daily: 'quotidien (1 h)', weekly: 'hebdomadaire', off: 'arrêté' };

export function ShowcaseModal({ contactId, name, url, url2, country, frequency, unreadable, onClose, onFrequencyChange }: {
  contactId: string; name: string; url: string | null; /** Seconde vitrine (12/11), lue avec la première. */ url2?: string | null; country?: string | null; frequency?: Freq | null; unreadable?: string | null; onClose: () => void; onFrequencyChange?: (f: Freq) => void;
}) {
  const { displayName, email } = useAuth();
  const [tab, setTab] = useState<Tab>('stock');
  const [view, setView] = useState<StockView>('in');
  const [vehicles, setVehicles] = useState<StockVehicle[]>([]);
  const [runs, setRuns] = useState<StockRun[]>([]);
  const [sales, setSales] = useState<OurVehicle[] | null>(null);
  const [offers, setOffers] = useState<OurVehicle[] | null>(null);
  const [known, setKnown] = useState<KnownModels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Filtres communs à tous les onglets.
  const [fBrand, setFBrand] = useState('');
  const [fModel, setFModel] = useState('');
  const [fFuel, setFFuel] = useState<FuelFamily | ''>('');
  const [fYearMin, setFYearMin] = useState<number | null>(null);
  const [fYearMax, setFYearMax] = useState<number | null>(null);
  const [fTrim, setFTrim] = useState('');
  const [showChart, setShowChart] = useState(false);
  const [stockSort, setStockSort] = useState<StockSort>('date_desc');
  // Comparer.
  const [mode, setMode] = useState<Mode>('sales');
  /** OFFRE PRÉCISE (13/11) : '' = toutes nos offres ; un id = seulement les véhicules retenus de cette offre, en face-à-face. */
  const [offerPick, setOfferPick] = useState('');
  const [onlyOk, setOnlyOk] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('gap');
  const [sortAsc, setSortAsc] = useState(false);
  const [thresholds, setThresholds] = useState<Record<Mode, number>>(() => {
    try { const raw = JSON.parse(localStorage.getItem('ada_compare_thresholds') ?? 'null'); if (raw && typeof raw.sales === 'number' && typeof raw.offers === 'number') return raw; } catch { /* défaut */ }
    return { sales: SALES_THRESHOLD_EUR, offers: OFFERS_THRESHOLD_EUR };
  });
  const setThreshold = (m: Mode, v: number) => setThresholds((t) => { const next = { ...t, [m]: Math.max(0, Math.round(v)) }; try { localStorage.setItem('ada_compare_thresholds', JSON.stringify(next)); } catch { /* ignoré */ } return next; });
  // Marché en direct.
  const [liveOpen, setLiveOpen] = useState(false);
  const [picked, setPicked] = useState<LivePick | null>(null);
  // Relevés.
  const [localScan, setLocalScan] = useState(() => isDealerScanning(contactId));
  const [serverRunning, setServerRunning] = useState(false);
  const scanning = localScan || serverRunning;
  const [freq, setFreq] = useState<Freq>(frequency ?? 'daily');
  const [freqMsg, setFreqMsg] = useState<string | null>(null);

  const cc = (country ?? '').toUpperCase();
  const vat = countryVat(cc);
  const vatKnown = cc in COUNTRY_VAT;
  const defaultCountry = OFFER_COUNTRIES.some((c) => c.code === cc) ? cc : 'FR';

  const load = async () => {
    const [r, v] = await Promise.all([listStockRuns(contactId), listStockVehicles(contactId)]);
    setRuns(r.runs); setVehicles(v.vehicles);
    if (r.error ?? v.error) setError(r.error ?? v.error);
    const running = r.runs.find((x) => x.status === 'running' && Date.now() - new Date(x.started_at).getTime() < 20 * 60_000);
    setServerRunning(!!running && !isDealerScanning(contactId));
    setLoading(false);
  };
  useEffect(() => { void load(); }, [contactId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    (async () => {
      await loadFxRates().catch(() => { /* repli EUR */ });
      // Les modèles connus d'abord : les ventes sans dossier véhicule en ont besoin pour lire leur libellé (04/11).
      const [ref, learned] = await Promise.all([
        listRefBrandModels().then((r) => r.modelsByBrand).catch(() => ({} as Record<string, string[]>)),
        loadLearnedModelsByBrand().catch(() => ({} as Record<string, string[]>)),
      ]);
      const kn = mergeKnownModels(ref, learned);
      const [s, o] = await Promise.all([loadOurSales(kn), loadOurOffers()]);
      if (!alive) return;
      setSales(s.rows); setOffers(o.rows); setKnown(kn);
      if (s.error || o.error) setError([s.error && `Ventes : ${s.error}`, o.error && `Offres : ${o.error}`].filter(Boolean).join(' · '));
    })();
    return () => { alive = false; };
  }, []);
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
  useEffect(() => {
    if (!serverRunning) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRunning]);

  const lastRun = runs.find((r) => r.status === 'done') ?? null;
  const lastFailure = runs[0]?.status === 'failed' ? runs[0] : null;
  const inStock = useMemo(() => vehicles.filter((v) => !v.gone_at), [vehicles]);
  const fresh = useMemo(() => (lastRun ? inStock.filter((v) => v.last_run_id === lastRun.id && new Date(v.first_seen_at).getTime() >= new Date(lastRun.started_at).getTime() - 60_000) : []), [inStock, lastRun]);
  const gone = useMemo(() => vehicles.filter((v) => v.gone_at).sort((a, b) => (b.gone_at ?? '').localeCompare(a.gone_at ?? '')), [vehicles]);
  const priced = useMemo(() => inStock.filter((v) => priceMoves(v).steps.length > 1), [inStock]);
  const noPrice = useMemo(() => inStock.filter((v) => v.price == null || v.price <= 0).length, [inStock]);

  // Énergie / finition / puissance lues une fois par véhicule.
  const facets = useMemo(() => { const m = new Map<string, ReturnType<typeof theirsFuelTrim>>(); for (const v of vehicles) m.set(v.id, theirsFuelTrim(v)); return m; }, [vehicles]);
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
  const matchesQuery = (v: StockVehicle) => !query.trim() || `${v.title ?? ''} ${v.brand ?? ''} ${v.model ?? ''} ${v.plate ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
  const filtersActive = Boolean(fBrand || fModel || fFuel || fTrim || fYearMin != null || fYearMax != null);
  const filterDeps = [fBrand, fModel, fFuel, fTrim, fYearMin, fYearMax, facets, query]; // eslint-disable-line react-hooks/exhaustive-deps

  const stockRows = useMemo(() => {
    const list = (view === 'in' ? inStock : view === 'new' ? fresh : view === 'gone' ? gone : priced).filter(matchesFilters).filter(matchesQuery);
    const eurOf = (v: StockVehicle) => (v.price != null && v.price > 0 ? toEur(v.price, v.currency ?? 'EUR') ?? null : null);
    const dateOf = (v: StockVehicle) => (view === 'gone' ? v.gone_at ?? '' : v.listed_at ?? v.first_seen_at);
    const title = (v: StockVehicle) => (v.title || `${v.brand ?? ''} ${v.model ?? ''}`).trim();
    const by: Record<StockSort, (a: StockVehicle, b: StockVehicle) => number> = {
      date_desc: (a, b) => dateOf(b).localeCompare(dateOf(a)) || title(a).localeCompare(title(b), 'fr'),
      date_asc: (a, b) => dateOf(a).localeCompare(dateOf(b)) || title(a).localeCompare(title(b), 'fr'),
      alpha: (a, b) => title(a).localeCompare(title(b), 'fr'),
      price_asc: (a, b) => (eurOf(a) ?? Infinity) - (eurOf(b) ?? Infinity),
      price_desc: (a, b) => (eurOf(b) ?? -Infinity) - (eurOf(a) ?? -Infinity),
      km_asc: (a, b) => (a.km ?? Infinity) - (b.km ?? Infinity),
      year_desc: (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || (eurOf(a) ?? Infinity) - (eurOf(b) ?? Infinity),
    };
    return [...list].sort(by[stockSort]);
  }, [view, inStock, fresh, gone, priced, stockSort, ...filterDeps]); // eslint-disable-line react-hooks/exhaustive-deps
  const stockFiltered = useMemo(() => inStock.filter(matchesFilters).filter(matchesQuery), [inStock, ...filterDeps]); // eslint-disable-line react-hooks/exhaustive-deps
  const goneFiltered = useMemo(() => gone.filter(matchesFilters).filter(matchesQuery), [gone, ...filterDeps]); // eslint-disable-line react-hooks/exhaustive-deps
  const pricesOf = (list: StockVehicle[]) => list.map((v) => (v.price != null && v.price > 0 ? toEur(v.price, v.currency ?? 'EUR') : null)).filter((p): p is number => p != null).sort((a, b) => a - b);
  const selPrices = useMemo(() => pricesOf(stockRows), [stockRows]); // eslint-disable-line react-hooks/exhaustive-deps
  const gonePrices = useMemo(() => pricesOf(goneFiltered), [goneFiltered]); // eslint-disable-line react-hooks/exhaustive-deps

  // Comparer : leur stock FILTRÉ face à nos ventes ou nos offres.
  const threshold = thresholds[mode];
  /** Les offres disponibles (id → titre · fournisseur, la plus récente d'abord) pour le choix d'une offre précise. */
  const offerChoices = useMemo(() => {
    const m = new Map<string, { label: string; date: string | null; count: number }>();
    for (const o of offers ?? []) { if (!o.offerId) continue; const c = m.get(o.offerId); if (c) c.count++; else m.set(o.offerId, { label: o.detail, date: o.date, count: 1 }); }
    return [...m.entries()].map(([id, c]) => ({ id, ...c })).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [offers]);
  const pickedOffer = mode === 'offers' && offerPick ? offerPick : null;
  /** Nos véhicules à comparer : ventes, toutes les offres, ou les véhicules retenus de l'offre choisie (tous s'il n'y en a aucun de retenu). */
  const oursForCompare = useMemo(() => {
    if (mode === 'sales') return sales;
    if (!offers) return offers;
    if (!pickedOffer) return offers;
    const of = offers.filter((o) => o.offerId === pickedOffer);
    const kept = of.filter((o) => o.selected);
    return kept.length ? kept : of;
  }, [mode, sales, offers, pickedOffer]);
  const result = useMemo(() => (oursForCompare ? compareStock(stockFiltered, oursForCompare, threshold, vat, known) : null), [stockFiltered, oursForCompare, threshold, vat, known]);
  const faceToFace = useMemo(() => (pickedOffer && result ? groupByOurs(result.matches, onlyOk) : []), [pickedOffer, result, onlyOk]);
  // Modèles en commun (04/11) : sans condition d'année ni de km — « ce genre de modèles ».
  const common = useMemo(() => (sales && offers ? commonModels(stockFiltered, sales, offers, known) : []), [stockFiltered, sales, offers, known]);
  const [commonOpen, setCommonOpen] = useState(true);
  const compareRows = useMemo(() => (result ? sortMatches(result.matches.filter((m) => !onlyOk || m.ok), sortKey, sortAsc) : []), [result, onlyOk, sortKey, sortAsc]);
  const okCount = result?.matches.filter((m) => m.ok).length ?? 0;
  const bestById = useMemo(() => new Map((result?.matches ?? []).map((m) => [m.theirs.id, m])), [result]);
  const pickOf = (v: StockVehicle): LivePick => {
    const m = bestById.get(v.id);
    if (m) return m;
    const tf = facets.get(v.id) ?? theirsFuelTrim(v);
    const eur = v.price != null ? toEur(v.price, v.currency ?? 'EUR') : null;
    return { theirs: v, theirsEur: Math.round(eur ?? 0), theirsFuel: tf.fuel, theirsTrim: tf.trim, theirsPower: tf.power, ours: null, ourTtc: null };
  };

  // Analyse.
  const velocity = useMemo(() => { const d = goneFiltered.map((v) => daysBetween(v.listed_at ?? v.first_seen_at, v.gone_at)).filter((x): x is number => x != null).sort((a, b) => a - b); return d.length >= 3 ? d[Math.floor(d.length / 2)] : null; }, [goneFiltered]);
  const goneMoves = useMemo(() => { const ms = goneFiltered.map(priceMoves).filter((m) => m.first != null && m.last != null); const dropped = ms.filter((m) => m.drops > 0); const pcts = dropped.map((m) => m.pct).filter((p): p is number => p != null).sort((a, b) => a - b); return { total: ms.length, dropped: dropped.length, medianPct: pcts.length ? pcts[Math.floor(pcts.length / 2)] : null }; }, [goneFiltered]);
  const byModel = useMemo(() => {
    type Row = { key: string; label: string; inStock: number; gone: number; inPrices: number[]; gonePrices: number[]; days: number[] };
    const map = new Map<string, Row>();
    const rowOf = (v: StockVehicle) => { const key = `${(v.brand ?? '').toUpperCase()}|${(v.model ?? '').toUpperCase()}`; return map.get(key) ?? map.set(key, { key, label: `${(v.brand ?? '').toUpperCase()} ${(v.model ?? '').toUpperCase()}`.trim() || '—', inStock: 0, gone: 0, inPrices: [], gonePrices: [], days: [] }).get(key)!; };
    for (const v of stockFiltered) { const r = rowOf(v); r.inStock++; const p = v.price != null && v.price > 0 ? toEur(v.price, v.currency ?? 'EUR') : null; if (p != null) r.inPrices.push(p); }
    for (const v of goneFiltered) { const r = rowOf(v); r.gone++; const p = v.price != null && v.price > 0 ? toEur(v.price, v.currency ?? 'EUR') : null; if (p != null) r.gonePrices.push(p); const d = daysBetween(v.listed_at ?? v.first_seen_at, v.gone_at); if (d != null) r.days.push(d); }
    const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
    return [...map.values()].map((r) => ({ ...r, medIn: med(r.inPrices), medGone: med(r.gonePrices), medDays: med(r.days) })).sort((a, b) => b.inStock + b.gone - (a.inStock + a.gone));
  }, [stockFiltered, goneFiltered]);

  const scan = async () => {
    if (!url) { setError('Cette fiche n\'a pas d\'adresse de vitrine : renseigne-la via « Modifier ».'); return; }
    setError(null); setNotice(null);
    startDealerScan(contactId, name, url, displayName || email || 'carte');
    setLocalScan(true);
    setTab('runs');
  };
  // Signal « vitrine non lisible » (09/11 soir) : posé ou retiré ici, visible sur la fiche et dans la liste.
  const [unread, setUnread] = useState<string | null>(unreadable ?? null);
  const [unreadDraft, setUnreadDraft] = useState('');
  const [unreadMsg, setUnreadMsg] = useState<string | null>(null);
  const markUnreadable = async () => {
    const reason = unreadDraft.trim();
    if (!reason) { setUnreadMsg('Écris la raison (ex. « liste chargée par une API à clé »).'); return; }
    const err = await setShowcaseUnreadable(contactId, reason);
    if (err) { setUnreadMsg(err); return; }
    setUnread(reason); setUnreadDraft(''); setFreq('off'); setUnreadMsg('Signal posé : fiche et liste le montrent ; relevé automatique arrêté.'); onFrequencyChange?.('off');
  };
  const clearUnreadable = async () => {
    const err = await setShowcaseUnreadable(contactId, null);
    if (err) { setUnreadMsg(err); return; }
    setUnread(null); setUnreadMsg('Signal retiré. Pense à remettre le relevé automatique si la vitrine est lisible.');
  };
  const changeFreq = async (f: Freq) => {
    setFreq(f); setFreqMsg(null);
    const err = await setStockFrequency(contactId, f);
    setFreqMsg(err ?? `Relevé automatique : ${FREQ_LABEL[f]}.`);
    if (!err) onFrequencyChange?.(f);
  };
  const resetFilters = () => { setFBrand(''); setFModel(''); setFFuel(''); setFYearMin(null); setFYearMax(null); setFTrim(''); setQuery(''); };
  const pick = (p: LivePick) => { setPicked(p); setLiveOpen(true); };
  const sel = (active: boolean) => `px-2 py-1 rounded-lg border bg-white ${active ? 'border-brand-ocean text-brand-encre' : 'border-slate-300'}`;
  const tabBtn = (t: Tab, label: string, Icon: typeof Boxes, badge?: string) => (
    <button onClick={() => setTab(t)} role="tab" aria-selected={tab === t} className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${tab === t ? 'border-brand-ocean text-brand-encre font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
      <Icon className="w-4 h-4" /> {label}{badge && <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${tab === t ? 'bg-blue-50 text-brand-encre' : 'bg-slate-100 text-slate-500'}`}>{badge}</span>}
    </button>
  );
  const runningRow = runs.find((x) => x.status === 'running');
  const progress = runningRow && (runningRow.pages ?? 0) > 0 ? `page ${runningRow.pages}, ${runningRow.total ?? 0} véhicules déjà lus (${Math.round((Date.now() - new Date(runningRow.started_at).getTime()) / 60_000)} min)` : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[97vw] h-[94vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div className="px-5 pt-3 pb-2 border-b border-slate-200 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-slate-900 truncate text-lg">Vitrine de {name}</h3>
            <p className="text-xs text-slate-500 truncate">
              {url ? <a href={url} target="_blank" rel="noreferrer" className="hover:underline">{url}</a> : <span className="text-amber-700">pas d'adresse de vitrine sur cette fiche</span>}
              {url2 && <> + <a href={url2} target="_blank" rel="noreferrer" className="hover:underline" title="Seconde vitrine : lue avec la première, véhicules cumulés dans ce stock">{url2}</a></>}
              {lastRun && <> · dernier relevé {new Date(lastRun.started_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ({lastRun.provider}, {lastRun.total} véhicules)</>}
              {' · '}relevé auto : {FREQ_LABEL[freq]}{unread ? <span className="text-orange-700 font-medium"> · ⚠ vitrine non lisible par Ada — {unread}</span> : null}
            </p>
          </div>
          <button onClick={() => void scan()} disabled={scanning} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre disabled:opacity-60 text-white text-sm font-medium">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {scanning ? 'Relevé en cours…' : lastRun ? 'Relever maintenant' : 'Premier relevé'}
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        {/* Onglets */}
        <div role="tablist" className="px-5 flex gap-1 border-b border-slate-200">
          {tabBtn('stock', 'Stock', Boxes, String(inStock.length))}
          {tabBtn('compare', 'Comparer', Scale, result ? String(okCount) : undefined)}
          {tabBtn('analyse', 'Analyse', BarChart3)}
          {tabBtn('runs', 'Relevés', ListChecks, String(runs.length))}
          <span className="ml-auto self-center text-[11px] text-slate-400 hidden md:inline">Filtres, recherche et marché en direct valent pour tous les onglets.</span>
        </div>
        {/* Filtres communs */}
        {tab !== 'runs' && (
          <div className="px-5 pt-2 pb-1 flex flex-wrap items-center gap-2 text-xs text-slate-600 border-b border-slate-100">
            <select value={fBrand} onChange={(e) => { setFBrand(e.target.value); setFModel(''); setFTrim(''); }} className={sel(!!fBrand)}><option value="">Marque : toutes</option>{brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select>
            <select value={fModel} onChange={(e) => { setFModel(e.target.value); setFTrim(''); }} className={sel(!!fModel)}><option value="">Modèle : tous</option>{modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select>
            <select value={fFuel} onChange={(e) => setFFuel(e.target.value as FuelFamily | '')} className={sel(!!fFuel)}><option value="">Carburant : tous</option>{(Object.keys(FUEL_LABEL) as FuelFamily[]).map((f) => <option key={f} value={f}>{FUEL_LABEL[f]}</option>)}</select>
            <select value={fYearMin ?? ''} onChange={(e) => setFYearMin(e.target.value === '' ? null : Number(e.target.value))} className={sel(fYearMin != null)}><option value="">Année min</option>{yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            <select value={fYearMax ?? ''} onChange={(e) => setFYearMax(e.target.value === '' ? null : Number(e.target.value))} className={sel(fYearMax != null)}><option value="">Année max</option>{yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            <select value={fTrim} onChange={(e) => setFTrim(e.target.value)} className={sel(!!fTrim)}><option value="">Finition : toutes</option>{trimOptions.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher : modèle, plaque…" className="px-3 py-1 rounded-lg border border-slate-300 w-48" />
            {(filtersActive || query) && <button onClick={resetFilters} className="text-brand-ocean hover:underline">Effacer</button>}
            <span className="text-slate-400">{stockFiltered.length} en stock{goneFiltered.length ? ` · ${goneFiltered.length} disparus` : ''}</span>
          </div>
        )}
        {(error || notice) && <p className={`mx-5 mt-2 text-xs ${error ? 'text-red-600' : 'text-emerald-700'}`}>{error ?? notice}</p>}
        {scanning && <p className="mx-5 mt-2 text-xs text-brand-ocean flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Relevé en cours sur le serveur{progress ? ` — ${progress}` : ''} : tu peux fermer cette fenêtre, la carte garde l'indicateur et le résultat t'attend ici.</p>}

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 overflow-y-auto">
            {loading ? <p className="p-6 text-sm text-slate-500">Chargement…</p> : vehicles.length === 0 && tab !== 'runs' ? (
              <div className="p-6 text-sm text-slate-600 space-y-2">
                <p>Aucun relevé pour cette concession. Lance le premier relevé : Ada lit toute la vitrine et, dès le deuxième passage, montre ce qui est arrivé, parti et changé de prix.</p>
                {url && <button onClick={() => void scan()} className="text-sm px-3 py-1.5 rounded-lg bg-brand-ocean text-white">Premier relevé</button>}
              </div>
            ) : tab === 'stock' ? (
              <>
                <div className="px-5 py-2 flex flex-wrap items-center gap-2">
                  {([['in', 'En stock', inStock.length], ['new', 'Nouveaux depuis le relevé précédent', fresh.length], ['gone', 'Disparus (vendus ?)', gone.length], ['price', 'Prix bougé depuis l\'arrivée', priced.length]] as const).map(([v, label, n]) => (
                    <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-full text-xs border ${view === v ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{label} · {n}</button>
                  ))}
                  <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">Trier par
                    <select value={stockSort} onChange={(e) => setStockSort(e.target.value as StockSort)} className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs">
                      {(Object.keys(STOCK_SORT_LABEL) as StockSort[]).map((k) => <option key={k} value={k}>{k.startsWith('date') && view === 'gone' ? STOCK_SORT_LABEL[k].replace('Date d\'ajout', 'Date de départ') : STOCK_SORT_LABEL[k]}</option>)}
                    </select>
                  </label>
                  <button onClick={() => setShowChart((v) => !v)} className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border ${showChart ? 'bg-brand-ocean border-brand-ocean text-white' : 'border-slate-300 text-brand-ocean hover:bg-blue-50'}`}><BarChart3 className="w-3.5 h-3.5" /> Distribution des prix</button>
                </div>
                {showChart && <div className="mx-5 mb-2"><PriceDistribution prices={selPrices} gone={gonePrices} label={view === 'gone' ? 'disparus' : view === 'new' ? 'nouveaux' : view === 'price' ? 'prix bougés' : 'en stock'} /></div>}
                {stockRows.length === 0 ? <p className="p-6 text-sm text-slate-500">Rien dans cette vue avec ces filtres.</p> : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                        <th className="px-4 py-2 font-medium">Véhicule</th><th className="px-3 py-2 font-medium text-right">Prix</th><th className="px-3 py-2 font-medium text-right">Km</th><th className="px-3 py-2 font-medium">Année</th><th className="px-3 py-2 font-medium">Énergie · boîte</th><th className="px-3 py-2 font-medium">Plaque</th><th className="px-3 py-2 font-medium">{view === 'gone' ? 'Parti le · durée' : 'Vu depuis'}</th><th className="px-3 py-2 font-medium">Chez nous</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockRows.map((v) => { const m = bestById.get(v.id); const f = facets.get(v.id); return (
                        <tr key={v.id} className={`border-b border-slate-100 hover:bg-slate-50 ${picked?.theirs.id === v.id ? 'bg-blue-50/60' : ''}`}>
                          <td className="px-4 py-2">{v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline inline-flex items-center gap-1">{v.title || v.external_id}<ExternalLink className="w-3 h-3 shrink-0" /></a> : (v.title || v.external_id)}{f?.power ? <span className="ml-1 text-[10px] text-slate-400">{f.power} ch</span> : null}</td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap"><PriceCell v={v} />{v.status && v.price != null && v.price > 0 && STATUS_LABEL[v.status] && <span title={STATUS_LABEL[v.status].title} className={`ml-1 inline-block px-1 py-0.5 rounded border text-[10px] ${STATUS_LABEL[v.status].cls}`}>{STATUS_LABEL[v.status].label}</span>}<PriceMovesLine v={v} /></td>
                          <td className="px-3 py-2 text-right tabular-nums">{v.km != null ? v.km.toLocaleString('fr-FR') : '—'}</td>
                          <td className="px-3 py-2">{v.year ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{[v.fuel, v.gearbox].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{v.plate ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{view === 'gone' ? <>{fmtStockDate(v.gone_at)}{daysBetween(v.listed_at ?? v.first_seen_at, v.gone_at) != null && <span className="text-slate-400"> · {daysBetween(v.listed_at ?? v.first_seen_at, v.gone_at)} j</span>}</> : <>{fmtStockDate(v.listed_at ?? v.first_seen_at)}{v.listed_at ? '' : <span className="text-slate-400" title="Le site ne donne pas la date de mise en ligne : première vue par ADA"> *</span>}</>}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {m ? <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${m.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`} title={`${m.ours.label} · ${mode === 'sales' ? 'vente' : 'achat'} TTC ${fmtMoney(m.ourTtc, 'EUR')}`}>{m.gap >= 0 ? '+' : ''}{fmtMoney(m.gap, 'EUR')}</span> : <span className="text-[11px] text-slate-300">—</span>}
                            <button onClick={() => pick(pickOf(v))} className={`ml-1.5 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border ${picked?.theirs.id === v.id ? 'border-brand-ocean bg-brand-ocean text-white' : 'border-slate-300 text-brand-ocean hover:bg-blue-50'}`} title="Marché en direct pour cette voiture"><Radar className="w-3 h-3" /> Marché</button>
                          </td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                )}
                <p className="px-5 py-2 text-[11px] text-slate-400">Lecture directe du site vitrine, sans Zyte. « Disparus » = présents au relevé précédent, absents de celui-ci : vendus ou retirés. Les dates marquées * sont la première vue par ADA, pas la mise en ligne.{noPrice > 0 && <> · <span className="text-amber-700">{noPrice} annonce{noPrice > 1 ? 's' : ''} sans prix affiché</span>.</>}</p>
              </>
            ) : tab === 'compare' ? (
              <>
                <div className="px-5 pt-3 flex flex-wrap items-center gap-2 text-xs">
                  <div role="tablist" className="flex rounded-lg bg-slate-100 p-0.5">
                    {([['sales', 'Ventes MC Export'], ['offers', 'Offres fournisseurs']] as const).map(([id, label]) => (
                      <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={`px-3 py-1.5 rounded-md text-sm ${mode === id ? 'bg-white shadow text-slate-900 font-semibold' : 'text-slate-600 hover:text-slate-900'}`}>{label} <span className="text-xs text-slate-400 font-normal">· seuil {fmtMoney(thresholds[id], 'EUR')}</span></button>
                    ))}
                  </div>
                  {mode === 'offers' && (
                    <label className="flex items-center gap-1.5 text-slate-600">Offre
                      <select value={offerPick} onChange={(e) => setOfferPick(e.target.value)} className="max-w-[320px] px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs" title="Comparer leur stock avec une offre précise (ses véhicules retenus)">
                        <option value="">toutes nos offres</option>
                        {offerChoices.map((c) => <option key={c.id} value={c.id}>{c.label.slice(0, 70)} · {c.count} véh.</option>)}
                      </select>
                    </label>
                  )}
                  <label className="flex items-center gap-1.5 text-slate-600">Seuil <input type="number" step={500} min={0} value={threshold} onChange={(e) => setThreshold(mode, Number(e.target.value) || 0)} className="w-24 px-2 py-1.5 rounded-lg border border-slate-300 text-right text-sm tabular-nums" /> €{(thresholds.sales !== SALES_THRESHOLD_EUR || thresholds.offers !== OFFERS_THRESHOLD_EUR) && <button onClick={() => { setThreshold('sales', SALES_THRESHOLD_EUR); setThreshold('offers', OFFERS_THRESHOLD_EUR); }} className="text-brand-ocean hover:underline">défauts</button>}</label>
                  <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer"><input type="checkbox" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} /> <Filter className="w-3.5 h-3.5" /> Au-dessus du seuil seulement</label>
                  <label className="ml-auto flex items-center gap-1.5 text-slate-600">Trier par
                    <select value={sortKey} onChange={(e) => { const k = e.target.value as SortKey; setSortKey(k); setSortAsc(k === 'brand' || k === 'model' || k === 'fuel'); }} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm">{(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}</select>
                    <button onClick={() => setSortAsc((v) => !v)} className="p-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">{sortAsc ? <ArrowUpNarrowWide className="w-3.5 h-3.5" /> : <ArrowDownWideNarrow className="w-3.5 h-3.5" />}</button>
                  </label>
                </div>
                <p className="px-5 pt-2 text-xs text-slate-500">
                  Même marque et modèle, même année, km à ± {KM_TOLERANCE.toLocaleString('fr-FR')} ; énergie, finition et puissance (10 %) quand connues des deux côtés. Leur prix en euros ; le nôtre (HT) mis en TTC {cc || 'du pays'} à {Math.round(vat * 1000) / 10} %{vatKnown ? '' : ' (taux inconnu : 20 %)'}.{' '}
                  {mode === 'sales' ? <>Ça passe quand notre vente TTC est au plus leur prix moins {fmtMoney(thresholds.sales, 'EUR')}.</> : <>Intéressant quand leur prix moins notre achat TTC atteint {fmtMoney(thresholds.offers, 'EUR')}.</>}
                </p>
                {result && (
                  <div className="px-5 pt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Kpi label="Leur stock (filtres)" value={String(result.theirsTotal)} hint={result.theirsPriced < result.theirsTotal ? `${result.theirsPriced} avec prix` : 'tous avec prix'} />
                    <Kpi label={mode === 'sales' ? 'Nos ventes connues' : pickedOffer ? 'Véhicules retenus de l\'offre' : 'Véhicules de nos offres'} value={String(result.oursTotal)} hint={result.oursUndated > 0 ? `dont ${result.oursUndated} sans année ou km : hors appariement` : undefined} />
                    <Kpi label="Leurs voitures appariées" value={String(result.matches.length)} hint={result.pairs > result.matches.length ? `${result.pairs} paires, la meilleure des nôtres en face` : undefined} />
                    <Kpi label="Au-dessus du seuil" value={String(okCount)} tone={okCount > 0 ? 'ok' : undefined} />
                  </div>
                )}
                {common.length > 0 && !pickedOffer && (
                  <div className="mx-5 mt-3 rounded-xl border border-slate-200 bg-white">
                    <button type="button" onClick={() => setCommonOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-2 text-left">
                      <span className="text-sm font-semibold text-slate-800">Modèles en commun <span className="text-slate-400 font-normal">· {common.length} — ce qu'ils ont en stock et que nous vendons ou avons en offre, sans condition d'année ni de km</span></span>
                      <span className="text-xs text-brand-ocean">{commonOpen ? 'replier' : 'déplier'}</span>
                    </button>
                    {commonOpen && (
                      <table className="w-full text-xs border-t border-slate-100">
                        <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-1.5 px-4 font-medium">Marque · modèle</th><th className="py-1.5 pr-3 font-medium text-right">Chez eux</th><th className="py-1.5 pr-3 font-medium text-right">Leur prix mini</th><th className="py-1.5 pr-3 font-medium text-right">Nos ventes</th><th className="py-1.5 pr-3 font-medium text-right">Dans nos offres</th><th className="py-1.5 pr-4 font-medium text-right">Notre achat HT mini</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {common.map((r) => (
                            <tr key={`${r.brand}|${r.model}`} className="text-slate-800">
                              <td className="py-1.5 px-4"><button type="button" onClick={() => { setFBrand(r.brand); setFModel(''); }} className="hover:underline text-left" title="Filtrer leur stock sur cette marque">{r.brand}</button> · {r.model}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{r.theirs}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{r.theirsMinEur != null ? fmtMoney(r.theirsMinEur, 'EUR') : '—'}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{r.sales}{r.sales > r.salesDated && <span className="text-slate-400"> ({r.sales - r.salesDated} sans année)</span>}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{r.offers || '—'}</td>
                              <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{r.offersMinHt != null ? fmtMoney(r.offersMinHt, 'EUR') : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
                {result?.warnings.map((w) => <p key={w} className="px-5 pt-1 text-xs text-amber-700">{w}</p>)}
                <div className="px-5 py-3">
                  {!result ? <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Lecture des ventes et des offres…</p>
                    : pickedOffer ? (
                      faceToFace.length === 0
                        ? <p className="text-sm text-slate-500">{result.matches.length > 0 && onlyOk ? `Aucune correspondance au-dessus du seuil pour cette offre (${result.matches.length} en dessous — décoche le filtre).` : 'Aucun véhicule de cette offre n\'a d\'équivalent dans leur stock (même modèle, même année, km à ± ' + KM_TOLERANCE.toLocaleString('fr-FR') + ').'}</p>
                        : <>
                            <p className="text-xs text-slate-500 mb-2">{(() => { const n = faceToFace.reduce((a, g) => a + g.count, 0); return <>{n} véhicule{n > 1 ? 's' : ''} de l'offre avec un équivalent chez eux{faceToFace.length < n ? ` (${faceToFace.length} bloc${faceToFace.length > 1 ? 's' : ''}, jumeaux regroupés)` : ''}{result.oursTotal > n ? ` · ${result.oursTotal - n} sans équivalent (non listés)` : ''}.</>; })()}</p>
                            <FaceToFace groups={faceToFace} vatLabel={`TTC ${cc || ''} ${Math.round(vat * 100)} %`} pickedId={picked?.theirs.id ?? null} onPick={(m) => pick(m)} />
                          </>
                    )
                    : compareRows.length === 0 ? <p className="text-sm text-slate-500">{result.matches.length > 0 && onlyOk ? `Aucune correspondance au-dessus du seuil (${result.matches.length} en dessous — décoche le filtre).` : 'Aucune voiture commune avec ces filtres.'}</p>
                      : (
                        <table className="w-full text-xs">
                          <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-2 pr-3 font-medium">Leur voiture</th><th className="py-2 pr-3 font-medium text-right">Leur prix</th><th className="py-2 pr-3 font-medium">{mode === 'sales' ? 'Notre vente' : 'Notre offre'}</th><th className="py-2 pr-3 font-medium text-right">{mode === 'sales' ? 'Notre vente' : 'Notre achat'} TTC {cc}<span className="block font-normal text-[10px]">HT en dessous</span></th><th className="py-2 pr-3 font-medium text-right">Écart</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">{compareRows.map((m) => <MatchRows key={m.theirs.id} m={m} mode={mode} picked={picked?.theirs.id === m.theirs.id} onPick={() => pick(m)} />)}</tbody>
                        </table>
                      )}
                </div>
              </>
            ) : tab === 'analyse' ? (
              <div className="px-5 py-3 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Kpi label="En stock (filtres)" value={String(stockFiltered.length)} hint={`${selPrices.length} avec prix`} />
                  <Kpi label="Disparus (filtres)" value={String(goneFiltered.length)} hint="présents avant, absents du dernier relevé" />
                  <Kpi label="Vélocité" value={velocity != null ? `${velocity} j` : '—'} hint="médiane des jours en stock des disparus" tone={velocity != null ? 'ok' : undefined} />
                  <Kpi label="Baisse avant départ" value={goneMoves.total ? `${goneMoves.dropped}/${goneMoves.total}` : '—'} hint={goneMoves.medianPct != null ? `baisse médiane ${goneMoves.medianPct.toLocaleString('fr-FR')} %` : 'disparus dont le prix avait baissé'} />
                </div>
                <PriceDistribution prices={pricesOf(stockFiltered)} gone={gonePrices} label="en stock" />
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 mb-1">Par modèle <span className="font-normal text-xs text-slate-500">— sous les filtres actifs</span></h4>
                  {byModel.length === 0 ? <p className="text-xs text-slate-400">Rien.</p> : (
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-1.5 pr-3 font-medium">Modèle</th><th className="py-1.5 pr-3 font-medium text-right">En stock</th><th className="py-1.5 pr-3 font-medium text-right">Médiane en stock</th><th className="py-1.5 pr-3 font-medium text-right">Disparus</th><th className="py-1.5 pr-3 font-medium text-right">Médiane disparus</th><th className="py-1.5 pr-3 font-medium text-right"><span className="inline-flex items-center gap-1 justify-end" title={DAYS_HELP}>Jours en stock (méd.) <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" aria-label={DAYS_HELP} /></span></th><th className="py-1.5 pr-3 font-medium text-right"><span className="inline-flex items-center gap-1 justify-end" title={ROTATION_HELP}>Rotation <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" aria-label={ROTATION_HELP} /></span></th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {byModel.slice(0, 80).map((r) => (
                          <tr key={r.key} className="hover:bg-slate-50 cursor-pointer" onClick={() => { const [b, m] = r.key.split('|'); setFBrand(b); setFModel(m); setTab('stock'); }} title="Filtrer sur ce modèle">
                            <td className="py-1.5 pr-3 font-medium text-slate-800">{r.label}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{r.inStock}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{r.medIn != null ? fmtMoney(r.medIn, 'EUR') : '—'}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{r.gone}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{r.medGone != null ? fmtMoney(r.medGone, 'EUR') : '—'}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{r.medDays != null ? `${r.medDays} j` : '—'}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{r.inStock + r.gone > 0 ? `${Math.round((r.gone / (r.inStock + r.gone)) * 100)} %` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">{ROTATION_HELP} Clique une ligne pour filtrer le Stock sur ce modèle.</p>
                </div>
              </div>
            ) : (
              <div className="px-5 py-3 space-y-4">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2 text-slate-700">Relevé automatique
                    <select value={freq} onChange={(e) => void changeFreq(e.target.value as Freq)} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm">
                      <option value="daily">quotidien (chaque nuit à 1 h)</option><option value="weekly">hebdomadaire</option><option value="off">arrêté</option>
                    </select>
                  </label>
                  {freqMsg && <span className={`text-xs ${/SQL/.test(freqMsg) ? 'text-amber-700' : 'text-emerald-700'}`}>{freqMsg}</span>}
                  <span className="ml-auto text-xs text-slate-500">{runs.length} relevé{runs.length > 1 ? 's' : ''}</span>
                </div>
                {/* VITRINE NON LISIBLE (09/11 soir, Channing) : signal avec sa raison, posé ou retiré ici. */}
                <div className={`rounded-lg border px-3 py-2 text-sm ${unread ? 'bg-orange-50 border-orange-300' : 'bg-slate-50 border-slate-200'}`}>
                  {unread ? (
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="text-orange-800 font-medium">⚠ Vitrine non lisible par Ada</span>
                      <span className="text-orange-900/80">— {unread}</span>
                      <button onClick={() => void clearUnreadable()} className="ml-auto text-xs px-2 py-1 rounded-lg border border-orange-300 text-orange-800 hover:bg-orange-100">Retirer le signal</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-slate-600 text-xs">Vitrine impossible à lire ? Pose un signal visible sur la fiche et dans la liste :</span>
                      <input value={unreadDraft} onChange={(e) => setUnreadDraft(e.target.value)} placeholder="raison (ex. liste servie par une API à clé)" className="flex-1 min-w-[220px] px-2 py-1 rounded-lg border border-slate-300 text-xs" />
                      <button onClick={() => void markUnreadable()} className="text-xs px-2 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100">Marquer non lisible</button>
                    </div>
                  )}
                  {unreadMsg && <p className={`text-xs mt-1 ${/SQL|refus/.test(unreadMsg) ? 'text-amber-700' : 'text-emerald-700'}`}>{unreadMsg}</p>}
                </div>
                {lastFailure && !scanning && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Dernier relevé en échec le {new Date(lastFailure.started_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} : {lastFailure.error ?? 'sans détail'}</p>}
                {runs.length === 0 ? <p className="text-sm text-slate-500">Aucun relevé encore.</p> : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-1.5 pr-3 font-medium">Date</th><th className="py-1.5 pr-3 font-medium">État</th><th className="py-1.5 pr-3 font-medium">Lecteur</th><th className="py-1.5 pr-3 font-medium text-right">Véhicules</th><th className="py-1.5 pr-3 font-medium text-right">Nouveaux</th><th className="py-1.5 pr-3 font-medium text-right">Disparus</th><th className="py-1.5 pr-3 font-medium text-right">Prix bougés</th><th className="py-1.5 pr-3 font-medium text-right">Pages</th><th className="py-1.5 pr-3 font-medium">Par</th><th className="py-1.5 pr-3 font-medium">Notes</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {runs.map((r) => (
                        <tr key={r.id} className={r.status === 'failed' ? 'bg-red-50/40' : r.status === 'running' ? 'bg-blue-50/40' : ''}>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(r.started_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}{r.finished_at && <span className="text-slate-400"> · {Math.max(1, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 60_000))} min</span>}</td>
                          <td className="py-1.5 pr-3">{r.status === 'done' ? <span className="text-emerald-700">terminé</span> : r.status === 'running' ? <span className="text-brand-encre">en cours</span> : <span className="text-red-700">échec</span>}</td>
                          <td className="py-1.5 pr-3 text-slate-600">{r.provider ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{r.total ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{r.new_count ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{r.gone_count ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{r.price_changes ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{r.pages ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-slate-600">{r.submitted_by ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-slate-500 max-w-[420px]"><span className="line-clamp-2" title={[r.error, ...(r.warnings ?? [])].filter(Boolean).join(' ; ')}>{[r.error, ...(r.warnings ?? [])].filter(Boolean).join(' ; ') || '—'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
          <LiveMarketColumn open={liveOpen} onToggle={() => setLiveOpen((v) => !v)} picked={picked} defaultCountry={defaultCountry} ourLabel={mode === 'sales' ? `notre vente TTC ${cc}` : `notre achat TTC ${cc}`} known={known} />
        </div>
      </div>
    </div>
  );
}
