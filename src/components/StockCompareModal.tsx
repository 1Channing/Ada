/**
 * COMPARER (02/11, Channing) : le stock relevé d'un contact de la carte face à nos ventes passées
 * (seuil 5 000 €) ou à nos offres fournisseurs (seuil 7 000 €). Même marque/modèle, même année,
 * km ± 15 000. Deux onglets, un tableau : leur voiture ↔ la nôtre, l'écart en couleur.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { X, Loader2, ExternalLink, Scale, BadgeCheck, Filter, ChevronDown, ChevronRight, ArrowDownWideNarrow, ArrowUpNarrowWide, Radar } from 'lucide-react';
import { LiveMarketColumn, type LivePick } from './LiveMarketColumn';
import { theirsFuelTrim, type KnownModels } from '../services/stockCompare';
import { listRefBrandModels } from '../services/workflow';
import { loadLearnedModelsByBrand, mergeKnownModels } from '../lib/offers/knownModels';
import { toEur } from '../services/fxRates';
import { OFFER_COUNTRIES } from '../services/offers';
import { COUNTRY_VAT, countryVat } from '../lib/offers/vat';
import { fmtMoney } from '../lib/fx';
import { loadFxRates } from '../services/fxRates';
import {
  compareStock, loadOurOffers, loadOurSales, loadTheirStock, KM_TOLERANCE, SALES_THRESHOLD_EUR, OFFERS_THRESHOLD_EUR,
  FUEL_LABEL, type CompareMatch, type CompareResult, type OurVehicle, type FuelFamily,
} from '../services/stockCompare';
import type { StockVehicle } from '../services/dealerStock';

export type Mode = 'sales' | 'offers';
/** TRI (02/11, Channing : « trier par motorisation, marque, modèle… ») — écart par défaut. */
export type SortKey = 'gap' | 'brand' | 'model' | 'fuel' | 'year' | 'km' | 'price' | 'power';
export const SORT_LABEL: Record<SortKey, string> = { gap: 'Écart', brand: 'Marque', model: 'Modèle', fuel: 'Motorisation', year: 'Année', km: 'Kilométrage', price: 'Leur prix', power: 'Puissance' };
const cmpStr = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').localeCompare(b ?? '', 'fr');
const cmpNum = (a: number | null | undefined, b: number | null | undefined) => (a ?? -Infinity) - (b ?? -Infinity);
export function sortMatches(rows: CompareMatch[], key: SortKey, asc: boolean): CompareMatch[] {
  const dir = asc ? 1 : -1;
  const by: Record<SortKey, (a: CompareMatch, b: CompareMatch) => number> = {
    gap: (a, b) => a.gap - b.gap,
    brand: (a, b) => cmpStr(a.theirs.brand, b.theirs.brand) || cmpStr(a.theirs.model, b.theirs.model) || b.gap - a.gap,
    model: (a, b) => cmpStr(a.theirs.model, b.theirs.model) || cmpStr(a.theirs.brand, b.theirs.brand) || b.gap - a.gap,
    fuel: (a, b) => cmpStr(a.theirsFuel ? FUEL_LABEL[a.theirsFuel] : 'zz', b.theirsFuel ? FUEL_LABEL[b.theirsFuel] : 'zz') || b.gap - a.gap,
    year: (a, b) => cmpNum(a.theirs.year, b.theirs.year) || b.gap - a.gap,
    km: (a, b) => cmpNum(a.theirs.km, b.theirs.km) || b.gap - a.gap,
    price: (a, b) => a.theirsEur - b.theirsEur || b.gap - a.gap,
    power: (a, b) => cmpNum(a.theirsPower, b.theirsPower) || b.gap - a.gap,
  };
  return [...rows].sort((a, b) => dir * by[key](a, b));
}
const fmtKm = (km: number | null) => (km == null ? '—' : `${km.toLocaleString('fr-FR')} km`);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

export function StockCompareModal({ contactId, name, country, onClose, onOpenStock }: { contactId: string; name: string; country?: string | null; onClose: () => void; onOpenStock?: () => void }) {
  const [mode, setMode] = useState<Mode>('sales');
  const [theirs, setTheirs] = useState<StockVehicle[] | null>(null);
  const [sales, setSales] = useState<OurVehicle[] | null>(null);
  const [offers, setOffers] = useState<OurVehicle[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [onlyOk, setOnlyOk] = useState(true);
  const [query, setQuery] = useState('');
  // MARCHÉ EN DIRECT (02/11) : colonne de droite repliée par défaut, ligne choisie par « Marché ».
  const [liveOpen, setLiveOpen] = useState(false);
  const [picked, setPicked] = useState<LivePick | null>(null);
  // MODÈLES CONNUS (référentiel + livres des sites) pour normaliser « EQC 400 » → « EQC » (02/11).
  const [known, setKnown] = useState<KnownModels | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      listRefBrandModels().then((r) => r.modelsByBrand).catch(() => ({} as Record<string, string[]>)),
      loadLearnedModelsByBrand().catch(() => ({} as Record<string, string[]>)),
    ]).then(([ref, learned]) => { if (alive) setKnown(mergeKnownModels(ref, learned)); });
    return () => { alive = false; };
  }, []);
  // VUE (02/11, Channing : « comparer leurs autres stocks même sans correspondance, en cliquant sur la tuile ») :
  // 'matches' = les correspondances ; 'stock' = tout leur stock en vente, correspondance quand il y en a une.
  const [view, setView] = useState<'matches' | 'stock'>('matches');
  // Stock complet par tranches de 300 lignes (4 706 voitures chez Kamux : pas tout d'un coup).
  const [stockShown, setStockShown] = useState(300);
  const defaultCountry = OFFER_COUNTRIES.some((c) => c.code === (country ?? '').toUpperCase()) ? (country as string).toUpperCase() : 'FR';
  // TVA DU PAYS DU CONTACT (02/11) : leurs prix sont TTC, les nôtres HT → notre prix × (1 + TVA) avant l'écart.
  const cc = (country ?? '').toUpperCase();
  const vat = countryVat(cc);
  const vatKnown = cc in COUNTRY_VAT;
  const [sortKey, setSortKey] = useState<SortKey>('gap');
  // FILTRE ÉNERGIE (02/11, Channing) : sur l'énergie de LEUR voiture, dans les deux vues ; '' = toutes.
  const [fuelFilter, setFuelFilter] = useState<FuelFamily | ''>('');
  const [sortAsc, setSortAsc] = useState(false);
  // SEUILS MODIFIABLES (02/11, Channing : « garder 5 000 € et 7 000 € par défaut ») — mémorisés dans ce
  // navigateur, remis aux valeurs par défaut d'un clic.
  const [thresholds, setThresholds] = useState<Record<Mode, number>>(() => {
    try { const raw = JSON.parse(localStorage.getItem('ada_compare_thresholds') ?? 'null'); if (raw && typeof raw.sales === 'number' && typeof raw.offers === 'number') return raw; } catch { /* repli défaut */ }
    return { sales: SALES_THRESHOLD_EUR, offers: OFFERS_THRESHOLD_EUR };
  });
  const setThreshold = (m: Mode, v: number) => setThresholds((t) => { const next = { ...t, [m]: Math.max(0, Math.round(v)) }; try { localStorage.setItem('ada_compare_thresholds', JSON.stringify(next)); } catch { /* ignoré */ } return next; });
  const isDefault = thresholds.sales === SALES_THRESHOLD_EUR && thresholds.offers === OFFERS_THRESHOLD_EUR;

  useEffect(() => {
    let alive = true;
    (async () => {
      const errs: string[] = [];
      await loadFxRates().catch(() => { /* taux : repli EUR */ });
      // Modèles connus d'abord : les ventes sans dossier véhicule en ont besoin (04/11).
      const kn = await Promise.all([
        listRefBrandModels().then((r) => r.modelsByBrand).catch(() => ({} as Record<string, string[]>)),
        loadLearnedModelsByBrand().catch(() => ({} as Record<string, string[]>)),
      ]).then(([ref, learned]) => mergeKnownModels(ref, learned));
      const [t, s, o] = await Promise.all([loadTheirStock(contactId), loadOurSales(kn), loadOurOffers()]);
      if (!alive) return;
      if (t.error) errs.push(`Stock du contact : ${t.error}`);
      if (s.error) errs.push(`Ventes MC Export : ${s.error}`);
      if (o.error) errs.push(`Offres : ${o.error}`);
      setTheirs(t.rows); setSales(s.rows); setOffers(o.rows); setErrors(errs);
    })();
    return () => { alive = false; };
  }, [contactId]);

  const threshold = thresholds[mode];
  const result: CompareResult | null = useMemo(() => {
    if (!theirs) return null;
    const ours = mode === 'sales' ? sales : offers;
    if (!ours) return null;
    return compareStock(theirs, ours, threshold, vat, known);
  }, [theirs, sales, offers, mode, threshold, vat, known]);

  const rows = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    const kept = result.matches.filter((m) => (!onlyOk || m.ok) && (!fuelFilter || m.theirsFuel === fuelFilter) && (!q || `${m.theirs.title ?? ''} ${m.theirs.brand ?? ''} ${m.theirs.model ?? ''} ${m.ours.label} ${m.theirs.plate ?? ''}`.toLowerCase().includes(q)));
    return sortMatches(kept, sortKey, sortAsc);
  }, [result, onlyOk, query, sortKey, sortAsc, fuelFilter]);

  const loading = !theirs || !sales || !offers;
  /** Tout leur stock en vente (prix connu), la meilleure correspondance quand elle existe — même tri et même recherche. */
  const stockRows = useMemo((): LivePick[] => {
    if (!theirs || !result) return [];
    const best = new Map(result.matches.map((m) => [m.theirs.id, m]));
    const q = query.trim().toLowerCase();
    const out: LivePick[] = [];
    for (const t of theirs) {
      if (t.price == null || t.price <= 0) continue;
      const eur = toEur(t.price, t.currency ?? 'EUR');
      if (eur == null) continue;
      if (q && !`${t.title ?? ''} ${t.brand ?? ''} ${t.model ?? ''} ${t.plate ?? ''}`.toLowerCase().includes(q)) continue;
      const m = best.get(t.id);
      const tf = m ? { fuel: m.theirsFuel, trim: m.theirsTrim, power: m.theirsPower } : theirsFuelTrim(t);
      if (fuelFilter && tf.fuel !== fuelFilter) continue;
      if (m) { out.push(m); continue; }
      out.push({ theirs: t, theirsEur: Math.round(eur), theirsFuel: tf.fuel, theirsTrim: tf.trim, theirsPower: tf.power, ours: null, ourTtc: null });
    }
    const asMatch = (p: LivePick): CompareMatch => ('gap' in p ? p as CompareMatch : { ...p, ours: p.ours as CompareMatch['ours'], ourTtc: 0, gap: -Infinity, ok: false, fuelCompared: false, trimCompared: false, powerCompared: false, others: [] });
    const sorted = sortMatches(out.map(asMatch), sortKey, sortAsc);
    return sorted.map((m) => (m.gap === -Infinity ? out.find((p) => p.theirs.id === m.theirs.id)! : m));
  }, [theirs, result, query, sortKey, sortAsc, fuelFilter]);
  const okCount = result?.matches.filter((m) => m.ok).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[96vw] h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Scale className="w-5 h-5 text-brand-ocean" /> Comparer le stock de {name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Même marque et modèle, même année, kilométrage à ± {KM_TOLERANCE.toLocaleString('fr-FR')} km ; même énergie, même finition et puissance équivalente (à 10 % près) quand elles sont connues des deux côtés. Leur prix de vente converti en euros ; le nôtre (HT) mis en TTC {cc || 'du pays'} à {Math.round(vat * 1000) / 10} %{vatKnown ? '' : ' (pays sans taux connu : 20 % par défaut)'}.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 pt-3 flex flex-wrap items-center gap-2">
          <div role="tablist" className="flex rounded-lg bg-slate-100 p-0.5">
            {([['sales', 'Ventes MC Export'], ['offers', 'Offres fournisseurs']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={`px-3 py-1.5 rounded-md text-sm ${mode === id ? 'bg-white shadow text-slate-900 font-semibold' : 'text-slate-600 hover:text-slate-900'}`}>
                {label} <span className="text-xs text-slate-400 font-normal">· seuil {fmtMoney(thresholds[id], 'EUR')}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Seuil
            <input type="number" step={500} min={0} value={threshold} onChange={(e) => setThreshold(mode, Number(e.target.value) || 0)} aria-label={`Seuil ${mode === 'sales' ? 'ventes' : 'offres'} en euros`} className="w-24 px-2 py-1.5 rounded-lg border border-slate-300 text-right text-sm tabular-nums" />
            €
            {!isDefault && <button onClick={() => { setThreshold('sales', SALES_THRESHOLD_EUR); setThreshold('offers', OFFERS_THRESHOLD_EUR); }} className="text-brand-ocean hover:underline" title={`Ventes ${fmtMoney(SALES_THRESHOLD_EUR, 'EUR')}, offres ${fmtMoney(OFFERS_THRESHOLD_EUR, 'EUR')}`}>défauts</button>}
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer ml-2">
            <input type="checkbox" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} disabled={view === 'stock'} /> <Filter className="w-3.5 h-3.5" /> Au-dessus du seuil seulement{view === 'stock' ? ' (vue stock complet)' : ''}
          </label>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
            Énergie
            <select value={fuelFilter} onChange={(e) => setFuelFilter(e.target.value as FuelFamily | '')} className={`px-2 py-1.5 rounded-lg border bg-white text-sm ${fuelFilter ? 'border-brand-ocean text-brand-encre' : 'border-slate-300'}`}>
              <option value="">toutes</option>
              {(Object.keys(FUEL_LABEL) as FuelFamily[]).map((f) => <option key={f} value={f}>{FUEL_LABEL[f]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Trier par
            <select value={sortKey} onChange={(e) => { const k = e.target.value as SortKey; setSortKey(k); setSortAsc(k === 'brand' || k === 'model' || k === 'fuel'); }} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm">
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
            <button onClick={() => setSortAsc((v) => !v)} title={sortAsc ? 'Croissant — cliquer pour décroissant' : 'Décroissant — cliquer pour croissant'} className="p-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
              {sortAsc ? <ArrowUpNarrowWide className="w-3.5 h-3.5" /> : <ArrowDownWideNarrow className="w-3.5 h-3.5" />}
            </button>
          </label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer : modèle, plaque…" className="w-52 px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
        </div>

        <p className="px-5 pt-2 text-xs text-slate-500">
          {mode === 'sales'
            ? <>Ça passe quand <strong>notre prix de vente, mis en TTC {cc}</strong>, est au plus <strong>leur prix moins {fmtMoney(thresholds.sales, 'EUR')}</strong> : on a déjà vendu la même voiture à un prix qui leur laisse de la marge.</>
            : <>Intéressant quand <strong>leur prix de vente moins notre prix d'achat mis en TTC {cc}</strong> (HT fournisseur × TVA du pays) atteint <strong>{fmtMoney(thresholds.offers, 'EUR')}</strong>.</>}
        </p>

        {result && !loading && (
          <div className="px-5 pt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Leur stock en vente" value={String(result.theirsTotal)} hint={`${result.theirsPriced < result.theirsTotal ? `${result.theirsPriced} avec prix · ` : ''}${view === 'stock' ? 'affiché — cliquer pour revenir aux correspondances' : 'cliquer pour tout afficher'}`} active={view === 'stock'} onClick={() => setView((v) => (v === 'stock' ? 'matches' : 'stock'))} />
            <Kpi label={mode === 'sales' ? 'Nos ventes connues' : 'Véhicules de nos offres'} value={String(result.oursTotal)} />
            <Kpi label="Leurs voitures appariées" value={String(result.matches.length)} hint={result.pairs > result.matches.length ? `${result.pairs} paires au total, la meilleure des nôtres en face` : 'une des nôtres en face de chacune'} />
            <Kpi label="Au-dessus du seuil" value={String(okCount)} hint="de leurs voitures, face à notre meilleure offre" tone={okCount > 0 ? 'ok' : undefined} />
          </div>
        )}
        {errors.length > 0 && <div className="px-5 pt-2">{errors.map((e) => <p key={e} className="text-xs text-red-600">{e}</p>)}</div>}
        {result?.warnings.map((w) => <p key={w} className="px-5 pt-1 text-xs text-amber-700">{w}</p>)}

        <div className="flex-1 min-h-0 flex">
        <div className="flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Lecture du stock, des ventes et des offres…</p>
          ) : result && result.theirsTotal === 0 ? (
            <div className="text-sm text-slate-600 space-y-2">
              <p>Aucun relevé de stock pour cette concession : il faut d'abord lire sa vitrine.</p>
              {onOpenStock && <button onClick={onOpenStock} className="text-sm px-3 py-1.5 rounded-lg bg-brand-ocean text-white">Relever le stock</button>}
            </div>
          ) : view === 'stock' ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">Leur voiture <span className="font-normal text-slate-400">· {stockRows.length} en vente</span></th>
                  <th className="py-2 pr-3 font-medium text-right">Leur prix</th>
                  <th className="py-2 pr-3 font-medium">{mode === 'sales' ? 'Notre vente' : 'Notre offre'} <span className="font-normal text-slate-400">· quand elle existe</span></th>
                  <th className="py-2 pr-3 font-medium text-right">{mode === 'sales' ? 'Notre vente' : 'Notre achat'} TTC {cc}</th>
                  <th className="py-2 pr-3 font-medium text-right">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stockRows.slice(0, stockShown).map((p) => ('gap' in p
                  ? <MatchRows key={p.theirs.id} m={p as CompareMatch} mode={mode} picked={picked?.theirs.id === p.theirs.id} onPick={() => { setPicked(p); setLiveOpen(true); }} />
                  : <StockOnlyRow key={p.theirs.id} p={p} picked={picked?.theirs.id === p.theirs.id} onPick={() => { setPicked(p); setLiveOpen(true); }} />))}
              </tbody>
              {stockRows.length > stockShown && (
                <tfoot><tr><td colSpan={5} className="py-3 text-center">
                  <button onClick={() => setStockShown((n) => n + 300)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Afficher 300 de plus ({stockRows.length - stockShown} restantes)</button>
                </td></tr></tfoot>
              )}
            </table>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {result && result.matches.length > 0 && onlyOk
                ? `Aucune correspondance au-dessus du seuil (${result.matches.length} en dessous — décoche le filtre pour les voir).`
                : `Aucune voiture commune : même marque et modèle, même année et ${KM_TOLERANCE.toLocaleString('fr-FR')} km d'écart au plus.`}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">Leur voiture</th>
                  <th className="py-2 pr-3 font-medium text-right">Leur prix</th>
                  <th className="py-2 pr-3 font-medium">{mode === 'sales' ? 'Notre vente' : 'Notre offre'}</th>
                  <th className="py-2 pr-3 font-medium text-right">{mode === 'sales' ? 'Notre vente' : 'Notre achat'} TTC {cc}<span className="block font-normal text-[10px]">HT en dessous</span></th>
                  <th className="py-2 pr-3 font-medium text-right">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((m) => <MatchRows key={m.theirs.id} m={m} mode={mode} picked={picked?.theirs.id === m.theirs.id} onPick={() => { setPicked(m); setLiveOpen(true); }} />)}
              </tbody>
            </table>
          )}
        </div>
        <LiveMarketColumn open={liveOpen} onToggle={() => setLiveOpen((v) => !v)} picked={picked} defaultCountry={defaultCountry} ourLabel={mode === 'sales' ? `notre vente TTC ${cc}` : `notre achat TTC ${cc}`} known={known} />
        </div>
      </div>
    </div>
  );
}

/** Une voiture du contact : sa meilleure correspondance, puis les autres dépliables (02/11). */
export function MatchRows({ m, mode, picked, onPick }: { m: CompareMatch; mode: Mode; picked: boolean; onPick: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <Row m={m} mode={mode} othersCount={m.others.length} open={open} onToggle={() => setOpen((v) => !v)} picked={picked} onPick={onPick} />
      {open && m.others.map((x) => <Row key={x.ours.id} m={x} mode={mode} alt />)}
    </Fragment>
  );
}

function Row({ m, mode, othersCount = 0, open = false, onToggle, alt = false, picked = false, onPick }: { m: CompareMatch; mode: Mode; othersCount?: number; open?: boolean; onToggle?: () => void; alt?: boolean; picked?: boolean; onPick?: () => void }) {
  const t = m.theirs;
  const o = m.ours;
  return (
    <tr className={`${m.ok ? '' : 'opacity-70'} ${alt ? 'bg-slate-50/60' : ''} ${picked ? 'bg-blue-50/60' : ''}`}>
      <td className="py-2 pr-3 align-top">
        {alt ? (
          <span className="block pl-5 text-slate-400 italic">même voiture, autre correspondance</span>
        ) : (
          <>
            <span className="font-medium text-slate-800">{t.title || `${t.brand ?? ''} ${t.model ?? ''}`}</span>
            {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-brand-ocean align-middle" aria-label="Ouvrir l'annonce"><ExternalLink className="w-3 h-3" /></a>}
            <span className="block text-slate-500">{t.year ?? '—'} · {fmtKm(t.km)}{t.plate ? ` · ${t.plate}` : ''}{m.theirsFuel ? ` · ${FUEL_LABEL[m.theirsFuel]}` : ''}{m.theirsPower ? ` · ${m.theirsPower} ch` : ''}{m.theirsTrim ? ` · ${m.theirsTrim}` : ''}</span>
            {othersCount > 0 && onToggle && (
              <button onClick={onToggle} className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-brand-ocean hover:underline">
                {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {open ? 'masquer' : 'voir'} {othersCount} autre{othersCount > 1 ? 's' : ''} correspondance{othersCount > 1 ? 's' : ''}
              </button>
            )}
          </>
        )}
      </td>
      <td className="py-2 pr-3 align-top text-right tabular-nums whitespace-nowrap">
        {!alt && <span className="font-semibold text-slate-800">{fmtMoney(m.theirsEur, 'EUR')}</span>}
        {!alt && t.currency && t.currency !== 'EUR' && t.price != null && <span className="block text-[10px] text-slate-400">{fmtMoney(t.price, t.currency)}</span>}
      </td>
      <td className="py-2 pr-3 align-top">
        <span className="font-medium text-slate-800">{o.label}</span>
        <span className="block text-slate-500">{o.year ?? '—'} · {fmtKm(o.km)}{o.plate ? ` · ${o.plate}` : ''}{o.fuel ? ` · ${FUEL_LABEL[o.fuel]}` : ''}{o.power ? ` · ${o.power} ch` : ''}{o.trim ? ` · ${o.trim}` : ''}</span>
        {o.offerId ? (
          // 04/11 (Channing) : l'offre est cliquable et ouvre Offres sur ce lot ; la Carte reste montée telle quelle
          // (keep-alive d'App), un clic sur « Carte » dans le menu ramène exactement où on s'est arrêté.
          <button type="button" onClick={() => window.history.pushState({}, '', `/offres?offer=${encodeURIComponent(o.offerId!)}&view=analyse&t=${Date.now()}`)} className="block text-left text-brand-ocean hover:underline" title="Ouvrir cette offre dans Offres — « Carte » dans le menu te ramène ici">
            {o.detail}{o.date ? ` · ${fmtDate(o.date)}` : ''}
          </button>
        ) : (
          <span className="block text-slate-400">{o.detail}{o.date ? ` · ${fmtDate(o.date)}` : ''}</span>
        )}
      </td>
      <td className="py-2 pr-3 align-top text-right tabular-nums whitespace-nowrap">
        <span className="font-semibold text-slate-800">{fmtMoney(m.ourTtc, 'EUR')}</span>
        <span className="block text-[10px] text-slate-400">HT {fmtMoney(o.price, 'EUR')}</span>
        {mode === 'sales' && o.purchase != null && <span className="block text-[10px] text-slate-400">acheté HT {fmtMoney(o.purchase, 'EUR')}</span>}
      </td>
      <td className="py-2 pr-3 align-top text-right whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold tabular-nums ${m.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : m.gap >= 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
          {m.ok && <BadgeCheck className="w-3 h-3" />}{m.gap >= 0 ? '+' : ''}{fmtMoney(m.gap, 'EUR')}
        </span>
        <span className="block mt-0.5 text-[10px] text-slate-400">
          {m.fuelCompared ? 'énergie ✓' : 'énergie non comparée'} · {m.powerCompared ? 'puissance ✓' : 'puissance non comparée'} · {m.trimCompared ? 'finition ✓' : 'finition non comparée'}
        </span>
        {!alt && onPick && (
          <button onClick={onPick} className={`mt-1 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border ${picked ? 'border-brand-ocean bg-brand-ocean text-white' : 'border-slate-300 text-brand-ocean hover:bg-blue-50'}`} title="Relever le marché en direct pour cette voiture (colonne de droite)">
            <Radar className="w-3 h-3" /> Marché
          </button>
        )}
      </td>
    </tr>
  );
}

/** Voiture du stock sans correspondance chez nous : juste elle, et le bouton « Marché » (02/11). */
/** FACE-À-FACE D'UNE OFFRE PRÉCISE (13/11, Channing : « comparer avec une offre qu'on sélectionnerait de manière
 *  précise, Ada présente les modèles du stock en face de l'offre, seulement ceux qui matchent, un UI propre ») :
 *  un bloc par véhicule de l'offre qui a au moins une voiture équivalente chez le partenaire, leurs voitures en
 *  dessous du meilleur écart au moins bon. Les véhicules sans équivalent ne sont pas listés (comptés à part). */
export interface FaceToFaceGroup { ours: OurVehicle; theirs: CompareMatch[]; /** Jumeaux de l'offre regroupés (même libellé, année, prix) : nombre et étendue de km. */ count: number; kmMin: number | null; kmMax: number | null }
export function groupByOurs(matches: CompareMatch[], onlyOk: boolean): FaceToFaceGroup[] {
  const map = new Map<string, FaceToFaceGroup>();
  for (const m of matches) for (const x of [m, ...m.others]) {
    if (onlyOk && !x.ok) continue;
    const g = map.get(x.ours.id) ?? map.set(x.ours.id, { ours: x.ours, theirs: [], count: 1, kmMin: x.ours.km, kmMax: x.ours.km }).get(x.ours.id)!;
    if (!g.theirs.some((y) => y.theirs.id === x.theirs.id)) g.theirs.push(x);
  }
  for (const g of map.values()) g.theirs.sort((a, b) => b.gap - a.gap);
  // Jumeaux (une offre de 11 Bigster identiques face aux 4 mêmes voitures) : un seul bloc « × 11 », km de… à….
  const merged = new Map<string, FaceToFaceGroup>();
  for (const g of map.values()) {
    const o = g.ours;
    const k = [o.label, o.year, o.price, o.fuel, o.trim, o.power, g.theirs.map((t) => t.theirs.id).join(',')].join('|');
    const m = merged.get(k);
    if (!m) merged.set(k, g);
    else { m.count++; if (o.km != null) { m.kmMin = m.kmMin == null ? o.km : Math.min(m.kmMin, o.km); m.kmMax = m.kmMax == null ? o.km : Math.max(m.kmMax, o.km); } }
  }
  const groups = [...merged.values()];
  groups.sort((a, b) => b.theirs[0].gap - a.theirs[0].gap);
  return groups;
}
export function FaceToFace({ groups, vatLabel, pickedId, onPick }: { groups: FaceToFaceGroup[]; vatLabel: string; pickedId: string | null; onPick: (m: CompareMatch) => void }) {
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const o = g.ours;
        return (
          <div key={o.id} className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-slate-900">{o.label}{g.count > 1 && <span className="ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-brand-ocean text-white align-middle">× {g.count}</span>}</span>
                <span className="block text-xs text-slate-500">{o.year ?? '—'} · {g.count > 1 && g.kmMin != null && g.kmMax != null && g.kmMin !== g.kmMax ? `${g.kmMin.toLocaleString('fr-FR')} à ${g.kmMax.toLocaleString('fr-FR')} km` : fmtKm(o.km)}{o.fuel ? ` · ${FUEL_LABEL[o.fuel]}` : ''}{o.power ? ` · ${o.power} ch` : ''}{o.trim ? ` · ${o.trim}` : ''}</span>
              </div>
              <div className="ml-auto text-right whitespace-nowrap">
                <span className="text-sm font-semibold text-slate-900">{fmtMoney(g.theirs[0].ourTtc, 'EUR')} <span className="text-[11px] font-normal text-slate-500">{vatLabel}</span></span>
                <span className="block text-[11px] text-slate-500">notre achat HT {fmtMoney(o.price, 'EUR')}</span>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600 whitespace-nowrap">{g.theirs.length} chez eux</span>
            </div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {g.theirs.map((m) => {
                  const t = m.theirs;
                  return (
                    <tr key={t.id} className={`${m.ok ? '' : 'opacity-70'} ${pickedId === t.id ? 'bg-blue-50/60' : 'hover:bg-slate-50/60'}`}>
                      <td className="py-2 pl-4 pr-3 align-top">
                        <span className="font-medium text-slate-800">{t.title || `${t.brand ?? ''} ${t.model ?? ''}`}</span>
                        {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-brand-ocean align-middle" aria-label="Ouvrir l'annonce"><ExternalLink className="w-3 h-3" /></a>}
                        <span className="block text-slate-500">{t.year ?? '—'} · {fmtKm(t.km)}{t.plate ? ` · ${t.plate}` : ''}{m.theirsFuel ? ` · ${FUEL_LABEL[m.theirsFuel]}` : ''}{m.theirsPower ? ` · ${m.theirsPower} ch` : ''}{m.theirsTrim ? ` · ${m.theirsTrim}` : ''}</span>
                      </td>
                      <td className="py-2 pr-3 align-top text-right tabular-nums whitespace-nowrap">
                        <span className="font-semibold text-slate-800">{fmtMoney(m.theirsEur, 'EUR')}</span>
                        {t.currency && t.currency !== 'EUR' && t.price != null && <span className="block text-[10px] text-slate-400">{fmtMoney(t.price, t.currency)}</span>}
                      </td>
                      <td className="py-2 pr-3 align-top text-right whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold tabular-nums ${m.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : m.gap >= 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                          {m.ok && <BadgeCheck className="w-3 h-3" />}{m.gap >= 0 ? '+' : ''}{fmtMoney(m.gap, 'EUR')}
                        </span>
                      </td>
                      <td className="py-2 pr-4 align-top text-right whitespace-nowrap">
                        <button type="button" onClick={() => onPick(m)} className={`text-[11px] px-2 py-1 rounded-lg border ${pickedId === t.id ? 'border-brand-ocean text-brand-encre bg-blue-50' : 'border-slate-300 text-slate-600 bg-white hover:bg-slate-50'}`}>Marché</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export function StockOnlyRow({ p, picked, onPick }: { p: LivePick; picked: boolean; onPick: () => void }) {
  const t = p.theirs;
  return (
    <tr className={picked ? 'bg-blue-50/60' : ''}>
      <td className="py-2 pr-3 align-top">
        <span className="font-medium text-slate-800">{t.title || `${t.brand ?? ''} ${t.model ?? ''}`}</span>
        {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-brand-ocean align-middle" aria-label="Ouvrir l'annonce"><ExternalLink className="w-3 h-3" /></a>}
        <span className="block text-slate-500">{t.year ?? '—'} · {fmtKm(t.km)}{t.plate ? ` · ${t.plate}` : ''}{p.theirsFuel ? ` · ${FUEL_LABEL[p.theirsFuel]}` : ''}{p.theirsPower ? ` · ${p.theirsPower} ch` : ''}{p.theirsTrim ? ` · ${p.theirsTrim}` : ''}</span>
      </td>
      <td className="py-2 pr-3 align-top text-right tabular-nums whitespace-nowrap">
        <span className="font-semibold text-slate-800">{fmtMoney(p.theirsEur, 'EUR')}</span>
        {t.currency && t.currency !== 'EUR' && t.price != null && <span className="block text-[10px] text-slate-400">{fmtMoney(t.price, t.currency)}</span>}
      </td>
      <td className="py-2 pr-3 align-top text-slate-400 italic">aucune correspondance chez nous</td>
      <td className="py-2 pr-3 align-top text-right text-slate-300">—</td>
      <td className="py-2 pr-3 align-top text-right whitespace-nowrap">
        <button onClick={onPick} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border ${picked ? 'border-brand-ocean bg-brand-ocean text-white' : 'border-slate-300 text-brand-ocean hover:bg-blue-50'}`} title="Relever le marché en direct pour cette voiture (colonne de droite)">
          <Radar className="w-3 h-3" /> Marché
        </button>
      </td>
    </tr>
  );
}

export function Kpi({ label, value, hint, tone, active, onClick }: { label: string; value: string; hint?: string; tone?: 'ok'; active?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`text-left rounded-xl border px-3 py-2 ${tone === 'ok' ? 'border-emerald-200 bg-emerald-50/50' : active ? 'border-brand-ocean bg-blue-50/60' : 'border-slate-200 bg-slate-50/60'} ${onClick ? 'hover:border-brand-ocean cursor-pointer' : ''}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'ok' ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </Tag>
  );
}
