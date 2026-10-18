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
 * clic ; « Chercher plus loin » lance la recherche approfondie (avec une
 * consigne, si vous en laissez une), et la préparation est refaite avec ce
 * qu'elle trouve. Le mail préparé part aussi de la boîte de l'agente, signé
 * par elle (« Envoyer ») : la même carte de message que la Messagerie.
 */
import { useState } from 'react';
import { Mail, Linkedin, PhoneCall, ExternalLink, ClipboardList, ChevronRight, Telescope, AlertTriangle } from 'lucide-react';
import type { ForYouMessage, CallSheet, AgentSettings, AgentCounts } from '../../services/agents';
import { MessageCard } from './MessageCard';
import { missingOf, lastDeepAt } from '../../lib/agents/deepResearch';
import { KIND_LABEL, fmtDateTime, scoreTone } from './helpers';
import { DeepAsk } from './shared';

const FLAG: Record<string, string> = { FR: '🇫🇷', DE: '🇩🇪', NL: '🇳🇱', BE: '🇧🇪', ES: '🇪🇸', IT: '🇮🇹', DK: '🇩🇰', AT: '🇦🇹', LU: '🇱🇺', SE: '🇸🇪', HU: '🇭🇺', LT: '🇱🇹', PL: '🇵🇱', PT: '🇵🇹', CH: '🇨🇭' };

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

/** Un grand compte, replié sur deux lignes (qui, note, ce qui est prêt, ce qui manque) ; ouvert : la fiche d'appel, le mail et la note LinkedIn préparés. */
export function ForYouCard({ items, settings, counts, isAdmin, onOpenThread, onChanged, onError, onInfo, onDeep, deeping }: {
  items: ForYouMessage[]; settings: AgentSettings | undefined; counts: AgentCounts | undefined; isAdmin: boolean;
  onOpenThread: (id: string) => void; onChanged: () => void; onError: (e: string) => void; onInfo?: (m: string) => void;
  /** La recherche approfondie de ce compte (18/10) : à lancer, ou en cours. */
  onDeep?: (prospectId: string, note: string) => void; deeping?: boolean;
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
        : (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {missing.length > 0 && <span className="text-amber-800">Il manque : {missing.join(', ')}.</span>}
            <DeepAsk name={first.agent === 'dana' ? 'Dana' : 'Ada'} again={!!deepAt} onLaunch={(note) => onDeep(p.id, note)}
              title="L'agente va plus loin sur le web (à qui appartient l'entreprise, qui décide, comment la joindre directement) ; si elle trouve mieux, le mail, la note et la fiche d'appel sont refaits. Environ 0,10 $, plus la nouvelle préparation." />
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
      {[...mail, ...notes].map((m) => <MessageCard key={`${m.id}-${m.updated_at}`} m={m} settings={settings} counts={counts} isAdmin={isAdmin} flat onChanged={onChanged} onError={onError} onInfo={onInfo} />)}
      </div>}
    </div>
  );
}
