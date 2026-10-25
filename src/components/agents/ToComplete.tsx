/**
 * « À valider › Grands comptes à compléter » (18/10, Channing : « je ne veux
 * pas les écarter, je veux surtout pouvoir voir ce qui ne va pas dans
 * l'onglet à valider, et pourquoi pas relancer des recherches approfondies !
 * Les contacts les plus durs à contacter sont ceux qui rapportent le plus »).
 * Les grands comptes qui ont leur fiche mais rien de préparé pour Channing :
 * pour chacun, ce qui manque (la personne qui décide, un e-mail, LinkedIn, un
 * téléphone, une note sous la note minimale) ; d'un clic, la recherche
 * approfondie ou la préparation quand même. Repliés par défaut ; la fiche
 * complète s'ouvre d'un clic.
 * 20/10 (Channing : « pouvoir stocker ces fiches quelque part, pour qu'elles
 * ne soient pas faites à la reprise de l'agente si la société n'est pas
 * pertinente, et ne pas cramer des crédits ») : « Mettre de côté », avec un
 * motif facultatif — et, d'un clic, les autres fiches de la même enseigne ;
 * elles vont dans « Mis de côté », d'où on les remet dans la liste.
 */
import { useState } from 'react';
import { ChevronRight, Telescope, Crown, AlertTriangle, CheckCircle2, Archive, Undo2 } from 'lucide-react';
import { DeepAsk } from './shared';
import type { AgentKey, ProspectDetail, ProspectStage } from '../../services/agents';
import { missingOf, lastDeepAt } from '../../lib/agents/deepResearch';
import { sameBrand, lastAside } from '../../lib/agents/setAside';
import { QualifCard } from './QualifCard';
import { KIND_LABEL, fmtDateTime, scoreTone } from './helpers';

const FLAG: Record<string, string> = { FR: '🇫🇷', DE: '🇩🇪', NL: '🇳🇱', BE: '🇧🇪', ES: '🇪🇸', IT: '🇮🇹', DK: '🇩🇰', AT: '🇦🇹', LU: '🇱🇺', SE: '🇸🇪', HU: '🇭🇺', LT: '🇱🇹', PL: '🇵🇱', PT: '🇵🇹', CH: '🇨🇭' };

/** Ce qui bloque la préparation : personne qui décide, e-mail, note sous la note minimale. LinkedIn et téléphone sont un plus. */
const BLOCKING = /personne qui décide|aucun e-mail/;
/** Pourquoi rien n'est encore préparé pour ce grand compte : ce qui bloque, et ce qui serait un plus. */
function whyNotPrepared(p: ProspectDetail, minScore: number, autoDraft: number): { missing: string[]; extra: string[]; ready: string | null } {
  const all = missingOf(p);
  const missing = all.filter((m) => BLOCKING.test(m));
  const extra = all.filter((m) => !BLOCKING.test(m));
  if (p.score != null && p.score < minScore) missing.push(`note ${p.score}, sous la note minimale (${minScore})`);
  const ready = missing.length ? null : autoDraft > 0 ? 'prêt : préparé au prochain passage' : 'prêt à préparer';
  return { missing, extra, ready };
}

interface Props {
  agent: AgentKey; rows: ProspectDetail[]; deep: Set<string>; draft: Set<string>; minScore: number; autoDraft: number; isAdmin: boolean;
  onDeep: (p: ProspectDetail, note: string) => void; onPrepare: (p: ProspectDetail) => void; onStage: (p: ProspectDetail, s: ProspectStage) => void; onRequalify: (p: ProspectDetail) => void;
  onOpenThread: (id: string) => void;
  /** 20/10 : « Mettre de côté » ces fiches (pas pertinentes), avec le motif ; 25/10 : le motif proposé comme leçon, si coché. */
  onAside: (rows: ProspectDetail[], reason: string, lesson: boolean) => void;
  /** 20/10 (le Workflow) : les autres fiches de la même entreprise, réunies sur la ligne de celle-ci. */
  twinsOf?: (p: ProspectDetail) => ProspectDetail[];
}

/**
 * « Mettre de côté » : le motif (facultatif) et, à cocher, les autres fiches de la même enseigne.
 * 25/10 (Channing : « laisser l'option, mais facultatif ») : un administrateur peut proposer le motif comme
 * leçon pour l'agente — décoché d'office ; la leçon attend sa validation dans « Ce qu'elle sait ».
 */
export function AsideAsk({ p, twins, onAside, agentName, canLearn = false }: { p: ProspectDetail; twins: ProspectDetail[]; onAside: (rows: ProspectDetail[], reason: string, lesson: boolean) => void; agentName?: string; canLearn?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [all, setAll] = useState(false);
  const [lesson, setLesson] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-50"
        title="Pas pertinente : la fiche quitte la liste et va dans « Mis de côté ». Plus aucune recherche ni préparation, automatique ou non : aucun crédit dépensé. Vous pourrez la remettre.">
        <Archive className="w-3.5 h-3.5" /> Mettre de côté
      </button>
    );
  }
  const learnable = reason.trim().length >= 5;
  const go = () => { onAside(all ? [p, ...twins] : [p], reason, canLearn && lesson && learnable); setOpen(false); setReason(''); setAll(false); setLesson(false); };
  return (
    <div className="w-full basis-full rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1.5 text-left">
      <label className="block text-xs font-medium text-slate-800" htmlFor={`aside-${p.id}`}>Pourquoi n'est-elle pas pertinente ? (facultatif, pour l'équipe)</label>
      <input id={`aside-${p.id}`} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
        onKeyDown={(e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') setOpen(false); }}
        placeholder="Ex. : enseigne de VO grand public, ne revend pas aux marchands"
        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300" />
      {twins.length > 0 && (
        <label className="flex items-start gap-1.5 text-xs text-slate-700">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="mt-0.5" />
          <span>Aussi {twins.length > 1 ? `les ${twins.length} autres fiches` : 'l\'autre fiche'} de la même enseigne : {twins.map((x) => x.name).join(', ')}</span>
        </label>
      )}
      {canLearn && (
        <label className={`flex items-start gap-1.5 text-xs ${learnable ? 'text-slate-700' : 'text-slate-400'}`}>
          <input type="checkbox" checked={lesson && learnable} disabled={!learnable} onChange={(e) => setLesson(e.target.checked)} className="mt-0.5" />
          <span>Proposer ce motif comme leçon pour {agentName ?? 'l\'agente'} (facultatif) : elle attend votre validation dans « Ce que {agentName ?? 'l\'agente'} sait », où vous pouvez la reformuler.</span>
        </label>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={go} className="inline-flex items-center gap-1 rounded-lg bg-slate-700 hover:bg-slate-800 text-white px-2.5 py-1 text-xs font-medium">
          <Archive className="w-3 h-3" /> Mettre de côté{all && twins.length ? ` (${twins.length + 1} fiches)` : ''}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-800">Annuler</button>
        <span className="text-[11px] text-slate-500">Plus aucune recherche ni préparation : aucun crédit dépensé. Elle reste dans « Mis de côté », d'où vous pouvez la remettre.</span>
      </div>
    </div>
  );
}

function Row({ p, twins, company, agent, deeping, drafting, minScore, autoDraft, isAdmin, onDeep, onPrepare, onStage, onRequalify, onOpenThread, onAside }: Omit<Props, 'rows' | 'deep' | 'draft' | 'twinsOf'> & { p: ProspectDetail; twins: ProspectDetail[]; company: ProspectDetail[]; deeping: boolean; drafting: boolean }) {
  const [open, setOpen] = useState(false);
  const name = agent === 'dana' ? 'Dana' : 'Ada';
  const kind = p.account_kind ?? p.kind;
  const { missing, extra, ready } = whyNotPrepared(p, minScore, autoDraft);
  const deepAt = lastDeepAt(p.evidence);
  const who = p.best_contact?.nom ? `${p.best_contact.nom}${p.best_contact.fonction ? ` — ${p.best_contact.fonction}` : ''}` : null;
  return (
    <div className={`bg-white border rounded-2xl shadow-sm ${open ? 'border-amber-300' : 'border-amber-200'}`}>
      <div className="px-4 py-3 flex items-start gap-2 flex-wrap">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="min-w-0 flex-1 basis-full md:basis-0 text-left flex items-start gap-2">
          <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 text-amber-600 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="min-w-0">
            <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
              {p.name}
              {p.country && <span className="text-xs font-normal text-slate-500">{FLAG[p.country] ?? ''} {[p.city, p.country].filter(Boolean).join(', ')}</span>}
              {p.score != null && <span className={`rounded border px-1.5 text-[11px] font-semibold tabular-nums ${scoreTone(p.score)}`}>{p.score}</span>}
            </span>
            <span className="block text-xs text-slate-600">{[kind ? KIND_LABEL[kind] ?? kind : null, p.group_name ? (/^groupe?\b/i.test(p.group_name) ? p.group_name : `groupe ${p.group_name}`) : null, who].filter(Boolean).join(' · ')}</span>
            <span className="mt-1 flex items-center gap-x-2.5 gap-y-1 flex-wrap text-[11px]">
              {missing.length > 0
                ? <span className="inline-flex items-center gap-0.5 text-amber-800"><AlertTriangle className="w-3 h-3" /> manque : {missing.join(', ')}</span>
                : <span className="inline-flex items-center gap-0.5 text-emerald-700"><CheckCircle2 className="w-3 h-3" /> {ready}</span>}
              {extra.length > 0 && <span className="text-slate-500">{missing.length ? 'et ' : 'en plus, '}{extra.join(', ')}</span>}
              {deepAt && <span className="inline-flex items-center gap-0.5 text-indigo-800"><Telescope className="w-3 h-3" /> recherche approfondie du {fmtDateTime(deepAt)}</span>}
              {company.length > 0 && <span className="text-slate-500" title={company.map((t) => `${t.name}${t.city ? ` (${t.city})` : ''}`).join(' · ')}>+ {company.length} autre{company.length > 1 ? 's' : ''} fiche{company.length > 1 ? 's' : ''} de l'entreprise</span>}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2 flex-wrap text-xs ml-6 md:ml-auto">
          {deeping
            ? <span className="text-indigo-700 animate-pulse">{name} cherche plus loin…</span>
            : (
              <DeepAsk name={name} again={!!deepAt} label="Recherche approfondie" onLaunch={(note) => onDeep(p, note)}
                title={`${name} va plus loin sur le web : à qui appartient l'entreprise, qui décide (au niveau du groupe d'abord), comment la joindre directement, des pistes. Si elle trouve la personne qui décide, le compte est préparé pour vous. Environ 0,10 $.`} />
            )}
          {drafting
            ? <span className="text-violet-700 animate-pulse">préparation…</span>
            : isAdmin && (
              <button onClick={() => onPrepare(p)} className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2 py-1 font-medium text-violet-800 hover:bg-violet-50"
                title="Opus 5.5 prépare tout de suite, avec ce que la fiche contient : le mail (s'il y a un e-mail publié), la note d'invitation LinkedIn et la fiche d'appel. Environ 0,07 $.">
                <Crown className="w-3.5 h-3.5" /> {missing.length ? 'Préparer quand même' : 'Préparer pour vous'}
              </button>
            )}
          <AsideAsk p={p} twins={twins} onAside={onAside} agentName={name} canLearn={isAdmin} />
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4">
          <QualifCard p={p} agentName={name} onStage={(st) => onStage(p, st)} onRequalify={() => onRequalify(p)} requalifying={false}
            threadId={null} onDraft={() => onPrepare(p)} drafting={drafting} onOpenThread={onOpenThread} onDeep={(note) => onDeep(p, note)} deeping={deeping} />
        </div>
      )}
    </div>
  );
}

export function ToComplete({ rows, deep, draft, twinsOf, ...rest }: Props) {
  return <>{rows.map((p) => {
    // Les fiches de la même entreprise (le Workflow les réunit), et celles de la même enseigne dans la liste : à mettre de côté d'un coup.
    const company = twinsOf?.(p) ?? [];
    const twins = [...company, ...sameBrand(p, rows).filter((x) => !company.some((y) => y.id === x.id))];
    return <Row key={p.id} p={p} twins={twins} company={company} deeping={deep.has(p.id)} drafting={draft.has(p.id)} {...rest} />;
  })}</>;
}

/** « Mis de côté » (20/10) : les fiches que l'équipe a jugées pas pertinentes — plus rien n'y est fait ; « Remettre » les rend à l'agente. */
export function SetAsideList({ rows, onRestore }: { rows: ProspectDetail[]; onRestore: (p: ProspectDetail) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 flex-wrap text-left">
        <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Archive className="w-4 h-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-900">Mis de côté</span>
        <span className="text-xs text-slate-400">{rows.length}</span>
        <span className="text-xs text-slate-500">— pas pertinentes : plus de recherche ni de préparation, aucun crédit dépensé.</span>
      </button>
      {open && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
          {rows.map((p) => {
            const a = lastAside(p.notes);
            return (
              <div key={p.id} className="px-4 py-2 flex items-start gap-2 flex-wrap text-sm">
                <span className="min-w-0 flex-1 basis-full sm:basis-0">
                  <span className="font-medium text-slate-800">{p.name}</span>
                  {p.country && <span className="ml-1.5 text-xs text-slate-500">{FLAG[p.country] ?? ''} {[p.city, p.country].filter(Boolean).join(', ')}</span>}
                  {p.score != null && <span className={`ml-1.5 rounded border px-1.5 text-[11px] font-semibold tabular-nums ${scoreTone(p.score)}`}>{p.score}</span>}
                  <span className="block text-xs text-slate-500">{a ? `Mis de côté le ${a.day}${a.reason ? ` : ${a.reason}` : ''}` : 'Écartée à la main (étape « écarté »).'}</span>
                </span>
                <button type="button" onClick={() => onRestore(p)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  title="Elle revient dans la liste : l'agente peut de nouveau la compléter et la préparer.">
                  <Undo2 className="w-3.5 h-3.5" /> Remettre dans la liste
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
