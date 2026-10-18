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
 */
import { useState } from 'react';
import { ChevronRight, Telescope, Crown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AgentKey, ProspectDetail, ProspectStage } from '../../services/agents';
import { missingOf, lastDeepAt } from '../../lib/agents/deepResearch';
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
  onDeep: (p: ProspectDetail) => void; onPrepare: (p: ProspectDetail) => void; onStage: (p: ProspectDetail, s: ProspectStage) => void; onRequalify: (p: ProspectDetail) => void;
  onOpenThread: (id: string) => void;
}

function Row({ p, agent, deeping, drafting, minScore, autoDraft, isAdmin, onDeep, onPrepare, onStage, onRequalify, onOpenThread }: Omit<Props, 'rows' | 'deep' | 'draft'> & { p: ProspectDetail; deeping: boolean; drafting: boolean }) {
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
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2 flex-wrap text-xs ml-6 md:ml-auto">
          {deeping
            ? <span className="text-indigo-700 animate-pulse">{name} cherche plus loin…</span>
            : (
              <button onClick={() => onDeep(p)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-2 py-1 font-medium text-indigo-800 hover:bg-indigo-50"
                title={`${name} va plus loin sur le web : à qui appartient l'entreprise, qui décide (au niveau du groupe d'abord), les e-mails et téléphones publiés, des pistes. Si elle trouve la personne qui décide, le compte est préparé pour vous. Environ 0,10 $.`}>
                <Telescope className="w-3.5 h-3.5" /> {deepAt ? 'Chercher encore plus loin' : 'Recherche approfondie'}
              </button>
            )}
          {drafting
            ? <span className="text-violet-700 animate-pulse">préparation…</span>
            : isAdmin && (
              <button onClick={() => onPrepare(p)} className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2 py-1 font-medium text-violet-800 hover:bg-violet-50"
                title="Opus 5.5 prépare tout de suite, avec ce que la fiche contient : le mail (s'il y a un e-mail publié), la note d'invitation LinkedIn et la fiche d'appel. Environ 0,07 $.">
                <Crown className="w-3.5 h-3.5" /> {missing.length ? 'Préparer quand même' : 'Préparer pour vous'}
              </button>
            )}
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4">
          <QualifCard p={p} agentName={name} onStage={(st) => onStage(p, st)} onRequalify={() => onRequalify(p)} requalifying={false}
            threadId={null} onDraft={() => onPrepare(p)} drafting={drafting} onOpenThread={onOpenThread} onDeep={() => onDeep(p)} deeping={deeping} />
        </div>
      )}
    </div>
  );
}

export function ToComplete({ rows, deep, draft, ...rest }: Props) {
  return <>{rows.map((p) => <Row key={p.id} p={p} deeping={deep.has(p.id)} drafting={draft.has(p.id)} {...rest} />)}</>;
}
