/**
 * Onglet Agents (16/10) — petites briques partagées : badges d'Ada et Dana,
 * statut et classement d'un message, éditeur de brouillon, bandeau, et le
 * petit « i » d'information (17/10).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AGENT_LABEL, type AgentKey, type Draft } from '../../services/agents';

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
  const width = () => Math.min(wide ? 640 : 360, window.innerWidth - 16);
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
          className="z-50 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg focus:outline-none">
          {children}
        </div>
      )}
    </>
  );
}
