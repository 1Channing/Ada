/**
 * FYC — FIND YOUR CUSTOMER : TÉLÉCHARGEMENT DES RAPPORTS D'INSPECTION (10/11, Channing : « on colle un lien
 * d'inspection, Ada lit le rapport »).
 *
 * Le navigateur ne peut pas lire le rapport lui-même (le site de l'inspecteur refuse les appels d'un autre
 * domaine) : le worker télécharge le PDF à partir du lien PARTAGÉ (celui que l'inspecteur a donné — aucune
 * clé ni compte) et le range dans le storage ; le navigateur en extrait ensuite les champs (pdfjs) et les
 * enregistre. Chaque 20 s : les lignes « queued ».
 *
 * Liens compris : la visionneuse VTI / Macadam (admin.vti-easi.eu/reportviewer/<type>/<id>/<langue>, dont
 * l'API est /api/reportviewer?reportType=&reportId=) et tout lien qui répond directement un PDF.
 *
 * TRADUCTIONS (11/11, Channing : « sur les PDF il y a beaucoup de français, pas de possibilité de traduire ? ») :
 * une ligne lue dont translate_to est posé → les valeurs du rapport (énergie, boîte, carrosserie, couleur,
 * équipements, pneus, constats) traduites par Claude dans cette langue, gardées dans translations[langue] ;
 * demandées par la fiche PDF client, une fois par langue.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { callClaude, AiUnavailable, BudgetReached } from './agents/claude';
import { HAIKU } from '../src/lib/agents/aiCost';
import { translationSource, translationSystem, translationFits, FYC_TRANSLATION_SCHEMA, FYC_LANG_NAMES, type FycTranslation, type FycTranslatable } from '../src/lib/fycTranslation';

const POLL_MS = 20_000;
const BUCKET = 'admin-documents';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
let running = false;
let warned = false;

export function startFyc(): void {
  setInterval(() => void tick(), POLL_MS);
  setTimeout(() => void tick(), 25_000);
  console.log('[FYC] téléchargement des rapports d\'inspection actif (poll 20 s)');
}

/** Les adresses à essayer, dans l'ordre, pour obtenir le PDF d'un lien d'inspection. */
export function pdfCandidates(sourceUrl: string): string[] {
  const out: string[] = [];
  try {
    const u = new URL(sourceUrl.trim());
    const m = u.pathname.match(/\/reportviewer\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/i);
    if (m) {
      const type = decodeURIComponent(m[1]);
      const id = decodeURIComponent(m[2]);
      out.push(`${u.origin}/api/reportviewer?reportType=${encodeURIComponent(type)}&reportId=${encodeURIComponent(id)}`);
    }
  } catch { /* lien illisible : essayé tel quel */ }
  out.push(sourceUrl.trim());
  return out;
}

async function fetchPdf(sourceUrl: string): Promise<{ buf: Buffer; from: string }> {
  const errors: string[] = [];
  for (const cu of pdfCandidates(sourceUrl)) {
    try {
      const r = await fetch(cu, { headers: { 'User-Agent': UA, 'Accept': 'application/pdf,*/*', 'Accept-Language': 'fr-FR,fr;q=0.9' } });
      if (!r.ok) { errors.push(`${cu.slice(0, 80)} : HTTP ${r.status}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { buf, from: cu };
      errors.push(`${cu.slice(0, 80)} : pas un PDF (${r.headers.get('content-type') ?? 'type inconnu'})`);
    } catch (e) { errors.push(`${cu.slice(0, 80)} : ${e instanceof Error ? e.message : String(e)}`); }
  }
  throw new Error(`rapport introuvable — ${errors.join(' ; ')}`);
}

/** Plafond du jour pour les traductions FYC (quelques centimes par fiche) — compté avec les appels de l'agente Ada. */
const TRANSLATION_BUDGET_USD = 5;

async function translate(sb: { from: (t: string) => any }, row: { id: string; translate_to: string; translations: Record<string, unknown> | null } & FycTranslatable): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const lang = String(row.translate_to).toLowerCase();
  const src = translationSource({ ...row, equipment: Array.isArray(row.equipment) ? row.equipment : [], tyres: Array.isArray(row.tyres) ? row.tyres : [], damages: { devaluation: row.damages?.devaluation ?? [], usage: row.damages?.usage ?? [] } });
  const done = (t: FycTranslation | null, err: string | null) => sb.from('fyc_inspections').update({
    translate_to: null, updated_at: new Date().toISOString(),
    ...(t ? { translations: { ...(row.translations ?? {}), [lang]: t } } : {}),
    ...(err ? { error: `traduction ${lang} : ${err}`.slice(0, 800) } : {}),
  }).eq('id', row.id);
  if (!FYC_LANG_NAMES[lang]) { await done(null, 'langue inconnue'); return; }
  try {
    const r = await callClaude<FycTranslation>({
      agent: 'ada', budgetUsd: TRANSLATION_BUDGET_USD, purpose: 'fyc_traduction', model: HAIKU,
      system: translationSystem(lang), user: JSON.stringify(src), schema: FYC_TRANSLATION_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 6000, effort: 'low',
    });
    if (!translationFits(src, r.data)) { await done(null, 'réponse incomplète (listes de longueur différente)'); console.warn(`[FYC] traduction ${lang} incomplète pour ${row.id}`); return; }
    await done(r.data, null);
    console.warn(`[FYC] valeurs traduites en ${lang} (${src.equipment.length} équipements, ${r.costUsd.toFixed(3)} $)`);
  } catch (e) {
    const msg = e instanceof BudgetReached || e instanceof AiUnavailable ? e.message : (e instanceof Error ? e.message : String(e));
    await done(null, msg);
    console.warn(`[FYC] traduction ${lang} en échec : ${msg.slice(0, 200)}`);
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    // Traductions demandées (fiche PDF client) : avant les téléchargements, quelqu'un attend devant l'écran.
    const tr = await sb.from('fyc_inspections').select('id, translate_to, translations, fuel, gearbox, body, color, equipment, tyres, damages').eq('status', 'read').not('translate_to', 'is', null).order('updated_at', { ascending: true }).limit(3);
    if (!tr.error) for (const row of (tr.data ?? []) as Array<Parameters<typeof translate>[1]>) await translate(sb, row);
    const { data, error } = await sb.from('fyc_inspections').select('id, source_url').eq('status', 'queued').order('created_at', { ascending: true }).limit(3);
    if (error) { if (!warned && !/does not exist|schema cache/i.test(error.message)) console.warn(`[FYC] file illisible : ${error.message}`); warned = true; return; }
    for (const row of (data ?? []) as Array<{ id: string; source_url: string }>) {
      try {
        const { buf, from } = await fetchPdf(row.source_url);
        const path = `fyc/${row.id}.pdf`;
        const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true });
        if (up.error) throw new Error(`storage : ${up.error.message}`);
        await sb.from('fyc_inspections').update({ status: 'fetched', pdf_path: path, error: null, updated_at: new Date().toISOString() }).eq('id', row.id);
        console.warn(`[FYC] rapport téléchargé (${Math.round(buf.length / 1024)} Ko) depuis ${from.slice(0, 60)}…`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sb.from('fyc_inspections').update({ status: 'failed', error: msg.slice(0, 800), updated_at: new Date().toISOString() }).eq('id', row.id);
        console.warn(`[FYC] rapport en échec : ${msg.slice(0, 200)}`);
      }
    }
  } finally { running = false; }
}
