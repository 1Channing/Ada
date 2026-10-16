/**
 * « À valider » (16/10) : tout ce qu'Ada et Dana (et l'équipe) veulent
 * envoyer passe ici — à valider, puis validé en attente d'envoi (avec la
 * raison : horaires, plafond, écart, boîte), puis les échecs. Pendant le
 * copilote, rien ne part sans un clic d'administrateur.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { listQueue, type AgentKey, type AgentSettings, type AgentCounts, type QueuedMessage } from '../../services/agents';
import { AgentBadge } from './shared';
import { MessageCard } from './MessageCard';

interface Props {
  settings: AgentSettings[];
  counts: Partial<Record<AgentKey, AgentCounts>>;
  isAdmin: boolean;
  refreshKey: number;
  onOpenThread: (id: string) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}

export function ValidationQueue({ settings, counts, isAdmin, refreshKey, onOpenThread, onChanged, onError }: Props) {
  const [rows, setRows] = useState<QueuedMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const r = await listQueue();
    if (r.error) onError(r.error); else setRows(r.rows);
    setLoaded(true);
  }, [onError]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const changed = () => { void load(); onChanged(); };
  const byAgent = (k: AgentKey) => settings.find((s) => s.agent === k);

  const groups: Array<{ key: string; title: string; icon: ReactNode; items: QueuedMessage[]; hint: string }> = [
    { key: 'a_valider', title: 'À valider', icon: <CheckCircle2 className="w-4 h-4 text-amber-600" />, items: rows.filter((m) => m.status === 'a_valider'),
      hint: isAdmin ? 'Relisez, corrigez si besoin, puis validez : le message part aux horaires d\'envoi.' : 'Un administrateur valide ces messages avant qu\'ils partent.' },
    { key: 'valide', title: 'Validés, en attente d\'envoi', icon: <Clock className="w-4 h-4 text-blue-600" />, items: rows.filter((m) => m.status === 'valide' || m.status === 'envoi'),
      hint: 'Le worker les envoie dès que les horaires, le plafond du jour et l\'écart entre deux envois le permettent.' },
    { key: 'echec', title: 'Échecs', icon: <AlertTriangle className="w-4 h-4 text-red-600" />, items: rows.filter((m) => m.status === 'echec'),
      hint: 'Rien n\'est renvoyé tout seul : corrigez (repasser en brouillon) puis revalidez.' },
  ];

  if (loaded && rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-12 text-center text-sm text-slate-500">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
        Rien à valider. Les messages soumis par l'équipe (et, en phase 2, ceux préparés par Ada et Dana) arrivent ici.
      </div>
    );
  }
  return (
    <div className="space-y-5">
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
                  <AgentBadge agent={m.agent} small />
                  <button onClick={() => onOpenThread(m.thread_id)} className="text-brand-ocean hover:underline truncate">ouvrir le fil{who ? ` avec ${who}` : ''}</button>
                </div>
                <MessageCard m={m} settings={byAgent(m.agent)} counts={counts[m.agent]} isAdmin={isAdmin} flat onChanged={changed} onError={onError} />
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
