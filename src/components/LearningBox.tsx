import { useEffect, useState } from 'react';
import { ExternalLink, Check, EyeOff, RotateCcw, Loader2, GraduationCap } from 'lucide-react';
import { listLearningCases, setLearningCaseStatus, KIND_LABEL, type LearningCase } from '../services/learningCases';

/**
 * BOÎTE À APPRENDRE (01/10, demande Channing) : les cas qu'ADA ne sait pas
 * encore traiter, enregistrés par le worker au moment où ils se présentent
 * (première famille : vitrines de concession non reconnues). On les revoit
 * ensemble ici — ou via l'outil MCP learning_cases — puis on marque « fait ».
 */
export function LearningBox() {
  const [cases, setCases] = useState<LearningCase[]>([]);
  const [filter, setFilter] = useState<'open' | 'done' | 'ignored' | 'all'>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (f = filter) => {
    setLoading(true);
    const r = await listLearningCases(f);
    setCases(r.cases); setError(r.error); setLoading(false);
  };
  useEffect(() => { void load(filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (c: LearningCase, status: 'open' | 'done' | 'ignored') => {
    let resolution: string | undefined;
    if (status === 'done') { const r = window.prompt('Comment ce cas a été réglé ? (une ligne, pour la mémoire)', c.resolution ?? ''); if (r == null) return; resolution = r; }
    setBusy(c.id);
    const err = await setLearningCaseStatus(c.id, status, resolution);
    if (err) setError(err);
    await load();
    setBusy(null);
  };

  const fmt = (s: string) => new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-slate-500 flex items-center gap-1.5"><GraduationCap className="w-4 h-4 text-emerald-600" /> Ce qu'ADA a rencontré sans savoir le traiter. Chaque cas est enregistré une fois et compté à chaque nouvelle rencontre.</p>
        <div className="ml-auto flex gap-1">
          {(['open', 'done', 'ignored', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-full text-xs border ${filter === f ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              {f === 'open' ? 'À traiter' : f === 'done' ? 'Faits' : f === 'ignored' ? 'Ignorés' : 'Tous'}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {loading ? <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</p>
        : cases.length === 0 ? <p className="text-sm text-slate-500 py-6 text-center">Rien à apprendre pour l'instant{filter === 'open' ? ' : la boîte est vide.' : '.'}</p>
          : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
              {cases.map((c) => {
                const d = (c.detail ?? {}) as { pageTitle?: string | null; hints?: string[] };
                return (
                  <li key={c.id} className="p-3 flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] uppercase tracking-wide text-slate-400">{KIND_LABEL[c.kind] ?? c.kind}</p>
                      <p className="font-medium text-slate-900">{c.title}</p>
                      {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-brand-ocean hover:underline inline-flex items-center gap-1 break-all">{c.url}<ExternalLink className="w-3 h-3 shrink-0" /></a>}
                      <p className="text-xs text-slate-500 mt-1">
                        {d.pageTitle && <>« {d.pageTitle} » · </>}
                        {d.hints && d.hints.length > 0 ? <>indices : {d.hints.join(', ')} · </> : <>aucun indice technique repéré · </>}
                        vu {c.seen_count} fois, dernière le {fmt(c.last_seen_at)}{c.submitted_by ? ` · par ${c.submitted_by}` : ''}
                      </p>
                      {c.resolution && <p className="text-xs text-emerald-700 mt-1">Réglé : {c.resolution}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {c.status !== 'done' && <button disabled={busy === c.id} onClick={() => void act(c, 'done')} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"><Check className="w-3.5 h-3.5" /> Fait</button>}
                      {c.status === 'open' && <button disabled={busy === c.id} onClick={() => void act(c, 'ignored')} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><EyeOff className="w-3.5 h-3.5" /> Ignorer</button>}
                      {c.status !== 'open' && <button disabled={busy === c.id} onClick={() => void act(c, 'open')} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><RotateCcw className="w-3.5 h-3.5" /> Rouvrir</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
    </div>
  );
}
