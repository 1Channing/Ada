import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, BarChart3, Archive, Plus, Pencil, Trash2, Power, ExternalLink, ArrowDownRight, BookmarkPlus, X } from 'lucide-react';
import { StudiesV2Results } from './StudiesV2Results';
import {
  DailySearch, DailyHit, listDailySearches, saveDailySearch, deleteDailySearch,
  listAllHits, saveHitToNegotiations, dismissHit, listRefBrandModels, listKnownTrims,
} from '../services/workflow';

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
      {tab === 'archives' && <StudiesV2Results />}
    </div>
  );
}

// ── Onglet Études quotidiennes ──────────────────────────────────────────────

const EMPTY: Partial<DailySearch> = {
  label: '', source_country: 'DE', target_country: 'FR', brand: '', model: '',
  year_min: null, year_max: null, fuel: '', trim: '', trim_target: '',
  price_gap_min: 3000, price_gap_max: 10000, run_hour: 7, active: true,
};

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

  const reload = () => {
    listDailySearches().then(setRows).catch((e) => setError(String(e.message ?? e))).finally(() => setLoading(false));
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
        <p className="text-sm text-slate-600">
          {rows.length} étude{rows.length > 1 ? 's' : ''} — scrape quotidien en <span className="font-medium">prix croissant</span>, 3 pages par site du pays source.
        </p>
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
              <div key={s.id} className={`bg-white rounded-xl border shadow-sm p-4 ${s.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {s.label || `${s.brand} ${s.model}`.trim()}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {flagOf(s.source_country)} → {flagOf(s.target_country)} · {s.brand}{s.model ? ` ${s.model}` : ''}
                      {s.year_min || s.year_max ? ` · ${s.year_min ?? '…'}–${s.year_max ?? '…'}` : ''}
                      {s.fuel ? ` · ${FUELS.find((f) => f.value === s.fuel)?.label ?? s.fuel}` : ''}
                      {s.trim ? ` · « ${s.trim} »` : ''}
                      {s.trim_target ? ` ≈ « ${s.trim_target} » (${s.target_country})` : ''}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Écart visé {s.price_gap_min.toLocaleString('fr-FR')}–{s.price_gap_max.toLocaleString('fr-FR')} € · scrape {String(s.run_hour).padStart(2, '0')} h 00
                      {s.last_run_at ? ` · dernier passage ${new Date(s.last_run_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ' · jamais lancé'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      title={s.active ? 'Mettre en pause' : 'Réactiver'}
                      onClick={async () => { await saveDailySearch({ ...s, active: !s.active }); reload(); }}
                      className={`p-1.5 rounded-lg transition-colors ${s.active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                    >
                      <Power className="w-4 h-4" />
                    </button>
                    <button title="Modifier" onClick={() => setEditing(s)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
                    <button
                      title="Supprimer"
                      onClick={async () => { if (confirm(`Supprimer l'étude « ${s.label || s.brand} » ?`)) { await deleteDailySearch(s.id); reload(); } }}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
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

// ── Onglet Résultats : le flux quotidien complet ────────────────────────────

function ResultsTab() {
  const [hits, setHits] = useState<DailyHit[]>([]);
  const [searches, setSearches] = useState<DailySearch[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    Promise.all([listAllHits(), listDailySearches()])
      .then(([h, s]) => { setHits(h); setSearches(s); })
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const labelOf = useMemo(() => {
    const m = new Map(searches.map((s) => [s.id, s.label || `${s.brand} ${s.model}`.trim()]));
    return (id: string) => m.get(id) ?? '—';
  }, [searches]);

  const byDay = useMemo(() => {
    const groups = new Map<string, DailyHit[]>();
    for (const h of hits) {
      const day = new Date(h.last_seen_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      (groups.get(day) ?? groups.set(day, []).get(day)!).push(h);
    }
    return [...groups.entries()];
  }, [hits]);

  if (loading) return <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p>;
  if (hits.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
        Rien pour l'instant — les résultats du scrape quotidien apparaîtront ici (nouvelles annonces et baisses de prix uniquement).
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {byDay.map(([day, list]) => (
        <div key={day}>
          <h3 className="text-sm font-semibold text-slate-700 capitalize mb-2">{day} · {list.length} annonce{list.length > 1 ? 's' : ''}</h3>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {list.map((h) => <HitRow key={h.id} hit={h} searchLabel={labelOf(h.search_id)} onChanged={reload} />)}
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
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          {flagOf(hit.source_country)} {hit.site} · {hit.year ?? '—'} · {hit.mileage != null ? `${hit.mileage.toLocaleString('fr-FR')} km` : '—'}
          {searchLabel ? ` · ${searchLabel}` : ''}
          {hit.price_gap != null ? ` · écart cible ${hit.price_gap >= 0 ? '+' : ''}${hit.price_gap.toLocaleString('fr-FR')} €` : ''}
        </p>
      </div>
      <span className="font-semibold text-slate-900 shrink-0">{fmtEur(hit.price)}</span>
      {hit.status === 'inbox' && (
        <div className="flex items-center gap-1 shrink-0">
          {hit.listing_url?.startsWith('http') && !compact && (
            <a href={hit.listing_url} target="_blank" rel="noreferrer" title="Ouvrir l'annonce" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ExternalLink className="w-4 h-4" /></a>
          )}
          <button
            title="Enregistrer → négociations"
            onClick={async () => { await saveHitToNegotiations(hit); onChanged(); }}
            className="p-1.5 rounded-lg text-brand-ocean hover:bg-blue-50"
          >
            <BookmarkPlus className="w-4 h-4" />
          </button>
          <button title="Supprimer" onClick={async () => { await dismissHit(hit.id); onChanged(); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-500">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {hit.status === 'saved' && <span className="text-xs text-emerald-600 font-medium shrink-0">En négociation</span>}
    </div>
  );
}
