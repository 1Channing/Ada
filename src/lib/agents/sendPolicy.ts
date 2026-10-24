/**
 * QUAND ADA ET DANA PEUVENT ENVOYER (16/10) — logique pure, partagée par le
 * worker (file d'envoi) et l'onglet Agents (« prochain créneau »).
 *
 * - Horaires de bureau à l'heure de Paris (jours et heures réglables). Une
 *   fin à « 00:00 » veut dire minuit : « 00:00 à 00:00 » = toute la journée.
 *   Ce sont aussi les horaires du travail automatique (17/10).
 * - Plafond du jour sur les premiers contacts et relances (les réponses à
 *   une personne qui a écrit ne sont pas plafonnées).
 * - Liste « ne plus contacter » : une adresse, ou « @domaine » pour tout un
 *   domaine.
 * Aucun import : testée par test/agents-mail.test.ts.
 */

export interface SendWindow {
  /** Jours ISO : 1 = lundi … 7 = dimanche. */
  send_days: number[];
  /** « 08:30 » ou « 08:30:00 ». */
  send_from: string;
  send_to: string;
}

const TZ = 'Europe/Paris';
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23',
});
const ISO_DAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface ParisClock { isoDay: number; minutes: number; ymd: string; y: number; m: number; d: number }

/** Jour et heure de Paris d'un instant. */
export function parisClock(at: Date): ParisClock {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const y = Number(p.year); const m = Number(p.month); const d = Number(p.day);
  return { isoDay: ISO_DAY[p.weekday] ?? 1, minutes: Number(p.hour) * 60 + Number(p.minute), ymd: `${p.year}-${p.month}-${p.day}`, y, m, d };
}

/** Décalage de Paris (ms) à un instant donné : heure murale − UTC. */
function parisOffsetMs(at: Date): number {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((wall - at.getTime()) / 60000) * 60000;
}

/** L'instant UTC d'une heure murale de Paris (jour y-m-d, minutes depuis minuit). */
export function parisWallToDate(y: number, m: number, d: number, minutes: number): Date {
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  // Le décalage (été/hiver) à l'instant visé, lu deux fois : la première lecture peut tomber de l'autre
  // côté du changement d'heure. 25/10 : lu à midi, il plaçait minuit du 25/10/2026 à 1 h (encore l'heure
  // d'été à minuit) — le plafond et les quotas du jour démarraient une heure trop tard.
  const first = wall - parisOffsetMs(new Date(wall));
  return new Date(wall - parisOffsetMs(new Date(first)));
}

/** Minuit à Paris (instant UTC) du jour de `at` — début du compteur du plafond. */
export function parisDayStart(at: Date): Date {
  const c = parisClock(at);
  return parisWallToDate(c.y, c.m, c.d, 0);
}

export const toMinutes = (hhmm: string): number => {
  const [h, mi] = (hhmm ?? '').split(':').map((x) => Number(x));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(mi) ? mi : 0);
};

/** La fin d'un créneau, en minutes depuis minuit : « 00:00 » en fin veut dire minuit (24 h). */
export const endMinutes = (hhmm: string): number => toMinutes(hhmm) || 24 * 60;

/** Dans les horaires d'envoi (heure de Paris) ? */
const DAY_NAME = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const hm = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
/** Les jours et heures de travail d'une agente, en clair : « du lundi au vendredi, 8 h 30-18 h », « tous les jours, 24 h sur 24 ». */
export function workHoursLabel(w: SendWindow): string {
  const days = [...new Set(w.send_days)].filter((d) => d >= 1 && d <= 7).sort();
  // Les jours qui se suivent : « du lundi au vendredi » (trois et plus), sinon chaque jour par son nom.
  const runs: number[][] = [];
  for (const d of days) { const last = runs[runs.length - 1]; if (last && d === last[last.length - 1] + 1) last.push(d); else runs.push([d]); }
  const parts = runs.flatMap((r) => (r.length >= 3 ? [`du ${DAY_NAME[r[0]]} au ${DAY_NAME[r[r.length - 1]]}`] : r.map((d) => DAY_NAME[d])));
  const dayText = days.length === 7 ? 'tous les jours' : days.length === 0 ? 'aucun jour'
    : parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : parts[0];
  const from = toMinutes(w.send_from);
  const to = endMinutes(w.send_to);
  return `${dayText}, ${from === 0 && to === 24 * 60 ? '24 h sur 24' : `${hm(from)}-${to === 24 * 60 ? 'minuit' : hm(to)}`}`;
}

export function inSendWindow(at: Date, w: SendWindow): boolean {
  const c = parisClock(at);
  if (!w.send_days.includes(c.isoDay)) return false;
  return c.minutes >= toMinutes(w.send_from) && c.minutes < endMinutes(w.send_to);
}

/** Le prochain instant où l'envoi est permis (maintenant s'il l'est déjà). Null si aucun jour n'est coché. */
export function nextWindowStart(at: Date, w: SendWindow): Date | null {
  if (inSendWindow(at, w)) return at;
  if (w.send_days.length === 0 || endMinutes(w.send_to) <= toMinutes(w.send_from)) return null;
  for (let k = 0; k < 8; k++) {
    const probe = new Date(at.getTime() + k * 86_400_000);
    const c = parisClock(probe);
    if (!w.send_days.includes(c.isoDay)) continue;
    const start = parisWallToDate(c.y, c.m, c.d, toMinutes(w.send_from));
    if (start.getTime() > at.getTime()) return start;
  }
  return null;
}

/** Écart aléatoire entre deux premiers contacts (en ms), borné et ordonné. */
export function randomGapMs(minSeconds: number, maxSeconds: number, rnd: () => number = Math.random): number {
  const lo = Math.max(0, Math.min(minSeconds, maxSeconds));
  const hi = Math.max(lo, Math.max(minSeconds, maxSeconds));
  return Math.round((lo + (hi - lo) * rnd()) * 1000);
}

/** La règle « ne plus contacter » qui bloque l'un des destinataires (adresse ou « @domaine »), sinon null. */
export function suppressionMatch(recipients: string[], suppressed: Iterable<string>): string | null {
  const set = new Set([...suppressed].map((s) => s.trim().toLowerCase()));
  for (const r of recipients) {
    const e = r.trim().toLowerCase();
    if (!e) continue;
    if (set.has(e)) return e;
    const dom = e.includes('@') ? `@${e.split('@')[1]}` : '';
    if (dom && set.has(dom)) return dom;
  }
  return null;
}

/** Les premiers contacts et relances comptent dans le plafond ; une réponse, non. */
export const countsAgainstCap = (kind: string): boolean => kind === 'premier_contact' || kind === 'relance';
