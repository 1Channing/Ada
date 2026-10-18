/**
 * Un message d'un fil d'Ada ou Dana (16/10) : reçu ou sortant, avec ses
 * gestes selon le statut — brouillon → à valider → validé (admin) → envoyé.
 * La base refuse ce qui sort de ce chemin ; l'écran ne propose que le permis.
 * 18/10 (Channing : « des éléments dans la messagerie avec lesquels je ne
 * peux rien faire » ; « un bouton Envoyer […] avec l'adresse de l'agente ») :
 * la même carte partout (Messagerie, À valider, Pour vous), chaque message
 * avec ses gestes. Préparé pour vous : Envoyer (depuis la boîte de l'agente,
 * signé par elle), Modifier, l'ouvrir dans votre Gmail, Marquer envoyé,
 * Écarter. Une note LinkedIn : la copier, ouvrir le profil, Marquer envoyée.
 */
import { useState } from 'react';
import { Paperclip, Pencil, Send, XCircle, Undo2, Trash2, ChevronDown, ExternalLink, Search, Linkedin, CheckCircle2 } from 'lucide-react';
import {
  attachmentUrl, editDraft, setMessageStatus, deleteDraft, sendFromAgent, markSentByHand, gmailComposeUrl,
  type AgentMessage, type AgentSettings, type AgentCounts, type Draft,
} from '../../services/agents';
import { StatusChip, ClassificationChip, DraftEditor, CopyButton } from './shared';
import { draftProblem, cleanDraft, pendingReason, fmtDateTime } from './helpers';
import { fmtUsd } from '../../lib/agents/aiCost';

const FACT_SOURCE: Record<string, string> = { fiche: 'sa fiche', stock: 'son stock', lot: 'ses lots', offre: 'nos offres', mc_export: 'MC Export', consignes: 'vos consignes', fil: 'son mail' };

const KIND_LABEL: Record<string, string> = { premier_contact: 'Premier contact', relance: 'Relance', reponse: 'Réponse' };
const btn = 'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50';
const sizeOf = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1000))} ko`);
const LINKEDIN_MAX = 300;

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
  /** Ce qui vient de se passer, en clair (« il part de dana@… dès que… »). */
  onInfo?: (msg: string) => void;
}

export function MessageCard({ m, settings, counts, isAdmin, context, flat, onChanged, onError, onInfo }: Props) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const out = m.direction === 'out';
  const linkedin = m.channel === 'linkedin';
  const prepared = m.status === 'pour_channing';
  const n = m.ai_notes ?? {};
  const name = settings?.display_name ?? (m.agent === 'dana' ? 'Dana' : 'Ada');
  const mailbox = settings?.mailbox ?? m.mailbox;
  const text = !out && m.body_new && !full ? m.body_new : m.body_text;
  // Un mail qui peut encore partir de la boîte de l'agente : brouillon, à valider, ou préparé pour vous.
  const sendable = out && !linkedin && (m.status === 'brouillon' || m.status === 'a_valider' || prepared);

  const run = async (f: () => Promise<string | null>, done?: string) => {
    setBusy(true);
    const e = await f();
    setBusy(false);
    if (e) onError(e); else { if (done) onInfo?.(done); onChanged(); }
  };
  const send = async (d?: Draft) => {
    if (!settings) { onError('Réglages de l\'agente illisibles : rechargez la page.'); return; }
    if (d) { const problem = draftProblem(d); if (problem) { onError(problem); return; } }
    const to = (d ? cleanDraft(d).to : m.to_emails).join(', ');
    // Un texte préparé avant le 18/10 pouvait parler au nom de Channing : il partira signé par l'agente.
    const asChanning = prepared && /\bChanning\b/.test(d?.body ?? m.body_text);
    if (!window.confirm(`Envoyer ce mail depuis ${mailbox}${prepared ? `, signé ${name},` : ''} à ${to} ?${asChanning ? `\n\nAttention : le texte parle de Channing à la première personne, et il partira signé ${name}. Modifiez-le d'abord si besoin.` : ''}`)) return;
    await run(async () => {
      let body = m.body_text;
      if (d) {
        const clean = cleanDraft(d);
        const e = await editDraft(m.id, clean);
        if (e) return e;
        body = clean.body;
        setEditing(null);
      }
      return sendFromAgent({ id: m.id, status: m.status, body_text: body }, settings);
    }, `Envoi validé : le mail part de ${mailbox} dès que ses horaires, son plafond du jour et l'écart entre deux envois le permettent (le moment exact s'affiche sur le message).`);
  };
  const saveEdit = async (then?: 'a_valider') => {
    if (!editing) return;
    if (!linkedin) { const problem = draftProblem(editing); if (problem) { onError(problem); return; } }
    await run(async () => {
      const e = await editDraft(m.id, linkedin ? { to: [], cc: [], subject: m.subject, body: editing.body.trim() } : cleanDraft(editing));
      if (e) return e;
      setEditing(null);
      return then && then !== m.status ? setMessageStatus(m.id, then) : null;
    });
  };
  const markSent = () => {
    if (!window.confirm(linkedin ? 'Vous avez envoyé l\'invitation depuis votre LinkedIn ?' : 'Vous avez envoyé ce mail depuis votre propre boîte ?')) return;
    void run(() => markSentByHand(m.id));
  };
  const openAttachment = async (path: string) => {
    const url = await attachmentUrl(path);
    if (url) window.open(url, '_blank', 'noopener'); else onError('Pièce jointe introuvable.');
  };

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${!out ? `bg-white border-slate-200 ${flat ? '' : 'md:mr-10'}` : linkedin ? `bg-sky-50/40 border-sky-200 ${flat ? '' : 'md:ml-10'}` : `bg-blue-50/40 border-blue-100 ${flat ? '' : 'md:ml-10'}`}`}>
      <div className="flex items-start justify-between gap-2 text-xs text-slate-500">
        <span className="min-w-0 truncate">
          {context ? <span className="font-medium text-slate-700">{context} · </span> : null}
          {!out ? <>{m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email}</>
            : linkedin ? <><Linkedin className="inline w-3.5 h-3.5 -mt-0.5 text-sky-700" /> Note d'invitation LinkedIn{n.linkedin_nom ? ` pour ${n.linkedin_nom}` : ''} — depuis votre LinkedIn</>
              : <>{name} → {m.to_emails.join(', ') || 'destinataire à choisir'}{m.cc_emails.length ? ` (copie : ${m.cc_emails.join(', ')})` : ''}</>}
        </span>
        <span className="shrink-0">{fmtDateTime(m.received_at ?? m.sent_at ?? m.created_at)}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusChip status={m.status} />
        {out && !linkedin && KIND_LABEL[m.kind] && <span className="text-[11px] text-slate-500">{KIND_LABEL[m.kind]}</span>}
        <ClassificationChip c={m.classification} />
        {out && m.author !== 'humain' && <span className="text-[11px] text-violet-700">rédigé par {m.author === 'ada' ? 'Ada' : m.author === 'dana' ? 'Dana' : 'ADA'}</span>}
        {n.grand_compte && <span className="text-[11px] rounded-full px-1.5 py-0 bg-violet-50 text-violet-800 border border-violet-200">grand compte</span>}
        {linkedin && <span className={`text-[11px] ${m.body_text.length > LINKEDIN_MAX ? 'text-rose-700' : 'text-slate-400'}`}>{m.body_text.length}/{LINKEDIN_MAX} caractères</span>}
      </div>
      {m.subject && !linkedin && !editing && <p className="text-sm font-semibold text-slate-900">{m.subject}</p>}
      {editing
        ? (linkedin
          ? <textarea autoFocus value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} className="w-full min-h-[90px] rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          : <DraftEditor draft={editing} onChange={setEditing} autoFocus />)
        : <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{text || <span className="text-slate-400">(vide)</span>}</p>}
      {!out && m.body_new && m.body_new !== m.body_text && !editing && (
        <button onClick={() => setFull(!full)} className="inline-flex items-center gap-1 text-[11px] text-brand-ocean hover:underline">
          <ChevronDown className={`w-3 h-3 transition-transform ${full ? 'rotate-180' : ''}`} /> {full ? 'Masquer l\'historique' : 'Voir le message entier'}
        </button>
      )}
      {m.translation_fr && !editing && (
        <details className="rounded-lg bg-white/70 border border-slate-200 px-3 py-2">
          <summary className="text-[11px] text-slate-500 cursor-pointer">Traduction française</summary>
          <p className="whitespace-pre-wrap text-xs text-slate-700 mt-1">{m.translation_fr}</p>
        </details>
      )}
      {out && m.ai_notes && !editing && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2 space-y-1">
          {n.resume && <p className="text-xs text-slate-800"><span className="text-[10px] uppercase tracking-wide text-violet-700">Ce qu'il demande</span> · {n.resume}{n.appel ? ' — à appeler' : ''}</p>}
          {n.alertes?.length
            ? <div><p className="text-[10px] uppercase tracking-wide text-amber-700">À vérifier avant d'envoyer</p>{n.alertes.map((a) => <p key={a} className="text-xs text-amber-900">• {a}</p>)}</div>
            : <p className="text-[11px] text-emerald-700">Contrôle d'ADA : longueur, question, liens et chiffres en ordre.</p>}
          {(n.faits?.length ?? 0) > 0 && (
            <details>
              <summary className="text-[11px] text-violet-800 cursor-pointer">Faits cités ({n.faits?.length}), avec leur source</summary>
              {n.faits?.map((f) => <p key={f.fait} className="text-xs text-slate-700">• {f.fait} <span className="text-slate-400">({FACT_SOURCE[f.source] ?? f.source})</span></p>)}
            </details>
          )}
          <p className="text-[10px] text-slate-400">{[n.modele, n.mots ? `${n.mots} mots` : null, n.cout_usd != null ? fmtUsd(n.cout_usd) : null].filter(Boolean).join(' · ')}</p>
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
      {m.status === 'refuse' && m.refused_reason && <p className="text-xs text-slate-500">Motif : {m.refused_reason}</p>}
      {(m.status === 'valide' || m.status === 'envoi') && <p className="text-[11px] text-blue-800">{pendingReason(m, settings, counts)}</p>}
      {prepared && (
        <p className="text-[11px] text-violet-800">{linkedin
          ? `À envoyer depuis votre LinkedIn (${LINKEDIN_MAX} caractères au plus), puis « Marquer envoyée ».`
          : `Préparé pour vous : « Envoyer » le fait partir de ${mailbox}, signé ${name} — ou envoyez-le de votre propre boîte (« Ouvrir dans Gmail »), puis « Marquer envoyé ».`}</p>
      )}
      {m.status === 'envoye_main' && <p className="text-[11px] text-emerald-800">{linkedin ? 'Envoyée par vous sur LinkedIn' : 'Envoyé par vous, de votre boîte'}{m.sent_at ? ` le ${fmtDateTime(m.sent_at)}` : ''}.</p>}

      {out && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          {editing ? (
            <>
              <button disabled={busy} onClick={() => void saveEdit()} className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>Enregistrer</button>
              {m.status === 'brouillon' && !linkedin && <button disabled={busy} onClick={() => void saveEdit('a_valider')} className={`${btn} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}><Send className="w-3 h-3" /> Enregistrer et soumettre</button>}
              {isAdmin && sendable && <button disabled={busy} onClick={() => void send(editing)} className={`${btn} border-brand-ocean bg-brand-ocean text-white hover:bg-brand-encre`}><Send className="w-3 h-3" /> Enregistrer et envoyer</button>}
              <button disabled={busy} onClick={() => setEditing(null)} className={`${btn} border-transparent text-slate-500 hover:text-slate-800`}>Annuler</button>
            </>
          ) : refusing !== null ? (
            <>
              <input autoFocus value={refusing} onChange={(e) => setRefusing(e.target.value)} placeholder="Pourquoi (facultatif) : cible, ton, moment…" className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-2 py-1 text-xs" />
              <button disabled={busy} onClick={() => void run(async () => { const e = await setMessageStatus(m.id, 'refuse', refusing); if (!e) setRefusing(null); return e; })} className={`${btn} border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100`}><XCircle className="w-3 h-3" /> {prepared ? 'Écarter' : 'Refuser'}</button>
              <button onClick={() => setRefusing(null)} className={`${btn} border-transparent text-slate-500`}>Annuler</button>
            </>
          ) : (
            <>
              {isAdmin && sendable && (
                <button disabled={busy} onClick={() => void send()} className={`${btn} border-brand-ocean bg-brand-ocean text-white hover:bg-brand-encre`} title={`Part de ${mailbox}${prepared ? `, signé ${name}` : ''}, dans ses horaires d'envoi`}>
                  <Send className="w-3 h-3" /> Envoyer
                </button>
              )}
              {(sendable || (linkedin && prepared)) && (
                <button disabled={busy} onClick={() => setEditing({ to: m.to_emails, cc: m.cc_emails, subject: m.subject, body: m.body_text })} className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}><Pencil className="w-3 h-3" /> Modifier</button>
              )}
              {m.status === 'brouillon' && !linkedin && (
                <button disabled={busy} onClick={() => void run(() => setMessageStatus(m.id, 'a_valider'))} className={`${btn} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}><Send className="w-3 h-3" /> Soumettre à validation</button>
              )}
              {prepared && linkedin && <CopyButton text={m.body_text} label="Copier la note" />}
              {prepared && linkedin && (n.linkedin_url
                ? <a href={n.linkedin_url} target="_blank" rel="noreferrer" className={`${btn} border-sky-300 bg-white text-sky-800 hover:bg-sky-50`}><ExternalLink className="w-3 h-3" /> Ouvrir le profil{n.linkedin_nom ? ` de ${n.linkedin_nom}` : ''}</a>
                : n.linkedin_recherche && <a href={n.linkedin_recherche} target="_blank" rel="noreferrer" className={`${btn} border-sky-300 bg-white text-sky-800 hover:bg-sky-50`} title="Profil pas encore trouvé : la recherche LinkedIn de la bonne personne"><Search className="w-3 h-3" /> Chercher sur LinkedIn</a>)}
              {prepared && !linkedin && (
                <a href={gmailComposeUrl(m.to_emails, m.subject, m.body_text)} target="_blank" rel="noreferrer" className={`${btn} border-blue-300 bg-white text-blue-800 hover:bg-blue-50`} title="S'ouvre dans votre Gmail (le compte Google ouvert dans ce navigateur), avec votre signature">
                  <ExternalLink className="w-3 h-3" /> Ouvrir dans Gmail
                </a>
              )}
              {prepared && !linkedin && <CopyButton text={`${m.subject}\n\n${m.body_text}`} label="Copier" />}
              {isAdmin && prepared && (
                <button disabled={busy} onClick={markSent} className={`${btn} border-emerald-600 bg-white text-emerald-800 hover:bg-emerald-50`}><CheckCircle2 className="w-3 h-3" /> {linkedin ? 'Marquer envoyée' : 'Marquer envoyé'}</button>
              )}
              {isAdmin && (m.status === 'a_valider' || prepared) && (
                <button disabled={busy} onClick={() => setRefusing('')} className={`${btn} border-rose-200 bg-white text-rose-700 hover:bg-rose-50`}><XCircle className="w-3 h-3" /> {prepared ? 'Écarter' : 'Refuser'}</button>
              )}
              {!linkedin && (m.status === 'valide' || m.status === 'a_valider' || m.status === 'echec' || m.status === 'refuse') && (
                <button disabled={busy} onClick={() => void run(() => setMessageStatus(m.id, 'brouillon'))} className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}><Undo2 className="w-3 h-3" /> {m.status === 'valide' ? 'Annuler l\'envoi' : 'Repasser en brouillon'}</button>
              )}
              {(m.status === 'brouillon' || m.status === 'a_valider' || m.status === 'refuse') && (
                <button disabled={busy} onClick={() => { if (window.confirm(linkedin ? 'Supprimer cette note ?' : 'Supprimer ce brouillon ?')) void run(() => deleteDraft(m)); }} className={`${btn} border-transparent text-slate-400 hover:text-rose-700`}><Trash2 className="w-3 h-3" /> Supprimer</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
