/**
 * MARCHÉ EN DIRECT (02/11, Channing) : colonne de droite de « Comparer », repliée par défaut. On choisit une
 * ligne (« Marché » sur la ligne), les filtres du Market Intelligence s'y pré-remplissent depuis leur
 * voiture (marque, modèle, finition, énergie, boîte, années, km, puissance), on les corrige, on choisit un
 * pays, et Ada lance un relevé en direct — exactement la mécanique de l'Analyse des offres (URL par site
 * du pays, job du worker, prix d'attaque = médiane des 3/5/8 moins chères, médiane, annonces).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Radar, ExternalLink, Search } from 'lucide-react';
import { fmtMoney } from '../lib/fx';
import { OFFER_COUNTRIES } from '../services/offers';
import { lotTargets, startLotJob, awaitLotJob, mergeCountry, lotLabel, type OfferLot, type LotTarget, type SiteResult, type CountryResult } from '../lib/offers/marketCheck';
import type { CompareMatch, FuelFamily } from '../services/stockCompare';

/** Voiture choisie pour le marché en direct : une correspondance, ou une voiture du stock SANS correspondance
 *  (02/11, Channing : « comparer leurs autres stocks même sans correspondance »). */
export type LivePick = Pick<CompareMatch, 'theirs' | 'theirsEur' | 'theirsFuel' | 'theirsTrim' | 'theirsPower'> & { ours: CompareMatch['ours'] | null; ourTtc: number | null };

const FUEL_CANON_OF: Record<FuelFamily, string> = { phev: 'HYBRIDE RECHARGEABLE', hybrid: 'HYBRIDE', electric: 'ELECTRIQUE', diesel: 'DIESEL', petrol: 'ESSENCE', gas: 'GPL' };
const FUEL_OPTIONS = ['', 'ESSENCE', 'DIESEL', 'HYBRIDE', 'HYBRIDE RECHARGEABLE', 'ELECTRIQUE', 'GPL'];
const SITE_LABEL = (key: string) => key.replace(/^autoscout24_/, 'AS24 ').replace(/_/g, ' ');

export interface LiveFilters {
  country: string; brand: string; model: string; trim: string; fuel: string; gearbox: string;
  yearFrom: number | null; yearTo: number | null; kmMax: number | null; powerMin: number | null;
}

/** Filtres pré-remplis depuis la voiture du contact (ceux du MI). */
export function filtersFromMatch(m: LivePick, defaultCountry: string): LiveFilters {
  const t = m.theirs;
  return {
    country: defaultCountry,
    brand: (t.brand ?? '').toUpperCase(), model: (t.model ?? '').toUpperCase(),
    trim: m.theirsTrim ?? '', fuel: m.theirsFuel ? FUEL_CANON_OF[m.theirsFuel] : '',
    gearbox: /auto/i.test(t.gearbox ?? '') ? 'AUTOMATIQUE' : /manu/i.test(t.gearbox ?? '') ? 'MANUELLE' : '',
    yearFrom: t.year, yearTo: t.year,
    kmMax: t.km != null ? Math.ceil((t.km + 15_000) / 10_000) * 10_000 : null,
    powerMin: m.theirsPower != null ? Math.floor((m.theirsPower * 0.9) / 5) * 5 : null,
  };
}

function lotOf(f: LiveFilters): OfferLot {
  const base = { brand: f.brand.trim(), model: f.model.trim(), yearFrom: f.yearFrom, yearTo: f.yearTo, fuel: f.fuel || null, gearbox: f.gearbox || null, kmMax: f.kmMax, trim: f.trim.trim() || null, powerMin: f.powerMin };
  return { key: `live|${Object.values(base).join('|')}`, label: lotLabel(base), ...base, year: f.yearFrom, count: 0, vehicleIds: [], ourPriceMin: null, ourPriceMax: null, ourPriceAvg: null, adjusted: true };
}

type SiteState = { t: LotTarget; status: 'queued' | 'running' | 'done'; r?: SiteResult };

export function LiveMarketColumn({ open, onToggle, picked, defaultCountry, ourLabel }: {
  open: boolean; onToggle: () => void; picked: LivePick | null; defaultCountry: string; ourLabel: string;
}) {
  const [filters, setFilters] = useState<LiveFilters | null>(null);
  const [sites, setSites] = useState<SiteState[]>([]);
  const [result, setResult] = useState<CountryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [forId, setForId] = useState<string | null>(null);

  // Nouvelle ligne choisie : filtres repris de sa voiture, résultat précédent effacé (le pays est gardé).
  useEffect(() => {
    if (!picked) return;
    if (picked.theirs.id === forId) return;
    setForId(picked.theirs.id);
    setFilters((prev) => filtersFromMatch(picked, prev?.country ?? defaultCountry));
    setSites([]); setResult(null); setNotice(null);
  }, [picked, forId, defaultCountry]);

  const set = <K extends keyof LiveFilters>(k: K, v: LiveFilters[K]) => setFilters((f) => (f ? { ...f, [k]: v } : f));
  const num = (s: string) => (s === '' ? null : Number(s) || null);

  const launch = async () => {
    if (!filters || running) return;
    if (!filters.brand || !filters.model) { setNotice('Marque et modèle sont nécessaires.'); return; }
    setRunning(true); setNotice(null); setResult(null);
    const lot = lotOf(filters);
    let targets: LotTarget[] = [];
    try { targets = await lotTargets(lot, [filters.country]); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); setRunning(false); return; }
    const usable = targets.filter((t) => t.url);
    if (usable.length === 0) { setNotice(`Aucune URL pour ce pays${targets[0]?.warnings[0] ? ` (${targets[0].warnings[0]})` : ''}.`); setRunning(false); return; }
    setSites(targets.map((t) => ({ t, status: t.url ? 'running' : 'done', r: t.url ? undefined : { site: t.site, url: '', at: new Date().toISOString(), count: 0, total: null, median: null, p25: null, min: null, error: t.warnings[0] ?? 'pas d\'URL' } })));
    let merged: CountryResult | undefined;
    await Promise.all(usable.map(async (t) => {
      const url = t.url as string;
      let r: SiteResult;
      try { const jobId = await startLotJob(url, lot, 'Comparer (carte)'); r = await awaitLotJob(jobId, t.site, url, { model: lot.model, strict: t.brandPageOnly, trim: lot.trim, powerMin: lot.powerMin }); }
      catch (e) { r = { site: t.site, url, at: new Date().toISOString(), count: 0, total: null, median: null, p25: null, min: null, error: e instanceof Error ? e.message : String(e) }; }
      merged = mergeCountry(merged, filters.country, r);
      setResult(merged);
      setSites((ss) => ss.map((s) => (s.t.site === t.site ? { ...s, status: 'done', r } : s)));
    }));
    setRunning(false);
  };

  if (!open) {
    return (
      <button onClick={onToggle} title="Ouvrir le marché en direct" className="w-10 shrink-0 border-l border-slate-200 bg-slate-50 hover:bg-blue-50 flex flex-col items-center justify-center gap-2 text-brand-ocean">
        <ChevronLeft className="w-4 h-4" />
        <Radar className="w-4 h-4" />
        <span className="text-[11px] font-medium" style={{ writingMode: 'vertical-rl' }}>Marché en direct</span>
      </button>
    );
  }

  const theirsEur = picked?.theirsEur ?? null;
  const ourPrice = picked?.ourTtc ?? null;
  const attack = result?.attackTtc ?? result?.medianTtc ?? null;
  const pct = (p: number | null) => (p != null && attack != null && attack > 0 ? Math.round(((p - attack) / attack) * 100) : null);
  const pctLabel = (p: number | null) => { const x = pct(p); return x == null ? '—' : `${x >= 0 ? '+' : ''}${x} % vs attaque`; };

  return (
    <aside className="w-[400px] shrink-0 border-l border-slate-200 bg-slate-50/60 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white">
        <Radar className="w-4 h-4 text-brand-ocean" />
        <h3 className="text-sm font-semibold text-slate-800 flex-1">Marché en direct</h3>
        <button onClick={onToggle} title="Replier" className="p-1 rounded text-slate-500 hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {!picked || !filters ? (
          <p className="text-slate-500">Choisis une ligne du tableau (bouton « Marché ») : ses critères se pré-remplissent ici, tu les ajustes, puis tu lances le relevé dans le pays de ton choix.</p>
        ) : (
          <>
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
              <p className="font-medium text-slate-800 truncate" title={picked.theirs.title ?? ''}>{picked.theirs.title || `${picked.theirs.brand ?? ''} ${picked.theirs.model ?? ''}`}</p>
              <p className="text-slate-500">leur prix {fmtMoney(theirsEur ?? 0, 'EUR')} · {ourPrice != null ? `${ourLabel} ${fmtMoney(ourPrice, 'EUR')}` : 'sans correspondance chez nous'}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <L label="Marque"><input value={filters.brand} onChange={(e) => set('brand', e.target.value.toUpperCase())} className={inp} /></L>
              <L label="Modèle"><input value={filters.model} onChange={(e) => set('model', e.target.value.toUpperCase())} className={inp} /></L>
              <L label="Finition"><input value={filters.trim} onChange={(e) => set('trim', e.target.value.toUpperCase())} placeholder="—" className={inp} /></L>
              <L label="Énergie">
                <select value={filters.fuel} onChange={(e) => set('fuel', e.target.value)} className={inp}>
                  {FUEL_OPTIONS.map((f) => <option key={f} value={f}>{f ? f.toLowerCase() : 'toutes'}</option>)}
                </select>
              </L>
              <L label="Boîte">
                <select value={filters.gearbox} onChange={(e) => set('gearbox', e.target.value)} className={inp}>
                  <option value="">toutes</option><option value="AUTOMATIQUE">automatique</option><option value="MANUELLE">manuelle</option>
                </select>
              </L>
              <L label="Puissance mini (ch)"><input type="number" value={filters.powerMin ?? ''} onChange={(e) => set('powerMin', num(e.target.value))} placeholder="—" className={inp} /></L>
              <L label="Année de"><input type="number" value={filters.yearFrom ?? ''} onChange={(e) => set('yearFrom', num(e.target.value))} className={inp} /></L>
              <L label="Année à"><input type="number" value={filters.yearTo ?? ''} onChange={(e) => set('yearTo', num(e.target.value))} className={inp} /></L>
              <L label="Km max"><input type="number" step={10000} value={filters.kmMax ?? ''} onChange={(e) => set('kmMax', num(e.target.value))} placeholder="—" className={inp} /></L>
              <L label="Pays">
                <select value={filters.country} onChange={(e) => set('country', e.target.value)} className={inp}>
                  {OFFER_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </L>
            </div>
            <button onClick={() => void launch()} disabled={running} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-ocean text-white text-sm font-medium disabled:opacity-50">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} {running ? 'Relevé en cours…' : `Relever en ${OFFER_COUNTRIES.find((c) => c.code === filters.country)?.label ?? filters.country}`}
            </button>
            {notice && <p className="text-amber-700">{notice}</p>}
            {result && (
              <div className={`rounded-lg border px-2.5 py-2 space-y-1 ${attack != null ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
                <p className="text-slate-800"><span className="font-semibold">{attack != null ? fmtMoney(attack, 'EUR') : '—'}</span> <span className="text-slate-500">prix d'attaque{result.medianTtc != null ? ` · méd. ${fmtMoney(result.medianTtc, 'EUR')}` : ''} · {result.competitors} annonce{result.competitors > 1 ? 's' : ''}</span></p>
                <p className="text-slate-700">Leur prix : <span className="font-semibold">{pctLabel(theirsEur)}</span></p>
                {ourPrice != null && <p className="text-slate-700">{ourLabel} : <span className="font-semibold">{pctLabel(ourPrice)}</span></p>}
                {attack != null && theirsEur != null && <p className="text-[10px] text-slate-400">Prix du marché : affichés dans le pays relevé (TTC local). Notre prix : TTC du pays du contact.</p>}
              </div>
            )}
            {sites.length > 0 && (
              <ul className="space-y-1">
                {sites.map((s) => (
                  <li key={s.t.site} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1">
                    <span className="font-medium text-slate-700 w-24 truncate">{SITE_LABEL(s.t.site)}</span>
                    {s.status !== 'done' ? <span className="text-brand-encre flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> en cours</span>
                      : s.r?.error ? <span className="text-amber-700 truncate" title={s.r.error}>{s.r.error}</span>
                        : <span className="text-slate-600">{s.r?.count ?? 0} annonces{s.r?.attack != null ? ` · attaque ${fmtMoney(s.r.attack, 'EUR')}` : ''}{s.r?.median != null ? ` · méd. ${fmtMoney(s.r.median, 'EUR')}` : ''}</span>}
                    {s.t.url && <a href={s.t.url} target="_blank" rel="noreferrer" className="ml-auto text-brand-ocean" title="Ouvrir la recherche"><ExternalLink className="w-3 h-3" /></a>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

const inp = 'w-full px-2 py-1 rounded border border-slate-300 bg-white text-xs';
function L({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-[10px] text-slate-500">{label}<span className="block mt-0.5">{children}</span></label>;
}
