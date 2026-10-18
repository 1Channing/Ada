/**
 * Recherche — l'onglet Comptes renommé le 18/10 (Channing : « l'onglet
 * comptes je veux le nommer recherche » ; « je veux pouvoir lancer des
 * recherches sur plusieurs types… qu'elle travaille les uns après les
 * autres ») : tous les types cochés d'office, une tâche par type, traitées
 * l'une après l'autre ; la liste montre tous les comptes trouvés, avec ou
 * sans fiche. L'origine (17/10, étape 2 ; Channing : « les retours leasing, loueurs, les
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
import { Search, ExternalLink, Sparkles, Crown, X, Undo2, Ban, ChevronRight } from 'lucide-react';
import { CheckDropdown } from './shared';
import {
  listAccounts, accountProspects, listTasks, queueResearch, queueTargetedResearch, queueAccountQualification, setAccountStatus, queueFirstMails, setProspectStage, threadsOfProspects, cancelTask, queueDeepResearch,
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
  const [statusF, setStatusF] = useState<StatusFilter>('tous');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // Tous les types cochés d'office (18/10) : une recherche par type, l'une après l'autre.
  const [launch, setLaunch] = useState<{ segments: string[]; country: string; notes: string; limit: string }>(() => ({ segments: SEGMENTS[agent].map((x) => x.key), country: agent === 'ada' ? 'NL' : 'FR', notes: '', limit: '' }));
  // Des notes (18/10) : une recherche ciblée, sur Opus 5.5, avec une limite de dépense facultative.
  const targeted = launch.notes.trim().length > 0;
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
  const deeping = useMemo(() => new Set(tasks.filter((t) => t.kind === 'qualification' && t.params.approfondie && isOpen(t)).flatMap((t) => t.params.prospect_ids ?? [])), [tasks]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => (!segmentF || a.segment === segmentF) && (!countryF || a.country === countryF)
      && (statusF === 'tous' || (statusF === 'a_qualifier' ? a.status === 'nouveau' : statusF === 'qualifies' ? a.status === 'qualifie' : a.status === 'ecarte'))
      && (!q || `${a.name} ${a.city ?? ''} ${a.website}`.toLowerCase().includes(q)));
  }, [accounts, segmentF, countryF, statusF, query]);
  const countries = useMemo(() => [...new Set(accounts.map((a) => a.country).filter(Boolean) as string[])].sort(), [accounts]);
  const byStatus = useMemo(() => ({
    nouveau: accounts.filter((a) => a.status === 'nouveau').length, qualifie: accounts.filter((a) => a.status === 'qualifie').length, ecarte: accounts.filter((a) => a.status === 'ecarte').length,
  }), [accounts]);
  // Les prochains comptes à qualifier : 10 au plus.
  const toQualify = useMemo(() => shown.filter((a) => a.status === 'nouveau' && !queued.has(a.id)).slice(0, 10).map((a) => a.id), [shown, queued]);

  const start = async () => {
    const segs = SEGMENTS[agent].filter((x) => launch.segments.includes(x.key));
    if (!segs.length) return;
    const where = COUNTRY_FR[launch.country] ?? launch.country;
    if (targeted) {
      const limit = Number(launch.limit.replace(',', '.'));
      const e = await queueTargetedResearch(agent, { segments: segs.map((x) => x.key), country: launch.country, notes: launch.notes, limit: Number.isFinite(limit) && limit > 0 ? limit : null }, userId);
      if (e) { onError(e); return; }
      onInfo(`${name} lance la recherche ciblée en ${where}, avec vos notes : elle cherche, prépare les fiches et va plus loin sur ce qu'elle trouve (quelques minutes). Le bilan vous arrive par mail.`);
      setLaunch({ ...launch, notes: '', limit: '' });
      void load();
      return;
    }
    // Un même lancement : un seul bilan par mail, quand la dernière recherche est finie.
    const lot = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    for (const sg of segs) {
      const e = await queueResearch(agent, { segment: sg.key, country: launch.country, lot }, userId);
      if (e) { onError(e); void load(); return; }
    }
    onInfo(segs.length > 1
      ? `${name} cherche ${segs.length} types d'entreprises en ${where}, l'un après l'autre (une à deux minutes chacun) : ${segs.map((x) => x.label.toLowerCase()).join(', ')}. Ce qu'elle trouve arrive ici au fur et à mesure ; le bilan vous arrive par mail à la fin.`
      : `${name} cherche : ${segs[0].label.toLowerCase()}, ${where}. Les entreprises trouvées arrivent ici d'ici une à deux minutes ; le bilan vous arrive par mail.`);
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
  const deepen = async (p: ProspectDetail, note = '') => {
    const e = await queueDeepResearch([p.id], userId, agent, note);
    if (e) { onError(e); return; }
    onInfo(`${name} cherche plus loin pour ${p.name}${note.trim() ? ', avec votre consigne' : ''} : à qui elle appartient, qui décide, comment la joindre directement. Une à deux minutes.`);
    void load();
  };
  const segs = SEGMENTS[agent];

  return (
    <div className="space-y-4">
      {/* Lancer une recherche */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Search className="w-4 h-4 text-brand-ocean" />
          <h3 className="text-sm font-semibold text-slate-900">Lancer une recherche</h3>
          <span className="text-xs text-slate-500">— {name} cherche aussi toute seule, chaque jour de travail (le nombre se règle dans Réglages) ; ici, vous lancez tout de suite les recherches de votre choix. Sur le web, 4 recherches au plus par type (environ 0,05 $), et seules les entreprises au site officiel vérifié sont gardées.</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <CheckDropdown className="w-64 max-w-full" options={segs.map((sg) => ({ key: sg.key, label: sg.label, hint: `qui décide : ${sg.roles}` }))} selected={launch.segments}
            onChange={(segments) => setLaunch({ ...launch, segments })} allLabel={`Tous les types (${segs.length})`} emptyLabel="Aucun type coché" unit="types" />
          <select className={input} value={launch.country} onChange={(e) => setLaunch({ ...launch, country: e.target.value })}>
            {countriesOf(agent).map((c) => <option key={c} value={c}>{FLAG[c] ?? ''} {COUNTRY_FR[c] ?? c}</option>)}
          </select>
          <button disabled={launch.segments.length === 0} onClick={() => void start()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40">
            <Search className="w-4 h-4" /> {targeted ? 'Lancer la recherche ciblée' : launch.segments.length > 1 ? `Lancer ${launch.segments.length} recherches` : 'Lancer la recherche'}
          </button>
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-slate-500">Notes (facultatif) — une entreprise, un groupe, ce que vous cherchez exactement : la recherche devient ciblée</span>
          <textarea value={launch.notes} onChange={(e) => setLaunch({ ...launch, notes: e.target.value })} maxLength={2000} rows={2}
            placeholder={agent === 'dana' ? 'Ex. : le groupe Hess et ses concessions en Moselle — qui gère la revente des VO et le de-fleet, et comment le joindre directement ?' : 'Ex. : le groupe Van Mossel aux Pays-Bas — qui achète les VO récents pour ses concessions ?'}
            className={`${input} w-full min-h-[56px]`} />
        </label>
        {targeted && (
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-slate-600">Limite de dépense (facultatif) :</span>
            <input type="number" min={0} step={0.5} value={launch.limit} onChange={(e) => setLaunch({ ...launch, limit: e.target.value })} placeholder="ex. 2" className={`${input} w-24`} />
            <span className="text-slate-600">$</span>
          </div>
        )}
        <p className="text-[11px] text-slate-400">{targeted
          ? `Recherche ciblée sur Opus 5.5 : elle suit vos notes, prépare la fiche de ce qu'elle trouve (5 au plus) et va plus loin dessus (3 au plus), avec vos notes en consigne — environ 0,50 à 2 $. La limite est relue entre deux étapes ; le budget du jour ${agent === 'dana' ? 'de Dana' : 'd\'Ada'} reste le plafond. Le bilan vous arrive par mail, avec ce qui reste à faire si elle s'arrête faute de budget.`
          : launch.segments.length > 1 ? `Une recherche par type coché, l'une après l'autre : environ ${(launch.segments.length * 0.05).toFixed(2).replace('.', ',')} $ en tout. Le bilan vous arrive par mail à la fin.` : (() => {
            const sg = segmentOf(agent, launch.segments[0]);
            return sg ? `${sg.who.charAt(0).toUpperCase()}${sg.who.slice(1)} — chez eux, qui décide : ${sg.roles}. Le bilan vous arrive par mail.` : 'Cochez au moins un type d\'entreprise.';
          })()}</p>
        {research.length > 0 && (
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {research.slice(0, 6).map((t) => {
              const seg = segmentOf(t.agent, t.params.segment);
              return (
                <div key={t.id} className="flex items-center gap-2 py-1.5 text-xs flex-wrap">
                  <span className={`rounded-full px-2 py-0.5 ${TASK_STATUS[t.status].cls}`}>{TASK_STATUS[t.status].label}</span>
                  <span className="font-medium text-slate-800">{t.params.notes ? 'Recherche ciblée' : seg?.label ?? t.params.segment} · {FLAG[t.params.country ?? ''] ?? ''} {COUNTRY_FR[t.params.country ?? ''] ?? t.params.country}{t.params.auto ? ' (automatique)' : ''}</span>
                  {t.params.notes && <span className="text-slate-500 truncate max-w-[22rem]" title={t.params.notes}>« {t.params.notes} »</span>}
                  {t.status === 'terminee' && t.result && (
                    <span className="text-slate-600">{t.result.gardes ?? 0} trouvé{(t.result.gardes ?? 0) > 1 ? 's' : ''}{t.result.deja ? `, ${t.result.deja} déjà connu${t.result.deja > 1 ? 's' : ''}` : ''}{t.result.ecartes ? `, ${t.result.ecartes} écarté${t.result.ecartes > 1 ? 's' : ''}` : ''}{t.result.ciblee ? `, ${t.result.fiches ?? 0} fiche${(t.result.fiches ?? 0) > 1 ? 's' : ''}, ${t.result.approfondies ?? 0} approfondie${(t.result.approfondies ?? 0) > 1 ? 's' : ''}` : ''} · {fmtUsd(t.result.cout_usd ?? 0)}{t.result.limite_usd ? ` (limite ${fmtUsd(t.result.limite_usd)})` : ''}{t.result.arret ? ` — arrêtée : ${t.result.arret}` : ''}</span>
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
            <h3 className="text-sm font-semibold text-slate-900">Entreprises trouvées</h3>
            <span className="text-xs text-slate-500">— chacune vue dans les résultats de recherche (site officiel), jamais devinée.</span>
            <span className="ml-auto text-xs text-slate-400">{shown.length} sur {accounts.length}</span>
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
              <option value="tous">Tous ({accounts.length})</option>
              <option value="a_qualifier">Sans fiche ({byStatus.nouveau})</option>
              <option value="qualifies">Avec fiche ({byStatus.qualifie})</option>
              <option value="ecartes">Écartés ({byStatus.ecarte})</option>
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
            <div className="px-4 py-10 text-center text-sm text-slate-400 space-y-2">
              <p>{accounts.length === 0
                ? 'Aucune entreprise trouvée pour l\'instant : lancez une recherche ci-dessus (ou laissez les recherches automatiques des Réglages travailler).'
                : statusF === 'a_qualifier' && byStatus.nouveau === 0
                  ? `Aucune entreprise sans fiche : ${name} a déjà préparé la fiche des ${byStatus.qualifie} entreprise${byStatus.qualifie > 1 ? 's' : ''} trouvée${byStatus.qualifie > 1 ? 's' : ''}.`
                  : 'Aucune entreprise ne correspond à ces filtres.'}</p>
              {accounts.length > 0 && (statusF !== 'tous' || segmentF || countryF || query) && (
                <button onClick={() => { setStatusF('tous'); setSegmentF(''); setCountryF(''); setQuery(''); }} className="text-brand-ocean hover:underline">Voir les {accounts.length} entreprises trouvées</button>
              )}
            </div>
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
                      <button onClick={() => setOpen(cardOpen ? null : a.id)} aria-expanded={cardOpen} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium ${cardOpen ? 'bg-violet-100 text-violet-900' : 'text-violet-800 hover:bg-violet-50'}`}>
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${cardOpen ? 'rotate-90' : ''}`} /> Fiche complète
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
                    threadId={threads.get(p.id) ?? null} onDraft={() => void draft(a, p)} drafting={drafting.has(p.id)} onOpenThread={onOpenThread}
                    onDeep={(note) => void deepen(p, note)} deeping={deeping.has(p.id)} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
