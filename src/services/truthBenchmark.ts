/**
 * ÉTALON HUMAIN HEBDOMADAIRE (décision Channing 14/09) — le seul juge de
 * paix de « l'étude trouve-t-elle toutes les voitures de ses critères ? ».
 * Chaque semaine : 5 études tirées au sort (tirage déterministe par semaine,
 * modèles distincts), une ligne par site et par côté ; ADA y met son dernier
 * compte de vague (market_snapshots, segment study:<id>), l'humain le sien
 * après avoir fait la recherche à la main. Rappel = min(ADA, humain) /
 * humain ; ADA > humain = mapping trop large, signalé à part.
 * Fail-open : table absente (SQL du 14/09 pas collé) → message explicite.
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';
import { listStudyUrls, listDailySearches, forceRunDailySearch, type DailySearch } from './workflow';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
export const BENCH_SQL_HINT = 'Étalon : SQL du 14/09 (truth_benchmarks) à coller.';

export interface BenchRow {
  id: string; week: string; search_id: string; search_label: string; site: string; side: 'source' | 'cible'; country: string;
  ada_count: number | null; ada_url: string | null; ada_at: string | null;
  human_count: number | null; human_url: string | null; note: string; filled_by: string | null; filled_at: string | null; created_at: string;
}

/** Semaine ISO « 2026-W38 » (lundi → dimanche), heure de Paris approchée par la date locale. */
export function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

const isMissing = (e: { message?: string } | null) => !!e && /does not exist|schema cache|relation/i.test(e.message ?? '');

/** Toutes les études actives de l'équipe (admin) sinon les miennes. */
async function candidateStudies(): Promise<DailySearch[]> {
  const admin = await sb.rpc('admin_list_daily_searches');
  const rows: DailySearch[] = !admin.error && Array.isArray(admin.data) ? (admin.data as DailySearch[]) : await listDailySearches();
  return rows.filter((s) => s.active);
}

/** Critères COMPLETS des études actives (toute l'équipe, sans propriétaire) — pour vérifier à la main avec les bons critères. */
export interface BenchCriteria {
  id: string; label: string; brand: string; model: string | null; fuel: string | null; trim: string | null; trim_target: string | null;
  year_min: number | null; year_max: number | null; mileage_max: number | null; gearbox: string | null; power_min: number | null;
  source_country: string; target_country: string;
}
export async function loadBenchCriteria(): Promise<Map<string, BenchCriteria>> {
  const { data, error } = await sb.rpc('truth_active_studies');
  const out = new Map<string, BenchCriteria>();
  if (error || !Array.isArray(data)) return out;
  for (const r of data as BenchCriteria[]) if (r.id) out.set(r.id, r);
  return out;
}

/**
 * RESCRAPE des études tirées (demande 14/09 : des données fraîches, sinon
 * trois véhicules vendus passent pour des erreurs). Pose le drapeau
 * « Lancer maintenant » via la fonction d'équipe (n'importe quel compte,
 * uniquement sur une étude de l'étalon en cours) ; repli sur mes propres
 * études si le SQL n'est pas collé. Le worker sonde le drapeau toutes les 30 s.
 */
export async function forceRescrape(week: string): Promise<{ requestedAt: string; studies: string[]; error: string | null }> {
  const { rows, error } = await listBenchWeek(week);
  if (error) return { requestedAt: '', studies: [], error };
  const ids = [...new Set(rows.map((r) => r.search_id))];
  const requestedAt = new Date().toISOString();
  const failed: string[] = [];
  for (const id of ids) {
    const r = await sb.rpc('truth_benchmark_force_run', { p_search: id, p_week: week });
    if (!r.error && r.data === true) continue;
    const err = await forceRunDailySearch(id);
    if (err || r.error) failed.push(id);
  }
  return {
    requestedAt, studies: ids,
    error: failed.length ? `${failed.length} étude(s) non relançable(s) (SQL truth_benchmark_force_run du 14/09 à coller pour relancer celles des autres).` : null,
  };
}

/** Dernier relevé ADA par site pour une étude (segment study:<id>) — depuis `since`, sinon 3 jours. */
async function adaCounts(searchId: string, sinceIso?: string): Promise<Map<string, { count: number; url: string | null; at: string }>> {
  const since = sinceIso ?? new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data } = await sb.from('market_snapshots').select('site,listing_count,source_url,scraped_at')
    .eq('segment_key', `study:${searchId}`).gte('scraped_at', since).order('scraped_at', { ascending: false }).limit(200);
  const out = new Map<string, { count: number; url: string | null; at: string }>();
  for (const r of (data ?? []) as Array<{ site: string; listing_count: number | null; source_url: string | null; scraped_at: string }>) {
    if (!out.has(r.site)) out.set(r.site, { count: r.listing_count ?? 0, url: r.source_url, at: r.scraped_at });
  }
  return out;
}

export async function listBenchWeek(week: string): Promise<{ rows: BenchRow[]; error: string | null }> {
  const { data, error } = await sb.from('truth_benchmarks').select('*').eq('week', week).order('search_label').order('side').order('site');
  if (error) return { rows: [], error: isMissing(error) ? BENCH_SQL_HINT : error.message };
  return { rows: (data ?? []) as BenchRow[], error: null };
}

/**
 * Tire les 5 études de la semaine (si pas encore tirées) et crée une ligne
 * par site et par côté avec le compte ADA du dernier relevé. Idempotent.
 */
export async function drawBenchWeek(week: string, count = 5): Promise<{ created: number; error: string | null }> {
  const existing = await listBenchWeek(week);
  if (existing.error) return { created: 0, error: existing.error };
  if (existing.rows.length > 0) return { created: 0, error: null };
  const studies = await candidateStudies();
  if (studies.length === 0) return { created: 0, error: 'Aucune étude active à tirer au sort.' };
  const rnd = seeded(week);
  const shuffled = [...studies].sort(() => rnd() - 0.5);
  const picked: DailySearch[] = [];
  const seenModel = new Set<string>();
  for (const s of shuffled) {
    const k = `${s.brand}|${s.model}`.toUpperCase();
    if (seenModel.has(k)) continue;
    seenModel.add(k); picked.push(s);
    if (picked.length >= count) break;
  }
  for (const s of shuffled) { if (picked.length >= count) break; if (!picked.includes(s)) picked.push(s); }
  const inserts: Array<Partial<BenchRow>> = [];
  for (const s of picked) {
    const [urls, counts] = await Promise.all([listStudyUrls(s), adaCounts(s.id)]);
    for (const u of urls) {
      const c = counts.get(u.site);
      inserts.push({
        week, search_id: s.id, search_label: s.label || `${s.brand} ${s.model}`.trim(), site: u.site, side: u.side, country: u.country,
        ada_count: c?.count ?? null, ada_url: c?.url ?? u.url ?? null, ada_at: c?.at ?? null,
      });
    }
  }
  const { error } = await sb.from('truth_benchmarks').insert(inserts);
  if (error) return { created: 0, error: isMissing(error) ? BENCH_SQL_HINT : error.message };
  return { created: inserts.length, error: null };
}

/**
 * Rafraîchit les comptes ADA de la semaine depuis les relevés postérieurs à
 * `sinceIso` (le rescrape demandé) — ou les derniers relevés sans borne.
 * Renvoie les études dont un relevé frais a été trouvé.
 */
export async function refreshAdaCounts(week: string, sinceIso?: string): Promise<{ fresh: string[]; error: string | null }> {
  const { rows, error } = await listBenchWeek(week);
  if (error) return { fresh: [], error };
  const byStudy = new Map<string, BenchRow[]>();
  for (const r of rows) byStudy.set(r.search_id, [...(byStudy.get(r.search_id) ?? []), r]);
  const fresh: string[] = [];
  for (const [searchId, list] of byStudy) {
    const counts = await adaCounts(searchId, sinceIso);
    if (counts.size === 0) continue;
    fresh.push(searchId);
    for (const r of list) {
      const c = counts.get(r.site);
      // Site absent du relevé frais (en échec) : on garde l'ancien compte mais
      // on ne le date pas du jour — l'humain voit qu'il est vieux.
      if (!c) continue;
      await sb.from('truth_benchmarks').update({ ada_count: c.count, ada_url: c.url, ada_at: c.at }).eq('id', r.id);
    }
  }
  return { fresh, error: null };
}

export async function saveHumanCount(id: string, humanCount: number | null, humanUrl: string, note: string): Promise<string | null> {
  const { error } = await sb.from('truth_benchmarks').update({
    human_count: humanCount, human_url: humanUrl.trim() || null, note: note.trim(),
    filled_by: useAuth.getState().userId, filled_at: humanCount == null ? null : new Date().toISOString(),
  }).eq('id', id);
  if (error) return isMissing(error) ? BENCH_SQL_HINT : error.message;
  // La correction part d'ici : un écart ouvre (ou met à jour) un dossier
  // « etalon_ecart » dans Doutes remarqués ; un écart résorbé le referme.
  // Fail-open : SQL du 14/09 pas collé → la ligne est enregistrée quand même.
  await sb.rpc('truth_benchmark_report', { p_benchmark: id });
  return null;
}

export interface BenchScore { week: string; filled: number; total: number; recall: number | null; overcount: number; bySite: Record<string, { recall: number | null; n: number; over: number }> }

/** Rappel par semaine et par site, sur les lignes remplies (humain > 0). */
export function scoreWeeks(rows: BenchRow[]): BenchScore[] {
  const byWeek = new Map<string, BenchRow[]>();
  for (const r of rows) byWeek.set(r.week, [...(byWeek.get(r.week) ?? []), r]);
  const out: BenchScore[] = [];
  for (const [week, list] of byWeek) {
    const filled = list.filter((r) => r.human_count != null);
    const measurable = filled.filter((r) => (r.human_count ?? 0) > 0 && r.ada_count != null);
    const recallOf = (rs: BenchRow[]) => rs.length ? rs.reduce((a, r) => a + Math.min(r.ada_count!, r.human_count!) / r.human_count!, 0) / rs.length : null;
    const bySite: BenchScore['bySite'] = {};
    for (const r of measurable) {
      const b = bySite[r.site] ?? (bySite[r.site] = { recall: null, n: 0, over: 0 });
      b.n++; if (r.ada_count! > r.human_count!) b.over++;
    }
    for (const site of Object.keys(bySite)) bySite[site].recall = recallOf(measurable.filter((r) => r.site === site));
    out.push({ week, filled: filled.length, total: list.length, recall: recallOf(measurable), overcount: measurable.filter((r) => r.ada_count! > r.human_count!).length, bySite });
  }
  return out.sort((a, b) => b.week.localeCompare(a.week));
}

export async function listBenchHistory(weeks = 12): Promise<BenchRow[]> {
  const { data, error } = await sb.from('truth_benchmarks').select('*').order('week', { ascending: false }).limit(weeks * 60);
  if (error) return [];
  return (data ?? []) as BenchRow[];
}
