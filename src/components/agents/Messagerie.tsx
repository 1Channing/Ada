/**
 * Messagerie d'Ada et Dana (16/10) : les fils de la boîte de l'agente
 * choisie en haut de la page (17/10 : une agente à la fois) à gauche, la
 * conversation à droite, une réponse ou une relance en bas, et un nouveau
 * message (premier contact) depuis sa boîte.
 * 18/10 (Channing : « une boîte d'envoi, une boîte de réception, une boîte
 * d'archives, et une boîte de brouillons connectée à À valider » ; « tout
 * doit être structuré ») : quatre dossiers, comme Gmail — un fil peut être
 * dans plusieurs. Brouillons = ce qui attend (les mêmes messages que « À
 * valider ») ; la réponse que l'agente prépare à un mail reçu s'y range, et
 * s'affiche sous ce mail dans le fil. Chaque message a ses gestes ; en bas,
 * « Répondre » seulement s'il y a un mail reçu, « Relancer » seulement après
 * un envoi resté sans réponse.
 * Rien ne part sans validation d'un administrateur.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, Plus, Archive, ArchiveRestore, MailWarning, Ban, Send, X, Reply, PenLine, Linkedin } from 'lucide-react';
import {
  listMailbox, getThread, startConversation, addToThread, setThreadFlags, addSuppression, replyDraft, withSignature,
  type AgentKey, type AgentThread, type AgentMessage, type AgentSettings, type AgentCounts, type Draft, type MailboxThread,
} from '../../services/agents';
import { folderThreads, folderOf, type MailFolder } from '../../lib/agents/mailbox';
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
  onInfo?: (msg: string) => void;
}

const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50';

const FOLDERS: Array<{ key: MailFolder; label: string; icon: typeof Inbox }> = [
  { key: 'reception', label: 'Réception', icon: Inbox },
  { key: 'brouillons', label: 'Brouillons', icon: PenLine },
  { key: 'envoyes', label: 'Envoyés', icon: Send },
  { key: 'archives', label: 'Archives', icon: Archive },
];

/** Ce qui attend dans un fil, en pastilles (dossier Brouillons). */
const WAIT_CHIP: Record<string, { label: string; cls: string }> = {
  pour_channing: { label: 'Pour vous', cls: 'bg-violet-50 text-violet-800 border-violet-200' },
  a_valider: { label: 'À valider', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  brouillon: { label: 'Brouillon', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  valide: { label: 'Part bientôt', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  envoi: { label: 'Envoi en cours', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  echec: { label: 'Échec', cls: 'bg-red-50 text-red-700 border-red-200' },
};

export function Messagerie({ agent, settings, counts, isAdmin, userId, openThreadId, refreshKey, onChanged, onError, onInfo }: Props) {
  const [folder, setFolder] = useState<MailFolder>('reception');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [all, setAll] = useState<MailboxThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(openThreadId);
  const [detail, setDetail] = useState<{ thread: AgentThread | null; messages: AgentMessage[] }>({ thread: null, messages: [] });
  const [reply, setReply] = useState<Draft | null>(null);
  const [composing, setComposing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const byAgent = useMemo(() => Object.fromEntries(settings.map((s) => [s.agent, s])) as Partial<Record<AgentKey, AgentSettings>>, [settings]);

  const loadList = useCallback(async () => {
    const r = await listMailbox(agent);
    if (r.error) onError(r.error); else setAll(r.rows);
    setLoaded(true);
  }, [agent, onError]);
  const loadDetail = useCallback(async (id: string) => {
    const r = await getThread(id);
    if (r.error) { onError(r.error); return; }
    setDetail({ thread: r.thread, messages: r.messages });
    if (r.thread?.unread) { await setThreadFlags(id, { unread: false }); setAll((t) => t.map((x) => (x.id === id ? { ...x, unread: false } : x))); }
  }, [onError]);

  useEffect(() => { void loadList(); }, [loadList, refreshKey]);
  useEffect(() => { if (openThreadId) setSelected(openThreadId); }, [openThreadId]);
  // Un fil ouvert depuis ailleurs (« Ouvrir le fil ») : le dossier où il se trouve.
  useEffect(() => {
    if (!openThreadId) return;
    const x = all.find((t) => t.id === openThreadId);
    if (x) setFolder(folderOf(x));
  }, [openThreadId, all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setReply(null); if (selected) void loadDetail(selected); else setDetail({ thread: null, messages: [] }); }, [selected, loadDetail]);
  useEffect(() => { if (selected) void loadDetail(selected); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = async () => { await loadList(); if (selected) await loadDetail(selected); onChanged(); };
  const inFolder = folderThreads(all, folder);
  const shown = folder === 'reception' && unreadOnly ? inFolder.filter((t) => t.unread) : inFolder;
  const count = (f: MailFolder) => folderThreads(all, f).length;
  const unread = folderThreads(all, 'reception').filter((t) => t.unread).length;
  const t = detail.thread;
  const s = t ? byAgent[t.agent] : undefined;
  const mine = byAgent[agent];
  const name = mine?.display_name ?? (agent === 'dana' ? 'Dana' : 'Ada');
  const mailbox = mine?.mailbox ?? `${agent}@mc-export.com`;

  const sendNew = async (status: 'brouillon' | 'a_valider' | 'valide') => {
    if (!composing || !mine) return;
    const problem = draftProblem(composing);
    if (problem) { onError(problem); return; }
    if (status === 'valide' && !window.confirm(`Envoyer ce message depuis ${mine.mailbox} à ${cleanDraft(composing).to.join(', ')} ?`)) return;
    setBusy(true);
    const r = await startConversation(mine, cleanDraft(composing), status);
    setBusy(false);
    if (r.error) { onError(r.error); return; }
    setComposing(null);
    setFolder(status === 'brouillon' || status === 'a_valider' || status === 'valide' ? 'brouillons' : folder);
    setSelected(r.threadId);
    await loadList();
    onChanged();
  };
  const sendReply = async (status: 'brouillon' | 'a_valider' | 'valide') => {
    if (!reply || !t || !s) return;
    const problem = draftProblem(reply);
    if (problem) { onError(problem); return; }
    if (status === 'valide' && !window.confirm(`Envoyer cette réponse depuis ${s.mailbox} à ${cleanDraft(reply).to.join(', ')} ?`)) return;
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
  // En bas du fil : « Répondre » s'il y a un mail reçu, « Relancer » après un mail parti resté sans réponse, rien sinon.
  const answered = detail.messages.some((m) => m.direction === 'in' && !m.auto_reply && m.classification !== 'rebond');
  const mailed = detail.messages.some((m) => m.direction === 'out' && m.channel === 'mail' && (m.status === 'envoye' || m.status === 'envoye_main'));
  const replyKind: 'reponse' | 'relance' | null = answered ? 'reponse' : mailed ? 'relance' : null;
  const whoOf = (x: MailboxThread) => x.counterpart_name || x.counterpart_email || (x.linkedinOnly ? x.subject.replace(/^LinkedIn\s+—\s+/, '') : 'Sans destinataire');
  const whenOf = (x: MailboxThread) => (folder === 'reception' ? x.lastIn : folder === 'envoyes' ? x.lastOut : null) ?? x.last_message_at ?? x.created_at;

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* Les dossiers et leurs fils */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col max-h-[75vh]">
        <div className="px-2 pt-2 pb-1 border-b border-slate-100 space-y-1.5">
          <div className="grid grid-cols-4 gap-1" role="tablist" aria-label="Dossiers">
            {FOLDERS.map((f) => {
              const Icon = f.icon;
              const n = f.key === 'reception' ? unread : count(f.key);
              return (
                <button key={f.key} role="tab" aria-selected={folder === f.key} onClick={() => { setFolder(f.key); setSelected(null); setComposing(null); }}
                  className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-medium ${folder === f.key ? 'bg-blue-50 text-brand-encre' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <span className="relative"><Icon className="w-4 h-4" />{n > 0 && <span className={`absolute -top-1.5 -right-3 rounded-full px-1 text-[9px] leading-[14px] text-white ${f.key === 'reception' ? 'bg-brand-ocean' : f.key === 'brouillons' ? 'bg-amber-500' : 'bg-slate-400'}`}>{n}</span>}</span>
                  {f.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 px-1 pb-1 text-xs text-slate-600 whitespace-nowrap">
            {folder === 'reception'
              ? <label className="inline-flex items-center gap-1"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Non lus</label>
              : <span className="text-slate-400 truncate">{folder === 'brouillons' ? 'Comme « À valider »' : folder === 'envoyes' ? 'Partis' : 'Rangés'}</span>}
            <span className="text-slate-400">{shown.length} fil{shown.length > 1 ? 's' : ''}</span>
            <button disabled={!mine} onClick={() => { setComposing({ to: [], subject: '', body: mine ? withSignature(mine) : '' }); setSelected(null); }} title="Nouveau message (premier contact)"
              className="ml-auto inline-flex items-center gap-1 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white px-2.5 py-1 text-xs font-medium disabled:opacity-50">
              <Plus className="w-3.5 h-3.5" /> Écrire
            </button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {loaded && shown.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              <Inbox className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              {folder === 'reception' ? (unreadOnly ? 'Aucun mail non lu.' : `Aucun mail reçu. Ceux de ${mailbox} arrivent ici dès que la boîte est connectée.`)
                : folder === 'brouillons' ? `Rien en attente : ce que ${name} prépare et ce que l'équipe écrit arrive ici (et dans « À valider »).`
                  : folder === 'envoyes' ? 'Rien d\'envoyé pour l\'instant.' : 'Aucun fil archivé.'}
            </div>
          )}
          {shown.map((x) => (
            <button key={x.id} onClick={() => { setSelected(x.id); setComposing(null); }} className={`w-full text-left px-3 py-2.5 border-b border-slate-100 ${selected === x.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
              <div className="flex items-center gap-2">
                {x.unread && <span className="w-2 h-2 rounded-full bg-brand-ocean shrink-0" title="Non lu" />}
                {x.linkedinOnly && <Linkedin className="w-3.5 h-3.5 shrink-0 text-sky-700" />}
                <span className={`text-sm truncate ${x.unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}`}>{whoOf(x)}</span>
                <span className="ml-auto shrink-0 text-[11px] text-slate-400">{fmtRelative(whenOf(x))}</span>
              </div>
              <p className="text-xs text-slate-600 truncate mt-0.5">{x.subject || '(sans objet)'}</p>
              {(folder === 'brouillons' || (folder === 'reception' && x.last_classification && x.last_classification !== 'reponse')) && (
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {folder === 'reception' && <ClassificationChip c={x.last_classification} />}
                  {folder === 'brouillons' && x.waitingStatuses.map((st) => WAIT_CHIP[st] && <span key={st} className={`rounded-full border px-1.5 text-[10px] ${WAIT_CHIP[st]?.cls}`}>{WAIT_CHIP[st]?.label}</span>)}
                  {folder === 'brouillons' && x.received && <span className="text-[10px] text-slate-500">réponse à un mail reçu</span>}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Le fil (sur téléphone, seulement quand un fil est ouvert) */}
      <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm min-h-[50vh] ${!composing && !t ? 'hidden lg:block' : ''}`}>
        {composing ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-slate-900">Nouveau message</h3>
              <button onClick={() => setComposing(null)} className="ml-auto text-slate-400 hover:text-slate-700" title="Fermer"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-500">Part de {mine?.mailbox}, avec la signature et le logo {name === 'Ada' ? 'd\'Ada' : `de ${name}`}. Premier contact : compte dans le plafond du jour et part aux horaires d'envoi.</p>
            <DraftEditor draft={composing} onChange={setComposing} autoFocus />
            <div className="flex items-center gap-2 flex-wrap">
              <button disabled={busy} onClick={() => void sendNew('brouillon')} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Enregistrer le brouillon</button>
              <button disabled={busy} onClick={() => void sendNew('a_valider')} className={`${btn} border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}>Soumettre à validation</button>
              {isAdmin && <button disabled={busy} onClick={() => void sendNew('valide')} className={`${btn} bg-brand-ocean hover:bg-brand-encre text-white`}><Send className="w-4 h-4" /> Envoyer</button>}
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
                <p className="text-xs text-slate-500 truncate">{t.counterpart_name ? `${t.counterpart_name} · ` : ''}{t.counterpart_email ?? (detail.messages.every((m) => m.channel === 'linkedin') ? 'sur LinkedIn' : '—')}</p>
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
                <MessageCard key={`${m.id}-${m.updated_at}`} m={m} settings={s} counts={counts[t.agent]} isAdmin={isAdmin} onChanged={() => void refreshAll()} onError={onError} onInfo={onInfo} />
              ))}
            </div>
            {s && replyKind && (reply ? (
              <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/60">
                <p className="text-xs text-slate-500">{replyKind === 'reponse' ? 'Réponse' : 'Relance (compte dans le plafond du jour)'} depuis {s.mailbox}</p>
                <DraftEditor draft={reply} onChange={setReply} autoFocus />
                <div className="flex items-center gap-2 flex-wrap">
                  <button disabled={busy} onClick={() => void sendReply('brouillon')} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>Enregistrer le brouillon</button>
                  <button disabled={busy} onClick={() => void sendReply('a_valider')} className={`${btn} border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}>Soumettre à validation</button>
                  {isAdmin && <button disabled={busy} onClick={() => void sendReply('valide')} className={`${btn} bg-brand-ocean hover:bg-brand-encre text-white`}><Send className="w-4 h-4" /> Envoyer</button>}
                  <button onClick={() => setReply(null)} className="text-xs text-slate-500 hover:text-slate-800">Annuler</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setReply(replyDraft(t, detail.messages, s))} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
                <Reply className="w-4 h-4" /> {replyKind === 'reponse' ? 'Répondre' : 'Relancer'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
