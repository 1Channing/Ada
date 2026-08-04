import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, BarChart3, Archive, Plus, ExternalLink, ArrowDownRight, X, MoreVertical, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  DailySearch, DailyHit, UrlGap, StudyUrl, listDailySearches, saveDailySearch, deleteDailySearch, forceRunDailySearch,
  listAllHits, saveHitToNegotiations, dismissHit, listRefBrandModels, listKnownTrims,
  checkSearchUrlCoverage, listStudyUrls, clearSearchHits, inboxToProcess,
} from '../services/workflow';

/** Identité visuelle des places de marché — badge normalisé partout. */
const SITE_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  LEBONCOIN: { label: 'LBC', bg: '#F56B2A', fg: '#fff' },
  MARKTPLAATS: { label: 'MP', bg: '#134FA8', fg: '#fff' },
  BILBASEN: { label: 'BB', bg: '#0F766E', fg: '#fff' },
  MOBILE_DE: { label: 'MD', bg: '#E85D26', fg: '#fff' },
  AUTOSCOUT_FR: { label: 'AS24 FR', bg: '#FFCC00', fg: '#1e293b' },
  AUTOSCOUT_DE: { label: 'AS24 DE', bg: '#FFCC00', fg: '#1e293b' },
  AUTOSCOUT_NL: { label: 'AS24 NL', bg: '#FFCC00', fg: '#1e293b' },
  AUTOSCOUT_IT: { label: 'AS24 IT', bg: '#FFCC00', fg: '#1e293b' },
  AUTOSCOUT_ES: { label: 'AS24 ES', bg: '#FFCC00', fg: '#1e293b' },
  AUTOSCOUT_BE: { label: 'AS24 BE', bg: '#FFCC00', fg: '#1e293b' },
};

export function SiteBadge({ site }: { site: string }) {
  const s = SITE_STYLE[site] ?? { label: site, bg: '#e2e8f0', fg: '#334155' };
  return (
    <span
      className="inline-flex items-center rounded font-bold uppercase tracking-wide shrink-0"
      style={{ background: s.bg, color: s.fg, fontSize: '9px', padding: '2px 6px' }}
    >
      {s.label}
    </span>
  );
}

/**
 * Workflow PERSONNEL (ex-Études) : chaque compte enregistre ses études
 * quotidiennes ; le worker les scrape à l'heure choisie (tri prix croissant,
 * 3 pages max) et ne remonte que les NOUVELLES annonces et les baisses.
 */

const COUNTRIES: Array<{ code: string; label: string; flag: string }> = [
  { code: 'FR', label: 'France', flag: '🇫🇷' },
  { code: 'DE', label: 'Allemagne', flag: '🇩🇪' },
  { code: 'NL', label: 'Pays-Bas', flag: '🇳🇱' },
  { code: 'DK', label: 'Danemark', flag: '🇩🇰' },
  { code: 'IT', label: 'Italie', flag: '🇮🇹' },
  { code: 'ES', label: 'Espagne', flag: '🇪🇸' },
  { code: 'BE', label: 'Belgique', flag: '🇧🇪' },
  { code: 'HU', label: 'Hongrie', flag: '🇭🇺' },
  { code: 'LT', label: 'Lituanie', flag: '🇱🇹' },
  { code: 'SE', label: 'Suède', flag: '🇸🇪' },
];
const FUELS = [
  { value: '', label: 'Toutes énergies' },
  { value: 'ESSENCE', label: 'Essence' },
  { value: 'DIESEL', label: 'Diesel' },
  { value: 'HYBRIDE', label: 'Hybride' },
  { value: 'PLUG_IN_HYBRID', label: 'Hybride rechargeable' },
  { value: 'ELECTRIQUE', label: 'Électrique' },
  { value: 'GPL', label: 'GPL' },
];

const flagOf = (code: string) => COUNTRIES.find((c) => c.code === code)?.flag ?? code;
const fmtEur = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} €`);

type Tab = 'searches' | 'results' | 'archives';

export function Workflow() {
  const [tab, setTab] = useState<Tab>('searches');
  const tabs = [
    { id: 'searches' as Tab, label: 'Études quotidiennes', icon: CalendarClock },
    { id: 'results' as Tab, label: 'Résultats', icon: BarChart3 },
    { id: 'archives' as Tab, label: 'Archives', icon: Archive },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Workflow</h1>
        <p className="text-slate-600 mt-2">Tes études quotidiennes — nouvelles annonces et baisses de prix chaque matin.</p>
      </div>
      <div className="border-b border-slate-200">
        <nav className="flex gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-3 flex items-center gap-2 border-b-2 transition-colors ${
                tab === id ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-700'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      </div>
      {tab === 'searches' && <DailySearchesTab />}
      {tab === 'results' && <ResultsTab />}
      {tab === 'archives' && <ArchivesTab />}
    </div>
  );
}

// ── Onglet Études quotidiennes ──────────────────────────────────────────────

const EMPTY: Partial<DailySearch> = {
  label: '', source_country: 'DE', target_country: 'FR', brand: '', model: '',
  year_min: null, year_max: null, fuel: '', trim: '', trim_target: '',
  gearbox: '', power_min: null, mileage_max: null,
  price_gap_min: 3000, price_gap_max: 10000, run_hour: 7, active: true,
};

const GEARBOXES = [
  { value: '', label: 'Toutes boîtes' },
  { value: 'AUTOMATIQUE', label: 'Automatique' },
  { value: 'MANUELLE', label: 'Manuelle' },
];

function DailySearchesTab() {
  const [rows, setRows] = useState<DailySearch[]>([]);
  const [editing, setEditing] = useState<Partial<DailySearch> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Sélecteurs sans faute de frappe : référentiel (marques/modèles) +
  // finitions déjà vues par ADA (source et cible séparées — noms différents).
  const [ref, setRef] = useState<{ brands: string[]; modelsByBrand: Record<string, string[]> }>({ brands: [], modelsByBrand: {} });
  const [trimsSource, setTrimsSource] = useState<string[]>([]);
  const [trimsTarget, setTrimsTarget] = useState<string[]>([]);

  // Couverture URL par étude (id → trous) — calculée à l'affichage et après
  // chaque enregistrement ; null = vérification en cours.
  const [coverage, setCoverage] = useState<Record<string, UrlGap[] | null>>({});

  const checkCoverage = (list: DailySearch[]) => {
    for (const s of list) {
      setCoverage((c) => ({ ...c, [s.id]: c[s.id] ?? null }));
      void checkSearchUrlCoverage(s).then((gaps) => setCoverage((c) => ({ ...c, [s.id]: gaps })));
    }
  };

  const reload = () => {
    listDailySearches()
      .then((list) => { setRows(list); checkCoverage(list); })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);
  useEffect(() => { void listRefBrandModels().then(setRef); }, []);

  // Suggestions de finitions dès que marque/modèle/pays changent.
  useEffect(() => {
    const b = editing?.brand ?? '';
    if (!b) { setTrimsSource([]); setTrimsTarget([]); return; }
    const m = editing?.model ?? '';
    let cancelled = false;
    void listKnownTrims(b, m, editing?.source_country).then((t) => { if (!cancelled) setTrimsSource(t); });
    void listKnownTrims(b, m, editing?.target_country).then((t) => { if (!cancelled) setTrimsTarget(t); });
    return () => { cancelled = true; };
  }, [editing?.brand, editing?.model, editing?.source_country, editing?.target_country]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const err = await saveDailySearch(editing as DailySearch);
    if (err) { setError(err); return; }
    setEditing(null); setError(null); reload();
  };

  const set = (patch: Partial<DailySearch>) => setEditing((s) => ({ ...s, ...patch }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">{rows.length} étude{rows.length > 1 ? 's' : ''}</p>
        <button
          onClick={() => setEditing({ ...EMPTY })}
          className="flex items-center gap-2 bg-brand-ocean hover:bg-brand-encre text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Nouvelle étude
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {editing && (
        <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">{editing.id ? 'Modifier l’étude' : 'Nouvelle étude quotidienne'}</h3>
            <button type="button" onClick={() => setEditing(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Nom (libre)">
              <input value={editing.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="Yaris Cross DE→FR" className={inputCls} />
            </Field>
            <Field label="Pays source">
              <select value={editing.source_country} onChange={(e) => set({ source_country: e.target.value })} className={inputCls}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.label}</option>)}
              </select>
            </Field>
            <Field label="Pays cible">
              <select value={editing.target_country} onChange={(e) => set({ target_country: e.target.value })} className={inputCls}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.label}</option>)}
              </select>
            </Field>
            <Field label="Heure du scrape">
              <select value={editing.run_hour ?? 7} onChange={(e) => set({ run_hour: Number(e.target.value) })} className={inputCls}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')} h 00</option>)}
              </select>
            </Field>
            <Field label="Marque *">
              <select
                value={editing.brand ?? ''}
                onChange={(e) => set({ brand: e.target.value, model: '' })}
                required
                className={inputCls}
              >
                <option value="">— choisir —</option>
                {ref.brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Modèle">
              <select
                value={editing.model ?? ''}
                onChange={(e) => set({ model: e.target.value })}
                disabled={!editing.brand}
                className={inputCls}
              >
                <option value="">Toute la marque</option>
                {(ref.modelsByBrand[editing.brand ?? ''] ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Année min">
              <input type="number" value={editing.year_min ?? ''} onChange={(e) => set({ year_min: e.target.value ? Number(e.target.value) : null })} placeholder="2020" className={inputCls} />
            </Field>
            <Field label="Année max">
              <input type="number" value={editing.year_max ?? ''} onChange={(e) => set({ year_max: e.target.value ? Number(e.target.value) : null })} placeholder="2026" className={inputCls} />
            </Field>
            <Field label="Kilométrage max">
              <input type="number" step={5000} value={editing.mileage_max ?? ''} onChange={(e) => set({ mileage_max: e.target.value ? Number(e.target.value) : null })} placeholder="100 000" className={inputCls} />
            </Field>
            <Field label="Boîte de vitesses">
              <select value={editing.gearbox ?? ''} onChange={(e) => set({ gearbox: e.target.value })} className={inputCls}>
                {GEARBOXES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </Field>
            <Field label="Puissance min (ch)">
              <input type="number" step={10} value={editing.power_min ?? ''} onChange={(e) => set({ power_min: e.target.value ? Number(e.target.value) : null })} placeholder="150" className={inputCls} />
            </Field>
            <Field label="Motorisation">
              <select value={editing.fuel ?? ''} onChange={(e) => set({ fuel: e.target.value })} className={inputCls}>
                {FUELS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            <Field label={`Finition pays source (${editing.source_country})`}>
              <input
                value={editing.trim ?? ''}
                onChange={(e) => set({ trim: e.target.value })}
                placeholder="GR Sport"
                list="trims-source"
                className={inputCls}
              />
              <datalist id="trims-source">
                {trimsSource.map((t) => <option key={t} value={t} />)}
              </datalist>
            </Field>
            <Field label={`Finition équivalente cible (${editing.target_country})`}>
              <input
                value={editing.trim_target ?? ''}
                onChange={(e) => set({ trim_target: e.target.value })}
                placeholder="mêmes équipements, nom local"
                list="trims-target"
                className={inputCls}
              />
              <datalist id="trims-target">
                {trimsTarget.map((t) => <option key={t} value={t} />)}
              </datalist>
            </Field>
            <Field label="Écart de prix min (€)">
              <input type="number" value={editing.price_gap_min ?? 3000} onChange={(e) => set({ price_gap_min: Number(e.target.value) || 0 })} className={inputCls} />
            </Field>
            <Field label="Écart de prix max (€)">
              <input type="number" value={editing.price_gap_max ?? 10000} onChange={(e) => set({ price_gap_max: Number(e.target.value) || 0 })} className={inputCls} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Marques et modèles viennent du référentiel (zéro faute de frappe). Les finitions sont suggérées d'après ce qu'ADA a déjà vu dans chaque pays — les noms diffèrent d'un marché à l'autre, d'où les deux champs. L'écart compare le prix de l'annonce à la médiane du pays cible (filtrée sur la finition équivalente si renseignée) ; sans données cible, l'annonce est montrée quand même.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Annuler</button>
            <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-ocean hover:bg-brand-encre text-white transition-colors">Enregistrer</button>
          </div>
        </form>
      )}

      {loading ? <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p>
        : rows.length === 0 && !editing ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
            Aucune étude quotidienne. Crée la première : ADA scrutera le marché chaque matin pour toi.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {rows.map((s) => (
              <SearchCard
                key={s.id}
                s={s}
                gaps={coverage[s.id] ?? null}
                onEdit={() => setEditing(s)}
                onDuplicate={() => setEditing({ ...s, id: undefined, label: `${s.label || `${s.brand} ${s.model}`.trim()} (copie)`, last_run_at: null })}
                onChanged={reload}
              />
            ))}
          </div>
        )}
    </div>
  );
}

function SearchCard({ s, gaps, onEdit, onDuplicate, onChanged }: {
  s: DailySearch;
  gaps: UrlGap[] | null; // null = vérification en cours
  onEdit: () => void;
  onDuplicate: () => void;
  onChanged: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [showGaps, setShowGaps] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    window.location.reload();
  };

  return (
    <div className={`bg-white rounded-xl border shadow-sm p-4 ${s.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-900 truncate">
              {s.label || `${s.brand} ${s.model}`.trim()}
            </p>
            {gaps === null && (
              <span title="Vérification de la couverture URL…" className="w-3 h-3 rounded-full border-2 border-slate-300 border-t-brand-ocean animate-spin shrink-0" />
            )}
            {gaps && gaps.length === 0 && (
              <span title="Couverture complète : URL générable sur tous les sites des deux pays" className="shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </span>
            )}
            {gaps && gaps.length > 0 && (
              <button
                title="Couverture incomplète — voir le détail"
                onClick={() => setShowGaps(!showGaps)}
                className="p-1 rounded-lg text-amber-500 hover:bg-amber-50 shrink-0"
              >
                <AlertTriangle className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {flagOf(s.source_country)} → {flagOf(s.target_country)} · {s.brand}{s.model ? ` ${s.model}` : ''}
            {s.year_min || s.year_max ? ` · ${s.year_min ?? '…'}–${s.year_max ?? '…'}` : ''}
            {s.fuel ? ` · ${FUELS.find((f) => f.value === s.fuel)?.label ?? s.fuel}` : ''}
            {s.gearbox ? ` · ${GEARBOXES.find((g) => g.value === s.gearbox)?.label ?? s.gearbox}` : ''}
            {s.power_min != null ? ` · ≥ ${s.power_min} ch` : ''}
            {s.trim ? ` · « ${s.trim} »` : ''}
            {s.trim_target ? ` ≈ « ${s.trim_target} » (${s.target_country})` : ''}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Écart visé {s.price_gap_min.toLocaleString('fr-FR')}–{s.price_gap_max.toLocaleString('fr-FR')} € · scrape {String(s.run_hour).padStart(2, '0')} h 00
            {s.last_run_at ? ` · dernier passage ${new Date(s.last_run_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ' · jamais lancé'}
            {!s.active ? ' · en pause' : ''}
          </p>
        </div>
        <div className="relative shrink-0" ref={menuRef}>
          <button onClick={() => setMenu(!menu)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
            <MoreVertical className="w-4 h-4" />
          </button>
          {menu && (
            // Mobile : feuille ancrée en bas d'écran — uniquement des ajouts max-md: (inertes sur PC).
            <div className="absolute right-0 top-8 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-48 text-sm max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:w-auto max-md:z-50 max-md:rounded-t-2xl max-md:rounded-b-none max-md:shadow-2xl max-md:max-h-[70vh] max-md:overflow-y-auto max-md:py-2">
              {/* Test / urgence : le worker sonde le drapeau toutes les 30 s
                  et lance l'étude même en pause, hors heure programmée. */}
              <button
                onClick={async () => {
                  setMenu(false);
                  const err = await forceRunDailySearch(s.id);
                  window.alert(err
                    ? `Lancement impossible : ${err}`
                    : `Étude « ${s.label || s.brand} » lancée — le worker la prend sous 30 s, résultats dans l'onglet Résultats (recharge la page dans ~2 min).`);
                }}
                className="w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 text-emerald-700 font-medium"
              >
                Lancer maintenant
              </button>
              <button
                onClick={async () => { setMenu(false); await saveDailySearch({ ...s, active: !s.active }); onChanged(); }}
                className="w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 text-slate-700"
              >
                {s.active ? 'Mettre en pause' : 'Réactiver'}
              </button>
              <button onClick={() => { setMenu(false); onEdit(); }} className="w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 text-slate-700">
                Modifier
              </button>
              <button onClick={() => { setMenu(false); onDuplicate(); }} className="w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 text-slate-700">
                Dupliquer
              </button>
              <button
                onClick={async () => {
                  setMenu(false);
                  if (confirm(`Supprimer l'étude « ${s.label || s.brand} » ?`)) { await deleteDailySearch(s.id); onChanged(); }
                }}
                className="w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 text-red-600"
              >
                Supprimer
              </button>
            </div>
          )}
        </div>
      </div>

      {gaps && gaps.length > 0 && showGaps && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-medium text-amber-800 mb-1.5">
            ADA ne sait pas encore générer l'URL sur {gaps.length} site{gaps.length > 1 ? 's' : ''} — l'étude tournera sur les autres :
          </p>
          <ul className="text-xs text-amber-800 space-y-0.5 mb-2">
            {gaps.map((g) => (
              <li key={`${g.side}|${g.site}`}>
                • {g.site} ({flagOf(g.country)} pays {g.side}) : mapping {s.brand}{s.model ? ` ${s.model}` : ''} manquant
              </li>
            ))}
          </ul>
          <button
            onClick={() => navigateTo('/ingestion')}
            className="text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg px-3 py-1.5 transition-colors"
          >
            Compléter par ingestion →
          </button>
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-ocean/40';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ── Onglet Résultats : organisé PAR ÉTUDE, stats en tête ────────────────────

/** Médiane des 6 premières annonces (même règle que le worker). */
function median6(prices: number[]): number | null {
  const sorted = [...prices].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const cheap = sorted.slice(0, 6);
  return cheap[Math.floor((cheap.length - 1) / 2)];
}

function ResultsTab() {
  const [hits, setHits] = useState<DailyHit[]>([]);
  const [searches, setSearches] = useState<DailySearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Liens d'étude par recherche (vérification humaine) — chargés à l'ouverture.
  const [urls, setUrls] = useState<Record<string, StudyUrl[] | null>>({});

  const toggle = (s: DailySearch) => {
    const willOpen = !(open[s.id] ?? false);
    setOpen((o) => ({ ...o, [s.id]: willOpen }));
    if (willOpen && urls[s.id] === undefined) {
      setUrls((u) => ({ ...u, [s.id]: null }));
      void listStudyUrls(s).then((list) => setUrls((u) => ({ ...u, [s.id]: list })));
    }
  };

  const reload = () => {
    Promise.all([listAllHits(), listDailySearches()])
      .then(([h, s]) => { setHits(h); setSearches(s); })
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  // Commutateur à deux positions (retour Channing 29/07 — un switch, pas une
  // case) : « À traiter » OU « Sans résultat » (vérification des marchés),
  // jamais les deux mélangés.
  const [mode, setMode] = useState<'feed' | 'empty'>('feed');

  const allGroups = useMemo(() => {
    const bySearch = new Map<string, DailyHit[]>();
    for (const h of hits) {
      (bySearch.get(h.search_id) ?? bySearch.set(h.search_id, []).get(h.search_id)!).push(h);
    }
    return searches.map((s) => {
      const all = bySearch.get(s.id) ?? [];
      // Le FEED = uniquement les annonces À TRAITER (inbox, dans l'écart).
      // Les validées vivent en Négociations (règle 29/07 : jamais re-montrées),
      // les hors-écart automatiques restent invisibles (mémoire de dédup),
      // les traitées à motif vivent aux Archives. Le non-traité S'ACCUMULE de
      // jour en jour — rien n'est écrasé. Tri PRIX CROISSANT (règle maison).
      // « À traiter » = la définition PARTAGÉE avec l'accueil (inboxToProcess) :
      // en boîte et conforme aux critères actuels de l'étude. Les deux pages
      // affichent forcément le même nombre.
      const list = inboxToProcess(all, [s])
        .sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));
      const prices = list.map((h) => h.price).filter((p): p is number => p != null);
      const latest = list.find((h) => h.target_median != null);
      return {
        search: s,
        list,
        stats: {
          count: list.length,
          fresh: list.filter((h) => h.kind === 'new').length,
          drops: list.filter((h) => h.kind === 'price_drop').length,
          // Annonces VUES par le scrape mais hors écart : la preuve qu'un
          // zéro vient du marché, pas d'un scrape en panne.
          outOfRange: all.filter((h) => h.status === 'dismissed' && !h.resolution).length,
          medianSource: median6(prices),
          medianTarget: latest?.target_median ?? null,
        },
      };
    });
  }, [hits, searches]);

  const groups = useMemo(
    () => allGroups.filter((g) => (mode === 'empty' ? g.list.length === 0 : g.list.length > 0)),
    [allGroups, mode],
  );
  const feedCount = allGroups.filter((g) => g.list.length > 0).length;
  const emptyCount = allGroups.length - feedCount;

  // Les annonces traitées à la main vivent dans l'ONGLET Archives — plus de
  // section en doublon ici (retour Channing 30/07).
  if (loading) return <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p>;
  if (searches.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
        Rien pour l'instant — les résultats du scrape quotidien apparaîtront ici, organisés par étude.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium shadow-sm">
          <button
            onClick={() => setMode('feed')}
            className={`px-3 py-1.5 rounded-md transition-colors ${mode === 'feed' ? 'bg-brand-ocean text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            À traiter · {feedCount}
          </button>
          <button
            onClick={() => setMode('empty')}
            className={`px-3 py-1.5 rounded-md transition-colors ${mode === 'empty' ? 'bg-brand-ocean text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Sans résultat · {emptyCount}
          </button>
        </div>
      </div>
      {groups.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-sm">
          {mode === 'feed' ? 'Aucune annonce à traiter — tout est à jour.' : 'Aucune étude sans résultat — tout a trouvé.'}
        </div>
      )}
      {groups.map(({ search: s, list, stats }) => {
        const name = s.label || `${s.brand} ${s.model}`.trim();
        const spread = stats.medianTarget != null && stats.medianSource != null
          ? stats.medianTarget - stats.medianSource : null;
        const isOpen = open[s.id] ?? false;
        return (
          <div key={s.id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
            {/* PAS d'overflow-hidden sur la carte : il rognait le panneau du
                menu ⋯ (constat 28/07) — l'arrondi est porté par le bouton. */}
            <div className="flex items-center pr-2">
              <button
                onClick={() => toggle(s)}
                className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors rounded-t-xl"
              >
                <span className={`transition-transform text-slate-400 ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 truncate">{name}</p>
                  <p className="text-xs text-slate-500">
                    {flagOf(s.source_country)} → {flagOf(s.target_country)}
                    {stats.count > 0 ? (
                      <> · {stats.count} annonce{stats.count > 1 ? 's' : ''} à traiter
                        {stats.drops > 0 ? ` · ${stats.drops} baisse${stats.drops > 1 ? 's' : ''}` : ''}</>
                    ) : (
                      // Étude sans résultat : le compteur hors-écart prouve que
                      // le scrape a bien vu le marché — ouvrir pour les liens.
                      <> · aucune annonce dans l'écart
                        {stats.outOfRange > 0
                          ? ` · ${stats.outOfRange} vue${stats.outOfRange > 1 ? 's' : ''} hors écart (scrape OK)`
                          : ' · rien vu au scrape — vérifier les liens ci-dessous'}</>
                    )}
                    {/* Fraîcheur de l'analyse : sans elle, un lancement forcé
                        qui range tout en « hors écart » semblait n'avoir
                        jamais tourné (constat 01/08 — le forçage avait pris
                        3 s, mais rien ne le montrait). */}
                    {s.last_run_at
                      ? ` · analysé le ${new Date(s.last_run_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                      : ' · jamais analysé'}
                  </p>
                </div>
                {spread != null && (
                  <span className={`text-sm font-semibold shrink-0 ${spread > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                    {spread > 0 ? '+' : ''}{spread.toLocaleString('fr-FR')} € d'écart médian
                  </span>
                )}
              </button>
              <ResultsGroupMenu search={s} name={name} onChanged={reload} />
            </div>

            {isOpen && (
              <>
                {/* Tableau des données importantes de l'étude */}
                <div className="px-4 pb-3">
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-xs text-slate-500">
                          <th className="py-2 px-3">Médiane source ({flagOf(s.source_country)})</th>
                          <th className="py-2 px-3">Médiane cible ({flagOf(s.target_country)})</th>
                          <th className="py-2 px-3">Écart médian</th>
                          <th className="py-2 px-3">Annonces trouvées</th>
                          <th className="py-2 px-3">À traiter</th>
                          <th className="py-2 px-3">Baisses</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="text-slate-800">
                          <td className="py-2 px-3 font-semibold">{fmtEur(stats.medianSource)}</td>
                          <td className="py-2 px-3 font-semibold">{fmtEur(stats.medianTarget)}</td>
                          <td className={`py-2 px-3 font-semibold ${spread != null && spread > 0 ? 'text-emerald-600' : ''}`}>
                            {spread != null ? `${spread > 0 ? '+' : ''}${spread.toLocaleString('fr-FR')} €` : '—'}
                          </td>
                          <td className="py-2 px-3 tabular-nums">{stats.count}</td>
                          <td className="py-2 px-3 tabular-nums">{stats.fresh}</td>
                          <td className="py-2 px-3 tabular-nums">{stats.drops}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Médianes calculées sur les 6 premières annonces (prix croissant). Chaque annonce ci-dessous affiche son écart à la médiane cible.
                  </p>

                  {/* Liens de l'étude — les URLs exactes que le worker utilise, à vérifier d'un clic. */}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap text-xs">
                    <span className="text-slate-500 font-medium">Liens de l'étude :</span>
                    {urls[s.id] === null || urls[s.id] === undefined
                      ? <span className="text-slate-400">génération…</span>
                      : (urls[s.id] ?? []).map((u) => (
                        u.url
                          ? <a
                              key={`${u.side}|${u.site}`}
                              href={u.url}
                              target="_blank"
                              rel="noreferrer"
                              title={`${u.side === 'source' ? 'Pays source' : 'Pays cible'} — ${u.url}`}
                              className="inline-flex items-center gap-1 border border-slate-200 rounded-full pl-1 pr-2 py-0.5 hover:border-brand-ocean hover:bg-blue-50 transition-colors"
                            >
                              <SiteBadge site={u.site} />
                              <ExternalLink className="w-3 h-3 text-slate-400" />
                            </a>
                          : <span key={`${u.side}|${u.site}`} title="URL non générable — mapping manquant" className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 rounded-full pl-1 pr-2 py-0.5 opacity-70">
                              <SiteBadge site={u.site} />
                              <AlertTriangle className="w-3 h-3 text-amber-500" />
                            </span>
                      ))}
                  </div>
                </div>
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {list.map((h) => <HitRow key={h.id} hit={h} onChanged={reload} />)}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Onglet Archives — UNIQUEMENT les annonces traitées (retour Channing 30/07 :
 * ni doublon avec la section des Résultats, ni bloc « Results » de l'ancien
 * moteur d'études, qui refaisait doublon avec l'onglet Résultats).
 */
function ArchivesTab() {
  const [hits, setHits] = useState<DailyHit[]>([]);
  const [searches, setSearches] = useState<DailySearch[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([listAllHits(), listDailySearches()])
      .then(([h, s]) => { setHits(h); setSearches(s); })
      .finally(() => setLoading(false));
  }, []);
  const archived = useMemo(
    () => hits.filter((h) => h.status === 'dismissed' && h.resolution),
    [hits],
  );
  return (
    <div className="space-y-6">
      {loading
        ? <p className="text-sm text-slate-400 py-4 text-center">Chargement…</p>
        : archived.length === 0
          ? (
            <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
              Aucune annonce archivée — les annonces marquées « traitée » depuis les Résultats arrivent ici.
            </div>
          )
          : <ArchivedHitsSection archived={archived} searches={searches} defaultOpen />}
    </div>
  );
}

/**
 * Archives des annonces traitées (demande Channing 28/07) : triées par
 * marque, modèle puis année. « Trop chère » reviendra d'elle-même dans le
 * feed sur vraie baisse de prix ; « hors critères » est définitif.
 */
function ArchivedHitsSection({ archived, searches, defaultOpen = false }: { archived: DailyHit[]; searches: DailySearch[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const groups = useMemo(() => {
    const byId = new Map(searches.map((s) => [s.id, s]));
    const byModel = new Map<string, { brand: string; model: string; hits: DailyHit[] }>();
    for (const h of archived) {
      const s = byId.get(h.search_id);
      const brand = (s?.brand ?? '?').toUpperCase();
      const model = (s?.model ?? '').toUpperCase();
      const key = `${brand}|${model}`;
      (byModel.get(key) ?? byModel.set(key, { brand, model, hits: [] }).get(key)!).hits.push(h);
    }
    return [...byModel.values()]
      .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model))
      .map((g) => ({
        ...g,
        hits: g.hits.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (a.price ?? 0) - (b.price ?? 0)),
      }));
  }, [archived, searches]);

  if (archived.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors rounded-xl">
        <span className={`transition-transform text-slate-400 ${open ? 'rotate-90' : ''}`}>▸</span>
        <Archive className="w-4 h-4 text-slate-400" />
        <span className="font-semibold text-slate-700">Archives</span>
        <span className="text-xs text-slate-500">{archived.length} annonce(s) traitée(s) — « trop chère » revient sur baisse, « hors critères » est définitif</span>
      </button>
      {open && groups.map((g) => (
        <div key={`${g.brand}|${g.model}`} className="border-t border-slate-100">
          <p className="px-4 pt-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {g.brand}{g.model ? ` ${g.model}` : ''}
          </p>
          <div className="divide-y divide-slate-50">
            {g.hits.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1 flex items-center gap-2">
                  {h.listing_url?.startsWith('http')
                    ? <a href={h.listing_url} target="_blank" rel="noreferrer" className="text-sm text-slate-700 hover:text-blue-600 hover:underline truncate">{h.title || h.listing_url}</a>
                    : <span className="text-sm text-slate-700 truncate">{h.title || '(annonce)'}</span>}
                  <SiteBadge site={h.site} />
                  <span className="text-xs text-slate-400 shrink-0">{h.year ?? '—'}</span>
                </div>
                <span className="text-sm font-medium text-slate-600 shrink-0">{fmtEur(h.price)}</span>
                <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 border shrink-0 ${
                  h.resolution === 'trop_chere'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  {h.resolution === 'trop_chere' ? 'trop chère' : 'hors critères'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Ligne annonce — partagée avec la case « Nouvelles annonces » de l'accueil. */
export function HitRow({ hit, searchLabel, onChanged, compact }: {
  hit: DailyHit; searchLabel?: string; onChanged: () => void; compact?: boolean;
}) {
  const drop = hit.kind === 'price_drop' && hit.previous_price != null && hit.price != null
    ? hit.previous_price - hit.price : null;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {hit.listing_url?.startsWith('http')
            ? <a href={hit.listing_url} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:text-blue-600 hover:underline truncate">{hit.title || hit.listing_url}</a>
            : <span className="font-medium text-slate-900 truncate">{hit.title || '(annonce)'}</span>}
          {drop != null && (
            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">
              <ArrowDownRight className="w-3 h-3" /> −{drop.toLocaleString('fr-FR')} €
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate flex items-center gap-1.5">
          <span>{flagOf(hit.source_country)}</span>
          <SiteBadge site={hit.site} />
          <span>
            {hit.year ?? '—'} · {hit.mileage != null ? `${hit.mileage.toLocaleString('fr-FR')} km` : '—'}
            {searchLabel ? ` · ${searchLabel}` : ''}
            {hit.price_gap != null ? ` · écart cible ${hit.price_gap >= 0 ? '+' : ''}${hit.price_gap.toLocaleString('fr-FR')} €` : ''}
          </span>
        </p>
      </div>
      <span className="font-semibold text-slate-900 shrink-0">{fmtEur(hit.price)}</span>
      {hit.status === 'inbox' && (
        <div className="flex items-center gap-1 shrink-0">
          {hit.listing_url?.startsWith('http') && !compact && (
            <a href={hit.listing_url} target="_blank" rel="noreferrer" title="Ouvrir l'annonce" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ExternalLink className="w-4 h-4" /></a>
          )}
          <HitActionsMenu hit={hit} onChanged={onChanged} />
        </div>
      )}
      {hit.status === 'saved' && <span className="text-xs text-emerald-600 font-medium shrink-0">En négociation</span>}
    </div>
  );
}

/**
 * Menu ⋯ d'une annonce (demande Channing 28/07) : Valider → négociations ;
 * Traitée avec motif → archives (« trop chère » revient sur vraie baisse,
 * « hors critères » est définitif).
 */
function HitActionsMenu({ hit, onChanged }: { hit: DailyHit; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const resolve = async (reason: 'trop_chere' | 'hors_criteres') => {
    setOpen(false);
    await dismissHit(hit.id, reason);
    onChanged();
  };

  return (
    <div className="relative" ref={ref}>
      <button title="Traiter l'annonce" onClick={() => setOpen(!open)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-56 text-sm max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:w-auto max-md:z-50 max-md:rounded-t-2xl max-md:rounded-b-none max-md:shadow-2xl max-md:max-h-[70vh] max-md:overflow-y-auto max-md:py-2">
          <button
            onClick={async () => { setOpen(false); await saveHitToNegotiations(hit); onChanged(); }}
            className="w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 text-brand-ocean font-medium"
          >
            Valider → négociations
          </button>
          <button onClick={() => void resolve('trop_chere')} className="w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 text-slate-700">
            Traitée · trop chère <span className="text-xs text-slate-400">(revient si baisse)</span>
          </button>
          <button onClick={() => void resolve('hors_criteres')} className="w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 text-slate-700">
            Traitée · hors critères <span className="text-xs text-slate-400">(définitif)</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Menu ⋯ d'un groupe de résultats : vider l'affichage de l'étude, avec ou
 * sans la mémoire « déjà vu ». La mémoire = les lignes daily_search_hits
 * elles-mêmes (le scrape déduplique dessus, tous statuts confondus) — les
 * garder en 'cleared' masque sans faire revenir, les supprimer remet à zéro.
 */
function ResultsGroupMenu({ search, name, onChanged }: { search: DailySearch; name: string; onChanged: () => void }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button onClick={() => setMenu(!menu)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
        <MoreVertical className="w-4 h-4" />
      </button>
      {menu && (
        <div className="absolute right-0 top-8 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-72 text-sm max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:w-auto max-md:z-50 max-md:rounded-t-2xl max-md:rounded-b-none max-md:shadow-2xl max-md:max-h-[70vh] max-md:overflow-y-auto max-md:py-2">
          <button
            onClick={async () => {
              setMenu(false);
              if (confirm(`Vider les résultats de « ${name} » en GARDANT la mémoire ?\n\nLes annonces déjà apparues ne seront pas re-présentées par les prochains scrapes (sauf baisse de prix).`)) {
                await clearSearchHits(search.id, true);
                onChanged();
              }
            }}
            className="w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 text-slate-700"
          >
            Vider les résultats <span className="text-xs text-slate-500">(garder la mémoire)</span>
          </button>
          <button
            onClick={async () => {
              setMenu(false);
              if (confirm(`Vider les résultats de « ${name} » ET la mémoire ?\n\nLes annonces déjà apparues pourront réapparaître en nouveautés au prochain scrape.`)) {
                await clearSearchHits(search.id, false);
                onChanged();
              }
            }}
            className="w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 text-red-600"
          >
            Vider et oublier <span className="text-xs opacity-70">(tout peut réapparaître)</span>
          </button>
        </div>
      )}
    </div>
  );
}
