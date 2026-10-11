/**
 * TRAJECTOIRE DES PRIX — instrument de l'Accueil (bêta, 11/10).
 *
 * Décision Channing : « les trajectoires de prix ne doivent pas être dans le
 * MI mais dans l'accueil de chacun, et ne montrer que les véhicules en études
 * quotidiennes (ceux sur lesquels nous aurons le plus de data). On doit
 * pouvoir choisir marque et modèle : un instrument de précision. »
 *
 * Faits seulement (« en vélocité ce qu'on est sûr uniquement ») : pour chaque
 * annonce du pays d'achat et du pays de vente, le trajet des prix daté relevé
 * par relevé, l'ancien prix barré et la mise en ligne déclarés par le site,
 * la présence prouvée par les relevés. Jamais « vendue », jamais de durée
 * estimée.
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { COUNTRY_NAMES } from '../data/cities';
import { humanListingUrl, fuelLabel } from '../services/marketData';
import { listDailySearches, type DailySearch } from '../services/workflow';
import { loadStudyTrajectory, summarizeFacts, type ListingFact, type StudyTrajectory } from '../services/listingFacts';

const COUNTRY_FLAG: Record<string, string> = {
  FR: '🇫🇷', NL: '🇳🇱', DK: '🇩🇰', DE: '🇩🇪', IT: '🇮🇹', ES: '🇪🇸', BE: '🇧🇪', HU: '🇭🇺', LT: '🇱🇹', SE: '🇸🇪',
};
const FUEL_CRITERIA_LABEL: Record<string, string> = {
  ELECTRIQUE: 'électrique', ESSENCE: 'essence', DIESEL: 'diesel', HYBRIDE: 'hybride', MILD_HYBRID: 'micro-hybride',
  PLUG_IN_HYBRID: 'hybride rechargeable', GPL: 'GPL', CNG: 'GNV',
};
const SELECTED_KEY = 'ada_trajectory_study';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
const fmtEur = (n: number | null | undefined) => (n == null || n === 0 ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
const fmtPct = (p: number | null | undefined) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p.toLocaleString('fr-FR')} %`);

function studyTitle(s: DailySearch): string {
  const years = s.year_min && s.year_max ? (s.year_min === s.year_max ? String(s.year_min) : `${s.year_min}–${s.year_max}`)
    : s.year_min ? `dès ${s.year_min}` : s.year_max ? `jusqu'à ${s.year_max}` : '';
  return [`${s.brand} ${s.model}`.trim(), years, FUEL_CRITERIA_LABEL[s.fuel] ?? (s.fuel ? fuelLabel(s.fuel.toLowerCase()) : ''), s.trim]
    .filter(Boolean).join(' · ');
}

export function PriceTrajectory() {
  const [studies, setStudies] = useState<DailySearch[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>(() => { try { return localStorage.getItem(SELECTED_KEY) ?? ''; } catch { return ''; } });
  const [cache, setCache] = useState<Record<string, StudyTrajectory>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    listDailySearches()
      .then((all) => {
        // Actives d'abord, puis par libellé — une étude en pause garde son
        // historique et reste consultable.
        const sorted = [...all].sort((a, b) => Number(b.active) - Number(a.active) || studyTitle(a).localeCompare(studyTitle(b)));
        setStudies(sorted);
      })
      .catch((e) => { setStudies([]); setError(e instanceof Error ? e.message : String(e)); });
  }, []);

  const study = useMemo(() => {
    if (!studies || studies.length === 0) return null;
    return studies.find((s) => s.id === selectedId) ?? studies[0];
  }, [studies, selectedId]);

  const load = async (s: DailySearch, force = false) => {
    if (!force && cache[s.id]) return;
    setLoading(true); setError(null);
    try {
      const t = await loadStudyTrajectory(s);
      setCache((c) => ({ ...c, [s.id]: t }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };
  useEffect(() => { if (study && open) void load(study); }, [study?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id: string) => {
    setSelectedId(id);
    try { localStorage.setItem(SELECTED_KEY, id); } catch { /* stockage indisponible */ }
  };

  const traj = study ? cache[study.id] : undefined;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-left">
          {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          <Activity className="w-5 h-5 text-rose-600" />
          <h2 className="text-lg font-semibold">Trajectoire des prix</h2>
          <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2">bêta</span>
        </button>
        {studies && studies.length > 0 && (
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <label className="text-xs uppercase tracking-wide text-slate-500">Étude quotidienne</label>
            <select
              value={study?.id ?? ''}
              onChange={(e) => select(e.target.value)}
              className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-800 max-w-[420px]"
            >
              {studies.map((s) => (
                <option key={s.id} value={s.id}>
                  {COUNTRY_FLAG[s.source_country] ?? s.source_country} {s.source_country} → {COUNTRY_FLAG[s.target_country] ?? s.target_country} {s.target_country} · {studyTitle(s)}{s.active ? '' : ' · en pause'}
                </option>
              ))}
            </select>
            {study && (
              <button onClick={() => void load(study, true)} disabled={loading} title="Recharger les relevés" className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-400 disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1">
        Véhicules de tes études quotidiennes, pays d'achat et pays de vente côte à côte. Faits seulement : prix relevé par ADA à chaque passage,
        ancien prix barré et date de mise en ligne déclarés par le site, présence prouvée par les relevés. Aucune estimation de vente.
      </p>

      {open && (
        <div className="mt-4">
          {studies === null ? (
            <div className="text-sm text-slate-500 py-8 text-center">Chargement des études…</div>
          ) : studies.length === 0 ? (
            <div className="text-sm text-slate-500 py-8 text-center">
              Aucune étude quotidienne. Crée-en une dans le Workflow : la trajectoire suit les véhicules qu'ADA relève chaque matin.
            </div>
          ) : error ? (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">Lecture impossible : {error}</div>
          ) : !traj ? (
            <div className="text-sm text-slate-500 py-8 text-center flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Lecture des relevés…</div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-5">
              <CountryPanel role="Achat" country={traj.study.source_country} facts={traj.source} scans={traj.sourceScans} trim={traj.study.trim} />
              <CountryPanel role="Vente" country={traj.study.target_country} facts={traj.target} scans={traj.targetScans} trim={traj.study.trim_target || traj.study.trim} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type View = 'moves' | 'site' | 'gone' | 'all';

function CountryPanel({ role, country, facts, scans, trim }: { role: string; country: string; facts: ListingFact[]; scans: string[]; trim?: string }) {
  const sum = useMemo(() => summarizeFacts(facts, country), [facts, country]);
  const [view, setView] = useState<View>('moves');
  const [showAll, setShowAll] = useState(false);
  const counts = useMemo(() => ({
    moves: facts.filter((f) => f.drops + f.rises > 0).length,
    site: facts.filter((f) => f.siteDiscountPct != null).length,
    gone: facts.filter((f) => f.status === 'gone').length,
    all: facts.length,
  }), [facts]);
  const rows = useMemo(() => {
    const picked = view === 'moves' ? facts.filter((f) => f.drops + f.rises > 0)
      : view === 'site' ? facts.filter((f) => f.siteDiscountPct != null)
      : view === 'gone' ? facts.filter((f) => f.status === 'gone')
      : facts;
    return [...picked].sort((a, b) => {
      if (view === 'gone') return String(b.goneSince ?? '').localeCompare(String(a.goneSince ?? ''));
      if (view === 'site') return (a.siteDiscountPct ?? 0) - (b.siteDiscountPct ?? 0);
      if (view === 'moves') return (a.observedDeltaPct ?? 0) - (b.observedDeltaPct ?? 0) || b.seenCount - a.seenCount;
      return (a.currentPrice ?? 0) - (b.currentPrice ?? 0);
    });
  }, [facts, view]);
  const shown = showAll ? rows : rows.slice(0, 8);
  const name = COUNTRY_NAMES[country] ?? country;

  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wide text-slate-500">{role}</span>
        <span className="text-base font-semibold text-slate-900">{COUNTRY_FLAG[country] ?? ''} {name}</span>
        {trim && <span className="text-xs text-slate-500">· finition « {trim} »</span>}
        <span className="text-xs text-slate-400 ml-auto">
          {scans.length === 0 ? 'aucun relevé' : scans.length === 1 ? `1 relevé le ${fmtDate(scans[0])}` : `${scans.length} relevés du ${fmtDate(scans[0])} au ${fmtDate(scans[scans.length - 1])}`}
        </span>
      </div>

      {facts.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">Aucune annonce relevée avec ces critères.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <Tile value={String(sum.online)} label="en ligne" hint={sum.gone > 0 ? `${sum.gone} absente${sum.gone > 1 ? 's' : ''} depuis un relevé` : 'aucune absence prouvée'} />
            <Tile
              value={sum.withDrop > 0 ? `${sum.withDrop}` : '0'}
              label={`baisse${sum.withDrop > 1 ? 's' : ''} observée${sum.withDrop > 1 ? 's' : ''}`}
              hint={sum.withDrop > 0 ? `médiane ${fmtPct(sum.medianDropPct)} · ${sum.withRise} hausse${sum.withRise > 1 ? 's' : ''} · ${sum.followed} suivies` : sum.followed > 0 ? `${sum.followed} suivies à ≥ 2 relevés, aucun mouvement` : 'un seul relevé par annonce'}
              tone={sum.withDrop > 0 ? 'emerald' : undefined}
            />
            <Tile
              value={String(sum.withSiteDiscount)}
              label={`prix barré${sum.withSiteDiscount > 1 ? 's' : ''} par le site`}
              hint={sum.withSiteDiscount > 0 ? `remise affichée, médiane ${fmtPct(sum.medianSiteDiscountPct)}` : 'aucun ancien prix affiché'}
              tone={sum.withSiteDiscount > 0 ? 'emerald' : undefined}
            />
            <Tile
              value={sum.medianAgeDays != null ? `${sum.medianAgeDays} j` : '—'}
              label="âge médian du stock"
              hint={sum.datedOnline > 0 ? `${sum.datedOnline} annonce${sum.datedOnline > 1 ? 's' : ''} datée${sum.datedOnline > 1 ? 's' : ''} par le site` : 'sites sans date de mise en ligne'}
            />
          </div>

          <div className="flex items-center gap-1.5 mt-3 text-xs flex-wrap">
            {([['moves', 'Prix bougés'], ['site', 'Prix barrés'], ['gone', 'Absentes'], ['all', 'Toutes']] as const).map(([k, label]) => (
              <button key={k} onClick={() => { setView(k); setShowAll(false); }}
                className={`px-2.5 py-1 rounded-full border ${view === k ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                {label} <span className={view === k ? 'text-slate-300' : 'text-slate-400'}>{counts[k]}</span>
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">
              {view === 'moves' ? 'Aucun prix bougé entre deux relevés.' : view === 'site' ? 'Aucun prix barré affiché par le site.' : view === 'gone' ? 'Aucune absence prouvée par un relevé postérieur.' : 'Aucune annonce.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 mt-2">
              {shown.map((f) => <ListingRow key={f.id} f={f} />)}
            </ul>
          )}
          {rows.length > 8 && (
            <button onClick={() => setShowAll((s) => !s)} className="text-xs text-slate-500 hover:text-slate-800 mt-2">
              {showAll ? 'Réduire' : `Voir les ${rows.length - 8} autres`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ListingRow({ f }: { f: ListingFact }) {
  const delta = f.observedDeltaPct;
  const sub = [f.site, f.latest.year ? String(f.latest.year) : '', f.latest.mileage != null ? `${f.latest.mileage.toLocaleString('fr-FR')} km` : '', f.latest.power_din ? `${f.latest.power_din} ch` : '']
    .filter(Boolean).join(' · ');
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {f.latest.listing_url ? (
            <a href={humanListingUrl(f.latest.listing_url)} target="_blank" rel="noreferrer" className="text-sm text-slate-900 hover:text-brand-ocean hover:underline inline-flex items-center gap-1 max-w-full" title={f.latest.title ?? ''}>
              <span className="truncate">{f.latest.title || f.latest.listing_url}</span><ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
            </a>
          ) : <span className="text-sm text-slate-900 truncate block">{f.latest.title ?? '—'}</span>}
          <div className="text-xs text-slate-500">{sub}</div>
          <div className="text-sm mt-1 flex items-center gap-1.5 flex-wrap tabular-nums">
            {f.steps.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="text-slate-400">→</span>}
                <span className={i === f.steps.length - 1 ? 'font-semibold text-slate-900' : 'text-slate-500'}>{fmtEur(s.price)}</span>
                <span className="text-[11px] text-slate-400">({fmtDate(s.at)})</span>
              </span>
            ))}
            {delta != null && (
              <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${delta < 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                {fmtPct(delta)}
              </span>
            )}
            {f.sitePreviousPrice != null && (
              <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5" title="Ancien prix affiché barré par le site">
                site : <span className="line-through text-slate-500">{fmtEur(f.sitePreviousPrice)}</span> {fmtPct(f.siteDiscountPct)}
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500 shrink-0 space-y-0.5">
          {f.status === 'online'
            ? <div className="text-slate-800 font-medium">en ligne</div>
            : <div className="text-amber-700 font-medium" title="Premier relevé postérieur qui couvrait l'annonce sans la revoir">absente depuis le {fmtDate(f.goneSince!)}</div>}
          <div>{f.seenCount === 1 ? `vue le ${fmtDate(f.firstSeenAt)}` : `vue ${f.seenCount} fois, ${fmtDate(f.firstSeenAt)} → ${fmtDate(f.lastSeenAt)}`}</div>
          <div>{f.publishedAt ? `en ligne depuis le ${fmtDate(f.publishedAt)} (${f.ageDaysAtLastSeen} j)` : 'mise en ligne non déclarée'}</div>
        </div>
      </div>
    </li>
  );
}

function Tile({ value, label, hint, tone }: { value: string; label: string; hint?: string; tone?: 'emerald' }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <div className={`text-xl font-bold tabular-nums ${tone === 'emerald' ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}
