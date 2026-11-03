/**
 * RELEVÉS DE STOCK HEBDOMADAIRES (11/10, décision Channing : « si ce scrape ne
 * coûte pas cher, let's go »).
 *
 * Chaque nuit (3 h Paris), ADA relève à nouveau le stock des concessions de la
 * Carte qui :
 *   - ont une vitrine (website) ET au moins un relevé réussi (site reconnu —
 *     un site inconnu reste à l'initiative d'un humain) ;
 *   - n'ont pas été relevées depuis 6 jours ;
 *   - dont le dernier relevé n'a PAS eu besoin de Zyte (lecture directe =
 *     gratuite ; un site derrière Cloudflare est payant, il reste manuel).
 * Les relevés s'enchaînent un par un (jamais en parallèle avec les études du
 * matin : 3 h, elles partent à 5 h). Bilan en warn → worker_logs.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { runDealerStock, showcaseKey } from './dealerStock';

// 03/11 (décision Channing) : créneau 1 h Paris, TOUTES les vitrines enregistrées, quotidien par défaut ;
// « weekly » = relevée si plus de 6 jours ; « off » = jamais. Les vitrines jamais lues avec succès partent
// aussi : leur échec est enregistré (boîte à apprendre) pour être corrigé le lendemain.
const TICK_MS = 15 * 60 * 1000;
const RUN_HOUR_PARIS = 1;
const STALE_DAYS = 6;
let running = false;
let lastDay = '';

const parisHour = () => Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }).format(new Date()));
const parisDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

type Run = { contact_id: string; started_at: string; status: string; warnings: string[] | null };
type Contact = { id: string; name: string; website: string | null; stock_frequency?: string | null };

export async function runWeeklyDealerStocks(force = false): Promise<void> {
  if (running) return;
  running = true;
  try {
    const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    // Colonne stock_frequency absente tant que le SQL du 03/11 n'est pas collé : tout le monde en quotidien.
    const first = await sb.from('network_contacts').select('id,name,website,stock_frequency').not('website', 'is', null).limit(2000);
    const contacts = first.error && /stock_frequency/.test(first.error.message)
      ? (await sb.from('network_contacts').select('id,name,website').not('website', 'is', null).limit(2000)).data
      : first.data;
    const { data: runs } = await sb.from('network_stock_runs').select('contact_id,started_at,status,warnings').order('started_at', { ascending: false }).limit(5000);
    const lastByContact = new Map<string, Run>();
    const lastDoneByContact = new Map<string, Run>();
    for (const r of (runs ?? []) as Run[]) {
      if (!lastByContact.has(r.contact_id)) lastByContact.set(r.contact_id, r);
      if (r.status === 'done' && !lastDoneByContact.has(r.contact_id)) lastDoneByContact.set(r.contact_id, r);
    }
    const cutoff = Date.now() - STALE_DAYS * 86_400_000;
    const due: Contact[] = [];
    const skipped: string[] = [];
    const todayCutoff = Date.now() - 20 * 3600_000;
    for (const c of (contacts ?? []) as Contact[]) {
      if (!c.website || !/^https?:\/\//i.test(c.website)) continue;
      const freq = c.stock_frequency ?? 'daily';
      if (freq === 'off') { skipped.push(`${c.name} (arrêté)`); continue; }
      const done = lastDoneByContact.get(c.id);
      const last = lastByContact.get(c.id);
      if (!force && last) {
        if (Date.parse(last.started_at) > todayCutoff) continue;                       // déjà relevée aujourd'hui
        if (freq === 'weekly' && Date.parse(last.started_at) > cutoff) continue;      // hebdomadaire : moins de 6 j
      }
      if (done && (done.warnings ?? []).some((w) => /Zyte/i.test(w))) { skipped.push(`${c.name} (Zyte, payant)`); continue; }
      due.push(c);
    }
    // VITRINE PARTAGÉE (03/11) : une seule lecture par site, le relevé est recopié sur les fiches sœurs par runDealerStock.
    const seenShowcase = new Set<string>();
    const dueUnique = due.filter((c) => { const k = showcaseKey(c.website) ?? c.id; if (seenShowcase.has(k)) { skipped.push(`${c.name} (même vitrine, relevé partagé)`); return false; } seenShowcase.add(k); return true; });
    due.length = 0; due.push(...dueUnique);
    if (due.length === 0) { console.warn(`[DEALER_STOCK_WEEKLY] rien à relever${skipped.length ? ` · ignorés : ${skipped.join(', ')}` : ''}`); return; }
    console.warn(`[DEALER_STOCK_WEEKLY] ${due.length} concession(s) à relever : ${due.map((c) => c.name).join(', ')}${skipped.length ? ` · ignorés : ${skipped.join(', ')}` : ''}`);
    let ok = 0, ko = 0;
    for (const c of due) {
      try {
        const s = await runDealerStock(c.id, c.website!, 'ADA (nuit)');
        ok++;
        console.warn(`[DEALER_STOCK_WEEKLY] ${c.name} : ${s.total} véhicules, ${s.newCount} nouveaux, ${s.goneCount} sortis, ${s.priceChanges} prix bougés (${s.provider}, ${s.pages} page(s))`);
      } catch (e) {
        ko++;
        console.warn(`[DEALER_STOCK_WEEKLY] ${c.name} : échec — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.warn(`[DEALER_STOCK_WEEKLY] terminé : ${ok} relevé(s), ${ko} échec(s)`);
  } finally { running = false; }
}

export function startDealerStockScheduler(): void {
  const tick = () => {
    const day = parisDay();
    if (parisHour() !== RUN_HOUR_PARIS || lastDay === day) return;
    lastDay = day;
    void runWeeklyDealerStocks();
  };
  setInterval(tick, TICK_MS);
  setTimeout(tick, 120_000);
  console.warn(`[DEALER_STOCK_WEEKLY] ordonnanceur actif (chaque nuit ${RUN_HOUR_PARIS} h Paris, toutes les vitrines : quotidien par défaut, hebdomadaire = ${STALE_DAYS} j, lecture directe seulement)`);
}
