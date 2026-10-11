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
import { runDealerStock } from './dealerStock';

const TICK_MS = 60 * 60 * 1000;
const RUN_HOUR_PARIS = 3;
const STALE_DAYS = 6;
let running = false;
let lastDay = '';

const parisHour = () => Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }).format(new Date()));
const parisDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

type Run = { contact_id: string; started_at: string; status: string; warnings: string[] | null };
type Contact = { id: string; name: string; website: string | null };

export async function runWeeklyDealerStocks(force = false): Promise<void> {
  if (running) return;
  running = true;
  try {
    const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: contacts } = await sb.from('network_contacts').select('id,name,website').not('website', 'is', null).limit(2000);
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
    for (const c of (contacts ?? []) as Contact[]) {
      if (!c.website || !/^https?:\/\//i.test(c.website)) continue;
      const done = lastDoneByContact.get(c.id);
      if (!done) continue;                                        // jamais relevé avec succès : reste manuel
      const last = lastByContact.get(c.id)!;
      if (!force && Date.parse(last.started_at) > cutoff) continue;  // relevé récent (réussi ou non)
      if ((done.warnings ?? []).some((w) => /Zyte/i.test(w))) { skipped.push(`${c.name} (Zyte, payant)`); continue; }
      due.push(c);
    }
    if (due.length === 0) { console.warn(`[DEALER_STOCK_WEEKLY] rien à relever${skipped.length ? ` · ignorés : ${skipped.join(', ')}` : ''}`); return; }
    console.warn(`[DEALER_STOCK_WEEKLY] ${due.length} concession(s) à relever : ${due.map((c) => c.name).join(', ')}${skipped.length ? ` · ignorés : ${skipped.join(', ')}` : ''}`);
    let ok = 0, ko = 0;
    for (const c of due) {
      try {
        const s = await runDealerStock(c.id, c.website!, 'ADA (hebdo)');
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
  console.warn(`[DEALER_STOCK_WEEKLY] ordonnanceur actif (chaque nuit ${RUN_HOUR_PARIS} h Paris, concessions non relevées depuis ${STALE_DAYS} j, lecture directe seulement)`);
}
