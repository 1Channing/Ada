/**
 * À QUI ÉCRIT-ON SUR UNE FICHE ? (27/11, Channing : « dans les relances, les adresses sélectionnées ne sont pas
 * celles des contacts prospects, les acheteurs ; il faut sélectionner les mails des personnes décisionnaires »).
 *
 * Une fiche porte une adresse générale (email : souvent info@…) et des personnes (people, avec leur rôle et parfois
 * leur adresse). Pour une relance, on écrit au DÉCISIONNAIRE : l'acheteur VO d'abord, puis le responsable VO ou la
 * direction, puis l'interlocuteur principal de la fiche ; l'adresse générale sert de repli ; un vendeur VO n'est
 * jamais choisi d'office (il ne décide pas des achats) — on peut toujours le choisir à la main. Pur, sans réseau.
 */
import { contactRoleOf, ROLE_RANK, ROLE_LABEL, splitContactName, type ContactRole } from '../agents/campaignContacts';

export interface PersonLike { name?: string | null; role?: string | null; email?: string | null; phone?: string | null; note?: string | null }
export interface ContactLike { contact_name: string | null; email: string | null; people?: PersonLike[] | null }

export interface RecipientOption {
  /** 'main' (l'adresse de la fiche) ou 'p<i>' (une personne). */
  key: string;
  email: string;
  /** Le nom de la personne (null pour une adresse générale sans nom). */
  name: string | null;
  role: ContactRole;
  roleText: string | null;
  /** Ce qu'on affiche : « Arjan den Toonder · acheteur VO — arjan@… ». */
  label: string;
  /** L'adresse générale de la fiche (info@, contact@…) ou l'interlocuteur principal. */
  main: boolean;
  generic: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC = /^(info|contact|kontakt|verkoop|verkauf|sales|vente|ventes|office|mail|post|hello|admin|service|occasions?|used|vo|bil|salg|myynti|info-?[a-z]*)@/i;
const roleOf = (name: string | null, role: string | null): ContactRole => contactRoleOf({ contact_name: role?.trim() ? `${name ?? ''} — ${role.trim()}` : (name ?? '') });

/** Toutes les adresses où l'on peut écrire sur cette fiche, dédoublonnées, la meilleure d'abord. */
export function recipientOptions(c: ContactLike): RecipientOption[] {
  const out: RecipientOption[] = [];
  const seen = new Set<string>();
  const push = (o: RecipientOption) => { const k = o.email.toLowerCase(); if (!EMAIL.test(o.email) || seen.has(k)) return; seen.add(k); out.push(o); };
  (c.people ?? []).forEach((p, i) => {
    const email = (p.email ?? '').trim();
    if (!email) return;
    const name = (p.name ?? '').trim() || null;
    const role = roleOf(name, p.role ?? null);
    push({ key: `p${i}`, email, name, role, roleText: (p.role ?? '').trim() || null, label: `${name ?? email} · ${ROLE_LABEL[role]}${name ? ` — ${email}` : ''}`, main: false, generic: GENERIC.test(email) });
  });
  const mainEmail = (c.email ?? '').trim();
  if (mainEmail) {
    const { person, role: roleText } = splitContactName(c.contact_name);
    const generic = GENERIC.test(mainEmail) || !person;
    const role = person ? contactRoleOf({ contact_name: c.contact_name }) : 'inconnu';
    push({ key: 'main', email: mainEmail, name: person, role, roleText, label: generic ? `Adresse générale — ${mainEmail}` : `${person} · ${ROLE_LABEL[role]} — ${mainEmail}`, main: true, generic });
  }
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Ordre de préférence : acheteur, responsable, interlocuteur principal nommé, personne au rôle inconnu, adresse générale, vendeur. */
function rank(o: RecipientOption): number {
  if (o.role === 'acheteur') return 0;
  if (o.role === 'responsable') return 1;
  if (o.main && !o.generic) return 2;
  if (o.role === 'inconnu' && !o.generic) return 3;
  if (o.generic) return 4;
  return 5 + ROLE_RANK[o.role];
}

/** Le destinataire proposé d'office : jamais un vendeur VO quand une autre adresse existe. */
export function defaultRecipient(c: ContactLike): RecipientOption | null {
  const opts = recipientOptions(c);
  if (opts.length === 0) return null;
  const nonSeller = opts.find((o) => o.role !== 'vendeur');
  return nonSeller ?? opts[0];
}

/** Le prénom à mettre dans « Bonjour {prenom} » : celui de la personne choisie, sinon rien. */
export function recipientFirstName(o: RecipientOption | null): string {
  return (o?.name ?? '').trim().split(/\s+/)[0] || '';
}
