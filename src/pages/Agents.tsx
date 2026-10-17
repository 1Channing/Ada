import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, Inbox, CheckCircle2, ScrollText, Settings2, RefreshCw, Building2, Layers, Briefcase } from 'lucide-react';
import { useAuth } from '../services/auth';
import { canSeeTab } from '../lib/appTabs';
import {
  listSettings, countsFor, listJournal, aiSpend, threadAgent, AGENT_LABEL,
  type AgentKey, type AgentSettings, type AgentCounts, type JournalRow, type AiSpend,
} from '../services/agents';
import { fmtUsd } from '../lib/agents/aiCost';
import { listAssignees } from '../services/userTasks';
import { parisDayStart } from '../lib/agents/sendPolicy';
import { Banner } from '../components/agents/shared';
import { fmtDateTime, fmtRelative } from '../components/agents/helpers';
import { Messagerie } from '../components/agents/Messagerie';
import { ValidationQueue } from '../components/agents/ValidationQueue';
import { Reglages } from '../components/agents/Reglages';
import { Prospects } from '../components/agents/Prospects';
import { Sourcing } from '../components/agents/Sourcing';
import { Comptes } from '../components/agents/Comptes';

/**
 * AGENTS — Ada et Dana (16/10, Channing : « deux agents qui travaillent en
 * continu, l'un en prospection sourcing, l'autre en prospection de vente…
 * je veux tout leur travail dans un onglet dédié, afin que je puisse
 * driver »). Ada (ada@mc-export.com) trouve des acheteurs, Dana
 * (dana@mc-export.com) des fournisseurs.
 *
 * Une agente à la fois (17/10, Channing : « un switch entre l'une ou
 * l'autre en haut, propre et épuré… chacune leurs propres comptes de
 * recherches et fonctions ») : le sélecteur en haut choisit l'agente, et la
 * page ne montre que ses chiffres et ses fonctions — sa Messagerie, ses
 * Acheteurs (Ada : l'annuaire des concessions hors de France) ou son
 * Sourcing (Dana : les lots de véhicules identiques), ses Comptes (ses types
 * de comptes, trouvés par recherche web), ce qui l'attend À valider, son
 * Journal, ses Réglages. Rien ne part sans un clic d'administrateur.
 */

type Tab = 'messagerie' | 'valider' | 'prospects' | 'sourcing' | 'comptes' | 'journal' | 'reglages';
const TAB: Record<Tab, { label: string; icon: ReactNode }> = {
  messagerie: { label: 'Messagerie', icon: <Inbox className="w-4 h-4" /> },
  prospects: { label: 'Acheteurs', icon: <Building2 className="w-4 h-4" /> },
  sourcing: { label: 'Sourcing', icon: <Layers className="w-4 h-4" /> },
  comptes: { label: 'Comptes', icon: <Briefcase className="w-4 h-4" /> },
  valider: { label: 'À valider', icon: <CheckCircle2 className="w-4 h-4" /> },
  journal: { label: 'Journal', icon: <ScrollText className="w-4 h-4" /> },
  reglages: { label: 'Réglages', icon: <Settings2 className="w-4 h-4" /> },
};
/** Les fonctions de chacune : Ada vend (l'annuaire des acheteurs), Dana achète (le sourcing des lots). */
const TABS_OF: Record<AgentKey, Tab[]> = {
  ada: ['messagerie', 'prospects', 'comptes', 'valider', 'journal', 'reglages'],
  dana: ['messagerie', 'sourcing', 'comptes', 'valider', 'journal', 'reglages'],
};
const SIDE: Record<AgentKey, string> = { ada: 'acheteurs', dana: 'fournisseurs' };
/** L'onglet d'une agente vu depuis l'autre (Acheteurs ↔ Sourcing). */
const tabFor = (agent: AgentKey, t: Tab): Tab => (TABS_OF[agent].includes(t) ? t : agent === 'ada' ? 'prospects' : 'sourcing');

const AGENT_STORE = 'ada.agents.agente';
function initialAgent(params: URLSearchParams): AgentKey {
  const a = params.get('agente');
  if (a === 'ada' || a === 'dana') return a;
  try { const s = window.localStorage.getItem(AGENT_STORE); if (s === 'ada' || s === 'dana') return s; } catch { /* stockage indisponible */ }
  return 'ada';
}

const CONNEXION: Record<string, { tone: 'ok' | 'warn' | 'err'; text: (mailbox: string) => string }> = {
  ok: { tone: 'ok', text: (b) => `Boîte ${b} connectée : les nouveaux mails arrivent dans la Messagerie d'ici deux minutes (les anciens restent dans Gmail).` },
  refusee: { tone: 'warn', text: () => 'Connexion annulée sur l\'écran Google.' },
  expiree: { tone: 'warn', text: () => 'Lien de connexion expiré : recommencez depuis Réglages.' },
  'mauvaise-boite': { tone: 'err', text: (b) => `Ce n'est pas la bonne boîte : sur l'écran Google, connectez-vous avec ${b}.` },
  'sans-jeton': { tone: 'err', text: () => 'Google n\'a pas donné d\'accès durable : recommencez (l\'écran doit demander votre accord).' },
  droits: { tone: 'err', text: () => 'L\'accès à Gmail n\'a pas été accordé : recommencez et cochez l\'accès à Gmail.' },
  erreur: { tone: 'err', text: () => 'La connexion a échoué côté worker : réessayez ; si ça persiste, voir le Journal.' },
};

export function Agents() {
  const { isAdmin, userId, allowedTabs } = useAuth();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [agent, setAgent] = useState<AgentKey>(() => initialAgent(params));
  const [tab, setTab] = useState<Tab>(() => {
    const o = params.get('onglet') as Tab | null;
    return o && o in TAB ? tabFor(initialAgent(params), o) : 'messagerie';
  });
  const [openThread, setOpenThread] = useState<string | null>(params.get('fil'));
  const [settings, setSettings] = useState<AgentSettings[]>([]);
  const [counts, setCounts] = useState<Partial<Record<AgentKey, AgentCounts>>>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [spend, setSpend] = useState<AiSpend | null>(null);

  const load = useCallback(async () => {
    const r = await listSettings();
    if (r.error) { setError(r.error); return; }
    setSettings(r.rows);
    const day = parisDayStart(new Date()).toISOString();
    const entries = await Promise.all(r.rows.map(async (s) => [s.agent, await countsFor(s.agent, day)] as const));
    setCounts(Object.fromEntries(entries));
    setSpend(await aiSpend());
  }, []);
  const refresh = useCallback(() => { void load(); setRefreshKey((k) => k + 1); }, [load]);
  const onError = useCallback((m: string) => setError(m), []);
  const onInfo = useCallback((t: string) => setInfo({ tone: 'ok', text: t }), []);
  const switchTo = (k: AgentKey) => {
    if (k === agent) return;
    setAgent(k);
    setTab((t) => tabFor(k, t));
    setOpenThread(null);
    setJournal([]);
    try { window.localStorage.setItem(AGENT_STORE, k); } catch { /* stockage indisponible */ }
  };

  // Retour de l'écran Google (?connexion=…&agente=…) : un bandeau, puis l'adresse est nettoyée.
  useEffect(() => {
    const c = params.get('connexion');
    if (c && CONNEXION[c]) {
      const a = (params.get('agente') ?? '') as AgentKey;
      const mailbox = a === 'ada' || a === 'dana' ? `${a}@mc-export.com` : 'la boîte';
      setInfo({ tone: CONNEXION[c].tone, text: CONNEXION[c].text(mailbox) });
    }
    if (c || params.get('fil') || params.get('onglet') || params.get('agente')) window.history.replaceState({}, '', '/agents');
    // Un lien d'alerte plus ancien (« /agents?fil=… », sans l'agente) : le fil s'ouvre chez la bonne.
    const fil = params.get('fil');
    if (fil && !params.get('agente')) {
      void threadAgent(fil).then((a) => {
        if (!a) return;
        setAgent(a);
        try { window.localStorage.setItem(AGENT_STORE, a); } catch { /* stockage indisponible */ }
      });
    }
  }, [params]);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => refresh(), 30_000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [load, refresh]);
  useEffect(() => {
    if (tab !== 'journal') return;
    void listJournal(agent).then((r) => (r.error ? setError(r.error) : setJournal(r.rows)));
    if (Object.keys(names).length === 0) void listAssignees().then((p) => setNames(Object.fromEntries(p.map((x) => [x.id, x.name]))));
  }, [tab, agent, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFromQueue = (id: string) => { setOpenThread(id); setTab('messagerie'); };
  const s = settings.find((x) => x.agent === agent);
  const c = counts[agent];
  const pendingOf = (k: AgentKey) => (counts[k]?.aValider ?? 0) + (counts[k]?.pourVous ?? 0);
  const canEditMap = canSeeTab(allowedTabs, isAdmin, 'carte:edition');

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2"><Bot className="w-7 h-7 text-brand-ocean" /> Agents</h1>
        <div role="tablist" aria-label="Agente" className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:ml-4">
          {(['ada', 'dana'] as AgentKey[]).map((k) => {
            const on = agent === k;
            const waiting = pendingOf(k);
            return (
              <button key={k} role="tab" aria-selected={on} onClick={() => switchTo(k)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${on ? (k === 'ada' ? 'bg-indigo-600 text-white' : 'bg-teal-600 text-white') : 'text-slate-600 hover:bg-slate-50'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${on ? 'bg-white/20 text-white' : k === 'ada' ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'}`}>{AGENT_LABEL[k].name[0]}</span>
                {AGENT_LABEL[k].name}
                <span className={`hidden sm:inline text-xs font-normal ${on ? 'text-white/80' : 'text-slate-400'}`}>{SIDE[k]}</span>
                {!on && waiting > 0 && <span className="rounded-full bg-amber-500 text-white text-[10px] px-1.5" title="À valider ou préparé pour vous">{waiting}</span>}
              </button>
            );
          })}
        </div>
        <button onClick={refresh} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          <RefreshCw className="w-4 h-4" /> Actualiser
        </button>
      </div>

      {info && <Banner tone={info.tone} onClose={() => setInfo(null)}>{info.text}</Banner>}
      {error && <Banner tone="err" onClose={() => setError(null)}>{error}</Banner>}

      {/* L'agente choisie : sa boîte, sa dépense, ses chiffres du jour */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-center gap-x-6 gap-y-3 flex-wrap">
        <div className="min-w-0 flex-1 basis-full md:basis-0">
          <p className="text-sm text-slate-600 truncate">{s?.mailbox ?? `${agent}@mc-export.com`}</p>
          <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
            {s?.gmail_connected_email
              ? <span className="rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5">boîte connectée · relevée {fmtRelative(s.last_sync_at)}</span>
              : <button onClick={() => setTab('reglages')} className="rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 hover:bg-amber-100">boîte pas encore connectée</button>}
            {spend
              ? <span className="rounded-full bg-violet-50 text-violet-800 border border-violet-200 px-2 py-0.5" title="Dépense IA (Claude), heure de Paris">IA : {fmtUsd(spend[agent]?.today ?? 0)} auj. · {fmtUsd(spend[agent]?.month ?? 0)} ce mois{s?.daily_budget_usd !== undefined ? ` · plafond ${Number(s.daily_budget_usd)} $/j` : ''}</span>
              : <span className="rounded-full bg-slate-50 text-slate-500 border border-slate-200 px-2 py-0.5">IA : SQL du 17/10 à coller</span>}
            {(c?.pourVous ?? 0) > 0 && <button onClick={() => setTab('valider')} className="rounded-full bg-violet-600 text-white px-2 py-0.5 hover:bg-violet-700">{c?.pourVous} grand{(c?.pourVous ?? 0) > 1 ? 's' : ''} compte{(c?.pourVous ?? 0) > 1 ? 's' : ''} pour vous</button>}
            {(c?.echecs ?? 0) > 0 && <button onClick={() => setTab('valider')} className="rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 hover:bg-red-100">{c?.echecs} envoi{(c?.echecs ?? 0) > 1 ? 's' : ''} en échec</button>}
          </div>
          {s?.last_sync_error && <p className="mt-1 text-[11px] text-red-700">{s.last_sync_error}</p>}
        </div>
        <div className="grid grid-cols-4 gap-2 text-center w-full md:w-auto">
          {[
            { n: c?.aValider ?? 0, l: 'à valider', sub: '', hot: (c?.aValider ?? 0) > 0, go: () => setTab('valider') },
            { n: c?.nonLus ?? 0, l: 'non lus', sub: '', hot: (c?.nonLus ?? 0) > 0, go: () => setTab('messagerie') },
            { n: c?.recusAujourdhui ?? 0, l: 'reçus auj.', sub: '', hot: false, go: () => setTab('messagerie') },
            { n: c?.envoyesAujourdhui ?? 0, l: 'envoyés auj.', sub: s ? `1ers contacts ${c?.premiersContactsAujourdhui ?? 0}/${s.daily_first_contact_cap}` : '', hot: false, go: () => setTab('journal') },
          ].map((x) => (
            <button key={x.l} onClick={x.go} className={`md:w-28 rounded-xl border px-1.5 py-2 ${x.hot ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50/60'} hover:border-brand-ocean`}>
              <p className="text-xl font-bold text-slate-900 tabular-nums">{x.n}</p>
              <p className="text-[10px] leading-tight text-slate-500">{x.l}</p>
              {x.sub && <p className="text-[9px] leading-tight text-slate-400 mt-0.5">{x.sub}</p>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS_OF[agent].map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-brand-ocean text-brand-encre' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {TAB[k].icon} {TAB[k].label}
            {k === 'valider' && pendingOf(agent) > 0 && <span className="ml-1 rounded-full bg-amber-500 text-white text-[10px] px-1.5">{pendingOf(agent)}</span>}
          </button>
        ))}
      </div>

      {tab === 'messagerie' && (
        <Messagerie key={agent} agent={agent} settings={settings} counts={counts} isAdmin={isAdmin} userId={userId} openThreadId={openThread} refreshKey={refreshKey} onChanged={() => void load()} onError={onError} />
      )}
      {tab === 'valider' && (
        <ValidationQueue key={agent} agent={agent} settings={settings} counts={counts} isAdmin={isAdmin} refreshKey={refreshKey} onOpenThread={openFromQueue} onChanged={() => void load()} onError={onError} />
      )}
      {tab === 'prospects' && agent === 'ada' && (
        <Prospects userId={userId} canEditMap={canEditMap} refreshKey={refreshKey} onError={onError} onInfo={onInfo} onOpenThread={openFromQueue} />
      )}
      {tab === 'sourcing' && agent === 'dana' && (
        <Sourcing userId={userId} canEditMap={canEditMap} refreshKey={refreshKey} onError={onError} onInfo={onInfo} onOpenThread={openFromQueue} />
      )}
      {tab === 'comptes' && (
        <Comptes key={agent} agent={agent} userId={userId} refreshKey={refreshKey} onError={onError} onInfo={onInfo} onOpenThread={openFromQueue} />
      )}
      {tab === 'journal' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className="flex items-center px-4 py-2.5 border-b border-slate-100">
            <span className="ml-auto text-xs text-slate-400">{journal.length} entrée{journal.length > 1 ? 's' : ''} (200 dernières)</span>
          </div>
          <div className="divide-y divide-slate-100">
            {journal.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">Rien encore : connexions de la boîte, mails reçus, recherches, validations et envois s'inscrivent ici.</p>}
            {journal.map((j) => (
              <div key={j.id} className="px-4 py-2 flex items-start gap-3 text-sm">
                <span className="shrink-0 w-24 text-xs text-slate-400 tabular-nums">{fmtDateTime(j.at)}</span>
                <span className="shrink-0 w-28 text-xs text-slate-500 truncate">{j.actor === 'humain' ? (j.actor_id ? names[j.actor_id] ?? 'équipe' : 'équipe') : j.actor === 'systeme' ? 'ADA (automatique)' : AGENT_LABEL[j.actor as AgentKey]?.name ?? j.actor}</span>
                <span className="min-w-0 flex-1 text-slate-800">{j.summary}</span>
                {j.thread_id && <button onClick={() => openFromQueue(j.thread_id!)} className="shrink-0 text-xs text-brand-ocean hover:underline">fil</button>}
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'reglages' && (
        <Reglages agent={agent} settings={settings} isAdmin={isAdmin} userId={userId} refreshKey={refreshKey} spend={spend} onChanged={() => void load()} onError={onError} onInfo={onInfo} />
      )}
    </div>
  );
}
