/**
 * LA MÉMOIRE DE L'ÉQUIPE, CÔTÉ WORKER (19/10 ; le rapprochement et ce qui
 * part dans la consigne : src/lib/agents/teamMemory.ts). Ce que l'équipe
 * MC Export sait déjà, lu dans ses tables :
 * - la carte du réseau — seulement ce que l'équipe a saisi (pas les fiches
 *   qu'Ada et Dana y ajoutent elles-mêmes), le contact principal et ses
 *   autres interlocuteurs ;
 * - le Workflow : les sociétés clientes et fournisseurs, et ce qu'on a fait
 *   avec elles (achats, ventes) ;
 * - les offres reçues des fournisseurs ;
 * - les mails des boîtes d'Ada et Dana, dont les copies de l'équipe (et les
 *   contacts qu'elles donnent).
 * Lu une fois toutes les 10 minutes. Le banc d'essai masque l'entreprise
 * testée (son contact de la carte, et son adresse partout ailleurs).
 */
import { emailDomain } from '../../src/lib/agents/people';
import { teamMatchesFor, companyKeys, type TeamRecord, type TeamMatch } from '../../src/lib/agents/teamMemory';
import type { DeepProspect } from '../../src/lib/agents/deepResearch';
import { sb } from './store';

const TTL_MS = 10 * 60_000;
let cache: { at: number; rows: TeamRecord[] } | null = null;
/** Le domaine de l'équipe et des agentes : jamais un contact extérieur. */
const OWN = /(^|\.)mc-export\.com$/i;

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }) : '');
const ROLE_FR: Record<string, string> = { vendeur: 'vendeur sur la carte', acheteur: 'acheteur sur la carte', les_deux: 'acheteur et vendeur sur la carte' };

interface MapRow {
  id: string; name: string; country: string | null; city: string | null; website: string | null; phone: string | null; email: string | null;
  contact_name: string | null; role: string | null; source: string | null; people: Array<{ name?: string; role?: string; phone?: string; email?: string }> | null;
}
interface WfContact { id: string; company_name: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; country: string | null; category: string | null; type: string | null }
interface MailRow {
  id: string; agent: string; direction: string; status: string; from_email: string | null; from_name: string | null; to_emails: string[] | null; cc_emails: string[] | null;
  subject: string | null; classification: string | null; received_at: string | null; sent_at: string | null; created_at: string;
  ai_notes: { contacts?: Array<{ nom?: string | null; fonction?: string | null; entreprise?: string | null; email?: string | null; telephone?: string | null }> } | null;
}

/** Tout ce que l'équipe sait (relu toutes les 10 minutes). */
export async function loadTeamRecords(): Promise<TeamRecord[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows: TeamRecord[] = [];

  // 1. La carte : ce que l'équipe a saisi.
  const { data: map } = await sb.from('network_contacts').select('id, name, country, city, website, phone, email, contact_name, role, source, people').limit(5000);
  for (const c of (map ?? []) as MapRow[]) {
    if ((c.source ?? 'manuel') !== 'manuel') continue;
    const relation = ROLE_FR[c.role ?? ''] ?? 'sur la carte';
    rows.push({ source: 'carte', ref: c.id, company: c.name, country: c.country, person: c.contact_name?.trim() || null, role: null, email: c.email?.trim().toLowerCase() || null, phone: c.phone, website: c.website, relation });
    for (const p of c.people ?? []) {
      if (!p?.name && !p?.email) continue;
      rows.push({ source: 'carte', ref: c.id, company: c.name, country: c.country, person: p.name?.trim() || null, role: p.role?.trim() || null, email: p.email?.trim().toLowerCase() || null, phone: p.phone ?? null, website: c.website, relation });
    }
  }

  // 2. Le Workflow : les sociétés, et ce qu'on a fait avec elles.
  const { data: wf } = await sb.from('contacts').select('id, company_name, first_name, last_name, email, phone, country, category, type').not('company_name', 'is', null).limit(5000);
  const contacts = ((wf ?? []) as WfContact[]).filter((c) => !/mc[ -]?export/i.test(c.company_name ?? ''));
  if (contacts.length) {
    const { data: tx } = await sb.from('transactions_admin').select('supplier_contact_id, seller_contact_id, seller_contact_id_2, buyer_contact_id, buyer_contact_id_2').limit(10000);
    const bought = new Map<string, number>();
    const sold = new Map<string, number>();
    for (const t of (tx ?? []) as Array<Record<string, string | null>>) {
      for (const k of ['supplier_contact_id', 'seller_contact_id', 'seller_contact_id_2']) if (t[k]) bought.set(t[k] as string, (bought.get(t[k] as string) ?? 0) + 1);
      for (const k of ['buyer_contact_id', 'buyer_contact_id_2']) if (t[k]) sold.set(t[k] as string, (sold.get(t[k] as string) ?? 0) + 1);
    }
    for (const c of contacts) {
      const a = bought.get(c.id) ?? 0;
      const v = sold.get(c.id) ?? 0;
      const relation = [a ? `fournisseur : ${a} achat${a > 1 ? 's' : ''}` : null, v ? `client : ${v} vente${v > 1 ? 's' : ''}` : null].filter(Boolean).join(', ') || 'dans le Workflow';
      const person = [c.first_name, c.last_name].filter((x) => x?.trim()).join(' ').trim() || null;
      rows.push({ source: 'workflow', ref: c.id, company: c.company_name, country: c.country, person, role: null, email: c.email?.trim().toLowerCase() || null, phone: c.phone, website: null, relation });
    }
  }

  // 3. Les offres reçues des fournisseurs (le nom seulement).
  const { data: offers } = await sb.from('supplier_offers').select('id, supplier, created_at').not('supplier', 'is', null).order('created_at', { ascending: false }).limit(500);
  for (const o of (offers ?? []) as Array<{ id: string; supplier: string | null; created_at: string }>) {
    if (!o.supplier?.trim()) continue;
    rows.push({ source: 'offre', ref: o.id, company: o.supplier.trim(), country: null, person: null, role: null, email: null, phone: null, website: null, relation: `offre reçue le ${day(o.created_at)}`, at: o.created_at });
  }

  // 4. Les mails des agentes (reçus et partis), dont les copies de l'équipe.
  const { data: mails } = await sb.from('agent_messages').select('id, agent, direction, status, from_email, from_name, to_emails, cc_emails, subject, classification, received_at, sent_at, created_at, ai_notes')
    .eq('channel', 'mail').in('status', ['recu', 'envoye', 'envoye_main']).order('created_at', { ascending: false }).limit(3000);
  for (const m of (mails ?? []) as MailRow[]) {
    const copy = m.classification === 'copie';
    const when = day(m.received_at ?? m.sent_at ?? m.created_at);
    const name = m.agent === 'dana' ? 'Dana' : 'Ada';
    const external = (e: string | null | undefined) => !!e && !OWN.test(emailDomain(e));
    if (m.direction === 'in' && external(m.from_email)) {
      rows.push({ source: copy ? 'copie' : 'mail', ref: m.id, company: null, country: null, person: m.from_name?.trim() || null, role: null, email: (m.from_email as string).toLowerCase(), phone: null, website: null,
        relation: copy ? `en copie d'un mail de l'équipe le ${when}` : `a écrit à ${name} le ${when}`, at: m.received_at });
    }
    const others = [...(m.to_emails ?? []), ...(m.cc_emails ?? [])].filter(external);
    for (const e of others) {
      rows.push({ source: copy ? 'copie' : 'mail', ref: m.id, company: null, country: null, person: null, role: null, email: e.toLowerCase(), phone: null, website: null,
        relation: copy ? `écrit par l'équipe le ${when}` : m.direction === 'out' ? `${name} lui a écrit le ${when}` : `en copie le ${when}`, at: m.sent_at ?? m.received_at });
    }
    for (const x of m.ai_notes?.contacts ?? []) {
      if (!x?.nom && !x?.email) continue;
      if (x.email && !external(x.email)) continue;
      rows.push({ source: copy ? 'copie' : 'mail', ref: m.id, company: x.entreprise?.trim() || null, country: null, person: x.nom?.trim() || null, role: x.fonction?.trim() || null,
        email: x.email?.trim().toLowerCase() || null, phone: x.telephone ?? null, website: null, relation: `donné dans un mail du ${when}`, at: m.received_at });
    }
  }
  cache = { at: Date.now(), rows };
  return rows;
}

/** Vide le cache (après une copie de l'équipe ou un « bon contact » donné par Channing : c'est tout de suite su). */
export const forgetTeam = (): void => { cache = null; };

/** Ce que le banc d'essai cache : l'entreprise testée — sa ligne de la carte, et son adresse partout ailleurs. */
export interface TeamMask { refs?: string[]; emails?: string[] }

/** Ce que l'équipe sait de cette fiche. */
export async function teamFor(p: Pick<DeepProspect, 'name' | 'group_name' | 'website' | 'emails' | 'phone' | 'city' | 'country' | 'evidence'>, mask: TeamMask = {}): Promise<TeamMatch[]> {
  const refs = new Set(mask.refs ?? []);
  const hidden = new Set((mask.emails ?? []).map((e) => e.toLowerCase()));
  const records = (await loadTeamRecords()).filter((r) => !(r.ref && refs.has(r.ref)) && !(r.email && hidden.has(r.email)));
  // Les autres sites de l'entreprise : celui du groupe, vu par la recherche approfondie.
  const sites = (p.evidence ?? []).filter((e) => /^(groupe|site du groupe)\b/i.test(e.note ?? '') && /^https?:\/\//i.test(e.url)).map((e) => e.url);
  const keys = companyKeys({ name: p.name, group_name: p.group_name, website: p.website, emails: (p.emails ?? []).map((e) => e.email), phone: p.phone, city: p.city, country: p.country, sites });
  return teamMatchesFor(keys, records);
}
