import { useEffect, useMemo, useState } from 'react';
import { Scale, ExternalLink, Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Veille juridique automobile européenne — lois, taxes, règlements + leur
 * historique. Alimentée automatiquement par le worker (collecte + résumé IA,
 * actif dès le branchement de la clé API) ; la saisie manuelle reste possible
 * pour amorcer et corriger.
 */

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

export function Veille() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [country, setCountry] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ country: 'EU', kind: 'loi', title: '', summary: '', effective_date: '', source_url: '' });

  const reload = () => {
    supabase
      .from('legal_watch_entries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => { setEntries((data ?? []) as Entry[]); setLoading(false); });
  };
  useEffect(reload, []);

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2"><Scale className="w-7 h-7 text-blue-600" /> Veille juridique</h1>
          <p className="text-slate-600 mt-2">Automobile européenne : lois, taxes, règlements — et leur historique complet.</p>
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="flex items-center gap-2 bg-brand-ocean hover:bg-brand-encre text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Ajouter une entrée
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-900">
        La collecte automatique (sources officielles + résumé IA, validation avant publication) s'active au branchement de la clé API — voir le worker, <code className="text-xs">legalWatchCollector</code>.
      </div>

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

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setCountry('')} className={chip(!country)}>Tous</button>
        {COUNTRIES.map((c) => (
          <button key={c} onClick={() => setCountry(c === country ? '' : c)} className={chip(country === c)}>{c}</button>
        ))}
      </div>

      {loading ? <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p>
        : visible.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
            Aucune entrée{country ? ` pour ${country}` : ''} pour l'instant.
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((e) => (
              <article key={e.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-600">{e.country}</span>
                  <span className={`text-[10px] uppercase font-semibold rounded-full px-2 py-0.5 ${e.kind === 'taxe' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>{e.kind}</span>
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

const chip = (active: boolean) =>
  `px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
    active ? 'bg-brand-ocean text-white border-brand-ocean' : 'bg-white text-slate-600 border-slate-300 hover:border-brand-ocean'
  }`;
