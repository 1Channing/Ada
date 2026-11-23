/**
 * NIVEAU DE RELATION D'UNE FICHE DE LA CARTE (23/11, Channing : « Ceux avec lesquels on a fait des deals dans les
 * ventes, on les garde en contact actif ; ensuite ceux dont les acheteurs VO sont connus ; les vitrines sans acheteurs
 * connus / sans deals pour les data » — « je veux des noms parlants, qu'on sache ce qu'on coche » — « en discussion,
 * quelque chose en un seul mot, avec un raccourci vers le fil de conversation de Dana »).
 *
 * Quatre niveaux, du plus fort au plus faible, chacun établi par un FAIT :
 *  - partenaire : au moins un deal enregistré dans les Ventes (il nous a acheté ou vendu une voiture) ;
 *  - discussion : il a répondu à Dana (un vrai message reçu dans un fil rattaché à la fiche) ;
 *  - prospect   : son acheteur VO (ou responsable VO) est connu (le contact de la fiche le dit) ;
 *  - donnees    : vitrine suivie pour ses données — ni acheteur connu, ni réponse, ni deal.
 * Un niveau posé à la main n'est jamais abaissé par le calcul ; le calcul relève un niveau quand les faits le
 * justifient. Les anciens mots (chaud, tiède, froid, nouveau) sont traduits une fois.
 * Pur : partagé par la Carte et par le passage de nuit du worker.
 */
import { contactRoleOf } from '../agents/campaignContacts';

export type RelationLevel = 'partenaire' | 'discussion' | 'prospect' | 'donnees';
export const RELATION_LEVELS: RelationLevel[] = ['partenaire', 'discussion', 'prospect', 'donnees'];
export const RELATION_LEVEL_LABEL: Record<RelationLevel, string> = { partenaire: 'Partenaire', discussion: 'Discussion', prospect: 'Prospect', donnees: 'Données' };
/** Ce que l'on coche : la phrase affichée à côté du niveau. */
export const RELATION_LEVEL_HELP: Record<RelationLevel, string> = {
  partenaire: 'Au moins un deal dans les Ventes : il nous a acheté ou vendu une voiture.',
  discussion: 'Il nous a répondu : la discussion est en cours (raccourci « Fil Dana » quand elle passe par Dana).',
  prospect: 'Son acheteur VO (ou responsable VO) est connu, pas encore de deal.',
  donnees: 'Vitrine suivie pour ses données : ni acheteur connu, ni réponse, ni deal.',
};
const RANK: Record<RelationLevel, number> = { partenaire: 3, discussion: 2, prospect: 1, donnees: 0 };

/** Mot enregistré → niveau. Anciens mots : chaud = conversation en cours (le deal, s'il existe, relève au-dessus),
 *  tiède = prospect, froid = données ; « nouveau » et vide = rien de posé (le calcul décide). */
export function relationLevelOf(relation: string | null | undefined): RelationLevel | null {
  const r = (relation ?? '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (r === 'partenaire' || r === 'discussion' || r === 'prospect') return r;
  if (r === 'donnees') return 'donnees';
  if (r === 'chaud') return 'discussion';
  if (r === 'tiede') return 'prospect';
  if (r === 'froid') return 'donnees';
  return null;
}
export const higherLevel = (a: RelationLevel | null, b: RelationLevel | null): RelationLevel | null => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);

export interface RelationFacts { deals: number; replied: boolean; buyerKnown: boolean }
/** Niveau établi par les faits. */
export const factLevel = (f: RelationFacts): RelationLevel => (f.deals > 0 ? 'partenaire' : f.replied ? 'discussion' : f.buyerKnown ? 'prospect' : 'donnees');
/** Acheteur ou responsable VO connu : le contact de la fiche est rangé « acheteur » ou « responsable » (même lecture que la Campagne). */
export const buyerKnown = (c: { contact_name: string | null }): boolean => { const r = contactRoleOf(c); return r === 'acheteur' || r === 'responsable'; };

/** Rôle du point de vue de MC Export (« vendeur » = nous achetons chez lui, « acheteur » = il nous achète). Channing :
 *  « s'ils vendent, c'est qu'ils ont acheté quelque part » — une concession ou un trader est les deux ; un loueur, un
 *  leasing, une flotte revend ses voitures (vendeur), sauf s'il nous a acheté. Les autres types gardent leur rôle,
 *  précisé par les deals. */
export function roleFor(kind: string, current: string, deals: { bought: number; sold: number }): string {
  if (kind === 'concession' || kind === 'trader') return 'les_deux';
  if (kind === 'loueur' || kind === 'leasing' || kind === 'flotte') return deals.bought > 0 ? 'les_deux' : 'vendeur';
  if (deals.bought > 0 && deals.sold > 0) return 'les_deux';
  if (deals.bought > 0) return current === 'vendeur' ? 'les_deux' : current === 'les_deux' ? 'les_deux' : 'acheteur';
  if (deals.sold > 0) return current === 'acheteur' ? 'les_deux' : current === 'les_deux' ? 'les_deux' : 'vendeur';
  return current;
}

// ── Rapprochement des Ventes et de la Carte ────────────────────────────────────────────────────────────────────────
export interface SalesContact { id: string; company_name: string | null; email: string | null; phone: string | null; vat_number?: string | null }
export interface CarteContact { id: string; name: string; email: string | null; phone: string | null; website: string | null; notes?: string | null; people?: Array<{ phone?: string; email?: string }> | null }
export interface SaleTx { seller_contact_id?: string | null; supplier_contact_id?: string | null; buyer_contact_id?: string | null; client_contact_id?: string | null; transaction_date?: string | null; status?: string | null }

/** Mots communs aux noms de sociétés auto : ils ne suffisent pas à reconnaître une société. */
const GENERIC = new Set(['auto', 'autos', 'automobile', 'automobiles', 'automobili', 'automoveis', 'autogroep', 'autobedrijf', 'automobielbedrijf', 'autohaus', 'autohandel', 'car', 'cars', 'motors', 'motor', 'group', 'groupe', 'gruppo', 'groep', 'dealer', 'occasion', 'occasions', 'center', 'centre', 'centro', 'concessionaria', 'garage', 'biler', 'bil', 'automobilforretning', 'comercio', 'et', 'and', 'the', 'srl', 'spa', 'sas', 'sarl', 'eurl', 'sa', 'bv', 'nv', 'gmbh', 'ag', 'kg', 'oy', 'oyj', 'ab', 'aps', 'as', 'uab', 'kft', 'zrt', 'sro', 'ltd']);
/** Cœur distinctif d'un nom de société, sans espaces : « AUTOGROEP OOSTENDORP » → « oostendorp », « De Waal Autogroep B.V. » → « dewaal »
 *  (les points des sigles retirés d'abord : « B.V. » = « bv », mot commun ; les particules « de », « van » restent : « Dewaal » s'écrit aussi collé). */
export function companyCore(name: string | null | undefined): string {
  const words = (name ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\(.*?\)/g, ' ').replace(/\./g, '').split(/[^a-z0-9]+/).filter(Boolean);
  return words.filter((w) => !GENERIC.has(w)).join('');
}
const compact = (name: string | null | undefined) => (name ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');
const FREE_MAIL = /(^|\.)(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|me|gmx|web|orange|wanadoo|free|sfr|laposte|aol|proton|protonmail|libero|virgilio|seznam|centrum|freemail|citromail)\./;
const mailDomain = (e: string | null | undefined) => { const d = (e ?? '').toLowerCase().trim().split('@')[1] ?? ''; return d && !FREE_MAIL.test(d + '.') ? d.replace(/^www\./, '') : ''; };
const webDomain = (u: string | null | undefined) => { try { return new URL(String(u)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const phoneKey = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; };

/** Fiches de la Carte d'un contact des Ventes : même n° de TVA cité dans la fiche, même domaine d'e-mail (pas une
 *  messagerie gratuite) ou de site, même téléphone, ou cœur de nom contenu dans le nom de la fiche (5 lettres au moins). */
export function carteMatchesOf(s: SalesContact, carte: CarteContact[]): string[] {
  const core = companyCore(s.company_name), dom = mailDomain(s.email), tel = phoneKey(s.phone);
  const vat = (s.vat_number ?? '').replace(/\s+/g, '').toUpperCase();
  const out: string[] = [];
  for (const c of carte) {
    const byVat = vat.length >= 8 && (c.notes ?? '').toUpperCase().replace(/\s+/g, '').includes(vat);
    const byDom = !!dom && (mailDomain(c.email) === dom || webDomain(c.website).endsWith(dom) || (c.people ?? []).some((p) => mailDomain(p.email) === dom));
    const byTel = !!tel && (phoneKey(c.phone) === tel || (c.people ?? []).some((p) => phoneKey(p.phone) === tel));
    const cCore = companyCore(c.name);
    const byName = (core.length >= 5 && compact(c.name).includes(core)) || (cCore.length >= 5 && compact(s.company_name).includes(cCore));
    if (byVat || byDom || byTel || byName) out.push(c.id);
  }
  return out;
}

/** Deals par fiche : chaque transaction compte UNE fois par fiche (un contact peut y être acheteur ET client). Les
 *  transactions annulées ne comptent pas. « bought » = il nous a acheté, « sold » = il nous a vendu. */
export function dealsByCarte(txs: SaleTx[], sales: SalesContact[], carte: CarteContact[]): Map<string, { bought: number; sold: number; last: string | null }> {
  const toCarte = new Map<string, string[]>();
  for (const s of sales) { const m = carteMatchesOf(s, carte); if (m.length) toCarte.set(s.id, m); }
  const out = new Map<string, { bought: number; sold: number; last: string | null }>();
  for (const t of txs) {
    if (/annul|cancel/i.test(t.status ?? '')) continue;
    const bump = (ids: Array<string | null | undefined>, k: 'bought' | 'sold') => {
      const fiches = new Set(ids.filter(Boolean).flatMap((id) => toCarte.get(id as string) ?? []));
      for (const f of fiches) {
        const d = out.get(f) ?? { bought: 0, sold: 0, last: null };
        d[k]++;
        if (t.transaction_date && (!d.last || t.transaction_date > d.last)) d.last = t.transaction_date;
        out.set(f, d);
      }
    };
    bump([t.buyer_contact_id, t.client_contact_id], 'bought');
    bump([t.seller_contact_id, t.supplier_contact_id], 'sold');
  }
  return out;
}
