/**
 * METTRE DE CÔTÉ UNE FICHE (20/10, Channing : « dans les fiches à compléter, pouvoir stocker ces fiches
 * quelque part, pour qu'elles ne soient pas faites à la reprise de l'agente si on considère que la
 * société n'est pas pertinente, et ainsi ne pas cramer des crédits inutilement »).
 * Une fiche mise de côté est écartée (étape « ecarte ») par l'équipe, sans motif de l'IA : plus de
 * recherche approfondie ni de préparation, automatique ou non, donc aucun crédit dépensé ; « Refaire
 * la fiche » ne la remet pas dans la liste, seule l'équipe le fait. La date et le motif sont écrits
 * dans ses notes (la seule colonne, avec l'étape, que l'appli peut modifier sur une fiche).
 */
import { distinctiveTokens } from './teamMemory';

/** La ligne des notes qui dit qu'une fiche a été mise de côté, et pourquoi. */
const ASIDE = /^Mis de côté le (\d{2}\/\d{2}\/\d{4})(?: : (.+))?$/;

/** « 20/10/2026 », à l'heure de Paris. */
export const dayFr = (at: Date): string => at.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
const day = dayFr;

/** « Mis de côté le 20/10/2026 : pas pertinent, enseigne de VO grand public » (le motif est facultatif). */
export function asideLine(at: Date, reason: string): string {
  const r = reason.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `Mis de côté le ${day(at)}${r ? ` : ${r}` : ''}`;
}

/** « Remis dans la liste le 21/10/2026 ». */
export const restoreLine = (at: Date): string => `Remis dans la liste le ${day(at)}`;

/** Les notes d'une fiche, une ligne de plus (les plus anciennes tombent au-delà de 4 000 caractères). */
export function withNoteLine(notes: string | null | undefined, line: string): string {
  return [String(notes ?? '').trim(), line].filter(Boolean).join('\n').slice(-4000);
}

/** Mise de côté par l'équipe : écartée sans motif de l'IA (l'IA écrit toujours le sien). */
export function isSetAside(p: { stage: string; exclusion_reason?: string | null }): boolean {
  return p.stage === 'ecarte' && !String(p.exclusion_reason ?? '').trim();
}

/** Quand et pourquoi elle a été mise de côté : la dernière ligne qui le dit dans ses notes. */
export function lastAside(notes: string | null | undefined): { day: string; reason: string | null } | null {
  const lines = String(notes ?? '').split('\n').map((l) => l.trim()).reverse();
  for (const l of lines) {
    const m = ASIDE.exec(l);
    if (m) return { day: m[1], reason: m[2]?.trim() || null };
  }
  return null;
}

/** L'enseigne d'une fiche : le premier mot distinctif de son nom (« FLEXICAR MURCIA. » → flexicar), ni la ville ni un mot banal. */
export function brandOf(name: string, city?: string | null): string | null {
  const t = distinctiveTokens(name, city ?? undefined)[0] ?? null;
  return t && t.length >= 3 ? t : null;
}

/** Les autres fiches de la liste à la même enseigne (FLEXICAR MÁLAGA, GRUPO FLEXICAR SEVILLA…), à mettre de côté d'un coup si on le coche. */
export function sameBrand<T extends { id: string; name: string; city?: string | null }>(p: T, rows: T[]): T[] {
  const b = brandOf(p.name, p.city);
  return b ? rows.filter((x) => x.id !== p.id && brandOf(x.name, x.city) === b) : [];
}
