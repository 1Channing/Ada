import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, Inbox, CheckCircle2, ScrollText, Settings2, RefreshCw, Building2, Layers } from 'lucide-react';
import { useAuth } from '../services/auth';
import { canSeeTab } from '../lib/appTabs';
import {
  listSettings, countsFor, listJournal, aiSpend, AGENT_LABEL,
  type AgentKey, type AgentSettings, type AgentCounts, type JournalRow, type AiSpend,
} from '../services/agents';
import { fmtUsd } from '../lib/agents/aiCost';
import { listAssignees } from '../services/userTasks';
import { parisDayStart } from '../lib/agents/sendPolicy';
import { AgentBadge, Banner } from '../components/agents/shared';
import { fmtDateTime, fmtRelative } from '../components/agents/helpers';
import { Messagerie } from '../components/agents/Messagerie';
import { ValidationQueue } from '../components/agents/ValidationQueue';
import { Reglages } from '../components/agents/Reglages';
import { Prospects } from '../components/agents/Prospects';
import { Sourcing } from '../components/agents/Sourcing';

/**
 * AGENTS — Ada et Dana (16/10, Channing : « deux agents qui travaillent en
 * continu, l'un en prospection sourcing, l'autre en prospection de vente…
 * je veux tout leur travail dans un onglet dédié, afin que je puisse
 * driver »). Ada (ada@mc-export.com) trouve des acheteurs, Dana
 * (dana@mc-export.com) des vendeurs.
 *
 * Phase 1 = zéro IA : leurs boîtes branchées sur ADA. Messagerie (fils,
 * pièces jointes, réponses), À valider (rien ne part sans un clic
 * d'administrateur), Journal (tout ce qui s'est passé), Réglages (connexion
 * Gmail, signature, rythme anti-spam, « ne plus contacter »).
 * Phase 2 (17/10) : Prospects — l'annuaire des concessions qui vendent ce
 * que nous vendons, plus cher, hors de France (Ada vend à l'export) ; Ada
 * les qualifie (Haiku 5.5) dans un budget par jour, et met les meilleurs sur
 * la carte. Sourcing — les lots de véhicules identiques que Dana repère
 * chez les garages de toute l'Europe.
 */

type Tab = 'messagerie' | 'valider' | 'prospects' | 'sourcing' | 'journal' | 'reglages';
const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'messagerie', label: 'Messagerie', icon: <Inbox className="w-4 h-4" /> },
  { key: 'prospects', label: 'Acheteurs (Ada)', icon: <Building2 className="w-4 h-4" /> },
  { key: 'sourcing', label: 'Sourcing (Dana)', icon: <Layers className="w-4 h-4" /> },
  { key: 'valider', label: 'À valider', icon: <CheckCircle2 className="w-4 h-4" /> },
  { key: 'journal', label: 'Journal', icon: <ScrollText className="w-4 h-4" /> },
  { key: 'reglages', label: 'Réglages', icon: <Settings2 className="w-4 h-4" /> },
];

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
  const [tab, setTab] = useState<Tab>(() => {
    const o = params.get('onglet');
    return TABS.some((t) => t.key === o) ? (o as Tab) : 'messagerie';
  });
  const [openThread, setOpenThread] = useState<string | null>(params.get('fil'));
  const [settings, setSettings] = useState<AgentSettings[]>([]);
  const [counts, setCounts] = useState<Partial<Record<AgentKey, AgentCounts>>>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [journalAgent, setJournalAgent] = useState<AgentKey | null>(null);
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

  // Retour de l'écran Google (?connexion=…&agente=…) : un bandeau, puis l'adresse est nettoyée.
  useEffect(() => {
    const c = params.get('connexion');
    if (c && CONNEXION[c]) {
      const agent = (params.get('agente') ?? '') as AgentKey;
      const mailbox = agent === 'ada' || agent === 'dana' ? `${agent}@mc-export.com` : 'la boîte';
      setInfo({ tone: CONNEXION[c].tone, text: CONNEXION[c].text(mailbox) });
    }
    if (c || params.get('fil') || params.get('onglet')) window.history.replaceState({}, '', '/agents');
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
    void listJournal(journalAgent).then((r) => (r.error ? setError(r.error) : setJournal(r.rows)));
    if (Object.keys(names).length === 0) void listAssignees().then((p) => setNames(Object.fromEntries(p.map((x) => [x.id, x.name]))));
  }, [tab, journalAgent, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFromQueue = (id: string) => { setOpenThread(id); setTab('messagerie'); };
  const pending = (counts.ada?.aValider ?? 0) + (counts.dana?.aValider ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2"><Bot className="w-7 h-7 text-brand-ocean" /> Agents</h1>
          <p className="text-slate-600 mt-2 max-w-3xl">
            Ada trouve des acheteurs à l'export, Dana des fournisseurs dans toute l'Europe, chacune depuis sa propre boîte : des relations durables, pas des affaires à l'unité.
            Rien ne part sans validation : vous écrivez ou relisez, un administrateur valide, ADA envoie aux horaires de bureau.
          </p>
        </div>
        <button onClick={refresh} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          <RefreshCw className="w-4 h-4" /> Actualiser
        </button>
      </div>

      {info && <Banner tone={info.tone} onClose={() => setInfo(null)}>{info.text}</Banner>}
      {error && <Banner tone="err" onClose={() => setError(null)}>{error}</Banner>}

      <div className="grid md:grid-cols-2 gap-4">
        {(['ada', 'dana'] as AgentKey[]).map((k) => {
          const s = settings.find((x) => x.agent === k);
          const c = counts[k];
          const l = AGENT_LABEL[k];
          return (
            <div key={k} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
              <div className="flex items-start gap-3">
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold text-white ${k === 'ada' ? 'bg-indigo-500' : 'bg-teal-500'}`}>{l.name[0]}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-semibold text-slate-900">{l.name}</span>
                    <span className="text-sm text-slate-500">{l.role}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{s?.mailbox ?? `${k}@mc-export.com`}</p>
                  <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
                    {s?.gmail_connected_email
                      ? <span className="rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5">boîte connectée · relevée {fmtRelative(s.last_sync_at)}</span>
                      : <button onClick={() => setTab('reglages')} className="rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 hover:bg-amber-100">boîte pas encore connectée</button>}
                    {k === 'ada' && spend
                      ? <span className="rounded-full bg-violet-50 text-violet-800 border border-violet-200 px-2 py-0.5" title="Dépense IA (Claude), heure de Paris">IA : {fmtUsd(spend.ada?.today ?? 0)} auj. · {fmtUsd(spend.ada?.month ?? 0)} ce mois{s?.daily_budget_usd !== undefined ? ` · plafond ${Number(s.daily_budget_usd)} $/j` : ''}</span>
                      : <span className="rounded-full bg-slate-50 text-slate-500 border border-slate-200 px-2 py-0.5">IA : {k === 'ada' ? 'SQL du 17/10 à coller' : 'phase 3'}</span>}
                  </div>
                  {s?.last_sync_error && <p className="mt-1 text-[11px] text-red-700">{s.last_sync_error}</p>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[
                  { n: c?.aValider ?? 0, l: 'à valider', sub: '', hot: (c?.aValider ?? 0) > 0, go: () => setTab('valider') },
                  { n: c?.nonLus ?? 0, l: 'non lus', sub: '', hot: (c?.nonLus ?? 0) > 0, go: () => setTab('messagerie') },
                  { n: c?.recusAujourdhui ?? 0, l: 'reçus auj.', sub: '', hot: false, go: () => setTab('messagerie') },
                  { n: c?.envoyesAujourdhui ?? 0, l: 'envoyés auj.', sub: s ? `1ers contacts ${c?.premiersContactsAujourdhui ?? 0}/${s.daily_first_contact_cap}` : '', hot: false, go: () => setTab('journal') },
                ].map((x) => (
                  <button key={x.l} onClick={x.go} className={`rounded-xl border px-1.5 py-2 ${x.hot ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50/60'} hover:border-brand-ocean`}>
                    <p className="text-xl font-bold text-slate-900 tabular-nums">{x.n}</p>
                    <p className="text-[10px] leading-tight text-slate-500">{x.l}</p>
                    {x.sub && <p className="text-[9px] leading-tight text-slate-400 mt-0.5">{x.sub}</p>}
                  </button>
                ))}
              </div>
              {(c?.echecs ?? 0) > 0 && <button onClick={() => setTab('valider')} className="mt-2 text-xs text-red-700 hover:underline">{c?.echecs} envoi(s) en échec à reprendre</button>}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.key ? 'border-brand-ocean text-brand-encre' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t.icon} {t.label}
            {t.key === 'valider' && pending > 0 && <span className="ml-1 rounded-full bg-amber-500 text-white text-[10px] px-1.5">{pending}</span>}
          </button>
        ))}
      </div>

      {tab === 'messagerie' && (
        <Messagerie settings={settings} counts={counts} isAdmin={isAdmin} userId={userId} openThreadId={openThread} refreshKey={refreshKey} onChanged={() => void load()} onError={onError} />
      )}
      {tab === 'valider' && (
        <ValidationQueue settings={settings} counts={counts} isAdmin={isAdmin} refreshKey={refreshKey} onOpenThread={openFromQueue} onChanged={() => void load()} onError={onError} />
      )}
      {tab === 'prospects' && (
        <Prospects userId={userId} canEditMap={canSeeTab(allowedTabs, isAdmin, 'carte:edition')} refreshKey={refreshKey} onError={onError} onInfo={onInfo} onOpenThread={openFromQueue} />
      )}
      {tab === 'sourcing' && (
        <Sourcing userId={userId} canEditMap={canSeeTab(allowedTabs, isAdmin, 'carte:edition')} refreshKey={refreshKey} onError={onError} onInfo={onInfo} />
      )}
      {tab === 'journal' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-slate-100">
            {([null, 'ada', 'dana'] as Array<AgentKey | null>).map((k) => (
              <button key={k ?? 'all'} onClick={() => setJournalAgent(k)} className={`rounded-full border px-2.5 py-0.5 text-xs ${journalAgent === k ? 'border-brand-ocean bg-blue-50 text-brand-encre' : 'border-slate-200 text-slate-600'}`}>{k ? AGENT_LABEL[k].name : 'Tout'}</button>
            ))}
            <span className="ml-auto text-xs text-slate-400">{journal.length} entrée{journal.length > 1 ? 's' : ''} (200 dernières)</span>
          </div>
          <div className="divide-y divide-slate-100">
            {journal.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">Rien encore : connexions de boîtes, mails reçus, validations et envois s'inscrivent ici.</p>}
            {journal.map((j) => (
              <div key={j.id} className="px-4 py-2 flex items-start gap-3 text-sm">
                <span className="shrink-0 w-24 text-xs text-slate-400 tabular-nums">{fmtDateTime(j.at)}</span>
                <span className="shrink-0 w-14"><AgentBadge agent={j.agent} small /></span>
                <span className="shrink-0 w-28 text-xs text-slate-500 truncate">{j.actor === 'humain' ? (j.actor_id ? names[j.actor_id] ?? 'équipe' : 'équipe') : j.actor === 'systeme' ? 'ADA (automatique)' : AGENT_LABEL[j.actor as AgentKey]?.name ?? j.actor}</span>
                <span className="min-w-0 flex-1 text-slate-800">{j.summary}</span>
                {j.thread_id && <button onClick={() => openFromQueue(j.thread_id!)} className="shrink-0 text-xs text-brand-ocean hover:underline">fil</button>}
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'reglages' && (
        <Reglages settings={settings} isAdmin={isAdmin} userId={userId} refreshKey={refreshKey} spend={spend} onChanged={() => void load()} onError={onError} onInfo={onInfo} />
      )}
    </div>
  );
}
