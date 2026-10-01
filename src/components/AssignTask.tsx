import { useEffect, useState } from 'react';
import { Send, Trash2, CheckSquare, Square, Loader2, UserPlus } from 'lucide-react';
import { listAssignees, listAllTasks, createTask, setTaskDone, deleteTask, type Assignee, type UserTask } from '../services/userTasks';

/**
 * CONFIER UNE TÂCHE (02/10, demande Channing) — panneau admin de la boîte à
 * apprendre : choisir le compte, écrire la note, coller un lien ; la
 * personne la voit sur son accueil avec une pastille. En dessous, toutes les
 * tâches par compte, avec leur état.
 */
export function AssignTask({ prefill, onPrefillUsed }: { prefill?: { title: string; note?: string; link?: string | null } | null; onPrefillUsed?: () => void }) {
  const [people, setPeople] = useState<Assignee[]>([]);
  const [assignee, setAssignee] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [tasks, setTasks] = useState<UserTask[]>([]);
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (f = filter) => { const r = await listAllTasks(f); setTasks(r.tasks); if (r.error) setMsg(r.error); };
  useEffect(() => { void listAssignees().then((p) => { setPeople(p); if (!assignee && p[0]) setAssignee(p[0].id); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!prefill) return;
    setTitle(prefill.title); setNote(prefill.note ?? ''); setLink(prefill.link ?? '');
    onPrefillUsed?.();
    document.getElementById('assign-task-title')?.focus();
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!assignee || !title.trim()) { setMsg('Choisis un compte et écris la tâche.'); return; }
    setBusy(true); setMsg(null);
    const err = await createTask({ assigneeId: assignee, title, note, link });
    setBusy(false);
    if (err) { setMsg(err); return; }
    setTitle(''); setNote(''); setLink('');
    setMsg(`Tâche confiée à ${people.find((p) => p.id === assignee)?.name ?? 'ce compte'} — elle apparaît sur son accueil.`);
    await load();
  };
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id.slice(0, 8);
  const fmt = (s: string) => new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-slate-800 flex items-center gap-2"><UserPlus className="w-4 h-4 text-emerald-600" /> Confier une tâche</p>
        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-2">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 text-sm bg-white">
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isAdmin ? ' (admin)' : ''}</option>)}
          </select>
          <input id="assign-task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="La tâche, en une ligne (ex. ajouter le client Mustière dans les contacts)" className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optionnel) : ce qu'il faut faire ou fournir" rows={2} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
        <div className="flex flex-wrap gap-2 items-center">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Lien (optionnel) : une page d'ADA (/ventes) ou une URL" className="flex-1 min-w-[240px] px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
          <button onClick={() => void submit()} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white text-sm font-medium disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Confier
          </button>
        </div>
        {msg && <p className="text-xs text-slate-600">{msg}</p>}
      </div>

      <div className="flex items-center gap-2">
        <p className="text-xs text-slate-500">Tâches confiées, par compte</p>
        <div className="ml-auto flex gap-1">
          {(['open', 'done', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-full text-xs border ${filter === f ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{f === 'open' ? 'À faire' : f === 'done' ? 'Faites' : 'Toutes'}</button>
          ))}
        </div>
      </div>
      {tasks.length === 0 ? <p className="text-sm text-slate-500 py-4 text-center">Aucune tâche.</p> : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
          {tasks.map((t) => (
            <li key={t.id} className={`px-4 py-2.5 flex items-start gap-3 ${t.status === 'done' ? 'opacity-60' : ''}`}>
              <button onClick={() => void setTaskDone(t.id, t.status !== 'done').then(() => load())} className="mt-0.5 shrink-0 text-emerald-600">{t.status === 'done' ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-400" />}</button>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">{nameOf(t.assignee_id)}{t.seen_at ? '' : ' · pas encore vue'}</p>
                <p className={`text-sm font-medium text-slate-900 ${t.status === 'done' ? 'line-through' : ''}`}>{t.title}</p>
                {t.note && <p className="text-xs text-slate-600 whitespace-pre-line">{t.note}</p>}
                <p className="text-[11px] text-slate-400">{t.status === 'done' && t.done_at ? `faite le ${fmt(t.done_at)}` : `confiée le ${fmt(t.created_at)}`}{t.link ? ` · ${t.link}` : ''}</p>
              </div>
              <button onClick={() => { if (window.confirm('Supprimer cette tâche ?')) void deleteTask(t.id).then(() => load()); }} title="Supprimer" className="shrink-0 p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
