import { useEffect, useState } from 'react';
import { CheckSquare, Square, ExternalLink, ArrowUpRight, ListChecks, Loader2 } from 'lucide-react';
import { listMyTasks, setTaskDone, markTasksSeen, type UserTask } from '../services/userTasks';

/**
 * MES TÂCHES — carte de l'accueil (02/10, demande Channing) : ce que l'admin
 * m'a confié, avec sa note et son lien ; je coche pour valider. Les tâches
 * faites restent visibles sept jours, barrées, puis disparaissent.
 */
export function MyTasks() {
  const [tasks, setTasks] = useState<UserTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const r = await listMyTasks('all');
    setTasks(r.tasks); setError(r.error); setLoading(false);
    void markTasksSeen(r.tasks.filter((t) => !t.seen_at).map((t) => t.id));
  };
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, []);

  const toggle = async (t: UserTask) => {
    setBusy(t.id);
    const err = await setTaskDone(t.id, t.status !== 'done');
    if (err) setError(err);
    await load();
    setBusy(null);
  };
  const go = (link: string) => {
    if (/^https?:\/\//.test(link)) { window.open(link, '_blank', 'noreferrer'); return; }
    window.history.pushState({}, '', link); window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const open = tasks.filter((t) => t.status === 'open');
  const recentDone = tasks.filter((t) => t.status === 'done' && t.done_at && Date.now() - new Date(t.done_at).getTime() < 7 * 86_400_000);
  if (!loading && !error && open.length === 0 && recentDone.length === 0) return null;
  const fmt = (s: string) => new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

  return (
    <div className="bg-white rounded-xl border border-amber-200 shadow-sm">
      <div className="px-4 py-2.5 border-b border-amber-100 flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-slate-800">Mes tâches{open.length ? ` · ${open.length} à faire` : ''}</h2>
        <span className="ml-auto text-[11px] text-slate-400">confiées par l'admin · coche pour valider</span>
      </div>
      {error && <p className="px-4 py-2 text-xs text-amber-700">{error}</p>}
      {loading ? <p className="px-4 py-3 text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</p> : (
        <ul className="divide-y divide-slate-100">
          {[...open, ...recentDone].map((t) => (
            <li key={t.id} className={`px-4 py-2.5 flex items-start gap-3 ${t.status === 'done' ? 'opacity-60' : ''}`}>
              <button onClick={() => void toggle(t)} disabled={busy === t.id} title={t.status === 'done' ? 'Remettre à faire' : 'Valider'} className="mt-0.5 text-emerald-600 hover:text-emerald-700 shrink-0">
                {t.status === 'done' ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-400 hover:text-emerald-600" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium text-slate-900 ${t.status === 'done' ? 'line-through' : ''}`}>{t.title}</p>
                {t.note && <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-line">{t.note}</p>}
                <p className="text-[11px] text-slate-400 mt-0.5">{t.status === 'done' && t.done_at ? `fait le ${fmt(t.done_at)}` : `confiée le ${fmt(t.created_at)}`}</p>
              </div>
              {t.link && (
                <button onClick={() => go(t.link!)} className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                  {/^https?:\/\//.test(t.link) ? <ExternalLink className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />} Ouvrir
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
