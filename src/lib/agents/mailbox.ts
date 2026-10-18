/**
 * LES DOSSIERS DE LA MESSAGERIE (18/10, Channing : « une boîte d'envoi, une
 * boîte de réception, une boîte d'archives, et une boîte de brouillons
 * connectée à À valider […] tout doit être structuré ») : comme Gmail, un
 * fil peut être dans plusieurs dossiers — Réception s'il a un mail reçu
 * (hors rebond), Brouillons s'il a quelque chose qui attend (les mêmes
 * messages que « À valider » : brouillon, à valider, préparé pour vous,
 * validé pas encore parti, échec), Envoyés s'il a un message parti, Archives
 * s'il est archivé — ou s'il n'a plus que des messages écartés.
 * La partie pure ; la lecture : listMailbox (services/agents.ts).
 */

export type MailFolder = 'reception' | 'brouillons' | 'envoyes' | 'archives';

/** Ce qu'un fil contient, pour le ranger. */
export interface MailboxFacts {
  archived: boolean; last_message_at: string | null; created_at: string;
  /** Un mail reçu (hors rebond), et le dernier reçu. */
  received: boolean; lastIn: string | null;
  /** Un message parti (de la boîte, ou envoyé par Channing lui-même), et le dernier parti. */
  sent: boolean; lastOut: string | null;
  /** Ce qui attend, et ses statuts (pastilles de la liste). */
  waiting: number; waitingStatuses: string[];
  /** Que des notes LinkedIn (pas de mail). */
  linkedinOnly: boolean;
  /** Que des messages écartés ou refusés : rangé avec les archives. */
  dead: boolean;
}

export interface MailboxMessageLite {
  direction: string; status: string; channel: string; classification: string | null;
  received_at: string | null; sent_at: string | null; created_at: string;
}

/** Ce qui attend dans « Brouillons » (et « À valider »). */
export const WAITING_STATUSES = ['brouillon', 'a_valider', 'pour_channing', 'valide', 'envoi', 'echec'];

/** Ce que contient un fil, d'après ses messages. */
export function mailboxFacts(ms: MailboxMessageLite[]): Omit<MailboxFacts, 'archived' | 'last_message_at' | 'created_at'> {
  const ins = ms.filter((x) => x.direction === 'in' && x.classification !== 'rebond');
  const outs = ms.filter((x) => x.direction === 'out' && (x.status === 'envoye' || x.status === 'envoye_main'));
  const waiting = ms.filter((x) => x.direction === 'out' && WAITING_STATUSES.includes(x.status));
  const latest = (xs: string[]) => xs.filter(Boolean).sort().pop() ?? null;
  return {
    received: ins.length > 0, lastIn: latest(ins.map((x) => x.received_at ?? x.created_at)),
    sent: outs.length > 0, lastOut: latest(outs.map((x) => x.sent_at ?? x.created_at)),
    waiting: waiting.length, waitingStatuses: [...new Set(waiting.map((x) => x.status))],
    linkedinOnly: ms.length > 0 && ms.every((x) => x.channel === 'linkedin'),
    dead: ms.length > 0 && ms.every((x) => x.direction === 'out' && x.status === 'refuse'),
  };
}

/** Les fils d'un dossier, les plus récents d'abord (le dernier reçu, le dernier parti, ou le dernier mouvement). */
export function folderThreads<T extends MailboxFacts>(rows: T[], f: MailFolder): T[] {
  const at = (x: T) => (f === 'reception' ? x.lastIn : f === 'envoyes' ? x.lastOut : null) ?? x.last_message_at ?? x.created_at;
  const inFolder = (x: T) => (f === 'archives' ? x.archived || x.dead
    : f === 'envoyes' ? x.sent
      : !x.archived && !x.dead && (f === 'reception' ? x.received : x.waiting > 0));
  return rows.filter(inFolder).sort((a, b) => at(b).localeCompare(at(a)));
}

/** Le dossier où ouvrir un fil (un lien « Ouvrir le fil ») : ce qui attend d'abord, puis la réception, les envois, les archives. */
export function folderOf(x: MailboxFacts): MailFolder {
  if (x.archived || x.dead) return 'archives';
  if (x.waiting > 0) return 'brouillons';
  if (x.received) return 'reception';
  return x.sent ? 'envoyes' : 'brouillons';
}
