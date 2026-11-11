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
 * l'API est /api/reportviewer?reportType=&reportId=), tout lien qui répond directement un PDF, et les rapports
 * DEKRA en page HTML partagée (cdn-prod.dekra-starfleet.com, 11/11) : la page est rangée telle quelle et ses
 * photos (voiture et dommages, hébergeur sans CORS : le navigateur ne peut pas les lire) téléchargées ici.
 *
 * TRADUCTIONS (11/11, Channing : « sur les PDF il y a beaucoup de français, pas de possibilité de traduire ? ») :
 * une ligne lue dont translate_to est posé → les valeurs du rapport (énergie, boîte, carrosserie, couleur,
 * équipements, pneus, constats) traduites par Claude dans cette langue, gardées dans translations[langue] ;
 * demandées par la fiche PDF client, une fois par langue. Un rapport DEKRA est d'abord traduit PAR DEKRA (la même
 * page dans la langue cible, via son sélecteur de langue, 11/11) ; Claude ne sert que si cette langue n'y est pas.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { callClaude, AiUnavailable, BudgetReached } from './agents/claude';
import { HAIKU } from '../src/lib/agents/aiCost';
import { translationSource, translationSystem, translationFits, FYC_TRANSLATION_SCHEMA, FYC_LANG_NAMES, type FycTranslation, type FycTranslatable } from '../src/lib/fycTranslation';
import { isDekraReport, parseDekraReport, dekraLanguageUrls, dekraTranslationFrom, type DekraPhoto, type FycDefectPhoto } from '../src/lib/dekraReport';
import { isFleetboxReport, parseFleetboxReport, fleetboxTranslationFrom } from '../src/lib/fleetboxReport';
import { groupLines } from '../src/lib/pdfLines';

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

type Fetched = { buf: Buffer; from: string; kind: 'pdf' | 'html' };
async function fetchReport(sourceUrl: string): Promise<Fetched> {
  const errors: string[] = [];
  for (const cu of pdfCandidates(sourceUrl)) {
    try {
      const r = await fetch(cu, { headers: { 'User-Agent': UA, 'Accept': 'application/pdf,text/html,*/*', 'Accept-Language': 'fr-FR,fr;q=0.9' } });
      if (!r.ok) { errors.push(`${cu.slice(0, 80)} : HTTP ${r.status}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { buf, from: cu, kind: 'pdf' };
      const ct = r.headers.get('content-type') ?? '';
      if (/html/i.test(ct) || /^\s*<(!doctype|html)/i.test(buf.subarray(0, 200).toString('utf8'))) {
        const html = buf.toString('utf8');
        if (isDekraReport(html)) return { buf, from: cu, kind: 'html' };
        errors.push(`${cu.slice(0, 80)} : page HTML sans rapport reconnu (seul DEKRA est lu en HTML ; la visionneuse VTI passe par son API)`);
        continue;
      }
      errors.push(`${cu.slice(0, 80)} : ni PDF ni page de rapport (${ct || 'type inconnu'})`);
    } catch (e) { errors.push(`${cu.slice(0, 80)} : ${e instanceof Error ? e.message : String(e)}`); }
  }
  throw new Error(`rapport introuvable — ${errors.join(' ; ')}`);
}

/** Photos d'un rapport HTML rangées dans le storage : voiture (photos) et dommages (defect_photos). Fail-open par photo. */
async function downloadPhotos(id: string, list: DekraPhoto[]): Promise<{ photos: string[]; defect_photos: FycDefectPhoto[] }> {
  const photos: string[] = []; const defect_photos: FycDefectPhoto[] = [];
  let n = 0;
  for (const p of list.slice(0, 40)) {
    try {
      const r = await fetch(p.url, { headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*' } });
      if (!r.ok) { console.warn(`[FYC] photo HTTP ${r.status} : ${p.url.slice(0, 80)}`); continue; }
      const ct = (r.headers.get('content-type') ?? '').toLowerCase();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2_000 || buf.length > 15_000_000) continue;
      const ext = /png/.test(ct) ? 'png' : /webp/.test(ct) ? 'webp' : 'jpg';
      const path = `fyc/${id}/photo_${++n}.${ext}`;
      const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: ct.split(';')[0] || 'image/jpeg', upsert: true });
      if (up.error) { console.warn(`[FYC] photo non rangée : ${up.error.message}`); continue; }
      if (p.list) defect_photos.push({ path, caption: p.caption, list: p.list, idx: p.idx }); else photos.push(path);
    } catch (e) { console.warn(`[FYC] photo en échec : ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { photos, defect_photos };
}

/** Plafond du jour pour les traductions FYC (quelques centimes par fiche) — compté avec les appels de l'agente Ada. */
const TRANSLATION_BUDGET_USD = 5;

/** La page DEKRA rangée dans le storage, relue dans la langue demandée par l'API de DEKRA ; null si impossible. */
async function dekraTranslation(pdfPath: string | null, lang: string): Promise<FycTranslation | null> {
  if (!pdfPath || !/\.html?$/i.test(pdfPath)) return null;
  const dl = await supabase.storage.from(BUCKET).download(pdfPath);
  if (dl.error || !dl.data) return null;
  const html = await dl.data.text();
  if (!isDekraReport(html)) return null;
  const url = dekraLanguageUrls(html)[lang];
  if (!url) return null;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' } });
  if (!r.ok) { console.warn(`[FYC] DEKRA ${lang} : HTTP ${r.status}`); return null; }
  const other = await r.text();
  if (!isDekraReport(other)) return null;
  return dekraTranslationFrom(parseDekraReport(html), parseDekraReport(other));
}

/** Lignes pdf.js d'un PDF (même regroupement que le navigateur), côté worker. */
async function pdfLinesOf(buf: Buffer): Promise<Array<{ text: string; frags: Array<{ x: number; s: string }> }>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    const out: Array<{ text: string; frags: Array<{ x: number; s: string }> }> = [];
    for (let n = 1; n <= doc.numPages; n++) { const page = await doc.getPage(n); const tc = await page.getTextContent(); out.push(...groupLines(tc.items as Array<{ str?: string; transform?: number[] }>, n)); page.cleanup(); }
    return out;
  } finally { await doc.destroy(); }
}

/** Rapport DEKRA fleetbox (PDF, paramètre l=) relu dans la langue demandée ; null si impossible. */
const FLEETBOX_LANGS = new Set(['it', 'fr', 'en', 'de', 'es', 'nl', 'pt']);
async function fleetboxTranslation(sourceUrl: string, pdfPath: string | null, lang: string): Promise<FycTranslation | null> {
  if (!/PDFDownloadHandlerSFT\.ashx/i.test(sourceUrl) || !FLEETBOX_LANGS.has(lang) || !pdfPath) return null;
  const dl = await supabase.storage.from(BUCKET).download(pdfPath);
  if (dl.error || !dl.data) return null;
  const srcLines = await pdfLinesOf(Buffer.from(await dl.data.arrayBuffer()));
  if (!isFleetboxReport(srcLines)) return null;
  const u = new URL(sourceUrl); u.searchParams.set('l', lang);
  const r = await fetch(u.toString(), { headers: { 'User-Agent': UA, 'Accept': 'application/pdf,*/*' } });
  if (!r.ok) { console.warn(`[FYC] fleetbox ${lang} : HTTP ${r.status}`); return null; }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
  return fleetboxTranslationFrom(parseFleetboxReport(srcLines), parseFleetboxReport(await pdfLinesOf(buf)), lang);
}

async function translate(sb: { from: (t: string) => any }, row: { id: string; translate_to: string; translations: Record<string, unknown> | null; pdf_path: string | null; source_url: string } & FycTranslatable): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const lang = String(row.translate_to).toLowerCase();
  const src = translationSource({ ...row, equipment: Array.isArray(row.equipment) ? row.equipment : [], tyres: Array.isArray(row.tyres) ? row.tyres : [], damages: { devaluation: row.damages?.devaluation ?? [], usage: row.damages?.usage ?? [] } });
  const done = (t: FycTranslation | null, err: string | null) => sb.from('fyc_inspections').update({
    translate_to: null, updated_at: new Date().toISOString(),
    ...(t ? { translations: { ...(row.translations ?? {}), [lang]: t } } : {}),
    ...(err ? { error: `traduction ${lang} : ${err}`.slice(0, 800) } : {}),
  }).eq('id', row.id);
  if (!FYC_LANG_NAMES[lang]) { await done(null, 'langue inconnue'); return; }
  // 1. Par DEKRA lui-même (mêmes mots que l'inspecteur, gratuit) : page HTML, ou PDF fleetbox (paramètre l=).
  try {
    const t = (await dekraTranslation(row.pdf_path, lang)) ?? (await fleetboxTranslation(row.source_url, row.pdf_path, lang));
    if (t && translationFits(src, t)) { await done(t, null); console.warn(`[FYC] valeurs traduites en ${lang} par le rapport DEKRA (${t.devaluation.length + t.usage.length} dommages, ${t.tyres.length} pneus)`); return; }
  } catch (e) { console.warn(`[FYC] rapport DEKRA ${lang} illisible, repli Claude : ${e instanceof Error ? e.message : String(e)}`); }
  // 2. Sinon Claude.
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
    const tr = await sb.from('fyc_inspections').select('id, translate_to, translations, pdf_path, source_url, fuel, gearbox, body, color, equipment, tyres, damages').eq('status', 'read').not('translate_to', 'is', null).order('updated_at', { ascending: true }).limit(3);
    if (!tr.error) for (const row of (tr.data ?? []) as Array<Parameters<typeof translate>[1]>) await translate(sb, row);
    const { data, error } = await sb.from('fyc_inspections').select('id, source_url').eq('status', 'queued').order('created_at', { ascending: true }).limit(3);
    if (error) { if (!warned && !/does not exist|schema cache/i.test(error.message)) console.warn(`[FYC] file illisible : ${error.message}`); warned = true; return; }
    for (const row of (data ?? []) as Array<{ id: string; source_url: string }>) {
      try {
        const { buf, from, kind } = await fetchReport(row.source_url);
        const path = `fyc/${row.id}.${kind}`;
        const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: kind === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8', upsert: true });
        if (up.error) throw new Error(`storage : ${up.error.message}`);
        // Page HTML (DEKRA) : ses photos sont téléchargées ici, le navigateur ne lira que les champs.
        const extra: Record<string, unknown> = {};
        if (kind === 'html') {
          const got = await downloadPhotos(row.id, parseDekraReport(buf.toString('utf8')).photos);
          extra.photos = got.photos; extra.defect_photos = got.defect_photos;
          console.warn(`[FYC] rapport DEKRA : ${got.photos.length} photos, ${got.defect_photos.length} photos de dommages`);
        }
        await sb.from('fyc_inspections').update({ status: 'fetched', pdf_path: path, error: null, updated_at: new Date().toISOString(), ...extra }).eq('id', row.id);
        console.warn(`[FYC] rapport téléchargé (${Math.round(buf.length / 1024)} Ko, ${kind}) depuis ${from.slice(0, 60)}…`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sb.from('fyc_inspections').update({ status: 'failed', error: msg.slice(0, 800), updated_at: new Date().toISOString() }).eq('id', row.id);
        console.warn(`[FYC] rapport en échec : ${msg.slice(0, 200)}`);
      }
    }
  } finally { running = false; }
}
