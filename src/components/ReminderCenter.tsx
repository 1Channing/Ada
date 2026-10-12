/**
 * CLOCHE « RAPPELS » (12/10, demande Channing pour l'équipe Weecars) — pour
 * tout le monde : mes rappels (posés depuis une annonce ou ici), échus en
 * tête, à venir ensuite, et les tâches confiées par l'admin. Je coche quand
 * c'est fait, je reporte d'un jour, je supprime un rappel que j'ai créé.
 * Relue toutes les 60 s, au retour sur l'onglet, à chaque navigation et dès
 * qu'un rappel est ajouté ailleurs dans l'app (signal REMINDERS_CHANGED).
 * La cloche du re-scan mensuel (NotificationCenter) est réservée à l'admin.
 */
import { useEffect, useState } from 'react';
import { Bell, Check, Trash2, X, ArrowUpRight, ExternalLink, Loader2, Plus, AlarmClock, CalendarClock } from 'lucide-react';
import { useAuth } from '../services/auth';
import {
  listMyTasks, setTaskDone, deleteTask, createReminder, snoozeReminder, markTasksSeen, isDue, isReminder,
  REMINDERS_CHANGED, type UserTask,
} from '../services/userTasks';

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `aujourd'hui ${hm}`;
  if (diff === 1) return `demain ${hm}`;
  if (diff === -1) return `hier ${hm}`;
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${hm}`;
};

/** Valeur datetime-local (heure locale) pour « demain 9 h ». */
export function defaultReminderWhen(): string {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ReminderCenter() {
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<UserTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(defaultReminderWhen);
  const [tick, setTick] = useState(0);

  const load = async () => {
    const r = await listMyTasks('open');
    setTasks(r.tasks); setError(r.error); setLoading(false);
  };
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const refresh = () => { if (alive) void load(); };
    refresh();
    const t = setInterval(() => { refresh(); setTick((x) => x + 1); }, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('locationchange', refresh);
    window.addEventListener(REMINDERS_CHANGED, refresh);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('locationchange', refresh); window.removeEventListener(REMINDERS_CHANGED, refresh); };
  }, [userId]);
  // Les tâches admin passent « vues » à l'ouverture de la cloche (pastille).
  useEffect(() => {
    if (!open) return;
    const unseen = tasks.filter((t) => !isReminder(t) && !t.seen_at).map((t) => t.id);
    if (unseen.length) void markTasksSeen(unseen).then(load);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recalculé à chaque rendu : `tick` (une fois par minute) fait basculer un
  // rappel « à venir » en « échu » sans relecture serveur.
  const now = Date.now();
  const byDue = (a: UserTask, b: UserTask) => String(a.due_at).localeCompare(String(b.due_at));
  const due = tasks.filter((t) => isReminder(t) && isDue(t, now)).sort(byDue);
  const upcoming = tasks.filter((t) => isReminder(t) && !isDue(t, now)).sort(byDue);
  const adminTasks = tasks.filter((t) => !isReminder(t));
  void tick;
  const badge = due.length + adminTasks.filter((t) => !t.seen_at).length;

  const go = (link: string) => {
    setOpen(false);
    if (/^https?:\/\//.test(link)) { window.open(link, '_blank', 'noreferrer'); return; }
    window.history.pushState({}, '', link); window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const done = async (t: UserTask) => { setBusy(t.id); const e = await setTaskDone(t.id, true); if (e) setError(e); await load(); setBusy(null); };
  const remove = async (t: UserTask) => { setBusy(t.id); const e = await deleteTask(t.id); if (e) setError(e); await load(); setBusy(null); };
  const snooze = async (t: UserTask) => {
    setBusy(t.id);
    const base = t.due_at && Date.parse(t.due_at) > Date.now() ? new Date(t.due_at) : new Date();
    base.setDate(base.getDate() + 1);
    const e = await snoozeReminder(t.id, base.toISOString()); if (e) setError(e); await load(); setBusy(null);
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !when) return;
    setBusy('new');
    const err = await createReminder({ title: title.trim(), dueAt: new Date(when).toISOString(), link: null });
    setBusy(null);
    if (err) { setError(err); return; }
    setTitle(''); setWhen(defaultReminderWhen()); setAdding(false); await load();
  };

  const Row = ({ t, tone }: { t: UserTask; tone: 'due' | 'upcoming' | 'task' }) => (
    <li className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${tone === 'due' ? 'bg-rose-50 border-rose-200' : tone === 'upcoming' ? 'bg-white border-slate-200' : 'bg-amber-50 border-amber-200'}`}>
      <button onClick={() => void done(t)} disabled={busy === t.id} title="Fait" className="mt-0.5 shrink-0 w-5 h-5 rounded border border-slate-300 bg-white grid place-items-center text-emerald-600 hover:border-emerald-500">
        {busy === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 opacity-0 hover:opacity-100" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-900 leading-snug">{t.title}</p>
        {t.note && <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-line line-clamp-2">{t.note}</p>}
        <p className={`text-[11px] mt-0.5 ${tone === 'due' ? 'text-rose-700 font-medium' : 'text-slate-500'}`}>
          {t.due_at ? <><AlarmClock className="w-3 h-3 inline -mt-0.5 mr-0.5" />{fmtWhen(t.due_at)}</> : `confiée par l'admin le ${new Date(t.created_at).toLocaleDateString('fr-FR')}`}
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {t.link && (
          <button onClick={() => go(t.link!)} title="Ouvrir" className="p-1 rounded text-slate-500 hover:bg-white hover:text-brand-ocean">
            {/^https?:\/\//.test(t.link) ? <ExternalLink className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
          </button>
        )}
        {isReminder(t) && <button onClick={() => void snooze(t)} disabled={busy === t.id} title="Reporter d'un jour" className="p-1 rounded text-slate-500 hover:bg-white hover:text-slate-800"><CalendarClock className="w-3.5 h-3.5" /></button>}
        {t.created_by === userId && <button onClick={() => void remove(t)} disabled={busy === t.id} title="Supprimer ce rappel" className="p-1 rounded text-slate-400 hover:bg-white hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}
      </div>
    </li>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative p-2 rounded-lg transition-colors ${open ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
        title="Rappels et tâches"
        aria-label="Rappels et tâches"
      >
        <Bell className="w-5 h-5" />
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[440px] max-w-[92vw] bg-white border border-slate-300 rounded-xl shadow-2xl p-4 space-y-3 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:w-auto max-md:max-w-none max-md:rounded-t-2xl max-md:rounded-b-none max-md:max-h-[80vh] max-md:overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Rappels{due.length ? ` — ${due.length} échu${due.length > 1 ? 's' : ''}` : ''}</h3>
            <div className="flex items-center gap-1">
              <button onClick={() => setAdding((a) => !a)} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"><Plus className="w-3.5 h-3.5" /> Rappel</button>
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800" aria-label="Fermer"><X className="w-4 h-4" /></button>
            </div>
          </div>
          {adding && (
            <form onSubmit={add} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Rappeler le vendeur de la Clio…" className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm bg-white" />
              <div className="flex items-center gap-2">
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 text-sm bg-white" />
                <button type="submit" disabled={busy === 'new' || !title.trim()} className="ml-auto px-3 py-1.5 rounded-lg bg-brand-ocean text-white text-xs font-medium disabled:opacity-50">Ajouter</button>
              </div>
            </form>
          )}
          {error && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{error}</p>}
          {loading ? (
            <p className="text-xs text-slate-500 flex items-center gap-2 py-3"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement…</p>
          ) : tasks.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">Aucun rappel. Pose-en un depuis une annonce (menu ⋯ → « Ajouter un rappel ») ou avec le bouton Rappel.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-3">
              {due.length > 0 && <ul className="space-y-1.5">{due.map((t) => <Row key={t.id} t={t} tone="due" />)}</ul>}
              {adminTasks.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Tâches confiées</p>
                  <ul className="space-y-1.5">{adminTasks.map((t) => <Row key={t.id} t={t} tone="task" />)}</ul>
                </div>
              )}
              {upcoming.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">À venir</p>
                  <ul className="space-y-1.5">{upcoming.map((t) => <Row key={t.id} t={t} tone="upcoming" />)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
