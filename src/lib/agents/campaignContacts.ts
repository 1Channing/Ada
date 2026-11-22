/**
 * QUI ON CONTACTE DANS UNE CAMPAGNE DEPUIS LA CARTE (22/11, Channing).
 * - « Les vendeurs VO ne connaissent pas les règles cross-border ; les acheteurs VO ont la main sur les stocks, c'est
 *   notre priorité ; sinon le responsable VO ; les vendeurs en tout dernier recours pour l'aiguillage, jamais en contact
 *   direct » → contactRoleOf / contactModeOf.
 * - « Quand je clique sur Alfa Romeo, je veux des concessions Alfa Romeo, pas des concessions qui ont des Alfa Romeo
 *   en vente — ce sont des reprises ; et les indépendants à part, jugés sur leur stock » → isIndependent / dealerBrands.
 * Pur : partagé par l'onglet Campagne et par le worker.
 */
import { brandKey } from './opportunity';
import { addressKind } from './qualification';

export interface CampaignContactLike { name: string; kind?: string | null; contact_name: string | null; email: string | null }

export type ContactMode = 'direct' | 'aiguillage';
export type ContactRole = 'acheteur' | 'responsable' | 'vendeur' | 'inconnu';
export const ROLE_LABEL: Record<ContactRole, string> = { acheteur: 'acheteur VO', responsable: 'responsable VO', vendeur: 'vendeur VO', inconnu: 'rôle inconnu' };
/** Acheteur VO d'abord, responsable VO ensuite ; le vendeur en dernier. */
export const ROLE_RANK: Record<ContactRole, number> = { acheteur: 0, responsable: 1, inconnu: 2, vendeur: 3 };

/** « Nom — rôle « titre local » » (fiches de Dana) : le nom, puis le rôle. */
export function splitContactName(contactName: string | null | undefined): { person: string | null; role: string | null } {
  // « · chef VO : Vladimír Sotá » (fiches plus anciennes) : un second nom après le point médian, pas le rôle du premier.
  const raw = (contactName ?? '').split(/\s+·\s+/)[0].trim();
  const parts = raw.split(/\s+[—–-]\s+/);
  if (parts.length === 1) {
    // « Tomáš Ožvald (výkup / acheteur VO) » : le rôle entre parenthèses.
    const m = raw.match(/^([^(]+?)\s*\(([^)]+)\)\s*$/);
    if (m) return { person: m[1].trim() || null, role: m[2].trim() || null };
  }
  const person = (parts[0] ?? '').trim() || null;
  const role = parts.slice(1).join(' — ').trim() || null;
  return { person, role };
}

export function contactRoleOf(c: Pick<CampaignContactLike, 'contact_name'>): ContactRole {
  const role = (splitContactName(c.contact_name).role ?? '').split('«')[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (/achet|vykup|felvasar|buyer|einkauf|inkoop|remarketing/.test(role)) return 'acheteur';
  if (/responsable|chef|direct|manager|leiter|hoofd|vedouci|veduci|vezet/.test(role)) return 'responsable';
  if (/vend|conseil|commercial|verk|sales|predaj|ertekesit/.test(role)) return 'vendeur';
  return 'inconnu';
}

/** Direct = acheteur VO ou responsable VO, nommé, à son adresse à lui (« prenom.nom@ », pas info@ / predaj@). */
export function contactModeOf(c: Pick<CampaignContactLike, 'contact_name' | 'email'>): ContactMode {
  const { person } = splitContactName(c.contact_name);
  if (!person || !c.email) return 'aiguillage';
  const role = contactRoleOf(c);
  if (role === 'vendeur' || role === 'inconnu') return 'aiguillage';
  return addressKind(c.email.trim().toLowerCase(), null, person) === 'personne' ? 'direct' : 'aiguillage';
}

export type DealerKind = 'concession' | 'independant';
export const isIndependent = (c: Pick<CampaignContactLike, 'name' | 'kind'>): boolean => c.kind === 'trader' || /ind[ée]pendant|autobaz[aá]r|haszn[aá]ltaut[oó]/i.test(c.name);
const nameTokens = (name: string) => name.split('(')[0].normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
/** Marques d'une concession : celles de son nom avant la parenthèse (le groupe entre parenthèses n'est pas une marque),
 *  plus celles qui pèsent au moins un quart de son stock (5 voitures ou plus). Un indépendant n'en a pas. */
export function dealerBrands(c: Pick<CampaignContactLike, 'name' | 'kind'>, stock: Array<{ brand: string; n: number }>, known: string[]): string[] {
  if (isIndependent(c)) return [];
  const tokens = new Set(nameTokens(c.name));
  const out = new Map<string, string>();
  for (const b of known) {
    const first = brandKey(b.split(/[\s/-]+/)[0]);
    if (first.length >= 3 && tokens.has(first)) out.set(brandKey(b), b);
    else if (first.length < 3 && c.name.split('(')[0].split(/[^A-Za-z0-9]+/).some((t) => t.toUpperCase() === b.toUpperCase())) out.set(brandKey(b), b);
  }
  const total = stock.reduce((a, b) => a + b.n, 0);
  for (const b of stock) if (b.n >= 5 && b.n / Math.max(1, total) >= 0.25) out.set(brandKey(b.brand), out.get(brandKey(b.brand)) ?? b.brand);
  return [...out.values()];
}
