/**
 * COMPARER (02/11, Channing) : le stock relevé d'un contact de la carte face à nos ventes passées
 * (seuil 5 000 €) ou à nos offres fournisseurs (seuil 7 000 €). Même marque/modèle, même année,
 * km ± 15 000. Deux onglets, un tableau : leur voiture ↔ la nôtre, l'écart en couleur.
 */
import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, ExternalLink, Scale, BadgeCheck, Filter } from 'lucide-react';
import { fmtMoney } from '../lib/fx';
import { loadFxRates } from '../services/fxRates';
import {
  compareStock, loadOurOffers, loadOurSales, loadTheirStock, KM_TOLERANCE, SALES_THRESHOLD_EUR, OFFERS_THRESHOLD_EUR,
  FUEL_LABEL, type CompareMatch, type CompareResult, type OurVehicle,
} from '../services/stockCompare';
import type { StockVehicle } from '../services/dealerStock';

type Mode = 'sales' | 'offers';
const fmtKm = (km: number | null) => (km == null ? '—' : `${km.toLocaleString('fr-FR')} km`);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

export function StockCompareModal({ contactId, name, onClose, onOpenStock }: { contactId: string; name: string; onClose: () => void; onOpenStock?: () => void }) {
  const [mode, setMode] = useState<Mode>('sales');
  const [theirs, setTheirs] = useState<StockVehicle[] | null>(null);
  const [sales, setSales] = useState<OurVehicle[] | null>(null);
  const [offers, setOffers] = useState<OurVehicle[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [onlyOk, setOnlyOk] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const errs: string[] = [];
      await loadFxRates().catch(() => { /* taux : repli EUR */ });
      const [t, s, o] = await Promise.all([loadTheirStock(contactId), loadOurSales(), loadOurOffers()]);
      if (!alive) return;
      if (t.error) errs.push(`Stock du contact : ${t.error}`);
      if (s.error) errs.push(`Ventes MC Export : ${s.error}`);
      if (o.error) errs.push(`Offres : ${o.error}`);
      setTheirs(t.rows); setSales(s.rows); setOffers(o.rows); setErrors(errs);
    })();
    return () => { alive = false; };
  }, [contactId]);

  const threshold = mode === 'sales' ? SALES_THRESHOLD_EUR : OFFERS_THRESHOLD_EUR;
  const result: CompareResult | null = useMemo(() => {
    if (!theirs) return null;
    const ours = mode === 'sales' ? sales : offers;
    if (!ours) return null;
    return compareStock(theirs, ours, threshold);
  }, [theirs, sales, offers, mode, threshold]);

  const rows = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    return result.matches.filter((m) => (!onlyOk || m.ok) && (!q || `${m.theirs.title ?? ''} ${m.theirs.brand ?? ''} ${m.theirs.model ?? ''} ${m.ours.label} ${m.theirs.plate ?? ''}`.toLowerCase().includes(q)));
  }, [result, onlyOk, query]);

  const loading = !theirs || !sales || !offers;
  const okCount = result?.matches.filter((m) => m.ok).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Scale className="w-5 h-5 text-brand-ocean" /> Comparer le stock de {name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Même marque et modèle, même année, kilométrage à ± {KM_TOLERANCE.toLocaleString('fr-FR')} km ; même énergie et même finition quand elles sont connues des deux côtés. Leur prix de vente converti en euros.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 pt-3 flex flex-wrap items-center gap-2">
          <div role="tablist" className="flex rounded-lg bg-slate-100 p-0.5">
            {([['sales', 'Ventes MC Export', SALES_THRESHOLD_EUR], ['offers', 'Offres fournisseurs', OFFERS_THRESHOLD_EUR]] as const).map(([id, label, th]) => (
              <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={`px-3 py-1.5 rounded-md text-sm ${mode === id ? 'bg-white shadow text-slate-900 font-semibold' : 'text-slate-600 hover:text-slate-900'}`}>
                {label} <span className="text-xs text-slate-400 font-normal">· seuil {fmtMoney(th, 'EUR')}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer ml-2">
            <input type="checkbox" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} /> <Filter className="w-3.5 h-3.5" /> Au-dessus du seuil seulement
          </label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer : modèle, plaque…" className="ml-auto w-56 px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
        </div>

        <p className="px-5 pt-2 text-xs text-slate-500">
          {mode === 'sales'
            ? <>Ça passe quand <strong>notre prix de vente</strong> est au plus <strong>leur prix moins {fmtMoney(SALES_THRESHOLD_EUR, 'EUR')}</strong> : on a déjà vendu la même voiture à un prix qui leur laisse de la marge.</>
            : <>Intéressant quand <strong>leur prix de vente moins notre prix d'achat</strong> (HT fournisseur, dans nos offres) atteint <strong>{fmtMoney(OFFERS_THRESHOLD_EUR, 'EUR')}</strong>.</>}
        </p>

        {result && !loading && (
          <div className="px-5 pt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Leur stock en vente" value={String(result.theirsTotal)} hint={result.theirsPriced < result.theirsTotal ? `${result.theirsPriced} avec prix` : 'tous avec prix'} />
            <Kpi label={mode === 'sales' ? 'Nos ventes connues' : 'Véhicules de nos offres'} value={String(result.oursTotal)} />
            <Kpi label="Correspondances" value={String(result.matches.length)} hint={`${okCount} au-dessus du seuil`} tone={okCount > 0 ? 'ok' : undefined} />
            <Kpi label="Leurs voitures concernées" value={String(result.theirsOk)} hint="avec au moins un match au-dessus du seuil" tone={result.theirsOk > 0 ? 'ok' : undefined} />
          </div>
        )}
        {errors.length > 0 && <div className="px-5 pt-2">{errors.map((e) => <p key={e} className="text-xs text-red-600">{e}</p>)}</div>}
        {result?.warnings.map((w) => <p key={w} className="px-5 pt-1 text-xs text-amber-700">{w}</p>)}

        <div className="flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Lecture du stock, des ventes et des offres…</p>
          ) : result && result.theirsTotal === 0 ? (
            <div className="text-sm text-slate-600 space-y-2">
              <p>Aucun relevé de stock pour cette concession : il faut d'abord lire sa vitrine.</p>
              {onOpenStock && <button onClick={onOpenStock} className="text-sm px-3 py-1.5 rounded-lg bg-brand-ocean text-white">Relever le stock</button>}
            </div>
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
                  <th className="py-2 pr-3 font-medium text-right">{mode === 'sales' ? 'Notre prix de vente' : 'Notre prix d\'achat HT'}</th>
                  <th className="py-2 pr-3 font-medium text-right">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((m) => <Row key={`${m.theirs.id}|${m.ours.id}`} m={m} mode={mode} />)}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ m, mode }: { m: CompareMatch; mode: Mode }) {
  const t = m.theirs;
  const o = m.ours;
  return (
    <tr className={m.ok ? '' : 'opacity-70'}>
      <td className="py-2 pr-3 align-top">
        <span className="font-medium text-slate-800">{t.title || `${t.brand ?? ''} ${t.model ?? ''}`}</span>
        {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-brand-ocean align-middle" aria-label="Ouvrir l'annonce"><ExternalLink className="w-3 h-3" /></a>}
        <span className="block text-slate-500">{t.year ?? '—'} · {fmtKm(t.km)}{t.plate ? ` · ${t.plate}` : ''}{m.theirsFuel ? ` · ${FUEL_LABEL[m.theirsFuel]}` : ''}{m.theirsTrim ? ` · ${m.theirsTrim}` : ''}</span>
      </td>
      <td className="py-2 pr-3 align-top text-right tabular-nums whitespace-nowrap">
        <span className="font-semibold text-slate-800">{fmtMoney(m.theirsEur, 'EUR')}</span>
        {t.currency && t.currency !== 'EUR' && t.price != null && <span className="block text-[10px] text-slate-400">{fmtMoney(t.price, t.currency)}</span>}
      </td>
      <td className="py-2 pr-3 align-top">
        <span className="font-medium text-slate-800">{o.label}</span>
        <span className="block text-slate-500">{o.year ?? '—'} · {fmtKm(o.km)}{o.plate ? ` · ${o.plate}` : ''}{o.fuel ? ` · ${FUEL_LABEL[o.fuel]}` : ''}{o.trim ? ` · ${o.trim}` : ''}</span>
        <span className="block text-slate-400">{o.detail}{o.date ? ` · ${fmtDate(o.date)}` : ''}</span>
      </td>
      <td className="py-2 pr-3 align-top text-right tabular-nums whitespace-nowrap">
        <span className="font-semibold text-slate-800">{fmtMoney(o.price, 'EUR')}</span>
        {mode === 'sales' && o.purchase != null && <span className="block text-[10px] text-slate-400">acheté {fmtMoney(o.purchase, 'EUR')}</span>}
      </td>
      <td className="py-2 pr-3 align-top text-right whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold tabular-nums ${m.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : m.gap >= 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
          {m.ok && <BadgeCheck className="w-3 h-3" />}{m.gap >= 0 ? '+' : ''}{fmtMoney(m.gap, 'EUR')}
        </span>
        <span className="block mt-0.5 text-[10px] text-slate-400">
          {m.fuelCompared ? 'énergie ✓' : 'énergie non comparée'} · {m.trimCompared ? 'finition ✓' : 'finition non comparée'}
        </span>
      </td>
    </tr>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${tone === 'ok' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50/60'}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'ok' ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}
