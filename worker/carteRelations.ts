/**
 * CLASSEMENT DE LA CARTE (23/11, Channing : « Ceux avec lesquels on a fait des deals dans les ventes, on les garde en
 * contact actif ; ensuite ceux dont les acheteurs VO sont connus ; les vitrines sans acheteurs connus / sans deals pour
 * les data » — « des noms parlants » — « on garde bien les différenciations loueur / concession / trader / flotte »).
 *
 * Chaque nuit (2 h Paris, après le relevé des vitrines) et au démarrage du worker : pour chaque fiche, le niveau établi
 * par les faits (src/lib/network/relations.ts) — Partenaire (deal dans les Ventes), Discussion (vraie réponse dans un
 * fil d'une agente rattaché à la fiche), Prospect (acheteur ou responsable VO connu), Données — et le rôle (les deals
 * disent qui achète à qui ; une concession ou un trader est acheteur ET vendeur). Le niveau enregistré n'est jamais
 * abaissé : un niveau posé à la main reste, le calcul ne fait que le relever. Le type (concession, loueur, leasing,
 * flotte, trader…) n'est jamais changé. Seules les fiches qui changent sont écrites ; bilan en warn → worker_logs.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { buyerKnown, dealsByCarte, factLevel, higherLevel, relationLevelOf, roleFor, type CarteContact, type SaleTx, type SalesContact } from '../src/lib/network/relations';
import { isRealAnswer } from '../src/lib/agents/mailbox';

type Fiche = CarteContact & { kind: string; role: string; relation: string; contact_name: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any };

/** Toutes les lignes d'une table, par pages de 1 000. */
async function all<T>(table: string, cols: string, filter?: (q: any) => any): Promise<{ rows: T[]; error: string | null }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    let q = sb.from(table).select(cols).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) return { rows, error: String(error.message ?? error) };
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return { rows, error: null };
}

export interface CarteClassification { id: string; name: string; relation: string; role: string; fromRelation: string; fromRole: string; deals: number }

/** Calcule les changements (sans écrire). */
export async function computeCarteRelations(): Promise<{ changes: CarteClassification[]; counts: Record<string, number>; warnings: string[] }> {
  const warnings: string[] = [];
  const fiches = await all<Fiche>('network_contacts', 'id, name, kind, role, relation, contact_name, email, phone, website, notes, people');
  if (fiches.error) throw new Error(`fiches de la Carte illisibles : ${fiches.error}`);
  let sales = await all<SalesContact>('contacts', 'id, company_name, email, phone, vat_number');
  if (sales.error && /vat_number/.test(sales.error)) sales = await all<SalesContact>('contacts', 'id, company_name, email, phone');
  if (sales.error) warnings.push(`contacts des Ventes illisibles (${sales.error}) : niveau Partenaire non recalculé`);
  const txs = await all<SaleTx>('transactions_admin', 'seller_contact_id, supplier_contact_id, buyer_contact_id, client_contact_id, transaction_date, status');
  if (txs.error) warnings.push(`transactions illisibles (${txs.error}) : niveau Partenaire non recalculé`);
  const threads = await all<{ id: string; network_contact_id: string }>('agent_threads', 'id, network_contact_id', (q) => q.not('network_contact_id', 'is', null));
  const msgs = await all<{ thread_id: string; direction: string; classification: string | null; auto_reply: boolean | null }>('agent_messages', 'thread_id, direction, classification, auto_reply', (q) => q.eq('direction', 'in'));
  if (threads.error || msgs.error) warnings.push(`fils des agentes illisibles (${threads.error ?? msgs.error}) : niveau Discussion non recalculé`);

  // MC Export lui-même apparaît dans ses propres transactions (vendeur de ses ventes) : jamais une fiche de la Carte.
  const salesContacts = sales.rows.filter((s) => !/mc[\s-]*export/i.test(s.company_name ?? ''));
  const deals = sales.error || txs.error ? new Map() : dealsByCarte(txs.rows, salesContacts, fiches.rows);
  const answered = new Set(msgs.rows.filter((m) => isRealAnswer({ direction: m.direction, classification: m.classification, auto_reply: m.auto_reply })).map((m) => m.thread_id));
  const replied = new Set(threads.rows.filter((t) => answered.has(t.id)).map((t) => t.network_contact_id));

  const changes: CarteClassification[] = [];
  const counts: Record<string, number> = { partenaire: 0, discussion: 0, prospect: 0, donnees: 0 };
  for (const f of fiches.rows) {
    const d = deals.get(f.id) ?? { bought: 0, sold: 0, last: null };
    const level = higherLevel(relationLevelOf(f.relation), factLevel({ deals: d.bought + d.sold, replied: replied.has(f.id), buyerKnown: buyerKnown(f) }))!;
    const role = roleFor(f.kind, f.role, d);
    counts[level]++;
    if (level !== f.relation || role !== f.role) changes.push({ id: f.id, name: f.name, relation: level, role, fromRelation: f.relation, fromRole: f.role, deals: d.bought + d.sold });
  }
  return { changes, counts, warnings };
}

let running = false;
/** Classe la Carte et écrit les fiches qui changent. */
export async function classifyCarte(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { changes, counts, warnings } = await computeCarteRelations();
    let ok = 0;
    for (const c of changes) {
      const { error } = await sb.from('network_contacts').update({ relation: c.relation, role: c.role, updated_at: new Date().toISOString() }).eq('id', c.id);
      if (error) warnings.push(`${c.name} : ${error.message}`); else ok++;
    }
    const promoted = changes.filter((c) => c.relation !== c.fromRelation).length;
    console.warn(`[CARTE_CLASSEMENT] ${ok} fiche(s) mise(s) à jour (${promoted} niveau(x), ${changes.length - promoted} rôle(s) seulement) · Partenaire ${counts.partenaire} · Discussion ${counts.discussion} · Prospect ${counts.prospect} · Données ${counts.donnees}${warnings.length ? ` · ${warnings.slice(0, 5).join(' · ')}` : ''}`);
  } catch (e) {
    console.warn(`[CARTE_CLASSEMENT] échec — ${e instanceof Error ? e.message : String(e)}`);
  } finally { running = false; }
}

const parisHour = () => { const h = Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }).format(new Date()).replace(/\D/g, '')); return Number.isFinite(h) ? h : new Date().getUTCHours(); };
const parisDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
let lastDay = '';
/** Au démarrage (3 min après) puis chaque nuit à 2 h Paris (après le relevé des vitrines de 1 h). */
export function startCarteRelationsScheduler(): void {
  setTimeout(() => { void classifyCarte(); }, 180_000);
  setInterval(() => {
    const day = parisDay();
    if (parisHour() !== 2 || lastDay === day) return;
    lastDay = day;
    void classifyCarte();
  }, 10 * 60 * 1000);
  console.warn('[CARTE_CLASSEMENT] ordonnanceur actif (au démarrage et chaque nuit à 2 h Paris : Partenaire / Discussion / Prospect / Données, rôle tiré des deals)');
}
