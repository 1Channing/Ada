/**
 * « Pour vous » (17/10, Channing : « elles préparent, vous envoyez » ;
 * « publiées seulement + LinkedIn ») : ce qu'Ada et Dana préparent pour un
 * GRAND COMPTE (groupe de distribution, loueur, leasing, flotte) et que vous
 * envoyez vous-même — le mail depuis votre Gmail, la note d'invitation sur
 * votre LinkedIn, l'appel avec la fiche. Une fois envoyé, « Marquer envoyé » :
 * le message est figé, le prospect passe « contacté », le journal le note.
 * Rien ne part tout seul : ni la boîte de l'agente, ni votre compte.
 * 18/10 (Channing : « que par défaut les grands comptes soient réduits,
 * pour qu'on ait une vue d'ensemble ») : chaque compte tient sur deux
 * lignes — qui, la note, ce qui est prêt, ce qui manque — et s'ouvre d'un
 * clic ; « Chercher plus loin » lance la recherche approfondie, et la
 * préparation est refaite avec ce qu'elle trouve.
 */
import { useState } from 'react';
import { Mail, Linkedin, PhoneCall, Copy, Check, ExternalLink, Send, XCircle, ClipboardList, Search, ChevronRight, Telescope, AlertTriangle } from 'lucide-react';
import { markSentByHand, setMessageStatus, gmailComposeUrl, type ForYouMessage, type CallSheet } from '../../services/agents';
import { missingOf, lastDeepAt } from '../../lib/agents/deepResearch';
import { KIND_LABEL, fmtDateTime, scoreTone } from './helpers';

const FLAG: Record<string, string> = { FR: '🇫🇷', DE: '🇩🇪', NL: '🇳🇱', BE: '🇧🇪', ES: '🇪🇸', IT: '🇮🇹', DK: '🇩🇰', AT: '🇦🇹', LU: '🇱🇺', SE: '🇸🇪', HU: '🇭🇺', LT: '🇱🇹', PL: '🇵🇱', PT: '🇵🇹', CH: '🇨🇭' };
const btn = 'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50';

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* repli ci-dessous */ }
  try {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => void copy(text).then((ok) => { setDone(ok); if (ok) window.setTimeout(() => setDone(false), 1500); })} className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
      {done ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />} {done ? 'Copié' : label}
    </button>
  );
}

function Sheet({ s }: { s: CallSheet }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1.5 text-sm">
      <p className="text-[10px] uppercase tracking-wide text-slate-400 flex items-center gap-1"><ClipboardList className="w-3 h-3" /> Fiche d'appel</p>
      {s.interlocuteur && <p className="text-slate-900"><span className="text-xs text-slate-500">Qui :</span> {s.interlocuteur}</p>}
      {s.pourquoi && <p className="text-xs text-slate-600">{s.pourquoi}</p>}
      {s.accroche && <p className="text-slate-800"><span className="text-xs text-slate-500">Accroche :</span> « {s.accroche} »</p>}
      {s.points.length > 0 && (
        <div><p className="text-xs text-slate-500">À dire</p>{s.points.map((x) => <p key={x} className="text-xs text-slate-800">• {x}</p>)}</div>
      )}
      {s.questions.length > 0 && (
        <div><p className="text-xs text-slate-500">À demander</p>{s.questions.map((x) => <p key={x} className="text-xs text-slate-800">• {x}</p>)}</div>
      )}
    </div>
  );
}

/** Un message préparé (le mail ou la note LinkedIn), avec ses gestes. */
function Prepared({ m, isAdmin, onChanged, onError }: { m: ForYouMessage; isAdmin: boolean; onChanged: () => void; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [showFr, setShowFr] = useState(false);
  const linkedin = m.channel === 'linkedin';
  const n = m.ai_notes ?? {};
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    const e = await f();
    setBusy(false);
    if (e) onError(e); else onChanged();
  };
  const sent = () => {
    if (!window.confirm(linkedin ? 'Vous avez envoyé l\'invitation depuis votre LinkedIn ?' : 'Vous avez envoyé ce mail depuis votre boîte ?')) return;
    void run(() => markSentByHand(m.id));
  };
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${linkedin ? 'border-sky-200 bg-sky-50/40' : 'border-blue-100 bg-blue-50/40'}`}>
      <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
        {linkedin ? <Linkedin className="w-4 h-4 text-sky-700" /> : <Mail className="w-4 h-4 text-blue-700" />}
        <span className="font-medium text-slate-800">{linkedin ? 'Note d\'invitation LinkedIn' : `Mail à ${m.to_emails.join(', ')}`}</span>
        {linkedin && <span className={m.body_text.length > 300 ? 'text-rose-700' : 'text-slate-400'}>{m.body_text.length}/300 caractères</span>}
        {n.langue && n.langue !== 'fr' && m.translation_fr && (
          <button onClick={() => setShowFr(!showFr)} className="ml-auto text-brand-ocean hover:underline">{showFr ? 'Masquer la traduction' : 'Traduction française'}</button>
        )}
      </div>
      {!linkedin && m.subject && <p className="text-sm font-semibold text-slate-900">{m.subject}</p>}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{m.body_text}</p>
      {showFr && m.translation_fr && (
        <div className="rounded-lg bg-white/70 border border-slate-200 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Traduction française</p>
          <p className="whitespace-pre-wrap text-xs text-slate-700">{m.translation_fr}</p>
        </div>
      )}
      {!linkedin && n.alertes && n.alertes.length > 0 && (
        <div>{n.alertes.map((a) => <p key={a} className="text-xs text-amber-900">• {a}</p>)}</div>
      )}
      {refusing !== null ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <input autoFocus value={refusing} onChange={(e) => setRefusing(e.target.value)} placeholder="Pourquoi (facultatif) : cible, ton, moment…" className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-2 py-1 text-xs" />
          <button disabled={busy} onClick={() => void run(() => setMessageStatus(m.id, 'refuse', refusing))} className={`${btn} border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100`}><XCircle className="w-3 h-3" /> Écarter</button>
          <button onClick={() => setRefusing(null)} className={`${btn} border-transparent text-slate-500`}>Annuler</button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          {linkedin ? (
            <>
              <CopyButton text={m.body_text} label="Copier la note" />
              {n.linkedin_url
                ? <a href={n.linkedin_url} target="_blank" rel="noreferrer" className={`${btn} border-sky-300 bg-white text-sky-800 hover:bg-sky-50`}><ExternalLink className="w-3 h-3" /> Ouvrir le profil{n.linkedin_nom ? ` de ${n.linkedin_nom}` : ''}</a>
                : n.linkedin_recherche && <a href={n.linkedin_recherche} target="_blank" rel="noreferrer" className={`${btn} border-sky-300 bg-white text-sky-800 hover:bg-sky-50`} title="Profil pas encore trouvé : la recherche LinkedIn de la bonne personne"><Search className="w-3 h-3" /> Chercher sur LinkedIn</a>}
            </>
          ) : (
            <>
              <a href={gmailComposeUrl(m.to_emails, m.subject, m.body_text)} target="_blank" rel="noreferrer" className={`${btn} border-blue-300 bg-white text-blue-800 hover:bg-blue-50`} title="S'ouvre dans votre Gmail (le compte Google ouvert dans ce navigateur), prêt à partir avec votre signature">
                <ExternalLink className="w-3 h-3" /> Ouvrir dans Gmail
              </a>
              <CopyButton text={`${m.subject}\n\n${m.body_text}`} label="Copier" />
            </>
          )}
          {isAdmin && (
            <>
              <button disabled={busy} onClick={sent} className={`${btn} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}><Send className="w-3 h-3" /> Marquer envoyé</button>
              <button disabled={busy} onClick={() => setRefusing('')} className={`${btn} border-transparent text-slate-500 hover:text-rose-700`}><XCircle className="w-3 h-3" /> Écarter</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Un grand compte, replié sur deux lignes (qui, note, ce qui est prêt, ce qui manque) ; ouvert : la fiche d'appel, le mail et la note LinkedIn préparés. */
export function ForYouCard({ items, isAdmin, onOpenThread, onChanged, onError, onDeep, deeping }: {
  items: ForYouMessage[]; isAdmin: boolean; onOpenThread: (id: string) => void; onChanged: () => void; onError: (e: string) => void;
  /** La recherche approfondie de ce compte (18/10) : à lancer, ou en cours. */
  onDeep?: (prospectId: string) => void; deeping?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const first = items[0];
  const p = first.thread?.prospect ?? null;
  const sheet = items.map((m) => m.ai_notes?.fiche_appel).find((x): x is CallSheet => !!x) ?? null;
  const mail = items.filter((m) => m.channel === 'mail');
  const notes = items.filter((m) => m.channel === 'linkedin');
  const kind = p?.account_kind ?? p?.kind ?? null;
  const missing = p ? missingOf({ best_contact: p.best_contact, emails: p.emails ?? [], people: p.people ?? [], phone: p.phone }) : [];
  const deepAt = lastDeepAt(p?.evidence);
  const leads = (p?.evidence ?? []).filter((e) => e.piste);
  const name = p?.name ?? first.thread?.counterpart_name ?? first.thread?.subject ?? 'Grand compte';
  const who = p?.best_contact?.nom ? `${p.best_contact.nom}${p.best_contact.fonction ? ` — ${p.best_contact.fonction}` : ''}` : null;
  return (
    <div className={`bg-white border rounded-2xl shadow-sm ${open ? 'border-violet-300' : 'border-violet-200'}`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full text-left px-4 py-3 flex items-start gap-2 flex-wrap hover:bg-violet-50/40 rounded-2xl">
        <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 text-violet-600 transition-transform ${open ? 'rotate-90' : ''}`} />
        <div className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-0">
          <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
            {name}
            {p?.country && <span className="text-xs font-normal text-slate-500">{FLAG[p.country] ?? ''} {[p.city, p.country].filter(Boolean).join(', ')}</span>}
          </p>
          <p className="text-xs text-slate-600">
            {[kind ? KIND_LABEL[kind] ?? kind : null, p?.group_name ? (/^groupe?\b/i.test(p.group_name) ? p.group_name : `groupe ${p.group_name}`) : null, first.agent === 'dana' ? 'fournisseur possible' : 'acheteur possible'].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 flex items-center gap-x-2.5 gap-y-1 flex-wrap text-[11px]">
            {who && <span className="text-slate-800 font-medium">{who}</span>}
            {mail.length > 0 ? <span className="inline-flex items-center gap-0.5 text-blue-800"><Mail className="w-3 h-3" /> mail prêt</span> : <span className="text-slate-400">pas de mail (aucun e-mail publié)</span>}
            {notes.length > 0 && <span className="inline-flex items-center gap-0.5 text-sky-800"><Linkedin className="w-3 h-3" /> note LinkedIn</span>}
            {sheet && <span className="inline-flex items-center gap-0.5 text-slate-700"><ClipboardList className="w-3 h-3" /> fiche d'appel</span>}
            {deepAt && <span className="inline-flex items-center gap-0.5 text-indigo-800"><Telescope className="w-3 h-3" /> recherche approfondie</span>}
            {missing.length > 0 && <span className="inline-flex items-center gap-0.5 text-amber-800"><AlertTriangle className="w-3 h-3" /> manque : {missing.join(', ')}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {p?.score != null && <span className={`rounded-lg border px-2 py-0.5 text-sm font-bold tabular-nums ${scoreTone(p.score)}`}>{p.score}<span className="text-[10px] font-normal">/100</span></span>}
          <span className="text-[11px] text-slate-400 whitespace-nowrap">préparé {fmtDateTime(first.created_at)}</span>
        </div>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">
      {p?.summary && <p className="text-sm text-slate-700">{p.summary}</p>}
      {leads.length > 0 && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-xs space-y-0.5">
          <p className="text-indigo-900 font-medium inline-flex items-center gap-1"><Telescope className="w-3.5 h-3.5" /> Pistes de la recherche approfondie{deepAt ? ` du ${fmtDateTime(deepAt)}` : ''}</p>
          {leads.map((l, i) => <p key={`${l.note}-${i}`} className="text-slate-800">• {l.note}</p>)}
        </div>
      )}
      {p && onDeep && (deeping
        ? <p className="text-xs text-indigo-700 animate-pulse">{first.agent === 'dana' ? 'Dana' : 'Ada'} cherche plus loin : à qui appartient l'entreprise, qui décide… la préparation sera refaite si elle trouve mieux.</p>
        : missing.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-amber-800">Il manque : {missing.join(', ')}.</span>
            <button onClick={() => onDeep(p.id)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-2 py-1 font-medium text-indigo-800 hover:bg-indigo-50"
              title="L'agente va plus loin sur le web (à qui appartient l'entreprise, qui décide, e-mails et téléphones publiés) ; si elle trouve mieux, le mail, la note et la fiche d'appel sont refaits. Environ 0,10 $, plus la nouvelle préparation.">
              <Telescope className="w-3.5 h-3.5" /> {deepAt ? 'Chercher encore plus loin' : 'Chercher plus loin'}
            </button>
          </div>
        ))}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        {p?.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-slate-700 hover:text-brand-ocean"><PhoneCall className="w-3.5 h-3.5" /> {p.phone}</a>}
        {p?.website && <a href={p.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-ocean hover:underline"><ExternalLink className="w-3.5 h-3.5" /> {p.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>}
        {p?.best_contact?.nom && <span className="text-slate-700">{p.best_contact.nom}{p.best_contact.fonction ? ` — ${p.best_contact.fonction}` : ''}</span>}
        {!mail.length && <span className="text-slate-500">Pas d'e-mail publié : LinkedIn et téléphone.</span>}
        <button onClick={() => onOpenThread(first.thread_id)} className="ml-auto text-brand-ocean hover:underline">Ouvrir le fil</button>
      </div>
      {sheet && <Sheet s={sheet} />}
      {mail.map((m) => <Prepared key={`${m.id}-${m.updated_at}`} m={m} isAdmin={isAdmin} onChanged={onChanged} onError={onError} />)}
      {notes.map((m) => <Prepared key={`${m.id}-${m.updated_at}`} m={m} isAdmin={isAdmin} onChanged={onChanged} onError={onError} />)}
      </div>}
    </div>
  );
}
