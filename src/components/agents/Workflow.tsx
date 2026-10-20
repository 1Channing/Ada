/**
 * « Workflow » (20/10, Channing : « à valider devient Workflow. 3 catégories, ne s'affiche que la catégorie
 * cliquée : 1. Discussions en cours — les fiches des groupes contactés par e-mail ou LinkedIn (on peut
 * ajouter des notes, modifier les fiches…), mises ici dès qu'un mail est envoyé ou qu'on l'y met ;
 * 2. Fiches — les fiches complètes ; 3. Brouillons — les fiches à compléter, où l'on sélectionne les
 * entreprises qui nous intéressent. Pour les deux agentes : optimiser, éviter les doublons d'affichage,
 * connecter la messagerie au reste »). Une entreprise = une carte, dans une seule catégorie
 * (src/lib/agents/workflow.ts) ; ce qui était « À valider » vit dans sa carte :
 * - Discussions en cours (./Discussion.tsx) : l'étape, le dernier échange, une réponse non lue ; les notes
 *   de l'équipe, ce qui attend (réponse à valider, note LinkedIn, échec d'envoi), les échanges, la fiche ;
 *   les mails à valider sans fiche, à part ;
 * - Fiches : le plan préparé (./ForYou.tsx — 18/10 : « Envoyer » fait partir le mail de la boîte de
 *   l'agente ; 19/10 : « Envoyer les aiguillages » d'un coup), le premier mail d'un petit compte, puis les
 *   fiches complètes à préparer ;
 * - Brouillons (./ToComplete.tsx — 18/10 : ce qui manque, la recherche approfondie, « Préparer quand
 *   même » ; 20/10 : « Mettre de côté »), et les fiches mises de côté.
 * Pendant le copilote, rien ne part sans un clic d'administrateur.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MessagesSquare, Contact, FilePenLine, Send, AlertTriangle, ChevronRight, MessageCircle } from 'lucide-react';
import {
  listWorkflow, prospectWork, setAsideProspects, restoreProspect, setProspectNotes, startDiscussion, queueDeepResearch, queueFirstMails, queueRedoPlan, queueQualification, queueAccountQualification, setProspectStage, sendFromAgent,
  AGENT_LABEL, type AgentKey, type AgentSettings, type AgentCounts, type ForYouMessage, type ProspectDetail, type ProspectStage, type WorkflowData,
} from '../../services/agents';
import { buildWorkflow, WF_COLUMNS, WF_LABEL, type WfColumn, type WfCard } from '../../lib/agents/workflow';
import { emailDomain } from '../../lib/agents/people';
import { MessageCard } from './MessageCard';
import { ForYouCard } from './ForYou';
import { ToComplete, SetAsideList, AsideAsk } from './ToComplete';
import { DiscussionCard } from './Discussion';

const VIEW_STORE = 'ada.agents.workflow';
const ICON: Record<WfColumn, ReactNode> = {
  discussions: <MessagesSquare className="w-4 h-4" />, fiches: <Contact className="w-4 h-4" />, brouillons: <FilePenLine className="w-4 h-4" />,
};
const HINT: Record<WfColumn, string> = {
  discussions: 'Les entreprises contactées (mail ou LinkedIn) : où en est l\'échange, vos notes, ce qui attend. Une fiche arrive ici dès qu\'un mail part — de la boîte de l\'agente ou de la Messagerie.',
  fiches: 'Les fiches complètes : le plan préparé à valider (« Envoyer » le fait partir de la boîte de l\'agente), ou prêtes à préparer.',
  brouillons: 'Les fiches à compléter : choisissez celles qui vous intéressent (recherche approfondie, préparer) ; mettez de côté les autres — plus aucun crédit dépensé dessus.',
};
type Card = WfCard<ProspectDetail, ForYouMessage>;

function storedView(): WfColumn | null {
  try { const v = window.localStorage.getItem(VIEW_STORE); return v === 'discussions' || v === 'fiches' || v === 'brouillons' ? v : null; } catch { return null; }
}

interface Props {
  agent: AgentKey;
  settings: AgentSettings[];
  counts: Partial<Record<AgentKey, AgentCounts>>;
  isAdmin: boolean;
  userId: string | null;
  refreshKey: number;
  /** La catégorie demandée par la page (une pastille « pour vous » ouvre les fiches ; chaque clic compte). */
  view?: { v: WfColumn; at: number } | null;
  onOpenThread: (id: string) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}

export function Workflow({ agent, settings, counts, isAdmin, userId, refreshKey, view: asked, onOpenThread, onChanged, onError, onInfo }: Props) {
  const [data, setData] = useState<WorkflowData | null>(null);
  const [work, setWork] = useState<{ deep: Set<string>; draft: Set<string> }>({ deep: new Set(), draft: new Set() });
  const [view, setView] = useState<WfColumn>(() => asked?.v ?? storedView() ?? 'discussions');
  const [showEnded, setShowEnded] = useState(false);
  const [smallOpen, setSmallOpen] = useState(false);
  useEffect(() => { if (asked) setView(asked.v); }, [asked]);
  const choose = (v: WfColumn) => { setView(v); try { window.localStorage.setItem(VIEW_STORE, v); } catch { /* stockage indisponible */ } };
  const load = useCallback(async () => {
    const [w, pw] = await Promise.all([listWorkflow(agent), prospectWork(agent)]);
    if (w.error) onError(w.error); else setData(w.data);
    setWork(pw);
  }, [agent, onError]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  // Une recherche approfondie ou une préparation en cours : on relit plus souvent.
  const busy = work.deep.size + work.draft.size > 0;
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [busy, load]);
  const changed = () => { void load(); onChanged(); };
  const mine = settings.find((s) => s.agent === agent);
  const name = AGENT_LABEL[agent].name;
  const agentName = agent === 'dana' ? 'Dana' : 'Ada';
  const minScore = mine?.map_min_score ?? 70;
  const wf = useMemo(() => (data ? buildWorkflow({ prospects: data.prospects, threads: data.threads, messages: data.messages, minScore, ownDomain: emailDomain(mine?.mailbox ?? '') || 'mc-export.com' }) : null),
    [data, minScore, mine?.mailbox]);
  const twinsOf = useMemo(() => {
    const m = new Map<string, ProspectDetail[]>();
    for (const c of [...(wf?.fiches ?? []), ...(wf?.brouillons ?? [])]) m.set(c.lead.id, c.twins);
    return (p: ProspectDetail) => m.get(p.id) ?? [];
  }, [wf]);

  // --- Les actions (celles d'« À valider », sur la carte de l'entreprise) ---
  const deepen = async (prospectId: string, label: string, note = '') => {
    const e = await queueDeepResearch([prospectId], userId, agent, note);
    if (e) { onError(e); return; }
    onInfo(`${name} cherche plus loin pour ${label}${note.trim() ? ', avec votre consigne' : ''} : à qui appartient l'entreprise, qui décide, les e-mails et téléphones publiés. Une à deux minutes ; si elle trouve mieux, ce qui est préparé est refait.`);
    void load();
  };
  const prepare = async (p: ProspectDetail) => {
    const e = await queueFirstMails([p.id], userId, agent);
    if (e) { onError(e); return; }
    onInfo(`${name} prépare pour vous ${p.name} (tout le plan : le mail ou l'aiguillage, une note LinkedIn par personne, la fiche d'appel) : il arrive dans « Fiches » d'ici une minute.`);
    void load();
  };
  const redo = async (prospectId: string, label: string) => {
    if (!window.confirm(`${name} refait tout le plan de ${label} avec la fiche telle qu'elle est : l'aiguillage, le mail, une note LinkedIn par personne, la fiche d'appel.\n\nCe qui est préparé et pas encore parti est remplacé — sauf un brouillon que vous avez corrigé. Environ 0,10 $.`)) return;
    const e = await queueRedoPlan(agent, prospectId, userId);
    if (e) { onError(e); return; }
    onInfo(`${name} refait le plan de ${label} : il remplace l'ancien ici d'ici une minute.`);
    void load();
  };
  const putAside = async (ps: ProspectDetail[], reason: string, pendingIds: string[] = []) => {
    const e = await setAsideProspects(ps, reason, pendingIds);
    if (e) { onError(e); return; }
    onInfo(`${ps.length > 1 ? `${ps.length} fiches mises` : `${ps[0].name} : mise`} de côté — plus aucune recherche ni préparation, aucun crédit dépensé. ${ps.length > 1 ? 'Elles restent' : 'Elle reste'} dans « Brouillons › Mis de côté ».`);
    changed();
  };
  const restore = async (p: ProspectDetail) => {
    const e = await restoreProspect(p);
    if (e) { onError(e); return; }
    onInfo(`${p.name} revient dans la liste : ${name} peut de nouveau la compléter et la préparer.`);
    changed();
  };
  const restage = async (p: ProspectDetail, stage: ProspectStage) => {
    const e = await setProspectStage(p.id, stage);
    if (e) onError(e); else changed();
  };
  const talk = async (p: ProspectDetail) => {
    const how = window.prompt(`${p.name} : contactée en dehors d'ADA (téléphone, salon, LinkedIn…) ? La fiche passe dans « Discussions en cours ».\n\nComment ? (facultatif, va dans ses notes)`, '');
    if (how === null) return;
    const e = await startDiscussion(p, how);
    if (e) { onError(e); return; }
    onInfo(`${p.name} est dans « Discussions en cours ».`);
    changed();
  };
  const saveNotes = async (p: ProspectDetail, notes: string): Promise<boolean> => {
    const e = await setProspectNotes(p.id, notes);
    if (e) { onError(e); return false; }
    void load();
    return true;
  };
  const requalify = async (p: ProspectDetail) => {
    const e = p.account_id ? await queueAccountQualification([p.account_id], userId, agent) : p.dealer_id ? await queueQualification([p.dealer_id], userId, agent) : 'Fiche sans garage ni compte d\'origine : impossible de la refaire.';
    if (e) onError(e); else onInfo(`${name} refait la fiche de ${p.name} (ce que la recherche approfondie a trouvé reste).`);
  };

  if (!wf) return <p className="text-sm text-slate-500 animate-pulse">Lecture du workflow…</p>;

  // 19/10 : les aiguillages préparés, envoyés d'un coup (une confirmation, puis chacun part de la boîte de l'agente, dans ses horaires).
  const routing = wf.fiches.flatMap((c) => c.pending).filter((m) => m.status === 'a_valider' && !!m.ai_notes?.aiguillage);
  const sendRouting = async () => {
    if (!mine || routing.length === 0) return;
    const to = routing.map((m) => `• ${m.to_emails.join(', ')}`).join('\n');
    if (!window.confirm(`Envoyer ${routing.length} aiguillage${routing.length > 1 ? 's' : ''} depuis ${mine.mailbox}, signé${routing.length > 1 ? 's' : ''} ${name} ?\n\n${to}\n\nIls partent dans ses horaires d'envoi, sous son plafond du jour, espacés.`)) return;
    let ok = 0;
    for (const m of routing) {
      const e = await sendFromAgent({ id: m.id, status: m.status, body_text: m.body_text }, mine);
      if (e) { onError(e); break; }
      ok++;
    }
    if (ok) onInfo(`${ok} aiguillage${ok > 1 ? 's' : ''} validé${ok > 1 ? 's' : ''} : ils partent de ${mine.mailbox} dès que ses horaires, son plafond du jour et l'écart entre deux envois le permettent.`);
    changed();
  };

  const counts3: Record<WfColumn, number> = { discussions: wf.discussions.filter((c) => !c.ended).length, fiches: wf.fiches.length, brouillons: wf.brouillons.length };
  const unread = wf.discussions.filter((c) => c.unread).length;
  const failed = WF_COLUMNS.flatMap((k) => wf[k].filter((c) => c.pending.some((m) => m.status === 'echec')).map((c) => ({ k, name: c.lead.name })));
  const orphanFailed = wf.orphans.filter((m) => m.status === 'echec').length;
  const cardProps = { settings: mine, counts: counts[agent], isAdmin, onOpenThread, onChanged: changed, onError, onInfo };
  const talkButton = (p: ProspectDetail) => (
    <button type="button" onClick={() => void talk(p)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-1 font-medium text-emerald-800 hover:bg-emerald-50"
      title="Vous l'avez contactée en dehors d'ADA (téléphone, salon…) : la fiche passe dans « Discussions en cours ».">
      <MessageCircle className="w-3.5 h-3.5" /> Passer en discussion
    </button>
  );
  const toComplete = (cards: Card[]) => (
    <ToComplete agent={agent} rows={cards.map((c) => c.lead)} deep={work.deep} draft={work.draft} minScore={minScore} autoDraft={mine?.auto_draft_per_day ?? 0} isAdmin={isAdmin}
      onDeep={(p, note) => void deepen(p.id, p.name, note)} onPrepare={(p) => void prepare(p)} onStage={(p, st) => void restage(p, st)} onRequalify={(p) => void requalify(p)} onOpenThread={onOpenThread}
      onAside={(ps, reason) => void putAside(ps, reason)} twinsOf={twinsOf} />
  );

  const prepared = wf.fiches.filter((c) => c.pending.length > 0);
  const ready = wf.fiches.filter((c) => c.pending.length === 0);
  const keyDrafts = wf.brouillons.filter((c) => c.lead.key_account);
  const smallDrafts = wf.brouillons.filter((c) => !c.lead.key_account);
  const active = wf.discussions.filter((c) => !c.ended);
  const ended = wf.discussions.filter((c) => c.ended);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Catégories du workflow" className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {WF_COLUMNS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => choose(k)}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium ${view === k ? 'bg-brand-encre text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            {ICON[k]}<span className="hidden sm:inline">{WF_LABEL[k]}</span><span className="sm:hidden">{k === 'discussions' ? 'Discussions' : WF_LABEL[k]}</span>
            <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${view === k ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{counts3[k]}</span>
            {k === 'discussions' && unread > 0 && <span className="h-2 w-2 rounded-full bg-emerald-500" title={`${unread} réponse${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}`} />}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">{HINT[view]}</p>
      {(failed.length > 0 || orphanFailed > 0) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 flex items-center gap-2 flex-wrap">
          <AlertTriangle className="w-3.5 h-3.5" /> Envoi en échec :
          {failed.map((f) => <button key={`${f.k}-${f.name}`} type="button" onClick={() => choose(f.k)} className="underline hover:no-underline">{f.name} ({WF_LABEL[f.k]})</button>)}
          {orphanFailed > 0 && <button type="button" onClick={() => choose('discussions')} className="underline hover:no-underline">{orphanFailed} mail{orphanFailed > 1 ? 's' : ''} sans fiche</button>}
        </div>
      )}

      {view === 'discussions' && (
        <div className="space-y-3">
          {active.map((c) => (
            <DiscussionCard key={c.lead.id} card={c} agentName={agentName} {...cardProps}
              onStage={(p, st) => void restage(p, st)} onNotes={saveNotes} onDeep={(p, note) => void deepen(p.id, p.name, note)} deeping={work.deep.has(c.lead.id)} onRequalify={(p) => void requalify(p)} />
          ))}
          {active.length === 0 && wf.orphans.length === 0 && (
            <p className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
              Aucune discussion en cours. Une fiche arrive ici dès qu'un mail part (de la boîte {agent === 'dana' ? 'de Dana' : 'd\'Ada'} ou de la Messagerie), qu'une réponse arrive, ou quand vous la passez en discussion.
            </p>
          )}
          {wf.orphans.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">Mails à valider, sans fiche <span className="text-xs font-normal text-slate-400">{wf.orphans.length}</span></h3>
              {wf.orphans.map((m) => {
                const who = m.thread?.counterpart_name || m.thread?.counterpart_email || m.to_emails[0] || '';
                return (
                  <div key={`${m.id}-${m.updated_at}`} className="space-y-1">
                    <button type="button" onClick={() => onOpenThread(m.thread_id)} className="text-xs text-brand-ocean hover:underline">ouvrir le fil{who ? ` avec ${who}` : ''}</button>
                    <MessageCard m={m} flat {...cardProps} />
                  </div>
                );
              })}
            </section>
          )}
          {ended.length > 0 && (
            <section className="space-y-2">
              <button type="button" onClick={() => setShowEnded(!showEnded)} aria-expanded={showEnded} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <ChevronRight className={`w-4 h-4 transition-transform ${showEnded ? 'rotate-90' : ''}`} /> Terminées (perdues) <span className="text-xs font-normal text-slate-400">{ended.length}</span>
              </button>
              {showEnded && ended.map((c) => (
                <DiscussionCard key={c.lead.id} card={c} agentName={agentName} {...cardProps}
                  onStage={(p, st) => void restage(p, st)} onNotes={saveNotes} onDeep={(p, note) => void deepen(p.id, p.name, note)} deeping={work.deep.has(c.lead.id)} onRequalify={(p) => void requalify(p)} />
              ))}
            </section>
          )}
        </div>
      )}

      {view === 'fiches' && (
        <div className="space-y-3">
          {isAdmin && routing.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
              {routing.length} aiguillage{routing.length > 1 ? 's' : ''} à valider : des mails très courts, sans présentation, pour obtenir le contact direct de la bonne personne.
              <button type="button" onClick={() => void sendRouting()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 font-medium">
                <Send className="w-3 h-3" /> Envoyer {routing.length > 1 ? `les ${routing.length} aiguillages` : 'l\'aiguillage'}
              </button>
            </div>
          )}
          {prepared.map((c) => (
            <ForYouCard key={c.lead.id} items={c.pending} twins={c.twins} {...cardProps}
              onDeep={(id, note) => void deepen(id, c.lead.name, note)} deeping={work.deep.has(c.lead.id)}
              onRedo={(id) => void redo(id, c.lead.name)} redoing={work.draft.has(c.lead.id)}
              actions={<>{talkButton(c.lead)}<AsideAsk p={c.lead} twins={c.twins} onAside={(ps, reason) => void putAside(ps, reason, c.pending.map((m) => m.id))} /></>} />
          ))}
          {ready.length > 0 && (
            <section className="space-y-2">
              {prepared.length > 0 && <h3 className="text-sm font-semibold text-slate-900">Prêtes à préparer <span className="text-xs font-normal text-slate-400">{ready.length}</span></h3>}
              {toComplete(ready)}
            </section>
          )}
          {wf.fiches.length === 0 && (
            <p className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
              Aucune fiche complète pour l'instant. Choisissez dans « Brouillons » les entreprises qui vous intéressent : une recherche approfondie les complète.
            </p>
          )}
        </div>
      )}

      {view === 'brouillons' && (
        <div className="space-y-3">
          {toComplete(keyDrafts)}
          {smallDrafts.length > 0 && (
            <section className="space-y-2">
              <button type="button" onClick={() => setSmallOpen(!smallOpen)} aria-expanded={smallOpen} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <ChevronRight className={`w-4 h-4 transition-transform ${smallOpen ? 'rotate-90' : ''}`} /> Petits comptes à compléter <span className="text-xs font-normal text-slate-400">{smallDrafts.length}</span>
              </button>
              {smallOpen && toComplete(smallDrafts.slice(0, 60))}
              {smallOpen && smallDrafts.length > 60 && <p className="text-xs text-slate-500">Les 60 mieux notés ; les autres sont dans l'onglet {agent === 'dana' ? 'Sourcing' : 'Acheteurs'}.</p>}
            </section>
          )}
          {wf.brouillons.length === 0 && (
            <p className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
              Aucune fiche à compléter. Les entreprises que {name} trouve (onglet Recherche) arrivent ici avec ce qui leur manque.
            </p>
          )}
          {wf.aside.length > 0 && <SetAsideList rows={wf.aside} onRestore={(p) => void restore(p)} />}
        </div>
      )}
    </div>
  );
}
