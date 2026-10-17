/**
 * EN DIRECT (17/10, Channing : « ajoute un onglet "live", qui permettrait de
 * voir en direct ce que l'agent fait »). Toutes les 3 secondes, tant que la
 * page est visible :
 * - où en est l'agente : au travail, une tâche en file, ou au repos (et
 *   pourquoi : hors de ses horaires de travail, ou rien à faire) ; sa
 *   dépense IA du jour face à son plafond ;
 * - la tâche du moment, pas à pas : les étapes que le worker écrit
 *   (« Fiche 3 sur 10 », « Arval Belgium : lecture de son site »…) ;
 * - la file d'attente (annulable tant qu'elle n'a pas commencé) ;
 * - le fil des derniers événements : appels à l'IA (recherches web, pages
 *   lues, coût), fiches prêtes, mails écrits, tâches terminées ou en échec,
 *   gestes de l'équipe (avec son nom) — et, plus bas, l'historique (18/10 :
 *   l'onglet Journal est retiré, Live le remplace).
 * Les pannes de l'IA s'affichent en clair : que faire (aiErrors.ts).
 * Rien ne se lance d'ici : c'est un écran pour regarder.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, Sparkles, ScrollText, Clock, Loader2, X, Search, Layers, Mail, Moon, Hourglass } from 'lucide-react';
import {
  listTasks, listRuns, listJournal, aiSpend, cancelTask, AGENT_LABEL,
  type AgentKey, type AgentSettings, type AgentTask, type AiRun, type JournalRow, type AiSpend,
} from '../../services/agents';
import { inSendWindow, nextWindowStart, parisClock } from '../../lib/agents/sendPolicy';
import { fmtUsd } from '../../lib/agents/aiCost';
import { segmentOf, COUNTRY_FR } from '../../lib/agents/research';
import { DISCOVERY_SITE_LABEL } from '../../lib/agents/discovery';
import { aiProblemOf, apiMessage } from '../../lib/agents/aiErrors';
import { listAssignees } from '../../services/userTasks';
import { Banner } from './shared';
import { fmtDateTime, workHoursLabel, deName } from './helpers';

interface Props {
  agent: AgentKey;
  settings: AgentSettings | undefined;
  /** L'autre agente est au travail : le worker fait une tâche à la fois. */
  otherBusy: boolean;
  isAdmin: boolean;
  refreshKey: number;
  onError: (m: string) => void;
  onOpenThread: (id: string) => void;
}

const POLL_MS = 3000;
/** La dépense du jour : une lecture sur cinq (toutes les 15 s). */
const SPEND_EVERY = 5;

const KIND: Record<AgentTask['kind'], { label: string; icon: ReactNode }> = {
  recherche_comptes: { label: 'Recherche web', icon: <Search className="w-4 h-4" /> },
  qualification: { label: 'Préparation des fiches', icon: <Sparkles className="w-4 h-4" /> },
  premier_mail: { label: 'Premiers mails', icon: <Mail className="w-4 h-4" /> },
  decouverte_concessions: { label: 'Relevé d\'annonces', icon: <Layers className="w-4 h-4" /> },
};
const PURPOSE: Record<string, string> = {
  qualification: 'fiche', recherche_comptes: 'recherche d\'entreprises sur le web', premier_mail: 'premier mail', grand_compte: 'grand compte (mail, note LinkedIn, fiche d\'appel)',
};
const pl = (n: number) => (n > 1 ? 's' : '');

/** De quoi parle une tâche, en clair. */
function what(t: AgentTask): string {
  const p = t.params ?? {};
  const n = (x?: unknown[]) => x?.length ?? 0;
  if (t.kind === 'recherche_comptes') {
    const seg = segmentOf(t.agent, p.segment);
    const c = String(p.country ?? '').toUpperCase();
    return `${seg ? seg.label.toLowerCase() : p.segment ?? ''} · ${COUNTRY_FR[c] ?? c}`;
  }
  if (t.kind === 'qualification') { const k = n(p.account_ids) + n(p.dealer_ids); return `${k} fiche${pl(k)}`; }
  if (t.kind === 'premier_mail') { const k = n(p.prospect_ids); return `${k} mail${pl(k)}`; }
  return `${DISCOVERY_SITE_LABEL[String(p.site ?? 'AUTOSCOUT').toUpperCase()] ?? p.site ?? ''} ${p.country ?? ''} · ${p.brand ?? ''}${p.model ? ` ${p.model}` : ''}`;
}

/** L'heure (aujourd'hui) ou la date et l'heure (avant), à Paris. */
function when(iso: string, now: number): string {
  const d = new Date(iso);
  if (parisClock(d).ymd !== parisClock(new Date(now)).ymd) return fmtDateTime(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' });
}
/** Depuis combien de temps : « 42 s », « 3 min 05 s », « 1 h 12 ». */
function since(iso: string | null, now: number): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}
/** Un échec de l'IA, en clair : une panne de réglage (et que faire), sinon son message sans le JSON. */
function aiProblemText(error: string): string {
  const p = aiProblemOf(error);
  if (!p) return `Le dernier appel à l'IA a échoué : ${apiMessage(error)}`;
  return `${p.text.charAt(0).toUpperCase()}${p.text.slice(1)}. En attendant, le travail automatique d'Ada et de Dana se met en pause une heure ; ce que vous lancez à la main réessaie tout de suite.`;
}
/** Une ligne du journal qui porte une erreur brute de l'API (avant le 18/10) : la panne en quelques mots. */
function cleanSummary(summary: string): string {
  const i = summary.indexOf(' en échec : ');
  if (i < 0 || !/\{"type"\s*:\s*"error"/.test(summary)) return summary;
  const rest = summary.slice(i + ' en échec : '.length);
  return `${summary.slice(0, i)} en échec : ${aiProblemOf(rest)?.short ?? apiMessage(rest)}`;
}
/** L'historique : 30 événements de chaque sorte, puis 50 de plus à chaque « Afficher plus ancien ». */
const DEPTH = 30;
const MORE = 50;
const MAX_DEPTH = 500;

interface Ev { key: string; at: string; icon: ReactNode; text: string; tone: 'ai' | 'journal' | 'err'; cost: number; thread: string | null }

export function Live({ agent, settings: s, otherBusy, isAdmin, refreshKey, onError, onOpenThread }: Props) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [spend, setSpend] = useState<AiSpend | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [depth, setDepth] = useState(DEPTH);
  const [names, setNames] = useState<Record<string, string>>({});
  const polls = useRef(0);

  useEffect(() => { void listAssignees().then((p) => setNames(Object.fromEntries(p.map((x) => [x.id, x.name])))); }, []);
  const load = useCallback(async () => {
    const withSpend = polls.current++ % SPEND_EVERY === 0;
    const [t, r, j, sp] = await Promise.all([listTasks(20, agent), listRuns(agent, depth), listJournal(agent, depth), withSpend ? aiSpend() : Promise.resolve(undefined)]);
    if (t.error) onError(t.error); else setTasks(t.rows);
    // SQL de la qualification pas encore collé : pas d'appels à montrer, rien de grave.
    if (!r.error) setRuns(r.rows);
    if (j.error) onError(j.error); else setJournal(j.rows);
    if (sp !== undefined) setSpend(sp);
    setLoaded(true);
  }, [agent, depth, onError]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => { window.clearInterval(tick); window.clearInterval(poll); };
  }, [load]);

  const name = AGENT_LABEL[agent].name;
  const running = tasks.find((t) => t.status === 'en_cours') ?? null;
  // La file dans l'ordre où le worker la prend : la plus ancienne d'abord.
  const queued = tasks.filter((t) => t.status === 'en_attente').sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const lv = running?.result?.live ?? null;
  const inHours = s ? inSendWindow(new Date(now), s) : true;
  const next = s && !inHours ? nextWindowStart(new Date(now), s) : null;
  const today = spend?.[agent]?.today ?? null;
  const budget = s?.daily_budget_usd !== undefined ? Number(s.daily_budget_usd) : null;
  const pct = today != null && budget ? (today / budget) * 100 : 0;
  // Le dernier appel à l'IA a échoué (dans l'heure) : on le dit en clair.
  const lastRun = runs[0];
  const problem = lastRun?.error && now - Date.parse(lastRun.created_at) < 3600_000 ? aiProblemText(lastRun.error) : null;
  // Une tâche en file depuis un moment sans que rien ne tourne : le worker est-il en route ?
  const waitingLong = !running && queued[0] && now - Date.parse(queued[0].created_at) > 120_000;

  const feed = useMemo<Ev[]>(() => [
    ...runs.map((r): Ev => {
      const bits = [r.web_searches ? `${r.web_searches} recherche${pl(r.web_searches)} web` : '', r.web_fetches ? `${r.web_fetches} page${pl(r.web_fetches)} lue${pl(r.web_fetches)}` : ''].filter(Boolean);
      return {
        key: `r-${r.id}`, at: r.created_at, icon: <Sparkles className="w-3.5 h-3.5" />, tone: r.error ? 'err' : 'ai', cost: Number(r.cost_usd) || 0, thread: null,
        text: `IA · ${PURPOSE[r.purpose] ?? r.purpose}${bits.length ? ` · ${bits.join(', ')}` : ''}${r.error ? ` — échec : ${aiProblemOf(r.error)?.short ?? apiMessage(r.error).slice(0, 160)}` : ''}`,
      };
    }),
    ...journal.map((j): Ev => ({
      key: `j-${j.id}`, at: j.at, icon: <ScrollText className="w-3.5 h-3.5" />, tone: /_echec$/.test(j.kind) ? 'err' : 'journal', cost: 0, thread: j.thread_id,
      text: j.actor === 'humain' ? `${(j.actor_id && names[j.actor_id]) || 'Équipe'} : ${j.summary}` : cleanSummary(j.summary),
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, depth + 10), [runs, journal, names, depth]);
  // Il reste plus ancien à lire : une des deux listes est pleine.
  const moreToRead = depth < MAX_DEPTH && (runs.length >= depth || journal.length >= depth);

  const state = running ? 'work' : queued.length ? 'wait' : 'idle';
  return (
    <div className="space-y-4">
      {/* Où elle en est */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-center gap-x-6 gap-y-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1 basis-full sm:basis-0">
          <span className="relative flex h-3.5 w-3.5 shrink-0">
            {state === 'work' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex h-3.5 w-3.5 rounded-full ${state === 'work' ? 'bg-emerald-500' : state === 'wait' ? 'bg-amber-400' : 'bg-slate-300'}`} />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-900">{state === 'work' ? `${name} travaille` : state === 'wait' ? `${name} va s'y mettre` : `${name} est au repos`}</p>
            <p className="text-sm text-slate-600">
              {running ? `${KIND[running.kind].label} — ${what(running)}`
                : queued.length ? `${queued.length} tâche${pl(queued.length)} en file : elle les prend une par une.${otherBusy ? ` Le worker fait une chose à la fois : il termine d'abord celle ${deName(agent === 'ada' ? 'Dana' : 'Ada')}.` : ''}`
                  : inHours ? 'Rien à faire pour l\'instant : son travail automatique repasse toutes les 10 minutes.'
                    : `Hors de ses horaires de travail (${s ? workHoursLabel(s) : '—'})${next ? ` : reprise ${fmtDateTime(next.toISOString())}` : ''}. Ce que vous lancez à la main part tout de suite.`}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <p className="text-xs text-slate-500">IA aujourd'hui</p>
          <p className="text-lg font-semibold text-slate-900 tabular-nums">{today != null ? fmtUsd(today) : '—'}{budget != null && <span className="text-xs font-normal text-slate-400"> / plafond {budget} $</span>}</p>
          {budget ? (
            <div className="mt-1 h-1.5 w-40 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-violet-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          ) : null}
        </div>
      </div>

      {problem && <Banner tone="err">{problem}</Banner>}
      {waitingLong && !otherBusy && <Banner tone="warn">Une tâche attend depuis {since(queued[0].created_at, now)} sans avoir démarré : le worker devrait l'avoir prise en moins d'une minute. Vérifiez qu'il tourne (Railway, worker TEST).</Banner>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
        {/* En ce moment */}
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Activity className="w-4 h-4 text-emerald-600" /> En ce moment</h3>
          {running ? (
            <>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">{KIND[running.kind].icon} {KIND[running.kind].label}</span>
                <span className="text-slate-600">{what(running)}</span>
                {!running.created_by && <span className="text-[10px] rounded-full px-1.5 bg-slate-50 border border-slate-200 text-slate-500">automatique</span>}
                <span className="ml-auto text-xs text-slate-400 tabular-nums">depuis {since(running.started_at, now)}</span>
              </div>
              {lv ? (
                <>
                  <p className="flex items-start gap-2 text-sm font-medium text-slate-900"><Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin text-emerald-600" /> {lv.step}</p>
                  {lv.total ? (
                    <div className="space-y-1">
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.round(((lv.done ?? 0) / lv.total) * 100)}%` }} /></div>
                      <p className="text-[11px] text-slate-500 tabular-nums">{lv.done ?? 0} sur {lv.total} terminé{(lv.done ?? 0) > 1 ? 's' : ''}</p>
                    </div>
                  ) : null}
                  <ol className="space-y-1 border-l-2 border-emerald-100 pl-3 max-h-72 overflow-y-auto">
                    {[...lv.log].reverse().map((x, i) => (
                      <li key={`${x.at}-${i}`} className={`text-xs ${i === 0 ? 'text-slate-900' : 'text-slate-500'}`}>
                        <span className="mr-2 tabular-nums text-slate-400">{when(x.at, now)}</span>{x.text}
                      </li>
                    ))}
                  </ol>
                </>
              ) : <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Démarrage…</p>}
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              {queued.length ? <><Hourglass className="w-4 h-4" /> La prochaine tâche démarre dès que le worker est libre.</> : <><Moon className="w-4 h-4" /> Aucune tâche en cours.</>}
            </p>
          )}
          {queued.length > 0 && (
            <div className="border-t border-slate-100 pt-3 space-y-1.5">
              <p className="text-xs font-medium text-slate-700">À suivre</p>
              {queued.map((t) => (
                <div key={t.id} className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-xs">
                  <Clock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  <span className="font-medium text-slate-800">{KIND[t.kind].label}</span>
                  <span className="min-w-0 truncate text-slate-600">{what(t)}</span>
                  {!t.created_by && <span className="shrink-0 text-[10px] rounded-full px-1.5 bg-slate-50 border border-slate-200 text-slate-500">automatique</span>}
                  <span className="ml-auto shrink-0 text-slate-400">en file depuis {since(t.created_at, now)}</span>
                  {isAdmin && (
                    <button onClick={() => void cancelTask(t.id).then((e) => (e ? onError(e) : void load()))} className="shrink-0 text-slate-400 hover:text-rose-600" title="Annuler cette tâche">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Fil en direct */}
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ScrollText className="w-4 h-4 text-brand-ocean" /> Fil en direct
            <span className="ml-auto text-[11px] font-normal text-slate-400">mis à jour toutes les 3 s</span>
          </h3>
          {loaded && feed.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Rien encore : ses recherches, ses fiches, ses mails et chaque appel à l'IA s'afficheront ici.</p>}
          <ol className="divide-y divide-slate-100 max-h-[34rem] overflow-y-auto">
            {feed.map((e) => (
              <li key={e.key} className={`flex items-start gap-2 py-1.5 px-1 text-xs transition-colors ${now - Date.parse(e.at) < 10_000 ? 'bg-emerald-50' : ''}`}>
                <span className="w-16 shrink-0 tabular-nums text-slate-400">{when(e.at, now)}</span>
                <span className={`mt-0.5 shrink-0 ${e.tone === 'err' ? 'text-red-600' : e.tone === 'ai' ? 'text-violet-600' : 'text-slate-400'}`}>{e.icon}</span>
                <span className={`min-w-0 flex-1 ${e.tone === 'err' ? 'text-red-700' : 'text-slate-800'}`}>{e.text}</span>
                {e.cost > 0 && <span className="shrink-0 tabular-nums text-slate-400">{fmtUsd(e.cost)}</span>}
                {e.thread && <button onClick={() => onOpenThread(e.thread as string)} className="shrink-0 text-brand-ocean hover:underline">fil</button>}
              </li>
            ))}
          </ol>
          {moreToRead && (
            <button onClick={() => setDepth((d) => Math.min(MAX_DEPTH, d + MORE))} className="w-full rounded-lg border border-slate-200 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
              Afficher plus ancien
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
