/**
 * JOURNAL DE NOTES DATÉES (12/10, Channing : « il faut noter les dates
 * d'ajout de chaque note » — un collègue déjà sur l'annonce, c'est la date
 * de sa dernière note qui dit si une relance vaut le coup).
 *
 * Les notes d'une négociation restent UNE colonne texte (negotiations.notes :
 * lue par l'anti-collision, l'Open space, les ventes) ; chaque ajout y est
 * écrit sur sa propre ligne, précédé de sa date :
 *     12/10/2026 09:41 — Vendeur joint, attend une offre
 * Les lignes sans date (notes d'avant, texte libre) forment le bloc
 * « ancien ». Fail-open : un texte quelconque se lit toujours.
 */
export interface NoteEntry { at: Date | null; text: string }
export interface NoteJournal { legacy: string; entries: NoteEntry[] }

const STAMP = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) — ?(.*)$/;

export function fmtStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function parseJournal(notes: string | null | undefined): NoteJournal {
  const legacy: string[] = [];
  const entries: NoteEntry[] = [];
  for (const line of (notes ?? '').split('\n')) {
    const m = line.match(STAMP);
    if (m) {
      entries.push({ at: new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5])), text: m[6] });
    } else if (entries.length) {
      entries[entries.length - 1].text += `\n${line}`; // suite d'une note sur plusieurs lignes
    } else {
      legacy.push(line);
    }
  }
  return { legacy: legacy.join('\n').trim(), entries: entries.map((e) => ({ ...e, text: e.text.trim() })).filter((e) => e.text) };
}

/** Ajoute une note datée en fin de journal (texte vide → inchangé). */
export function appendEntry(notes: string | null | undefined, text: string, at = new Date()): string {
  const t = text.trim();
  if (!t) return notes ?? '';
  const base = (notes ?? '').replace(/\s+$/, '');
  return `${base ? `${base}\n` : ''}${fmtStamp(at)} — ${t}`;
}

/** Date de la dernière note datée, sinon le repli (dernière activité connue). */
export function lastNoteDate(notes: string | null | undefined, fallback?: string | null): Date | null {
  const dated = parseJournal(notes).entries.filter((e) => e.at).map((e) => e.at!.getTime());
  if (dated.length) return new Date(Math.max(...dated));
  const f = fallback ? Date.parse(fallback) : NaN;
  return Number.isFinite(f) ? new Date(f) : null;
}

/** « il y a 3 j », « aujourd'hui », « il y a 3 sem. » */
export function agoLabel(d: Date, now = Date.now()): string {
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 14) return `il y a ${days} j`;
  if (days < 60) return `il y a ${Math.floor(days / 7)} sem.`;
  return `il y a ${Math.floor(days / 30)} mois`;
}

/** Seuil de relance (Channing 12/10 : « si le dernier contact date de 3 semaines, ça vaut le coup de relancer »). */
export const RELANCE_AFTER_DAYS = 21;
export function worthRelaunch(d: Date | null, now = Date.now()): boolean {
  return d != null && now - d.getTime() >= RELANCE_AFTER_DAYS * 86_400_000;
}
