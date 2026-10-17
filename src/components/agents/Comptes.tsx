/**
 * Comptes (17/10, étape 2 ; Channing : « les retours leasing, loueurs, les
 * acheteurs / vendeurs des gros groupes de concessions, les fleet managers,
 * les revendeurs B2B… il y a tous les pays à travailler »).
 *
 * Ce que les annonces ne montrent pas. L'agente choisie en haut de la page
 * (17/10 : une à la fois, chacune ses comptes) cherche sur le web un de SES
 * types de compte dans un de SES pays (Haiku 5.5, 4 recherches au plus) —
 * Dana : leasing, loueurs, flottes, groupes, négociants B2B, toute
 * l'Europe ; Ada : groupes, revendeurs, flottes qui renouvellent, jamais la
 * France. Seules les entreprises vues pour de vrai sont gardées (site
 * officiel vérifié), puis qualifiées (qui décide, e-mail publié, LinkedIn).
 * Un grand compte est préparé pour vous (« À valider › Pour vous ») ; un
 * petit reçoit le premier mail de l'agente, à valider. Rien n'est envoyé
 * d'ici.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, ExternalLink, Sparkles, Crown, X, Undo2, Ban } from 'lucide-react';
import {
  listAccounts, accountProspects, listTasks, queueResearch, queueAccountQualification, setAccountStatus, queueFirstMails, setProspectStage, threadsOfProspects, cancelTask,
  AGENT_LABEL, type AgentAccount, type AgentKey, type AgentTask, type ProspectDetail, type ProspectStage,
} from '../../services/agents';
import { SEGMENTS, RESEARCH_COUNTRIES, COUNTRY_FR, segmentOf } from '../../lib/agents/research';
import { fmtUsd } from '../../lib/agents/aiCost';
import { QualifCard } from './QualifCard';
import { fmtRelative, STAGE_LABEL, scoreTone } from './helpers';

const FLAG: Record<string, string> = { FR: '🇫🇷', DE: '🇩🇪', NL: '🇳🇱', BE: '🇧🇪', ES: '🇪🇸', IT: '🇮🇹', DK: '🇩🇰', AT: '🇦🇹', LU: '🇱🇺', SE: '🇸🇪', PT: '🇵🇹', PL: '🇵🇱', HU: '🇭🇺', LT: '🇱🇹', CH: '🇨🇭' };
const input = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40';
const TASK_STATUS: Record<AgentTask['status'], { label: string; cls: string }> = {
  en_attente: { label: 'en attente', cls: 'bg-slate-100 text-slate-600' },
  en_cours: { label: 'en cours', cls: 'bg-blue-50 text-blue-800' },
  terminee: { label: 'terminée', cls: 'bg-emerald-50 text-emerald-800' },
  echec: { label: 'échec', cls: 'bg-red-50 text-red-800' },
  annulee: { label: 'annulée', cls: 'bg-slate-100 text-slate-400' },
};
/** Ada vend à l'export : jamais la France ; Dana cherche dans toute l'Europe. */
const countriesOf = (agent: AgentKey) => (agent === 'ada' ? RESEARCH_COUNTRIES.filter((c) => c !== 'FR') : RESEARCH_COUNTRIES);
const hostOf = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const isOpen = (t: AgentTask) => t.status === 'en_attente' || t.status === 'en_cours';

type StatusFilter = 'a_qualifier' | 'qualifies' | 'ecartes' | 'tous';

interface Props { agent: AgentKey; userId: string | null; refreshKey: number; onError: (m: string) => void; onInfo: (m: string) => void; onOpenThread: (id: string) => void }

export function Comptes({ agent, userId, refreshKey, onError, onInfo, onOpenThread }: Props) {
  const [accounts, setAccounts] = useState<AgentAccount[]>([]);
  const [details, setDetails] = useState<Map<string, ProspectDetail>>(new Map());
  const [threads, setThreads] = useState<Map<string, string>>(new Map());
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [segmentF, setSegmentF] = useState('');
  const [countryF, setCountryF] = useState('');
  const [statusF, setStatusF] = useState<StatusFilter>('a_qualifier');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [launch, setLaunch] = useState<{ segment: string; country: string }>(() => ({ segment: SEGMENTS[agent][0].key, country: agent === 'ada' ? 'NL' : 'FR' }));
  const name = AGENT_LABEL[agent].name;

  const load = useCallback(async () => {
    const [r, t] = await Promise.all([listAccounts(agent), listTasks(60, agent)]);
    if (r.error) onError(r.error);
    else {
      setAccounts(r.rows);
      const det = await accountProspects(r.rows.filter((a) => a.prospect_id || a.status !== 'nouveau').map((a) => a.id));
      setDetails(new Map(det.filter((x) => x.account_id).map((x) => [x.account_id as string, x])));
      setThreads(await threadsOfProspects(det.map((x) => x.id)));
    }
    if (t.error) onError(t.error); else setTasks(t.rows.filter((x) => x.kind === 'recherche_comptes' || x.kind === 'qualification' || x.kind === 'premier_mail'));
    setLoaded(true);
  }, [agent, onError]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const busy = tasks.some(isOpen);
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [busy, load]);

  const research = tasks.filter((t) => t.kind === 'recherche_comptes');
  const queued = useMemo(() => new Set(tasks.filter((t) => t.kind === 'qualification' && isOpen(t)).flatMap((t) => t.params.account_ids ?? [])), [tasks]);
  const drafting = useMemo(() => new Set(tasks.filter((t) => t.kind === 'premier_mail' && isOpen(t)).flatMap((t) => t.params.prospect_ids ?? [])), [tasks]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => (!segmentF || a.segment === segmentF) && (!countryF || a.country === countryF)
      && (statusF === 'tous' || (statusF === 'a_qualifier' ? a.status === 'nouveau' : statusF === 'qualifies' ? a.status === 'qualifie' : a.status === 'ecarte'))
      && (!q || `${a.name} ${a.city ?? ''} ${a.website}`.toLowerCase().includes(q)));
  }, [accounts, segmentF, countryF, statusF, query]);
  const countries = useMemo(() => [...new Set(accounts.map((a) => a.country).filter(Boolean) as string[])].sort(), [accounts]);
  // Les prochains comptes à qualifier : 10 au plus.
  const toQualify = useMemo(() => shown.filter((a) => a.status === 'nouveau' && !queued.has(a.id)).slice(0, 10).map((a) => a.id), [shown, queued]);

  const start = async () => {
    const e = await queueResearch(agent, { segment: launch.segment, country: launch.country }, userId);
    if (e) { onError(e); return; }
    const seg = segmentOf(agent, launch.segment);
    onInfo(`${name} cherche : ${seg?.label.toLowerCase() ?? launch.segment}, ${COUNTRY_FR[launch.country] ?? launch.country}. Les entreprises trouvées arrivent ici d'ici une à deux minutes.`);
    void load();
  };
  const qualify = async (ids: string[]) => {
    if (!ids.length) return;
    const e = await queueAccountQualification(ids, userId, agent);
    if (e) { onError(e); return; }
    const n = ids.length;
    onInfo(`${name} prépare ${n > 1 ? `${n} fiches` : 'la fiche'} : qui décide, e-mail publié, LinkedIn s'il est trouvé. Une minute environ par fiche. Rien n'est envoyé à personne.`);
    void load();
  };
  const status = async (a: AgentAccount, s: 'nouveau' | 'ecarte') => {
    const e = await setAccountStatus(a.id, s);
    if (e) onError(e); else setAccounts((xs) => xs.map((x) => (x.id === a.id ? { ...x, status: s } : x)));
  };
  const draft = async (a: AgentAccount, p: ProspectDetail) => {
    const e = await queueFirstMails([p.id], userId, a.agent);
    if (e) { onError(e); return; }
    onInfo(p.key_account
      ? `${name} prépare pour vous ${p.name} (mail, note LinkedIn, fiche d'appel) : « À valider › Pour vous » d'ici une minute.`
      : `${name} rédige le premier mail pour ${p.name} : il arrivera dans « À valider » d'ici une minute.`);
    void load();
  };
  const changeStage = async (a: AgentAccount, p: ProspectDetail, stage: ProspectStage) => {
    const e = await setProspectStage(p.id, stage);
    if (e) onError(e); else setDetails((m) => new Map(m).set(a.id, { ...p, stage }));
  };
  const segs = SEGMENTS[agent];

  return (
    <div className="space-y-4">
      {/* Lancer une recherche */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Search className="w-4 h-4 text-brand-ocean" />
          <h3 className="text-sm font-semibold text-slate-900">Chercher des comptes</h3>
          <span className="text-xs text-slate-500">— {name} cherche sur le web (4 recherches au plus, quelques centimes) et ne garde que les entreprises au site officiel vérifié.</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <select className={input} value={launch.segment} onChange={(e) => setLaunch({ ...launch, segment: e.target.value })}>
            {segs.map((sg) => <option key={sg.key} value={sg.key}>{sg.label}</option>)}
          </select>
          <select className={input} value={launch.country} onChange={(e) => setLaunch({ ...launch, country: e.target.value })}>
            {countriesOf(agent).map((c) => <option key={c} value={c}>{FLAG[c] ?? ''} {COUNTRY_FR[c] ?? c}</option>)}
          </select>
          <button onClick={() => void start()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white px-3 py-1.5 text-sm font-medium"><Search className="w-4 h-4" /> Lancer la recherche</button>
        </div>
        {(() => {
          const sg = segmentOf(agent, launch.segment);
          return sg ? <p className="text-[11px] text-slate-400">{sg.who.charAt(0).toUpperCase()}{sg.who.slice(1)} — chez eux, qui décide : {sg.roles}.</p> : null;
        })()}
        {research.length > 0 && (
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {research.slice(0, 6).map((t) => {
              const seg = segmentOf(t.agent, t.params.segment);
              return (
                <div key={t.id} className="flex items-center gap-2 py-1.5 text-xs flex-wrap">
                  <span className={`rounded-full px-2 py-0.5 ${TASK_STATUS[t.status].cls}`}>{TASK_STATUS[t.status].label}</span>
                  <span className="font-medium text-slate-800">{seg?.label ?? t.params.segment} · {FLAG[t.params.country ?? ''] ?? ''} {COUNTRY_FR[t.params.country ?? ''] ?? t.params.country}{t.params.auto ? ' (automatique)' : ''}</span>
                  {t.status === 'terminee' && t.result && (
                    <span className="text-slate-600">{t.result.gardes ?? 0} trouvé{(t.result.gardes ?? 0) > 1 ? 's' : ''}{t.result.deja ? `, ${t.result.deja} déjà connu${t.result.deja > 1 ? 's' : ''}` : ''}{t.result.ecartes ? `, ${t.result.ecartes} écarté${t.result.ecartes > 1 ? 's' : ''}` : ''} · {fmtUsd(t.result.cout_usd ?? 0)}</span>
                  )}
                  {t.status === 'echec' && <span className="text-red-700">{t.error}</span>}
                  <span className="ml-auto text-slate-400">{fmtRelative(t.finished_at ?? t.created_at)}</span>
                  {t.status === 'en_attente' && <button onClick={() => void cancelTask(t.id).then((e) => (e ? onError(e) : void load()))} className="text-slate-400 hover:text-rose-600" title="Annuler"><X className="w-3.5 h-3.5" /></button>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Les comptes trouvés */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Crown className="w-4 h-4 text-violet-600" />
            <h3 className="text-sm font-semibold text-slate-900">Comptes trouvés</h3>
            <span className="text-xs text-slate-500">— chacun vu dans les résultats de recherche (site officiel), jamais deviné.</span>
            <span className="ml-auto text-xs text-slate-400">{shown.length} compte{shown.length > 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <select value={segmentF} onChange={(e) => setSegmentF(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
              <option value="">Tous les types</option>
              {segs.map((sg) => <option key={sg.key} value={sg.key}>{sg.label}</option>)}
            </select>
            <select value={countryF} onChange={(e) => setCountryF(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
              <option value="">Tous pays</option>
              {countries.map((c) => <option key={c} value={c}>{FLAG[c] ?? ''} {COUNTRY_FR[c] ?? c}</option>)}
            </select>
            <select value={statusF} onChange={(e) => setStatusF(e.target.value as StatusFilter)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
              <option value="a_qualifier">Sans fiche</option>
              <option value="qualifies">Avec fiche</option>
              <option value="ecartes">Écartés</option>
              <option value="tous">Tous</option>
            </select>
            <input className={`${input} w-40 sm:ml-auto`} placeholder="Chercher…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {toQualify.length > 0 && (
            <button onClick={() => void qualify(toQualify)} className="inline-flex items-center gap-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-2.5 py-1 text-xs font-medium" title="Qui décide, e-mail publié, LinkedIn s'il est trouvé. Quelques centimes la fiche.">
              <Sparkles className="w-3.5 h-3.5" /> {toQualify.length > 1 ? `Préparer ${toQualify.length} fiches` : 'Préparer 1 fiche'}
            </button>
          )}
        </div>
        <div className="divide-y divide-slate-100">
          {loaded && shown.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              {accounts.length === 0 ? 'Aucun compte pour l\'instant : lancez une recherche ci-dessus (ou laissez les recherches automatiques des Réglages travailler).' : 'Aucun compte ne correspond à ces filtres.'}
            </p>
          )}
          {shown.map((a) => {
            const seg = segmentOf(a.agent, a.segment);
            const p = details.get(a.id) ?? null;
            const cardOpen = open === a.id;
            return (
              <div key={a.id} className="px-4 py-3">
                <div className="flex items-start gap-x-3 gap-y-1.5 flex-wrap">
                  <div className="min-w-0 flex-1 basis-full sm:basis-0">
                    <p className="text-sm text-slate-900 flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold">{a.name}</span>
                      <span className="text-xs text-slate-500">{FLAG[a.country ?? ''] ?? ''} {[a.city, COUNTRY_FR[a.country ?? ''] ?? a.country].filter(Boolean).join(', ')}</span>
                      {seg && <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-slate-50 border border-slate-200 text-slate-600">{seg.label}</span>}
                      {p && <span className={`rounded border px-1.5 text-[11px] font-semibold tabular-nums ${scoreTone(p.score)}`}>{p.score ?? '—'}</span>}
                      {p && <span className="text-[11px] text-slate-500">{STAGE_LABEL[p.stage] ?? p.stage}</span>}
                      {p?.key_account && <span className="inline-flex items-center gap-0.5 text-[10px] rounded-full px-1.5 bg-violet-600 text-white"><Crown className="w-3 h-3" /> grand compte</span>}
                      {a.status === 'ecarte' && <span className="text-[11px] text-rose-700">écarté</span>}
                    </p>
                    {a.size_hint && <p className="text-xs text-slate-700 mt-0.5">{a.size_hint}</p>}
                    {a.why && <p className="text-xs text-slate-600 mt-0.5">{a.why}</p>}
                    <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                      <a href={a.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-ocean hover:underline"><ExternalLink className="w-3 h-3" />{hostOf(a.website)}</a>
                      {a.sources.length > 0 && <span>vu sur :</span>}
                      {a.sources.slice(0, 3).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline">{hostOf(u)}</a>)}
                      <span>· trouvé {fmtRelative(a.found_at)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    {p ? (
                      <button onClick={() => setOpen(cardOpen ? null : a.id)} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 ${cardOpen ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100'}`}>
                        <Sparkles className="w-3.5 h-3.5" /> Fiche {agent === 'ada' ? 'd\'Ada' : 'de Dana'}
                      </button>
                    ) : queued.has(a.id) ? (
                      <span className="text-violet-800 animate-pulse">fiche en cours…</span>
                    ) : a.status === 'nouveau' ? (
                      <button onClick={() => void qualify([a.id])} className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2 py-1 text-violet-800 hover:bg-violet-50" title="Qui décide, e-mail publié, LinkedIn s'il est trouvé">
                        <Sparkles className="w-3.5 h-3.5" /> Préparer la fiche
                      </button>
                    ) : null}
                    {a.status === 'nouveau' && !queued.has(a.id) && (
                      <button onClick={() => void status(a, 'ecarte')} className="inline-flex items-center gap-1 text-slate-400 hover:text-rose-700" title="Pas pour nous : pas de fiche"><Ban className="w-3.5 h-3.5" /> Écarter</button>
                    )}
                    {a.status === 'ecarte' && !p && (
                      <button onClick={() => void status(a, 'nouveau')} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"><Undo2 className="w-3.5 h-3.5" /> Remettre</button>
                    )}
                  </div>
                </div>
                {cardOpen && p && (
                  <QualifCard p={p} agentName={name as 'Ada' | 'Dana'} onStage={(st) => void changeStage(a, p, st)}
                    onRequalify={() => void qualify([a.id])} requalifying={queued.has(a.id)}
                    threadId={threads.get(p.id) ?? null} onDraft={() => void draft(a, p)} drafting={drafting.has(p.id)} onOpenThread={onOpenThread} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
