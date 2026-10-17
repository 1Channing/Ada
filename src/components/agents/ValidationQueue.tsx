/**
 * « À valider » (16/10) : tout ce que l'agente choisie en haut de la page
 * (et l'équipe, depuis sa boîte) veut envoyer passe ici — à valider, puis
 * validé en attente d'envoi (avec la raison : horaires, plafond, écart,
 * boîte), puis les échecs. Pendant le copilote, rien ne part sans un clic
 * d'administrateur.
 * « Pour vous » (17/10) : les grands comptes qu'elle a préparés, que vous
 * envoyez vous-même (votre Gmail, votre LinkedIn, votre téléphone).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Clock, AlertTriangle, Crown } from 'lucide-react';
import { listQueue, listForYou, AGENT_LABEL, type AgentKey, type AgentSettings, type AgentCounts, type QueuedMessage, type ForYouMessage } from '../../services/agents';
import { MessageCard } from './MessageCard';
import { ForYouCard } from './ForYou';
import { deName } from './helpers';

interface Props {
  agent: AgentKey;
  settings: AgentSettings[];
  counts: Partial<Record<AgentKey, AgentCounts>>;
  isAdmin: boolean;
  refreshKey: number;
  onOpenThread: (id: string) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}

export function ValidationQueue({ agent, settings, counts, isAdmin, refreshKey, onOpenThread, onChanged, onError }: Props) {
  const [rows, setRows] = useState<QueuedMessage[]>([]);
  const [forYou, setForYou] = useState<ForYouMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const [r, f] = await Promise.all([listQueue(agent), listForYou(agent)]);
    if (r.error) onError(r.error); else setRows(r.rows);
    if (f.error) onError(f.error); else setForYou(f.rows);
    setLoaded(true);
  }, [agent, onError]);
  // Un grand compte = un fil : son mail et sa note LinkedIn ensemble.
  const accounts = useMemo(() => {
    const m = new Map<string, ForYouMessage[]>();
    for (const x of forYou) (m.get(x.thread_id) ?? m.set(x.thread_id, []).get(x.thread_id)!).push(x);
    return [...m.values()];
  }, [forYou]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const changed = () => { void load(); onChanged(); };
  const mine = settings.find((s) => s.agent === agent);
  const name = AGENT_LABEL[agent].name;

  const groups: Array<{ key: string; title: string; icon: ReactNode; items: QueuedMessage[]; hint: string }> = [
    { key: 'a_valider', title: 'À valider', icon: <CheckCircle2 className="w-4 h-4 text-amber-600" />, items: rows.filter((m) => m.status === 'a_valider'),
      hint: isAdmin ? 'Relisez, corrigez si besoin, puis validez : le message part aux horaires d\'envoi.' : 'Un administrateur valide ces messages avant qu\'ils partent.' },
    { key: 'valide', title: 'Validés, en attente d\'envoi', icon: <Clock className="w-4 h-4 text-blue-600" />, items: rows.filter((m) => m.status === 'valide' || m.status === 'envoi'),
      hint: 'Le worker les envoie dès que les horaires, le plafond du jour et l\'écart entre deux envois le permettent.' },
    { key: 'echec', title: 'Échecs', icon: <AlertTriangle className="w-4 h-4 text-red-600" />, items: rows.filter((m) => m.status === 'echec'),
      hint: 'Rien n\'est renvoyé tout seul : corrigez (repasser en brouillon) puis revalidez.' },
  ];

  if (loaded && rows.length === 0 && accounts.length === 0) {
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
            <span className="text-xs text-slate-500">— {name} prépare, vous envoyez (votre Gmail, votre LinkedIn, votre téléphone), puis « Marquer envoyé ».</span>
          </div>
          {accounts.map((items) => <ForYouCard key={items[0].thread_id} items={items} isAdmin={isAdmin} onOpenThread={onOpenThread} onChanged={changed} onError={onError} />)}
        </section>
      )}
      {groups.filter((g) => g.items.length > 0).map((g) => (
        <section key={g.key} className="space-y-2">
          <div className="flex items-center gap-2">
            {g.icon}
            <h3 className="text-sm font-semibold text-slate-900">{g.title}</h3>
            <span className="text-xs text-slate-400">{g.items.length}</span>
            <span className="text-xs text-slate-500 hidden md:inline">— {g.hint}</span>
          </div>
          {g.items.map((m) => {
            const who = m.thread?.counterpart_name || m.thread?.counterpart_email || m.to_emails[0] || '';
            return (
              <div key={`${m.id}-${m.updated_at}`} className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <button onClick={() => onOpenThread(m.thread_id)} className="text-brand-ocean hover:underline truncate">ouvrir le fil{who ? ` avec ${who}` : ''}</button>
                </div>
                <MessageCard m={m} settings={mine} counts={counts[agent]} isAdmin={isAdmin} flat onChanged={changed} onError={onError} />
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
