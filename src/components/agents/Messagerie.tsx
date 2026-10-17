/**
 * Messagerie d'Ada et Dana (16/10) : les fils de la boîte de l'agente
 * choisie en haut de la page (17/10 : une agente à la fois) à gauche, la
 * conversation à droite, une réponse ou une relance en bas, et un nouveau
 * message (premier contact) depuis sa boîte.
 * Rien ne part sans validation d'un administrateur.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, Plus, Archive, ArchiveRestore, MailWarning, Ban, Send, CheckCircle2, X, Reply } from 'lucide-react';
import {
  listThreads, getThread, startConversation, addToThread, setThreadFlags, addSuppression, replyDraft, withSignature,
  type AgentKey, type AgentThread, type AgentMessage, type AgentSettings, type AgentCounts, type Draft,
} from '../../services/agents';
import { ClassificationChip, DraftEditor } from './shared';
import { draftProblem, cleanDraft, fmtRelative } from './helpers';
import { MessageCard } from './MessageCard';

interface Props {
  agent: AgentKey;
  settings: AgentSettings[];
  counts: Partial<Record<AgentKey, AgentCounts>>;
  isAdmin: boolean;
  userId: string | null;
  openThreadId: string | null;
  refreshKey: number;
  onChanged: () => void;
  onError: (msg: string) => void;
}

const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50';

export function Messagerie({ agent, settings, counts, isAdmin, userId, openThreadId, refreshKey, onChanged, onError }: Props) {
  const [archived, setArchived] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [selected, setSelected] = useState<string | null>(openThreadId);
  const [detail, setDetail] = useState<{ thread: AgentThread | null; messages: AgentMessage[] }>({ thread: null, messages: [] });
  const [reply, setReply] = useState<Draft | null>(null);
  const [composing, setComposing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const byAgent = useMemo(() => Object.fromEntries(settings.map((s) => [s.agent, s])) as Partial<Record<AgentKey, AgentSettings>>, [settings]);

  const loadList = useCallback(async () => {
    const r = await listThreads({ agent, archived });
    if (r.error) onError(r.error); else setThreads(r.rows);
  }, [agent, archived, onError]);
  const loadDetail = useCallback(async (id: string) => {
    const r = await getThread(id);
    if (r.error) { onError(r.error); return; }
    setDetail({ thread: r.thread, messages: r.messages });
    if (r.thread?.unread) { await setThreadFlags(id, { unread: false }); setThreads((t) => t.map((x) => (x.id === id ? { ...x, unread: false } : x))); }
  }, [onError]);

  useEffect(() => { void loadList(); }, [loadList, refreshKey]);
  useEffect(() => { if (openThreadId) setSelected(openThreadId); }, [openThreadId]);
  useEffect(() => { setReply(null); if (selected) void loadDetail(selected); else setDetail({ thread: null, messages: [] }); }, [selected, loadDetail]);
  useEffect(() => { if (selected) void loadDetail(selected); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = async () => { await loadList(); if (selected) await loadDetail(selected); onChanged(); };
  const shown = unreadOnly ? threads.filter((t) => t.unread) : threads;
  const t = detail.thread;
  const s = t ? byAgent[t.agent] : undefined;
  const mine = byAgent[agent];

  const sendNew = async (status: 'brouillon' | 'a_valider' | 'valide') => {
    if (!composing || !mine) return;
    const problem = draftProblem(composing);
    if (problem) { onError(problem); return; }
    setBusy(true);
    const r = await startConversation(mine, cleanDraft(composing), status);
    setBusy(false);
    if (r.error) { onError(r.error); return; }
    setComposing(null);
    setArchived(false);
    setSelected(r.threadId);
    await loadList();
    onChanged();
  };
  const sendReply = async (status: 'brouillon' | 'a_valider' | 'valide') => {
    if (!reply || !t) return;
    const problem = draftProblem(reply);
    if (problem) { onError(problem); return; }
    setBusy(true);
    const e = await addToThread(t, detail.messages, cleanDraft(reply), status);
    setBusy(false);
    if (e) { onError(e); return; }
    setReply(null);
    await refreshAll();
  };
  const blockCounterpart = async () => {
    if (!t?.counterpart_email) return;
    if (!window.confirm(`Ne plus jamais écrire à ${t.counterpart_email} (Ada comme Dana) ?`)) return;
    const e = await addSuppression(t.counterpart_email, 'refus', `depuis le fil « ${t.subject} »`, t.agent, userId);
    if (e) onError(e); else onChanged();
  };
  const answered = detail.messages.some((m) => m.direction === 'in' && !m.auto_reply && m.classification !== 'rebond');

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* Liste des fils */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col max-h-[75vh]">
        <div className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-3 text-xs text-slate-600 whitespace-nowrap">
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Non lus</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archivés</label>
          <span className="text-slate-400">{shown.length} fil{shown.length > 1 ? 's' : ''}</span>
          <button disabled={!mine} onClick={() => setComposing({ to: [], subject: '', body: mine ? withSignature(mine) : '' })} title="Nouveau message (premier contact)"
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white px-2.5 py-1 text-xs font-medium disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Écrire
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {shown.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              <Inbox className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              {archived ? 'Aucun fil archivé.' : `Aucun fil pour l'instant. Les mails reçus par ${mine?.mailbox ?? `${agent}@mc-export.com`} arrivent ici dès que la boîte est connectée.`}
            </div>
          )}
          {shown.map((x) => {
            const cls = x.last_classification === 'reponse' ? null : x.last_classification;
            return (
              <button key={x.id} onClick={() => setSelected(x.id)} className={`w-full text-left px-3 py-2.5 border-b border-slate-100 ${selected === x.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                <div className="flex items-center gap-2">
                  {x.unread && <span className="w-2 h-2 rounded-full bg-brand-ocean shrink-0" title="Non lu" />}
                  <span className={`text-sm truncate ${x.unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}`}>{x.counterpart_name || x.counterpart_email || 'Sans destinataire'}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-slate-400">{fmtRelative(x.last_message_at ?? x.created_at)}</span>
                </div>
                <p className="text-xs text-slate-600 truncate mt-0.5">{x.subject || '(sans objet)'}</p>
                {(cls || !x.gmail_thread_id) && (
                  <div className="flex items-center gap-1 mt-1">
                    <ClassificationChip c={cls} />
                    {!x.gmail_thread_id && <span className="text-[10px] text-slate-400">pas encore envoyé</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation (sur téléphone, seulement quand un fil est ouvert) */}
      <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm min-h-[50vh] ${!composing && !t ? 'hidden lg:block' : ''}`}>
        {composing ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-slate-900">Nouveau message</h3>
              <button onClick={() => setComposing(null)} className="ml-auto text-slate-400 hover:text-slate-700" title="Fermer"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-500">Part de {mine?.mailbox}. Premier contact : compte dans le plafond du jour et part aux horaires d'envoi, après validation.</p>
            <DraftEditor draft={composing} onChange={setComposing} autoFocus />
            <div className="flex items-center gap-2 flex-wrap">
              <button disabled={busy} onClick={() => void sendNew('brouillon')} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Enregistrer le brouillon</button>
              <button disabled={busy} onClick={() => void sendNew('a_valider')} className={`${btn} border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}><Send className="w-4 h-4" /> Soumettre à validation</button>
              {isAdmin && <button disabled={busy} onClick={() => void sendNew('valide')} className={`${btn} bg-brand-ocean hover:bg-brand-encre text-white`}><CheckCircle2 className="w-4 h-4" /> Valider l'envoi</button>}
            </div>
          </div>
        ) : !t ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-10 text-sm text-slate-400">
            <MailWarning className="w-8 h-8 mb-2 text-slate-300" />
            Choisissez un fil à gauche, ou écrivez un nouveau message.
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-slate-900 truncate">{t.subject || '(sans objet)'}</h3>
                <p className="text-xs text-slate-500 truncate">{t.counterpart_name ? `${t.counterpart_name} · ` : ''}{t.counterpart_email ?? '—'}</p>
              </div>
              <button onClick={() => void setThreadFlags(t.id, { archived: !t.archived }).then((e) => { if (e) onError(e); else { setSelected(null); void loadList(); } })} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" title={t.archived ? 'Désarchiver' : 'Archiver'}>
                {t.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />} {t.archived ? 'Désarchiver' : 'Archiver'}
              </button>
              {t.counterpart_email && (
                <button onClick={() => void blockCounterpart()} className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800" title="Ajouter à « ne plus contacter »">
                  <Ban className="w-4 h-4" /> Ne plus contacter
                </button>
              )}
            </div>
            <div className="space-y-2">
              {detail.messages.map((m) => (
                <MessageCard key={`${m.id}-${m.updated_at}`} m={m} settings={s} counts={counts[t.agent]} isAdmin={isAdmin} onChanged={() => void refreshAll()} onError={onError} />
              ))}
            </div>
            {s && (reply ? (
              <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/60">
                <p className="text-xs text-slate-500">{answered ? 'Réponse' : 'Relance (compte dans le plafond du jour)'} depuis {s.mailbox}</p>
                <DraftEditor draft={reply} onChange={setReply} autoFocus />
                <div className="flex items-center gap-2 flex-wrap">
                  <button disabled={busy} onClick={() => void sendReply('brouillon')} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>Enregistrer le brouillon</button>
                  <button disabled={busy} onClick={() => void sendReply('a_valider')} className={`${btn} border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}><Send className="w-4 h-4" /> Soumettre à validation</button>
                  {isAdmin && <button disabled={busy} onClick={() => void sendReply('valide')} className={`${btn} bg-brand-ocean hover:bg-brand-encre text-white`}><CheckCircle2 className="w-4 h-4" /> Valider l'envoi</button>}
                  <button onClick={() => setReply(null)} className="text-xs text-slate-500 hover:text-slate-800">Annuler</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setReply(replyDraft(t, detail.messages, s))} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
                <Reply className="w-4 h-4" /> {answered ? 'Répondre' : 'Relancer'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
