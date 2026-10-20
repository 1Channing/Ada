/**
 * « Workflow › Discussions en cours » (20/10, Channing : « on y retrouve les fiches complètes des groupes
 * qu'on a contactés par e-mail ou LinkedIn — on peut ajouter des notes, modifier les fiches… ; elles y
 * sont dès qu'un mail est envoyé, ou qu'on l'y a mise »). Une carte par entreprise, repliée : où en est
 * la discussion (l'étape, le dernier échange, une réponse non lue) et ce qui attend (une réponse à
 * valider, une note LinkedIn à envoyer, un échec d'envoi). Ouverte : les notes de l'équipe, ce qui
 * attend, les échanges de ses fils (lus à l'ouverture), la fiche complète, ses autres fiches.
 */
import { useEffect, useState } from 'react';
import { ChevronRight, MessagesSquare, ArrowUpRight, ArrowDownLeft, StickyNote, Linkedin, AlertTriangle, Clock, PenLine, ExternalLink } from 'lucide-react';
import { getThread, setThreadFlags, type AgentMessage, type AgentSettings, type AgentCounts, type AgentThread, type ProspectDetail, type ProspectStage, type ForYouMessage } from '../../services/agents';
import { noteLine, type WfCard } from '../../lib/agents/workflow';
import { withNoteLine } from '../../lib/agents/setAside';
import { MessageCard } from './MessageCard';
import { QualifCard } from './QualifCard';
import { KIND_LABEL, STAGE_LABEL, fmtDateTime, scoreTone } from './helpers';

const FLAG: Record<string, string> = { FR: '🇫🇷', DE: '🇩🇪', NL: '🇳🇱', BE: '🇧🇪', ES: '🇪🇸', IT: '🇮🇹', DK: '🇩🇰', AT: '🇦🇹', LU: '🇱🇺', SE: '🇸🇪', HU: '🇭🇺', LT: '🇱🇹', PL: '🇵🇱', PT: '🇵🇹', CH: '🇨🇭' };
/** Les étapes d'une discussion, dans l'ordre (« Fiche prête » : la remettre dans les fiches). */
const TALK_STAGES: ProspectStage[] = ['contacte', 'repondu', 'interesse', 'client', 'perdu', 'qualifie'];

/** Les notes de l'équipe : ajouter une ligne datée, ou tout reprendre. */
function NotesBox({ p, onSave }: { p: ProspectDetail; onSave: (notes: string) => Promise<boolean> }) {
  const [add, setAdd] = useState('');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.notes ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(p.notes ?? ''); }, [p.notes]);
  const save = async (notes: string) => { setBusy(true); const done = await onSave(notes); setBusy(false); if (done) { setAdd(''); setEditing(false); } };
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 space-y-1.5">
      <p className="text-[10px] uppercase tracking-wide text-amber-800 flex items-center gap-1"><StickyNote className="w-3 h-3" /> Notes de l'équipe</p>
      {editing ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={4000}
          className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300" />
      ) : (p.notes ?? '').trim()
        ? <p className="text-sm text-slate-800 whitespace-pre-wrap">{p.notes}</p>
        : <p className="text-xs text-slate-500">Aucune note pour l'instant.</p>}
      {editing ? (
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => void save(text)} className="rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 text-xs font-medium disabled:opacity-50">Enregistrer</button>
          <button type="button" onClick={() => { setEditing(false); setText(p.notes ?? ''); }} className="text-xs text-slate-500 hover:text-slate-800">Annuler</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <input value={add} onChange={(e) => setAdd(e.target.value)} maxLength={1000} placeholder="Ajouter une note (rappel, ce qu'il a dit au téléphone…)"
            onKeyDown={(e) => { if (e.key === 'Enter' && add.trim()) void save(withNoteLine(p.notes, noteLine(new Date(), add))); }}
            className="min-w-0 flex-1 basis-60 rounded-lg border border-amber-300 bg-white px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300" />
          <button type="button" disabled={busy || !add.trim()} onClick={() => void save(withNoteLine(p.notes, noteLine(new Date(), add)))}
            className="rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 text-xs font-medium disabled:opacity-40">Ajouter</button>
          {(p.notes ?? '').trim() && <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs text-amber-800 hover:underline"><PenLine className="w-3 h-3" /> Modifier</button>}
        </div>
      )}
    </div>
  );
}

/** Les échanges d'un fil (lus à l'ouverture de la carte) : qui, quand, le début du message. */
function Exchanges({ thread, messages, onOpenThread }: { thread: AgentThread; messages: AgentMessage[]; onOpenThread: (id: string) => void }) {
  const shown = messages.filter((m) => ['recu', 'envoye', 'envoye_main'].includes(m.status)).slice(-6);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <MessagesSquare className="w-3.5 h-3.5 text-slate-500" />
        <span className="font-medium text-slate-800 truncate">{thread.subject || '(sans objet)'}</span>
        <button type="button" onClick={() => onOpenThread(thread.id)} className="ml-auto shrink-0 text-brand-ocean hover:underline">Ouvrir le fil</button>
      </div>
      {shown.length === 0 && <p className="text-xs text-slate-500">Rien d'envoyé ni de reçu dans ce fil pour l'instant.</p>}
      {shown.map((m) => {
        const inbound = m.direction === 'in';
        const who = inbound ? m.from_name || m.from_email || '?' : m.channel === 'linkedin' ? `LinkedIn${m.ai_notes?.personne ? ` — ${m.ai_notes.personne}` : ''}` : m.to_emails.join(', ');
        const text = (m.body_new || m.body_text || '').replace(/\s+/g, ' ').trim();
        return (
          <p key={m.id} className="text-xs text-slate-700 flex items-start gap-1.5">
            {inbound ? <ArrowDownLeft className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" /> : <ArrowUpRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-600" />}
            <span className="min-w-0"><span className="text-slate-500">{fmtDateTime(m.received_at ?? m.sent_at ?? m.created_at)} · {inbound ? 'de' : 'à'} {who}</span> — {text.length > 180 ? `${text.slice(0, 177)}…` : text}</span>
          </p>
        );
      })}
    </div>
  );
}

export function DiscussionCard({ card, agentName, settings, counts, isAdmin, onOpenThread, onChanged, onError, onInfo, onStage, onNotes, onDeep, deeping, onRequalify }: {
  card: WfCard<ProspectDetail, ForYouMessage>; agentName: 'Ada' | 'Dana'; settings: AgentSettings | undefined; counts: AgentCounts | undefined; isAdmin: boolean;
  onOpenThread: (id: string) => void; onChanged: () => void; onError: (e: string) => void; onInfo?: (m: string) => void;
  onStage: (p: ProspectDetail, s: ProspectStage) => void; onNotes: (p: ProspectDetail, notes: string) => Promise<boolean>;
  onDeep: (p: ProspectDetail, note: string) => void; deeping: boolean; onRequalify: (p: ProspectDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showFiche, setShowFiche] = useState(false);
  const [loaded, setLoaded] = useState<Array<{ thread: AgentThread; messages: AgentMessage[] }> | null>(null);
  const p = card.lead;
  const ids = card.threads.map((t) => t.id).join();
  // Ouverte : les échanges de ses fils ; une réponse non lue est lue.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const got = await Promise.all(card.threads.slice(0, 6).map((t) => getThread(t.id)));
      if (!alive) return;
      setLoaded(got.filter((g) => g.thread).map((g) => ({ thread: g.thread as AgentThread, messages: g.messages })));
      const unread = card.threads.filter((t) => t.unread);
      if (unread.length) { await Promise.all(unread.map((t) => setThreadFlags(t.id, { unread: false }))); onChanged(); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ids]);
  const kind = p.account_kind ?? p.kind;
  const who = p.best_contact?.nom ? `${p.best_contact.nom}${p.best_contact.fonction ? ` — ${p.best_contact.fonction}` : ''}` : null;
  const last = card.threads[0];
  const toValidate = card.pending.filter((m) => m.status === 'a_valider' || m.status === 'brouillon');
  const notes = card.pending.filter((m) => m.status === 'pour_channing' && m.channel === 'linkedin');
  const mails = card.pending.filter((m) => m.status === 'pour_channing' && m.channel === 'mail');
  const leaving = card.pending.filter((m) => m.status === 'valide' || m.status === 'envoi');
  const failed = card.pending.filter((m) => m.status === 'echec');
  return (
    <div className={`bg-white border rounded-2xl shadow-sm ${open ? 'border-emerald-300' : card.unread ? 'border-emerald-400' : 'border-slate-200'} ${card.ended ? 'opacity-75' : ''}`}>
      <div className="px-4 py-3 flex items-start gap-2 flex-wrap">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-w-0 flex-1 basis-full md:basis-0 text-left flex items-start gap-2">
          <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 text-emerald-600 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="min-w-0">
            <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
              {p.name}
              {p.country && <span className="text-xs font-normal text-slate-500">{FLAG[p.country] ?? ''} {[p.city, p.country].filter(Boolean).join(', ')}</span>}
              {p.score != null && <span className={`rounded border px-1.5 text-[11px] font-semibold tabular-nums ${scoreTone(p.score)}`}>{p.score}</span>}
              {card.unread && <span className="rounded-full bg-emerald-600 text-white px-1.5 text-[10px] font-medium">réponse non lue</span>}
            </span>
            <span className="block text-xs text-slate-600">{[kind ? KIND_LABEL[kind] ?? kind : null, p.group_name, who].filter(Boolean).join(' · ')}</span>
            <span className="mt-1 flex items-center gap-x-2.5 gap-y-1 flex-wrap text-[11px]">
              {last?.last_message_at && (
                <span className="inline-flex items-center gap-0.5 text-slate-600">
                  {last.last_direction === 'in' ? <ArrowDownLeft className="w-3 h-3 text-emerald-600" /> : <ArrowUpRight className="w-3 h-3 text-blue-600" />}
                  {last.last_direction === 'in' ? 'reçu' : 'dernier envoi'} le {fmtDateTime(last.last_message_at)}{last.counterpart_name || last.counterpart_email ? ` — ${last.counterpart_name || last.counterpart_email}` : ''}
                </span>
              )}
              {toValidate.length > 0 && <span className="text-amber-800">{toValidate.length} à valider</span>}
              {mails.length > 0 && <span className="text-blue-800">{mails.length > 1 ? `${mails.length} mails préparés` : 'un mail préparé'}</span>}
              {notes.length > 0 && <span className="inline-flex items-center gap-0.5 text-sky-800"><Linkedin className="w-3 h-3" /> {notes.length > 1 ? `${notes.length} notes LinkedIn à envoyer` : 'note LinkedIn à envoyer'}</span>}
              {leaving.length > 0 && <span className="inline-flex items-center gap-0.5 text-blue-700"><Clock className="w-3 h-3" /> {leaving.length} validé{leaving.length > 1 ? 's' : ''}, part bientôt</span>}
              {failed.length > 0 && <span className="inline-flex items-center gap-0.5 text-red-700"><AlertTriangle className="w-3 h-3" /> échec d'envoi</span>}
              {(p.notes ?? '').trim() && <span className="inline-flex items-center gap-0.5 text-amber-800"><StickyNote className="w-3 h-3" /> notes</span>}
              {card.twins.length > 0 && <span className="text-slate-500">+ {card.twins.length} autre{card.twins.length > 1 ? 's' : ''} fiche{card.twins.length > 1 ? 's' : ''} de l'entreprise</span>}
            </span>
          </span>
        </button>
        <select value={p.stage} onChange={(e) => onStage(p, e.target.value as ProspectStage)} aria-label="Étape de la discussion"
          className="ml-6 md:ml-auto rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs">
          {TALK_STAGES.map((k) => <option key={k} value={k}>{k === 'qualifie' ? 'Remettre dans les fiches' : STAGE_LABEL[k]}</option>)}
        </select>
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <NotesBox p={p} onSave={(n) => onNotes(p, n)} />
          {/* Ce qui s'est dit d'abord, puis ce qui attend (la réponse à valider, la note à envoyer). */}
          {loaded === null
            ? <p className="text-xs text-slate-500 animate-pulse">Lecture des échanges…</p>
            : loaded.map((x) => <Exchanges key={x.thread.id} thread={x.thread} messages={x.messages} onOpenThread={onOpenThread} />)}
          {card.pending.map((m) => <MessageCard key={`${m.id}-${m.updated_at}`} m={m} settings={settings} counts={counts} isAdmin={isAdmin} flat onChanged={onChanged} onError={onError} onInfo={onInfo} />)}
          {card.twins.length > 0 && (
            <p className="text-xs text-slate-600">Autres fiches de cette entreprise (même site ou même domaine d'adresse), réunies ici : {card.twins.map((t) => `${t.name}${t.city ? ` (${t.city})` : ''}${t.best_contact?.nom ? ` — ${t.best_contact.nom}` : ''}`).join(' · ')}.</p>
          )}
          <button type="button" onClick={() => setShowFiche(!showFiche)} aria-expanded={showFiche} className="inline-flex items-center gap-1 text-xs text-brand-ocean hover:underline">
            <ExternalLink className="w-3.5 h-3.5" /> {showFiche ? 'Masquer la fiche complète' : 'Voir la fiche complète (contacts, e-mails, pistes, sources)'}
          </button>
          {showFiche && (
            <QualifCard p={p} agentName={agentName} onStage={(st) => onStage(p, st)} onRequalify={() => onRequalify(p)} requalifying={false}
              threadId={card.threads[0]?.id ?? null} onDraft={() => undefined} drafting={false} onOpenThread={onOpenThread} onDeep={(note) => onDeep(p, note)} deeping={deeping} />
          )}
        </div>
      )}
    </div>
  );
}
