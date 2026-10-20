/**
 * « À valider » (16/10) : tout ce que l'agente choisie en haut de la page
 * (et l'équipe, depuis sa boîte) veut envoyer passe ici — à valider, puis
 * validé en attente d'envoi (avec la raison : horaires, plafond, écart,
 * boîte), puis les échecs. Pendant le copilote, rien ne part sans un clic
 * d'administrateur.
 * « Pour vous » (17/10) : les grands comptes qu'elle a préparés, que vous
 * envoyez (18/10 : « Envoyer » fait partir le mail de la boîte de l'agente,
 * signé par elle ; la note LinkedIn et l'appel restent à vous).
 * 18/10 : repliés par défaut (une vue d'ensemble, on ouvre l'un ou
 * l'autre) ; et les grands comptes à compléter — fiche faite, rien de
 * préparé —, avec ce qui manque, la recherche approfondie et « Préparer
 * quand même ».
 * 19/10 (Channing : « il faut bien démarquer les mails d'aiguillage pour un
 * envoi rapide sans perdre de temps ») : les aiguillages à part, en tête,
 * avec « Envoyer les aiguillages » (une confirmation, puis chacun part de la
 * boîte de l'agente, dans ses horaires).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Clock, AlertTriangle, Crown, Telescope, Compass, Send } from 'lucide-react';
import {
  listQueue, listForYou, listKeyAccounts, threadsOfProspects, prospectWork, queueDeepResearch, queueFirstMails, queueRedoPlan, queueQualification, queueAccountQualification, setProspectStage, sendFromAgent,
  AGENT_LABEL, type AgentKey, type AgentSettings, type AgentCounts, type QueuedMessage, type ForYouMessage, type ProspectDetail, type ProspectStage,
} from '../../services/agents';
import { MessageCard } from './MessageCard';
import { ForYouCard } from './ForYou';
import { ToComplete } from './ToComplete';
import { deName } from './helpers';

interface Props {
  agent: AgentKey;
  settings: AgentSettings[];
  counts: Partial<Record<AgentKey, AgentCounts>>;
  isAdmin: boolean;
  userId: string | null;
  refreshKey: number;
  onOpenThread: (id: string) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}

export function ValidationQueue({ agent, settings, counts, isAdmin, userId, refreshKey, onOpenThread, onChanged, onError, onInfo }: Props) {
  const [rows, setRows] = useState<QueuedMessage[]>([]);
  const [forYou, setForYou] = useState<ForYouMessage[]>([]);
  const [keyAccounts, setKeyAccounts] = useState<ProspectDetail[]>([]);
  const [work, setWork] = useState<{ deep: Set<string>; draft: Set<string> }>({ deep: new Set(), draft: new Set() });
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const [r, f, k, w] = await Promise.all([listQueue(agent), listForYou(agent), listKeyAccounts(agent), prospectWork(agent)]);
    if (r.error) onError(r.error); else setRows(r.rows);
    if (f.error) onError(f.error); else setForYou(f.rows);
    if (k.error) onError(k.error);
    else {
      // À compléter : les grands comptes qui n'ont pas encore de fil (rien de préparé, rien d'envoyé).
      const threads = await threadsOfProspects(k.rows.map((p) => p.id));
      setKeyAccounts(k.rows.filter((p) => !threads.has(p.id)));
    }
    setWork(w);
    setLoaded(true);
  }, [agent, onError]);
  // Un grand compte = un fil : son mail et sa note LinkedIn ensemble.
  const accounts = useMemo(() => {
    const m = new Map<string, ForYouMessage[]>();
    for (const x of forYou) (m.get(x.thread_id) ?? m.set(x.thread_id, []).get(x.thread_id)!).push(x);
    return [...m.values()];
  }, [forYou]);
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
  const deepen = async (prospectId: string, label: string, note = '') => {
    const e = await queueDeepResearch([prospectId], userId, agent, note);
    if (e) { onError(e); return; }
    onInfo(`${name} cherche plus loin pour ${label}${note.trim() ? ', avec votre consigne' : ''} : à qui appartient l'entreprise, qui décide, les e-mails et téléphones publiés. Une à deux minutes ; si elle trouve mieux, ce qui est préparé est refait.`);
    void load();
  };
  const prepare = async (p: ProspectDetail) => {
    const e = await queueFirstMails([p.id], userId, agent);
    if (e) { onError(e); return; }
    onInfo(`${name} prépare pour vous ${p.name} (tout le plan : le mail ou l'aiguillage, une note LinkedIn par personne, la fiche d'appel) : il arrive dans « Pour vous » d'ici une minute.`);
    void load();
  };
  // 20/10 : « Refaire le plan » — avec la fiche telle qu'elle est ; la nouvelle préparation remplace l'ancienne.
  const redo = async (prospectId: string, label: string) => {
    if (!window.confirm(`${name} refait tout le plan de ${label} avec la fiche telle qu'elle est : l'aiguillage, le mail, une note LinkedIn par personne, la fiche d'appel.\n\nCe qui est préparé et pas encore parti est remplacé — sauf un brouillon que vous avez corrigé. Environ 0,10 $.`)) return;
    const e = await queueRedoPlan(agent, prospectId, userId);
    if (e) { onError(e); return; }
    onInfo(`${name} refait le plan de ${label} : il remplace l'ancien ici d'ici une minute.`);
    void load();
  };
  const restage = async (p: ProspectDetail, stage: ProspectStage) => {
    const e = await setProspectStage(p.id, stage);
    if (e) onError(e); else void load();
  };
  const requalify = async (p: ProspectDetail) => {
    const e = p.account_id ? await queueAccountQualification([p.account_id], userId, agent) : p.dealer_id ? await queueQualification([p.dealer_id], userId, agent) : 'Fiche sans garage ni compte d\'origine : impossible de la refaire.';
    if (e) onError(e); else onInfo(`${name} refait la fiche de ${p.name} (ce que la recherche approfondie a trouvé reste).`);
  };

  // 19/10 : les aiguillages, à part et en tête : courts, sans présentation, à envoyer sans attendre.
  const routing = rows.filter((m) => m.status === 'a_valider' && !!m.ai_notes?.aiguillage);
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
  const groups: Array<{ key: string; title: string; icon: ReactNode; items: QueuedMessage[]; hint: string; action?: ReactNode }> = [
    { key: 'aiguillage', title: 'Aiguillages — pour obtenir le bon contact', icon: <Compass className="w-4 h-4 text-indigo-600" />, items: routing,
      hint: 'des mails très courts, sans présentation, pour obtenir le contact direct de la bonne personne : à envoyer sans attendre.',
      action: isAdmin && routing.length > 0 ? (
        <button onClick={() => void sendRouting()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 text-xs font-medium">
          <Send className="w-3 h-3" /> Envoyer {routing.length > 1 ? `les ${routing.length} aiguillages` : 'l\'aiguillage'}
        </button>
      ) : undefined },
    { key: 'a_valider', title: 'À valider', icon: <CheckCircle2 className="w-4 h-4 text-amber-600" />, items: rows.filter((m) => m.status === 'a_valider' && !m.ai_notes?.aiguillage),
      hint: isAdmin ? 'Relisez, corrigez si besoin, puis « Envoyer » : le message part de la boîte de l\'agente, à ses horaires d\'envoi.' : 'Un administrateur envoie ces messages après les avoir relus.' },
    { key: 'valide', title: 'Validés, en attente d\'envoi', icon: <Clock className="w-4 h-4 text-blue-600" />, items: rows.filter((m) => m.status === 'valide' || m.status === 'envoi'),
      hint: 'Le worker les envoie dès que les horaires, le plafond du jour et l\'écart entre deux envois le permettent.' },
    { key: 'echec', title: 'Échecs', icon: <AlertTriangle className="w-4 h-4 text-red-600" />, items: rows.filter((m) => m.status === 'echec'),
      hint: 'Rien n\'est renvoyé tout seul : corrigez (repasser en brouillon) puis revalidez.' },
  ];

  if (loaded && rows.length === 0 && accounts.length === 0 && keyAccounts.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-12 text-center text-sm text-slate-500">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
        Rien à valider. Les premiers mails {deName(name)} et les messages soumis par l'équipe depuis sa boîte arrivent ici ; les grands comptes qu'elle prépare pour vous aussi.
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {accounts.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Crown className="w-4 h-4 text-violet-600" />
            <h3 className="text-sm font-semibold text-slate-900">Pour vous — grands comptes</h3>
            <span className="text-xs text-slate-400">{accounts.length}</span>
            <span className="text-xs text-slate-500">— {name} prépare : « Envoyer » fait partir le mail de sa boîte, signé par elle ; les notes LinkedIn et l'appel restent à vous.</span>
          </div>
          {accounts.map((items) => {
            const pid = items[0].thread?.prospect?.id ?? '';
            return <ForYouCard key={items[0].thread_id} items={items} settings={mine} counts={counts[agent]} isAdmin={isAdmin} onOpenThread={onOpenThread} onChanged={changed} onError={onError} onInfo={onInfo}
              onDeep={(id, note) => void deepen(id, items[0].thread?.prospect?.name ?? 'ce compte', note)} deeping={work.deep.has(pid)}
              onRedo={(id) => void redo(id, items[0].thread?.prospect?.name ?? 'ce compte')} redoing={work.draft.has(pid)} />;
          })}
        </section>
      )}
      {keyAccounts.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Telescope className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-900">Grands comptes à compléter</h3>
            <span className="text-xs text-slate-400">{keyAccounts.length}</span>
            <span className="text-xs text-slate-500">— la fiche est faite, rien n'est encore préparé : voici ce qui manque. Les plus durs à joindre sont souvent ceux qui rapportent le plus.</span>
          </div>
          <ToComplete agent={agent} rows={keyAccounts} deep={work.deep} draft={work.draft} minScore={mine?.map_min_score ?? 70} autoDraft={mine?.auto_draft_per_day ?? 0} isAdmin={isAdmin}
            onDeep={(p, note) => void deepen(p.id, p.name, note)} onPrepare={(p) => void prepare(p)} onStage={(p, st) => void restage(p, st)} onRequalify={(p) => void requalify(p)} onOpenThread={onOpenThread} />
        </section>
      )}
      {groups.filter((g) => g.items.length > 0).map((g) => (
        <section key={g.key} className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {g.icon}
            <h3 className="text-sm font-semibold text-slate-900">{g.title}</h3>
            <span className="text-xs text-slate-400">{g.items.length}</span>
            <span className="text-xs text-slate-500 hidden md:inline">— {g.hint}</span>
            {g.action}
          </div>
          {g.items.map((m) => {
            const who = m.thread?.counterpart_name || m.thread?.counterpart_email || m.to_emails[0] || '';
            return (
              <div key={`${m.id}-${m.updated_at}`} className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <button onClick={() => onOpenThread(m.thread_id)} className="text-brand-ocean hover:underline truncate">ouvrir le fil{who ? ` avec ${who}` : ''}</button>
                </div>
                <MessageCard m={m} settings={mine} counts={counts[agent]} isAdmin={isAdmin} flat onChanged={changed} onError={onError} onInfo={onInfo} />
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
