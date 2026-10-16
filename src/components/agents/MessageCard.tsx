/**
 * Un message d'un fil d'Ada ou Dana (16/10) : reçu ou sortant, avec ses
 * gestes selon le statut — brouillon → à valider → validé (admin) → envoyé.
 * La base refuse ce qui sort de ce chemin ; l'écran ne propose que le permis.
 */
import { useState } from 'react';
import { Paperclip, Pencil, Send, CheckCircle2, XCircle, Undo2, Trash2, ChevronDown } from 'lucide-react';
import {
  attachmentUrl, editDraft, setMessageStatus, deleteDraft,
  type AgentMessage, type AgentSettings, type AgentCounts, type Draft,
} from '../../services/agents';
import { StatusChip, ClassificationChip, DraftEditor } from './shared';
import { draftProblem, cleanDraft, pendingReason, fmtDateTime } from './helpers';

const KIND_LABEL: Record<string, string> = { premier_contact: 'Premier contact', relance: 'Relance', reponse: 'Réponse' };
const btn = 'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50';
const sizeOf = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1000))} ko`);

interface Props {
  m: AgentMessage;
  settings: AgentSettings | undefined;
  counts: AgentCounts | undefined;
  isAdmin: boolean;
  /** Afficher le fil d'origine (file de validation) plutôt que l'expéditeur. */
  context?: string;
  /** File de validation : pas de décalage gauche/droite de conversation. */
  flat?: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}

export function MessageCard({ m, settings, counts, isAdmin, context, flat, onChanged, onError }: Props) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const out = m.direction === 'out';
  const text = !out && m.body_new && !full ? m.body_new : m.body_text;

  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    const e = await f();
    setBusy(false);
    if (e) onError(e); else onChanged();
  };
  const saveEdit = async (then?: 'a_valider' | 'valide') => {
    if (!editing) return;
    const problem = draftProblem(editing);
    if (problem) { onError(problem); return; }
    await run(async () => {
      const e = await editDraft(m.id, cleanDraft(editing));
      if (e) return e;
      setEditing(null);
      return then && then !== m.status ? setMessageStatus(m.id, then) : null;
    });
  };
  const openAttachment = async (path: string) => {
    const url = await attachmentUrl(path);
    if (url) window.open(url, '_blank', 'noopener'); else onError('Pièce jointe introuvable.');
  };

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${out ? `bg-blue-50/40 border-blue-100 ${flat ? '' : 'md:ml-10'}` : `bg-white border-slate-200 ${flat ? '' : 'md:mr-10'}`}`}>
      <div className="flex items-start justify-between gap-2 text-xs text-slate-500">
        <span className="min-w-0 truncate">
          {context ? <span className="font-medium text-slate-700">{context} · </span> : null}
          {out ? <>{settings?.display_name ?? m.agent} → {m.to_emails.join(', ') || '—'}{m.cc_emails.length ? ` (copie : ${m.cc_emails.join(', ')})` : ''}</>
            : <>{m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email}</>}
        </span>
        <span className="shrink-0">{fmtDateTime(m.received_at ?? m.sent_at ?? m.created_at)}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusChip status={m.status} />
        {out && KIND_LABEL[m.kind] && <span className="text-[11px] text-slate-500">{KIND_LABEL[m.kind]}</span>}
        <ClassificationChip c={m.classification} />
        {out && m.author !== 'humain' && <span className="text-[11px] text-violet-700">rédigé par {m.author === 'ada' ? 'Ada' : m.author === 'dana' ? 'Dana' : 'ADA'}</span>}
      </div>
      {m.subject && !editing && <p className="text-sm font-semibold text-slate-900">{m.subject}</p>}
      {editing ? <DraftEditor draft={editing} onChange={setEditing} autoFocus /> : <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{text || <span className="text-slate-400">(vide)</span>}</p>}
      {!out && m.body_new && m.body_new !== m.body_text && !editing && (
        <button onClick={() => setFull(!full)} className="inline-flex items-center gap-1 text-[11px] text-brand-ocean hover:underline">
          <ChevronDown className={`w-3 h-3 transition-transform ${full ? 'rotate-180' : ''}`} /> {full ? 'Masquer l\'historique' : 'Voir le message entier'}
        </button>
      )}
      {m.translation_fr && !editing && (
        <div className="rounded-lg bg-white/70 border border-slate-200 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Traduction française</p>
          <p className="whitespace-pre-wrap text-xs text-slate-700">{m.translation_fr}</p>
        </div>
      )}
      {m.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {m.attachments.map((a) => (
            <button key={a.path} onClick={() => void openAttachment(a.path)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-brand-ocean">
              <Paperclip className="w-3 h-3" /> {a.name} <span className="text-slate-400">{sizeOf(a.size)}</span>
            </button>
          ))}
        </div>
      )}
      {m.status === 'echec' && m.error && <p className="text-xs text-red-700">{m.error}</p>}
      {m.status === 'refuse' && m.refused_reason && <p className="text-xs text-slate-500">Motif du refus : {m.refused_reason}</p>}
      {(m.status === 'valide' || m.status === 'envoi') && <p className="text-[11px] text-blue-800">{pendingReason(m, settings, counts)}</p>}

      {out && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          {editing ? (
            <>
              <button disabled={busy} onClick={() => void saveEdit()} className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>Enregistrer</button>
              {m.status === 'brouillon' && <button disabled={busy} onClick={() => void saveEdit('a_valider')} className={`${btn} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}><Send className="w-3 h-3" /> Enregistrer et soumettre</button>}
              {isAdmin && <button disabled={busy} onClick={() => void saveEdit('valide')} className={`${btn} border-brand-ocean bg-brand-ocean text-white hover:bg-brand-encre`}><CheckCircle2 className="w-3 h-3" /> Enregistrer et valider</button>}
              <button disabled={busy} onClick={() => setEditing(null)} className={`${btn} border-transparent text-slate-500 hover:text-slate-800`}>Annuler</button>
            </>
          ) : refusing !== null ? (
            <>
              <input autoFocus value={refusing} onChange={(e) => setRefusing(e.target.value)} placeholder="Motif (facultatif) : ton, prix, cible…" className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-2 py-1 text-xs" />
              <button disabled={busy} onClick={() => void run(async () => { const e = await setMessageStatus(m.id, 'refuse', refusing); if (!e) setRefusing(null); return e; })} className={`${btn} border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100`}><XCircle className="w-3 h-3" /> Refuser</button>
              <button onClick={() => setRefusing(null)} className={`${btn} border-transparent text-slate-500`}>Annuler</button>
            </>
          ) : (
            <>
              {(m.status === 'brouillon' || m.status === 'a_valider') && (
                <button disabled={busy} onClick={() => setEditing({ to: m.to_emails, cc: m.cc_emails, subject: m.subject, body: m.body_text })} className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}><Pencil className="w-3 h-3" /> Modifier</button>
              )}
              {m.status === 'brouillon' && (
                <button disabled={busy} onClick={() => void run(() => setMessageStatus(m.id, 'a_valider'))} className={`${btn} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}><Send className="w-3 h-3" /> Soumettre à validation</button>
              )}
              {isAdmin && (m.status === 'brouillon' || m.status === 'a_valider') && (
                <button disabled={busy} onClick={() => void run(() => setMessageStatus(m.id, 'valide'))} className={`${btn} border-brand-ocean bg-brand-ocean text-white hover:bg-brand-encre`}><CheckCircle2 className="w-3 h-3" /> Valider l'envoi</button>
              )}
              {isAdmin && m.status === 'a_valider' && (
                <button disabled={busy} onClick={() => setRefusing('')} className={`${btn} border-rose-200 bg-white text-rose-700 hover:bg-rose-50`}><XCircle className="w-3 h-3" /> Refuser</button>
              )}
              {(m.status === 'valide' || m.status === 'a_valider' || m.status === 'echec' || m.status === 'refuse') && (
                <button disabled={busy} onClick={() => void run(() => setMessageStatus(m.id, 'brouillon'))} className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}><Undo2 className="w-3 h-3" /> {m.status === 'valide' ? 'Annuler l\'envoi' : 'Repasser en brouillon'}</button>
              )}
              {(m.status === 'brouillon' || m.status === 'a_valider' || m.status === 'refuse') && (
                <button disabled={busy} onClick={() => { if (window.confirm('Supprimer ce brouillon ?')) void run(() => deleteDraft(m)); }} className={`${btn} border-transparent text-slate-400 hover:text-rose-700`}><Trash2 className="w-3 h-3" /> Supprimer</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
