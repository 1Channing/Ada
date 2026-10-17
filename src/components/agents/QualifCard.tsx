/**
 * La fiche d'un garage qualifié par Ada (acheteur) ou Dana (fournisseur)
 * (17/10) : le score et ce qui le compose, qui ils sont, à qui écrire, les
 * e-mails publiés (vérifiés : le domaine reçoit du courrier), les profils
 * LinkedIn vus, les lots (Dana), les pages lues, le coût. Un grand compte
 * (groupe, loueur, leasing, flotte) est préparé pour Channing, qui envoie
 * lui-même. L'équipe change l'étape (à contacter, écarté…) ; le reste vient
 * du worker.
 */
import { useState } from 'react';
import { CheckCircle2, XCircle, ExternalLink, RefreshCw, User, Mail, MapPin, PenLine, MessagesSquare, Crown, Linkedin, Layers } from 'lucide-react';
import type { ProspectDetail, ProspectStage } from '../../services/agents';
import { fmtUsd } from '../../lib/agents/aiCost';
import { lotLine } from '../../lib/agents/sourcing';
import { fmtDateTime, KIND_LABEL, STAGE_LABEL, LANG_LABEL, scoreTone } from './helpers';

interface Props {
  p: ProspectDetail; onStage: (s: ProspectStage) => void; onRequalify: () => void; requalifying: boolean;
  /** Le fil de ce garage, s'il existe ; sinon l'agente peut rédiger le premier contact. */
  threadId: string | null; onDraft: () => void; drafting: boolean; onOpenThread: (id: string) => void;
  /** Qui l'a qualifié : Ada (acheteurs, par défaut) ou Dana (fournisseurs). */
  agentName?: 'Ada' | 'Dana';
}

const LiLink = ({ url }: { url: string | null | undefined }) => (url
  ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center text-sky-700 hover:text-sky-900" title="Profil LinkedIn (vu dans une page lue)"><Linkedin className="w-3.5 h-3.5" /></a>
  : null);

export function QualifCard({ p, onStage, onRequalify, requalifying, threadId, onDraft, drafting, onOpenThread, agentName = 'Ada' }: Props) {
  const [allEmails, setAllEmails] = useState(false);
  const best = p.best_contact;
  const emails = allEmails ? p.emails : p.emails.slice(0, 5);
  const key = p.key_account === true;
  const verified = !!best?.email && p.emails.some((e) => e.email === best.email && e.mx);
  const open = ['qualifie', 'a_contacter'].includes(p.stage);
  return (
    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/40 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`rounded-lg border px-2 py-0.5 text-base font-bold tabular-nums ${scoreTone(p.score)}`}>{p.score ?? '—'}<span className="text-xs font-normal">/100</span></span>
        <span className="text-xs text-violet-900 font-medium">Fiche {agentName === 'Ada' ? 'd\'Ada' : 'de Dana'} du {fmtDateTime(p.qualified_at)}</span>
        {key && <span className="inline-flex items-center gap-1 text-[11px] rounded-full px-1.5 py-0.5 bg-violet-600 text-white" title="Groupe, loueur, leasing, flotte : préparé pour vous, vous envoyez vous-même"><Crown className="w-3 h-3" /> grand compte</span>}
        <span className="text-xs text-slate-400">· {fmtUsd(Number(p.qualify_cost_usd))}</span>
        {p.network_contact_id && <span className="inline-flex items-center gap-1 text-[11px] rounded-full px-1.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-200"><MapPin className="w-3 h-3" /> sur la carte</span>}
        <select value={p.stage} onChange={(e) => onStage(e.target.value as ProspectStage)} className="ml-auto rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs">
          {(Object.keys(STAGE_LABEL) as ProspectStage[]).map((k) => <option key={k} value={k}>{STAGE_LABEL[k]}</option>)}
        </select>
        <button disabled={requalifying} onClick={onRequalify} className="inline-flex items-center gap-1 text-xs text-violet-800 hover:underline disabled:opacity-40" title="Relire les pages et refaire la fiche">
          <RefreshCw className="w-3.5 h-3.5" /> Refaire la fiche
        </button>
      </div>
      {p.summary && <p className="text-slate-800">{p.summary}</p>}
      {(p.lots?.length ?? 0) > 0 && (
        <div className="text-xs space-y-0.5">
          <p className="text-slate-400 inline-flex items-center gap-1"><Layers className="w-3 h-3" /> Lots vus par Dana</p>
          {p.lots?.map((l) => <p key={`${l.brand}|${l.model}|${l.year}`} className="text-teal-900">• {lotLine(l, true)}</p>)}
        </div>
      )}
      {p.stage === 'ecarte' && p.exclusion_reason && <p className="text-xs text-rose-700">Écarté : {p.exclusion_reason}</p>}
      <p className="text-xs text-slate-600">
        {[p.kind ? KIND_LABEL[p.kind] ?? p.kind : null, p.group_name ? (/^groupe?\b/i.test(p.group_name) ? p.group_name : `groupe ${p.group_name}`) : null, p.sites ? `${p.sites} site${p.sites > 1 ? 's' : ''}` : null,
          p.brands_official?.length ? `officiel : ${p.brands_official.join(', ')}` : null, p.language ? `écrire en ${LANG_LABEL[p.language] ?? p.language}` : null,
          p.legal_name].filter(Boolean).join(' · ')}
        {p.website && <> · <a href={p.website} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline">{p.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></>}
      </p>
      {((best && (best.nom || best.email)) || key) && (
        <div className="rounded-lg bg-white border border-slate-200 px-2.5 py-1.5">
          <p className="text-xs text-slate-500">{key ? 'Qui décide (grand compte : vous écrivez vous-même)' : 'À qui écrire'}</p>
          {best && (best.nom || best.email) ? (
            <p className="text-slate-900">
              <User className="inline w-3.5 h-3.5 mr-1 text-slate-400" />{best.nom ?? 'service'}{best.fonction ? ` — ${best.fonction}` : ''} <LiLink url={best.linkedin} />
              {best.email && <> · <Mail className="inline w-3.5 h-3.5 mx-1 text-slate-400" /><span className="font-medium">{best.email}</span></>}
            </p>
          ) : <p className="text-xs text-slate-500">Personne de nommé : la fiche d'appel dira quelle fonction demander.</p>}
          {best?.pourquoi && <p className="text-xs text-slate-500">{best.pourquoi}</p>}
          <div className="mt-1.5">
            {threadId ? (
              <button onClick={() => onOpenThread(threadId)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"><MessagesSquare className="w-3.5 h-3.5" /> {key ? 'Voir ce qui a été préparé' : 'Voir la conversation'}</button>
            ) : drafting ? (
              <span className="text-xs text-violet-700 animate-pulse">{agentName} {key ? 'prépare le mail, la note LinkedIn et la fiche d\'appel…' : 'rédige le premier mail…'}</span>
            ) : key && open ? (
              <button onClick={onDraft} className="inline-flex items-center gap-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-2 py-1 text-xs font-medium" title="Opus 5.5 prépare, à votre nom : le mail (si un e-mail publié est vérifié), la note d'invitation LinkedIn et la fiche d'appel. Ils arrivent dans « À valider › Pour vous » : vous envoyez vous-même.">
                <Crown className="w-3.5 h-3.5" /> Préparer pour vous
              </button>
            ) : verified && open ? (
              <button onClick={onDraft} className="inline-flex items-center gap-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-2 py-1 text-xs font-medium" title="Opus 5.5 écrit dans sa langue, avec la traduction ; le brouillon arrive dans « À valider ». Rien ne part sans validation.">
                <PenLine className="w-3.5 h-3.5" /> Rédiger le premier mail
              </button>
            ) : <span className="text-[11px] text-slate-400">{open ? 'Pas de premier mail : il faut un e-mail publié et vérifié.' : `Étape « ${STAGE_LABEL[p.stage]} ».`}</span>}
          </div>
        </div>
      )}
      {p.people.length > 0 && (
        <p className="text-xs text-slate-600"><span className="text-slate-400">Personnes :</span> {p.people.map((x, i) => (
          <span key={`${x.nom}-${i}`}>{i > 0 ? ' · ' : ''}{x.nom}{x.fonction ? ` (${x.fonction})` : ''}{x.email ? ` ${x.email}` : ''} <LiLink url={x.linkedin} /></span>
        ))}</p>
      )}
      {p.emails.length > 0 && (
        <div className="text-xs space-y-0.5">
          <p className="text-slate-400">E-mails publiés ({p.emails.length})</p>
          {emails.map((e) => (
            <p key={e.email} className="flex items-center gap-1.5 flex-wrap">
              {e.mx ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <XCircle className="w-3.5 h-3.5 text-rose-500" />}
              <span className={e.mx ? 'text-slate-800' : 'text-slate-400 line-through'} title={e.mx ? 'Le domaine reçoit du courrier' : 'Le domaine ne reçoit pas de courrier : adresse inutilisable'}>{e.email}</span>
              {e.nature && e.nature !== 'autre' && <span className="text-slate-400">{e.nature}</span>}
              <span className="text-slate-300 truncate max-w-[16rem]">{e.source}</span>
            </p>
          ))}
          {p.emails.length > 5 && <button onClick={() => setAllEmails(!allEmails)} className="text-brand-ocean hover:underline">{allEmails ? 'Moins' : `Les ${p.emails.length - 5} autres`}</button>}
        </div>
      )}
      {p.fit_parts.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap text-[11px]">
          <span className="text-slate-400">Score d'adéquation {p.fit_score} :</span>
          {p.fit_parts.map((x) => <span key={x.label} className="rounded-full bg-white border border-slate-200 px-1.5 text-slate-600">{x.label} +{x.points}</span>)}
          {p.score != null && p.fit_score != null && p.score !== p.fit_score && <span className="text-slate-500">· avis de {agentName} {p.score - p.fit_score > 0 ? '+' : ''}{p.score - p.fit_score}</span>}
        </div>
      )}
      {p.evidence.length > 0 && (
        <p className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
          <span className="text-slate-400">Pages lues :</span>
          {p.evidence.map((e) => <a key={e.url} href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-ocean hover:underline"><ExternalLink className="w-3 h-3" />{e.note}</a>)}
        </p>
      )}
    </div>
  );
}
