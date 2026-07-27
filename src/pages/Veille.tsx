import { useEffect, useMemo, useState } from 'react';
import { Scale, ExternalLink, Plus, X, Zap, ChevronDown, ChevronRight, Star, Check, Trash2, Landmark } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Veille juridique & fiscale automobile européenne (demande Channing 27/07).
 *
 * 1. RÉFÉRENTIEL FISCAL PAR PAYS (UE + Schengen) — le cœur : coût à
 *    l'immatriculation, où les électriques sont favorisées, malus,
 *    historique des bonus. Amorcé en connaissances générales (« à
 *    vérifier »), confirmé pays par pays par la collecte IA du worker.
 * 2. BROUILLONS à valider — les actualités remontées par l'IA arrivent en
 *    'draft', l'équipe publie ou écarte.
 * 3. FIL D'ACTUALITÉS publiées + saisie manuelle.
 */

interface Profile {
  country: string;
  country_name: string;
  bloc: string;
  ada_market: boolean;
  registration_cost: string;
  registration_cost_level: string;
  ev_favorable: boolean | null;
  ev_incentives: string;
  malus: string;
  bonus_history: Array<{ year: string; label: string }>;
  sources: string[];
  verified: boolean;
  updated_by: string;
  updated_at: string;
}

interface Entry {
  id: string;
  country: string;
  kind: string;
  title: string;
  summary: string;
  effective_date: string | null;
  source_url: string;
  status: string;
  created_by: string;
  created_at: string;
}

const COUNTRIES = ['EU', 'FR', 'DE', 'NL', 'DK', 'IT', 'ES', 'BE'];
const KINDS = [
  { value: 'loi', label: 'Loi' },
  { value: 'taxe', label: 'Taxe' },
  { value: 'reglement', label: 'Règlement' },
];

const LEVEL_META: Record<string, { label: string; cls: string; rank: number }> = {
  faible: { label: 'Faible', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', rank: 0 },
  moyen: { label: 'Moyen', cls: 'bg-amber-50 text-amber-700 border-amber-200', rank: 1 },
  eleve: { label: 'Élevé', cls: 'bg-rose-50 text-rose-700 border-rose-200', rank: 2 },
};

const flagOf = (iso2: string) =>
  iso2.length === 2 ? String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🇪🇺';

type SortKey = 'cout-asc' | 'cout-desc' | 'ev' | 'az';
type BlocFilter = '' | 'ada' | 'UE' | 'Schengen (hors UE)';

export function Veille() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [country, setCountry] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('cout-asc');
  const [blocFilter, setBlocFilter] = useState<BlocFilter>('');
  const [form, setForm] = useState({ country: 'EU', kind: 'loi', title: '', summary: '', effective_date: '', source_url: '' });

  const reload = () => {
    supabase
      .from('legal_watch_entries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => { setEntries((data ?? []) as Entry[]); setLoading(false); });
    supabase
      .from('country_fiscal_profiles')
      .select('*')
      .then(({ data }) => setProfiles(((data ?? []) as unknown as Profile[])));
  };
  useEffect(reload, []);

  const visibleProfiles = useMemo(() => {
    let list = profiles.slice();
    if (blocFilter === 'ada') list = list.filter((p) => p.ada_market);
    else if (blocFilter) list = list.filter((p) => p.bloc === blocFilter);
    const rank = (p: Profile) => LEVEL_META[p.registration_cost_level]?.rank ?? 1;
    list.sort((a, b) => {
      if (sortKey === 'az') return a.country_name.localeCompare(b.country_name, 'fr');
      if (sortKey === 'ev') {
        const ev = (p: Profile) => (p.ev_favorable === true ? 0 : p.ev_favorable === false ? 2 : 1);
        if (ev(a) !== ev(b)) return ev(a) - ev(b);
        return rank(a) - rank(b);
      }
      const d = rank(a) - rank(b);
      if (d !== 0) return sortKey === 'cout-desc' ? -d : d;
      // À niveau égal : pays ADA d'abord, puis alphabétique.
      if (a.ada_market !== b.ada_market) return a.ada_market ? -1 : 1;
      return a.country_name.localeCompare(b.country_name, 'fr');
    });
    return list;
  }, [profiles, sortKey, blocFilter]);

  const drafts = useMemo(() => entries.filter((e) => e.status === 'draft'), [entries]);
  const visible = useMemo(
    () => entries.filter((e) => e.status === 'published' && (!country || e.country === country)),
    [entries, country],
  );

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from('legal_watch_entries').insert({
      country: form.country, kind: form.kind, title: form.title.trim(),
      summary: form.summary.trim(), source_url: form.source_url.trim(),
      effective_date: form.effective_date || null, created_by: 'manuel',
    });
    setAdding(false);
    setForm({ country: 'EU', kind: 'loi', title: '', summary: '', effective_date: '', source_url: '' });
    reload();
  };

  const setDraftStatus = async (id: string, status: 'published' | 'dismissed') => {
    await supabase.from('legal_watch_entries').update({ status }).eq('id', id);
    reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2"><Scale className="w-7 h-7 text-blue-600" /> Veille juridique</h1>
          <p className="text-slate-600 mt-2">Fiscalité automobile par pays (UE + Schengen), disparités qui font les marges — et le fil des évolutions.</p>
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="flex items-center gap-2 bg-brand-ocean hover:bg-brand-encre text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Ajouter une entrée
        </button>
      </div>

      {/* ── RÉFÉRENTIEL FISCAL PAR PAYS ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-slate-900">Fiscalité par pays</h2>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {([['', 'Tous'], ['ada', '★ Pays ADA'], ['UE', 'UE'], ['Schengen (hors UE)', 'Schengen hors UE']] as Array<[BlocFilter, string]>).map(([v, label]) => (
              <button key={v || 'all'} onClick={() => setBlocFilter(v)} className={chip(blocFilter === v)}>{label}</button>
            ))}
          </div>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="ml-auto px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
          >
            <option value="cout-asc">Immatriculation la moins chère d'abord</option>
            <option value="cout-desc">Immatriculation la plus chère d'abord</option>
            <option value="ev">Électriques favorisées d'abord</option>
            <option value="az">Alphabétique</option>
          </select>
        </div>
        {profiles.length === 0 ? (
          <p className="text-sm text-slate-500 p-8 text-center">
            Référentiel vide — appliquer la migration <code className="text-xs">country_fiscal_profiles</code> pour amorcer les 30 pays.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">Pays</th>
                  <th className="px-3 py-2 font-medium">Immatriculation</th>
                  <th className="px-3 py-2 font-medium">Électrique</th>
                  <th className="px-3 py-2 font-medium hidden lg:table-cell">Malus</th>
                  <th className="px-3 py-2 font-medium hidden md:table-cell">Dernier bonus</th>
                  <th className="px-3 py-2 font-medium">État</th>
                </tr>
              </thead>
              <tbody>
                {visibleProfiles.map((p) => {
                  const level = LEVEL_META[p.registration_cost_level] ?? LEVEL_META.moyen;
                  const lastBonus = (p.bonus_history ?? [])[Math.max(0, (p.bonus_history ?? []).length - 1)];
                  const isOpen = expanded === p.country;
                  return (
                    <FiscalRow key={p.country} p={p} level={level} lastBonus={lastBonus} isOpen={isOpen}
                      onToggle={() => setExpanded(isOpen ? null : p.country)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400 px-4 py-2 border-t border-slate-100">
          « À vérifier » = amorce de connaissances générales, en attente de confirmation par la collecte automatique
          (recherche web + IA, active dès la clé API branchée sur Railway) — les profils confirmés affichent leurs sources.
        </p>
      </div>

      {/* ── BROUILLONS IA À VALIDER ─────────────────────────────────────── */}
      {drafts.length > 0 && (
        <div className="bg-amber-50/60 rounded-xl border border-amber-200 p-4">
          <h2 className="font-semibold text-slate-900 mb-2">Actualités à valider <span className="text-xs font-normal text-slate-500">— remontées par la collecte, publiez ou écartez</span></h2>
          <div className="space-y-2">
            {drafts.map((e) => (
              <div key={e.id} className="bg-white rounded-lg border border-slate-200 p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-600">{e.country}</span>
                    <span className={kindBadge(e.kind)}>{e.kind}</span>
                    <span className="font-medium text-slate-900 text-sm">{e.title}</span>
                    {e.source_url?.startsWith('http') && (
                      <a href={e.source_url} target="_blank" rel="noreferrer" className="p-0.5 text-slate-400 hover:text-brand-ocean"><ExternalLink className="w-3.5 h-3.5" /></a>
                    )}
                  </div>
                  {e.summary && <p className="text-xs text-slate-600 mt-1">{e.summary}</p>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => void setDraftStatus(e.id, 'published')} title="Publier"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
                    <Check className="w-3.5 h-3.5" /> Publier
                  </button>
                  <button onClick={() => void setDraftStatus(e.id, 'dismissed')} title="Écarter"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SAISIE MANUELLE ─────────────────────────────────────────────── */}
      {adding && (
        <form onSubmit={add} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Nouvelle entrée</h3>
            <button type="button" onClick={() => setAdding(false)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Pays</label>
              <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date d'effet</label>
              <input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Source (URL)</label>
              <input value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} placeholder="https://…" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Titre *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Malus CO2 2027 : nouveau barème" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Résumé</label>
            <textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={3} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
          <div className="flex justify-end">
            <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-ocean hover:bg-brand-encre text-white transition-colors">Publier</button>
          </div>
        </form>
      )}

      {/* ── FIL D'ACTUALITÉS PUBLIÉES ───────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setCountry('')} className={chip(!country)}>Tous</button>
        {COUNTRIES.map((c) => (
          <button key={c} onClick={() => setCountry(c === country ? '' : c)} className={chip(country === c)}>{c}</button>
        ))}
      </div>

      {loading ? <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p>
        : visible.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
            Aucune actualité{country ? ` pour ${country}` : ''} pour l'instant.
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((e) => (
              <article key={e.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-600">{e.country}</span>
                  <span className={kindBadge(e.kind)}>{e.kind}</span>
                  <h3 className="font-semibold text-slate-900 flex-1 min-w-[200px]">{e.title}</h3>
                  {e.effective_date && <span className="text-xs text-slate-500">Effet : {new Date(e.effective_date).toLocaleDateString('fr-FR')}</span>}
                  {e.source_url?.startsWith('http') && (
                    <a href={e.source_url} target="_blank" rel="noreferrer" className="p-1 text-slate-400 hover:text-brand-ocean"><ExternalLink className="w-4 h-4" /></a>
                  )}
                </div>
                {e.summary && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{e.summary}</p>}
                <p className="text-[11px] text-slate-400 mt-2">
                  Ajoutée le {new Date(e.created_at).toLocaleDateString('fr-FR')} · {e.created_by === 'manuel' ? 'saisie manuelle' : 'collecte automatique'}
                </p>
              </article>
            ))}
          </div>
        )}
    </div>
  );
}

function FiscalRow({ p, level, lastBonus, isOpen, onToggle }: {
  p: Profile;
  level: { label: string; cls: string };
  lastBonus: { year: string; label: string } | undefined;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} className={`border-b border-slate-50 cursor-pointer transition-colors ${isOpen ? 'bg-blue-50/40' : 'hover:bg-slate-50'}`}>
        <td className="px-4 py-2.5 whitespace-nowrap">
          <div className="flex items-center gap-2">
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
            <span className="text-base leading-none">{flagOf(p.country)}</span>
            <span className="font-medium text-slate-900">{p.country_name}</span>
            {p.ada_market && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" aria-label="Pays ADA" />}
            {p.bloc !== 'UE' && <span className="text-[10px] text-slate-400 border border-slate-200 rounded-full px-1.5 py-0.5">hors UE</span>}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${level.cls}`}>{level.label}</span>
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {p.ev_favorable === true ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border bg-emerald-50 text-emerald-700 border-emerald-200"><Zap className="w-3 h-3" /> Favorisée</span>
          ) : p.ev_favorable === false ? (
            <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 border bg-slate-50 text-slate-500 border-slate-200">Neutre</span>
          ) : (
            <span className="text-[11px] text-slate-400">?</span>
          )}
        </td>
        <td className="px-3 py-2.5 hidden lg:table-cell max-w-[280px]">
          <span className="text-xs text-slate-600 line-clamp-1">{p.malus || '—'}</span>
        </td>
        <td className="px-3 py-2.5 hidden md:table-cell max-w-[240px]">
          {lastBonus ? (
            <span className="text-xs text-slate-600 line-clamp-1"><span className="font-medium text-slate-500">{lastBonus.year}</span> · {lastBonus.label}</span>
          ) : <span className="text-xs text-slate-400">—</span>}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {p.verified ? (
            <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 border bg-blue-50 text-blue-700 border-blue-200">Vérifié</span>
          ) : (
            <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 border bg-amber-50 text-amber-700 border-amber-200">À vérifier</span>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-blue-50/30 border-b border-slate-100">
          <td colSpan={6} className="px-6 py-4">
            <div className="grid lg:grid-cols-2 gap-4 text-sm">
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-1">Coût à l'immatriculation</div>
                  <p className="text-slate-700">{p.registration_cost || '—'}</p>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-1">Malus</div>
                  <p className="text-slate-700">{p.malus || '—'}</p>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-1">Électriques</div>
                  <p className="text-slate-700">{p.ev_incentives || '—'}</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-1">Historique des bonus</div>
                  {(p.bonus_history ?? []).length === 0 ? (
                    <p className="text-slate-400 text-xs">Aucun dispositif recensé.</p>
                  ) : (
                    <ul className="space-y-1">
                      {p.bonus_history.map((b, i) => (
                        <li key={i} className="flex gap-2 text-xs">
                          <span className="font-semibold text-slate-500 whitespace-nowrap w-20 shrink-0">{b.year}</span>
                          <span className="text-slate-700">{b.label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {(p.sources ?? []).length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-1">Sources</div>
                    <ul className="space-y-0.5">
                      {p.sources.map((s, i) => (
                        <li key={i}>
                          <a href={s} target="_blank" rel="noreferrer" className="text-xs text-brand-ocean hover:underline inline-flex items-center gap-1 break-all">
                            <ExternalLink className="w-3 h-3 shrink-0" /> {s.replace(/^https?:\/\//, '').slice(0, 80)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[11px] text-slate-400">
                  Mise à jour {new Date(p.updated_at).toLocaleDateString('fr-FR')} · {p.updated_by}
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const kindBadge = (kind: string) =>
  `text-[10px] uppercase font-semibold rounded-full px-2 py-0.5 ${
    kind === 'taxe' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
  }`;

const chip = (active: boolean) =>
  `px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
    active ? 'bg-brand-ocean text-white border-brand-ocean' : 'bg-white text-slate-600 border-slate-300 hover:border-brand-ocean'
  }`;
