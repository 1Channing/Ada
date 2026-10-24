/**
 * Onglet Agents (16/10) — petites briques partagées : badges d'Ada et Dana,
 * statut et classement d'un message, éditeur de brouillon, bandeau, et le
 * petit « i » d'information (17/10).
 */
import { createContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Telescope, Copy, Check } from 'lucide-react';
import { AGENT_LABEL, type AgentKey, type Draft } from '../../services/agents';

/**
 * Ce que tout l'onglet sait (19/10) : l'agente choisie, le compte connecté, s'il est administrateur, et où
 * dire ce qui se passe — pour les gestes de la fiche (« Le bon contact est… », l'adresse probable) sans
 * les faire passer par chaque écran.
 */
export interface AgentsCtxValue { agent: AgentKey; userId: string | null; isAdmin: boolean; onError: (m: string) => void; onInfo: (m: string) => void }
export const AgentsCtx = createContext<AgentsCtxValue | null>(null);

export function AgentBadge({ agent, small }: { agent: AgentKey | null; small?: boolean }) {
  if (!agent) return <span className="text-[11px] text-slate-400">—</span>;
  const l = AGENT_LABEL[agent];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border ${l.tone} ${small ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[11px]'} font-medium`}>
      <span className={`w-1.5 h-1.5 rounded-full ${l.dot}`} /> {l.name}
    </span>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  brouillon: { label: 'Brouillon', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  a_valider: { label: 'À valider', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  valide: { label: 'Validé, en attente d\'envoi', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  envoi: { label: 'Envoi en cours', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  envoye: { label: 'Envoyé', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  echec: { label: 'Échec', cls: 'bg-red-50 text-red-800 border-red-200' },
  refuse: { label: 'Refusé', cls: 'bg-slate-100 text-slate-500 border-slate-200 line-through' },
  recu: { label: 'Reçu', cls: 'bg-white text-slate-600 border-slate-200' },
  pour_channing: { label: 'Pour vous', cls: 'bg-violet-50 text-violet-800 border-violet-200' },
  envoye_main: { label: 'Envoyé par vous', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
};
export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${s.cls}`}>{s.label}</span>;
}

const CLASSES: Record<string, { label: string; cls: string }> = {
  positif: { label: 'Positif', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  negatif: { label: 'Négatif', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  question: { label: 'Question', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  absence: { label: 'Absent', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  rebond: { label: 'Adresse morte', cls: 'bg-red-50 text-red-700 border-red-200' },
  stop: { label: 'Ne plus contacter', cls: 'bg-red-50 text-red-700 border-red-200' },
  reponse: { label: 'Réponse', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  copie: { label: 'Copie de l\'équipe', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  antispam: { label: 'Anti-spam : cliquer le lien', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};
export function ClassificationChip({ c }: { c: string | null }) {
  if (!c || !CLASSES[c]) return null;
  return <span className={`inline-block rounded-full border px-1.5 py-0 text-[10px] ${CLASSES[c].cls}`}>{CLASSES[c].label}</span>;
}

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40';

/** Destinataires, objet et texte d'un message (remonter avec une `key` pour repartir d'un autre brouillon). */
export function DraftEditor({ draft, onChange, autoFocus }: { draft: Draft; onChange: (d: Draft) => void; autoFocus?: boolean }) {
  const [toRaw, setToRaw] = useState(draft.to.join(', '));
  return (
    <div className="space-y-2">
      <input className={inputCls} placeholder="Destinataire(s) : jean@garage.fr, …" value={toRaw}
        onChange={(e) => { setToRaw(e.target.value); onChange({ ...draft, to: e.target.value.split(/[,;]/).map((x) => x.trim()).filter(Boolean) }); }} />
      <input className={inputCls} placeholder="Objet" value={draft.subject} onChange={(e) => onChange({ ...draft, subject: e.target.value })} />
      <textarea className={`${inputCls} min-h-[180px] font-[inherit] leading-relaxed`} value={draft.body} autoFocus={autoFocus}
        onChange={(e) => onChange({ ...draft, body: e.target.value })} />
    </div>
  );
}

export function Banner({ tone, children, onClose }: { tone: 'ok' | 'warn' | 'err'; children: ReactNode; onClose?: () => void }) {
  const cls = tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-red-50 border-red-200 text-red-800';
  return (
    <div className={`rounded-xl border px-4 py-2.5 text-sm flex items-start gap-3 ${cls}`}>
      <div className="flex-1">{children}</div>
      {onClose && <button onClick={onClose} className="text-xs opacity-70 hover:opacity-100">Fermer</button>}
    </div>
  );
}

/**
 * Un petit « i » : l'explication s'affiche au survol (au toucher sur téléphone,
 * au clavier aussi). Mesurée avant d'apparaître, elle tient toujours dans
 * l'écran sans jamais couvrir le « i » (sinon, sur téléphone, la fin du
 * toucher tombe sur elle) : dessous, ou au-dessus s'il manque de place, et
 * elle défile si aucun côté ne suffit. On peut y entrer avec le curseur ou le
 * doigt sans qu'elle se ferme ; elle se ferme en sortant, en touchant
 * ailleurs ou avec Échap.
 */
export function InfoTip({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const leaving = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const width = () => Math.min(wide ? 900 : 360, window.innerWidth - 16);
  const show = () => { if (leaving.current) window.clearTimeout(leaving.current); setOpen(true); };
  const hide = () => { setOpen(false); setPos(null); };
  const hideSoon = () => { leaving.current = window.setTimeout(hide, 150); };
  const inside = (n: EventTarget | null) => !!n && (tip.current?.contains(n as Node) || btn.current?.contains(n as Node));
  useLayoutEffect(() => {
    if (!open || !btn.current || !tip.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = width();
    const h = tip.current.scrollHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom - 16;
    const above = r.top - 16;
    if (h <= below || below >= above) setPos({ left, top: r.bottom + 8, maxHeight: below });
    else setPos({ left, top: Math.max(8, r.top - 8 - h), maxHeight: above });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => { if (!inside(e.target)) hide(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', hide); window.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => () => { if (leaving.current) window.clearTimeout(leaving.current); }, []);
  return (
    <>
      <button ref={btn} type="button" aria-label={label} aria-expanded={open} onMouseEnter={show} onMouseLeave={hideSoon} onFocus={show} onClick={show}
        onBlur={(e) => { if (!inside(e.relatedTarget)) hide(); }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 text-[10px] font-semibold italic leading-none text-slate-500 hover:border-brand-ocean hover:text-brand-ocean focus:outline-none focus:ring-2 focus:ring-brand-ocean/40">i</button>
      {open && (
        <div ref={tip} role="tooltip" tabIndex={-1} onMouseEnter={show} onMouseLeave={hide} onBlur={(e) => { if (!inside(e.relatedTarget)) hide(); }}
          style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, width: width(), maxHeight: pos?.maxHeight, visibility: pos ? 'visible' : 'hidden' }}
          className="z-50 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-[13px] leading-snug text-slate-700 shadow-lg focus:outline-none">
          {children}
        </div>
      )}
    </>
  );
}

/**
 * Un menu déroulant à cocher (18/10, Channing : « des marques à cocher, via un
 * menu déroulant plutôt que des marques à écrire : cela évite les erreurs
 * humaines de précipitation » ; les types d'une recherche aussi). Fermé, il
 * dit ce qui est coché ; ouvert, une case par choix, avec « Tout cocher » et
 * « Tout décocher ». Se ferme d'un clic à côté ou avec Échap.
 */
export function CheckDropdown({ options, selected, onChange, disabled, allLabel = 'Tout', emptyLabel = 'Rien de coché', unit = 'cochés', className = '' }: {
  options: Array<{ key: string; label: string; hint?: string }>;
  selected: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
  /** Ce que dit le bouton quand tout est coché, quand rien ne l'est, et après un nombre (« 5 cochés »). */
  allLabel?: string; emptyLabel?: string; unit?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const on = options.filter((o) => selected.includes(o.key));
  const text = on.length === 0 ? emptyLabel : on.length === options.length ? allLabel : on.length <= 3 ? on.map((o) => o.label).join(', ') : `${on.length} ${unit}`;
  const toggle = (k: string) => onChange(selected.includes(k) ? selected.filter((x) => x !== k) : options.map((o) => o.key).filter((x) => x === k || selected.includes(x)));
  return (
    <div ref={box} className={`relative inline-block ${className}`}>
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}
        className="w-full inline-flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:bg-slate-50 disabled:text-slate-500">
        <span className="truncate">{text}</span>
        <svg className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="absolute left-0 z-30 mt-1 w-max min-w-full max-w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-1.5 text-xs">
            <button type="button" data-modifie onClick={() => onChange(options.map((o) => o.key))} className="text-brand-ocean hover:underline">Tout cocher</button>
            <button type="button" data-modifie onClick={() => onChange([])} className="text-slate-500 hover:underline">Tout décocher</button>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {options.map((o) => (
              <label key={o.key} className="flex items-start gap-2 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={selected.includes(o.key)} onChange={() => toggle(o.key)} />
                <span>{o.label}{o.hint && <span className="block text-[11px] text-slate-500">{o.hint}</span>}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * « Chercher plus loin » (18/10, Channing : « pouvoir laisser une note à l'agente pour qu'elle s'en
 * serve ») : le bouton ouvre une consigne facultative — « trouve le moyen de joindre directement la
 * bonne personne, ou au moins son service » —, puis lance la recherche approfondie.
 */
export function DeepAsk({ name, again, label, title, onLaunch, small }: {
  /** Ada ou Dana. */
  name: string;
  /** Déjà approfondie : « Chercher encore plus loin ». */
  again?: boolean;
  /** Le libellé du bouton quand ce n'est pas encore fait (« Chercher plus loin », « Recherche approfondie »). */
  label?: string;
  title?: string;
  onLaunch: (note: string) => void;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title={title}
        className={`inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-white font-medium text-indigo-800 hover:bg-indigo-50 ${small ? 'px-2 py-0.5 text-xs' : 'px-2 py-1 text-xs'}`}>
        <Telescope className="w-3.5 h-3.5" />
        {again ? 'Chercher encore plus loin' : label ?? 'Chercher plus loin'}
      </button>
    );
  }
  const launch = () => { onLaunch(note.trim().slice(0, 1000)); setOpen(false); setNote(''); };
  return (
    <div className="w-full basis-full rounded-lg border border-indigo-200 bg-indigo-50/60 p-2 space-y-1.5 text-left">
      <label className="block text-xs font-medium text-indigo-900" htmlFor="deep-note">Une consigne pour {name} (facultatif)</label>
      <textarea id="deep-note" autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) launch(); if (e.key === 'Escape') setOpen(false); }}
        placeholder="Ex. : trouve le moyen de joindre directement la personne qui décide, ou au moins son service — pas l'adresse du service client."
        className="w-full min-h-[64px] rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={launch} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 text-xs font-medium">Lancer la recherche</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-800">Annuler</button>
        <span className="text-[11px] text-slate-500">Environ 0,10 $. Elle suit votre consigne sans jamais deviner une adresse ; si elle trouve mieux, ce qui est préparé est refait.</span>
      </div>
    </div>
  );
}

/** Copier un texte (presse-papiers, ou l'ancienne méthode si le navigateur la refuse). */
async function copyText(text: string): Promise<boolean> {
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

export function CopyButton({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => void copyText(text).then((ok) => { setDone(ok); if (ok) window.setTimeout(() => setDone(false), 1500); })}
      className={`inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 ${className}`}>
      {done ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />} {done ? 'Copié' : label}
    </button>
  );
}
