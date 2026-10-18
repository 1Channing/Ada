/**
 * LE BILAN DU JOUR (18/10, Channing : « envoyer un mail à l'organisation MC
 * Export (tous les utilisateurs MC Export), lorsqu'une agente a fini ses
 * recherches du jour, avec un petit détail sur les statistiques »).
 *
 * Quand : une fois par jour de travail et par agente, si elle a travaillé —
 * dès qu'elle a fini (ses recherches et relevés d'office du jour faits, plus
 * rien en attente depuis une heure, ou son budget du jour atteint), sinon à
 * la fin de ses heures de travail (20 h pour une agente qui travaille toute
 * la journée). Jamais avant 7 h : un travail fini dans la nuit part à 7 h.
 * Quoi : un mail en texte simple — ses recherches et ce qu'elles ont trouvé,
 * les fiches, les recherches approfondies, ce qui est préparé pour Channing,
 * les premiers mails à valider, la dépense, ce qui attend dans ADA.
 * La partie pure (le moment, le texte) ; l'envoi : worker/agents/recap.ts.
 * Testée par test/agents-bilan.test.ts.
 */
import { parisClock, toMinutes, endMinutes, type SendWindow } from './sendPolicy';

/** Pas de bilan avant 7 h ; le soir d'une agente qui travaille toute la journée : 20 h. */
export const RECAP_NOT_BEFORE = 7 * 60;
export const RECAP_ALL_DAY_AT = 20 * 60;
/** Une heure sans rien en attente après ses recherches du jour : elle a fini. */
export const RECAP_IDLE_MS = 60 * 60_000;

export interface RecapDueInput {
  now: Date;
  window: SendWindow;
  /** Elle a travaillé aujourd'hui (une tâche ou un appel à l'IA). */
  worked: boolean;
  /** Tâches en attente ou en cours. */
  pending: number;
  /** La dernière activité (tâche posée ou finie), ou null. */
  lastActivityAt: string | null;
  researchQuota: number; researchToday: number;
  discoveryOn: boolean; discoveryQuota: number; discoveryToday: number;
  budgetReached: boolean;
}

/** L'heure de fin de journée de l'agente, en minutes (20 h si elle travaille toute la journée). */
export function recapEndMinutes(w: SendWindow): number {
  const from = toMinutes(w.send_from);
  const end = endMinutes(w.send_to);
  return from === 0 && end >= 24 * 60 ? RECAP_ALL_DAY_AT : end;
}

/** Le bilan du jour doit-il partir maintenant ? (le « une fois par jour » est tenu par l'envoi) */
export function recapDue(i: RecapDueInput): boolean {
  const c = parisClock(i.now);
  if (!i.window.send_days.includes(c.isoDay) || !i.worked || c.minutes < RECAP_NOT_BEFORE) return false;
  // Une tâche qui attend ou tourne finit d'abord (elle compte dans le bilan).
  if (i.pending > 0) return false;
  if (c.minutes >= recapEndMinutes(i.window)) return true;
  if (i.budgetReached) return true;
  const quotas = i.researchToday >= i.researchQuota && (!i.discoveryOn || i.discoveryToday >= i.discoveryQuota);
  const idle = !i.lastActivityAt || i.now.getTime() - Date.parse(i.lastActivityAt) >= RECAP_IDLE_MS;
  return quotas && idle;
}

export interface RecapInput {
  agent: 'ada' | 'dana'; name: string; now: Date; hours: string;
  /** Les recherches web du jour : leur libellé (« sociétés de leasing · France ») et ce qu'elles ont gardé. */
  research: Array<{ label: string; found: number }>;
  discoveries: number; listings: number;
  fiches: number; keyFiches: number; top: Array<{ name: string; score: number | null }>;
  deep: { done: number; enriched: number; found: string[] };
  prepared: string[]; drafts: number; map: number;
  spent: number; budget: number;
  waiting: { forYou: number; toComplete: number; toValidate: number };
  link: string;
}

const DAY = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });
const usd = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;
const s = (n: number) => (n > 1 ? 's' : '');

/** L'objet et le texte du bilan. */
export function recapMail(i: RecapInput): { subject: string; body: string } {
  const day = DAY.format(i.now);
  const found = i.research.reduce((n, r) => n + r.found, 0);
  const lines: string[] = [
    'Bonjour,',
    '',
    `Voici la journée de ${i.name} (${i.hours}).`,
    '',
    `• Recherches sur le web : ${i.research.length}${i.research.length ? ` — ${found} entreprise${s(found)} trouvée${s(found)} (${i.research.map((r) => `${r.label} : ${r.found}`).join(' ; ')})` : ''}`,
    `• Relevés d'annonces : ${i.discoveries}${i.discoveries ? ` — ${i.listings} annonce${s(i.listings)} lue${s(i.listings)}` : ''}`,
    `• Fiches préparées : ${i.fiches}${i.keyFiches ? `, dont ${i.keyFiches} grand${s(i.keyFiches)} compte${s(i.keyFiches)}` : ''}${i.top.length ? ` — les mieux notées : ${i.top.map((t) => `${t.name} ${t.score ?? '—'}`).join(' · ')}` : ''}`,
    `• Recherches approfondies : ${i.deep.done}${i.deep.done ? ` — ${i.deep.enriched} fiche${s(i.deep.enriched)} complétée${s(i.deep.enriched)}${i.deep.found.length ? ` (${i.deep.found.join(' ; ')})` : ''}` : ''}`,
    `• Préparé pour Channing (grands comptes) : ${i.prepared.length}${i.prepared.length ? ` — ${i.prepared.join(', ')}` : ''}`,
    `• Premiers mails à valider : ${i.drafts}`,
    `• Ajoutés à la carte du réseau : ${i.map}`,
    `• Dépense IA : ${usd(i.spent)} sur ${usd(i.budget)}`,
    '',
  ];
  const todo = [
    i.waiting.forYou ? `${i.waiting.forYou} grand${s(i.waiting.forYou)} compte${s(i.waiting.forYou)} « Pour vous »` : null,
    i.waiting.toValidate ? `${i.waiting.toValidate} mail${s(i.waiting.toValidate)} à valider` : null,
    i.waiting.toComplete ? `${i.waiting.toComplete} grand${s(i.waiting.toComplete)} compte${s(i.waiting.toComplete)} à compléter` : null,
  ].filter(Boolean);
  lines.push(todo.length ? `À traiter dans ADA : ${todo.join(', ')}.` : 'Rien n\'attend dans ADA.');
  lines.push(`Ouvrir : ${i.link}`);
  lines.push('');
  lines.push(`— ${i.name}, ${i.agent === 'dana' ? 'l\'assistante achats' : 'l\'assistante commerciale'} de MC Export (IA). Ce bilan part une fois par jour ; rien n'est envoyé à l'extérieur sans validation.`);
  return { subject: `${i.name} — bilan du ${day}`, body: lines.join('\n') };
}
