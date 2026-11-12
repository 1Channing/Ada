/**
 * FYC — FIND YOUR CUSTOMER (10/11, Channing : « un outil d'analyse dans le Market Intelligence : une inspection
 * comparée en quelques clics à tout un marché et à un client cible »).
 *
 * Une ligne par inspection (table fyc_inspections, SQL du 10/11). Le worker télécharge le PDF du rapport
 * (statut queued → fetched, worker/fyc.ts) ; ici le navigateur en extrait les champs (pdfjs + src/lib/fycReport.ts)
 * et les enregistre (statut read). Nos prix (achat, attaque), les filtres MI retenus et le client cible sont
 * gardés sur la ligne : on les retrouve en revenant.
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';
import { signedUrl } from './storageAccess';
import { pdfToLinesEx } from '../lib/pdfText';
import { docxToLinesEx } from '../lib/docxText';
import { extractPdfPhotos } from '../lib/pdfImages';
import type { FycTranslation } from '../lib/fycTranslation';
import { isDekraReport, parseDekraReport, type FycDefectPhoto } from '../lib/dekraReport';
import { isFleetboxReport, parseFleetboxReport } from '../lib/fleetboxReport';
import { isMacadamReport, parseMacadamReport } from '../lib/macadamReport';
import { htmlToLines } from '../lib/docxText';
import { ADMIN_BUCKET } from './storageAccess';
import { parseFycReport, type FycReportFields } from '../lib/fycReport';
import type { MarketFilters } from './marketData';

export type FycStatus = 'queued' | 'fetched' | 'read' | 'failed';
export interface FycInspection extends FycReportFields {
  id: string; source_url: string; status: FycStatus; error: string | null; pdf_path: string | null;
  purchase_price: number | null; attack_price: number | null; notes: string;
  market_filters: MarketFilters; client_contact_id: string | null;
  created_by: string | null; created_by_name: string; created_at: string; updated_at: string;
  /** Archivée (10/11 soir, Channing : « un petit onglet archive ») : sortie de la liste courante, rouvrable. */
  archived_at: string | null;
  /** Photos du rapport (11/11 : « ajouter les photos ») : chemins dans le storage admin-documents (fyc/<id>/photo_N.jpg). */
  photos: string[];
  /** Photos des dommages (rapports DEKRA, 11/11) : chemin, légende, dommage illustré. */
  defect_photos: FycDefectPhoto[];
  /** Valeurs du rapport traduites par langue (11/11), et la langue demandée au worker (null quand rien n'est en attente). */
  translations: Record<string, FycTranslation>;
  translate_to: string | null;
}

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /does not exist|relation|schema cache/i.test(m);
export const FYC_SQL_HINT = 'FYC : colle le SQL du 10/11 (fyc_inspections).';

function normalize(r: Record<string, unknown>): FycInspection {
  const d = (r.damages ?? {}) as Partial<FycInspection['damages']>;
  return {
    ...(r as unknown as FycInspection),
    damages: { devaluation: Array.isArray(d.devaluation) ? d.devaluation : [], usage: Array.isArray(d.usage) ? d.usage : [] },
    raw_fields: (r.raw_fields ?? {}) as Record<string, string>,
    equipment: Array.isArray(r.equipment) ? (r.equipment as string[]) : [],
    tyres: Array.isArray(r.tyres) ? (r.tyres as string[]) : [],
    archived_at: (r.archived_at as string | null | undefined) ?? null,
    photos: Array.isArray(r.photos) ? (r.photos as string[]).filter((p) => typeof p === 'string') : [],
    defect_photos: Array.isArray(r.defect_photos) ? (r.defect_photos as FycDefectPhoto[]).filter((p) => p && typeof p.path === 'string') : [],
    translations: (r.translations && typeof r.translations === 'object' ? r.translations : {}) as Record<string, FycTranslation>,
    translate_to: typeof r.translate_to === 'string' ? r.translate_to : null,
    market_filters: (r.market_filters ?? {}) as MarketFilters,
    notes: typeof r.notes === 'string' ? r.notes : '',
    asking_price: r.asking_price == null ? null : Number(r.asking_price),
    repair_cost: r.repair_cost == null ? null : Number(r.repair_cost),
    purchase_price: r.purchase_price == null ? null : Number(r.purchase_price),
    attack_price: r.attack_price == null ? null : Number(r.attack_price),
  };
}

export async function listInspections(): Promise<{ rows: FycInspection[]; error: string | null }> {
  const { data, error } = await untyped.from('fyc_inspections').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return { rows: [], error: missing(error.message) ? FYC_SQL_HINT : error.message };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(normalize), error: null };
}

/** Un lien par ligne ; les liens déjà présents ne sont pas redéposés (rendus dans `existing`). */
export async function addInspections(text: string): Promise<{ added: number; existing: number; error: string | null }> {
  // « &amp; » (adresse copiée depuis une page HTML, 12/11) : rétabli en « & », sinon le site rend un fichier vide.
  const urls = [...new Set(text.split(/[\s,;]+/).map((u) => u.trim().replace(/&amp;/gi, '&')).filter((u) => /^https?:\/\//i.test(u)))];
  if (urls.length === 0) return { added: 0, existing: 0, error: 'Aucun lien reconnu (il faut une adresse commençant par http).' };
  const { data: have } = await untyped.from('fyc_inspections').select('source_url').in('source_url', urls);
  const seen = new Set(((have ?? []) as Array<{ source_url: string }>).map((r) => r.source_url));
  const fresh = urls.filter((u) => !seen.has(u));
  if (fresh.length === 0) return { added: 0, existing: urls.length, error: null };
  const { userId, displayName, email } = useAuth.getState();
  const { error } = await untyped.from('fyc_inspections').insert(fresh.map((u) => ({ source_url: u, status: 'queued', created_by: userId, created_by_name: displayName || email || '' })));
  if (error) return { added: 0, existing: urls.length - fresh.length, error: missing(error.message) ? FYC_SQL_HINT : error.message };
  return { added: fresh.length, existing: urls.length - fresh.length, error: null };
}

/** Champs du rapport corrigeables à la main (11/11, Channing : « modifier les infos dans le FYC, ligne par ligne, critère par critère »). */
export type FycEditableField = 'brand' | 'model' | 'version' | 'vin' | 'first_registration' | 'year' | 'km' | 'fuel' | 'gearbox' | 'power_ch' | 'body' | 'color' | 'doors' | 'seats' | 'repair_cost' | 'asking_price' | 'report_number' | 'report_date';
export async function updateInspection(id: string, patch: Partial<Pick<FycInspection, 'purchase_price' | 'attack_price' | 'notes' | 'market_filters' | 'client_contact_id' | 'archived_at' | 'translate_to' | FycEditableField>>): Promise<string | null> {
  const { error } = await untyped.from('fyc_inspections').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

export async function deleteInspection(id: string): Promise<string | null> {
  const { error } = await untyped.from('fyc_inspections').delete().eq('id', id);
  return error ? error.message : null;
}

/** Relance le téléchargement d'un rapport en échec. */
export async function retryInspection(id: string): Promise<string | null> {
  const { error } = await untyped.from('fyc_inspections').update({ status: 'queued', error: null, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

/** Relit le rapport déjà rangé dans le storage (champs ET photos) — pour les dossiers lus avant les photos (11/11). */
export async function rereadInspection(row: FycInspection): Promise<string | null> {
  if (!row.pdf_path) return 'rapport absent du storage : relance le téléchargement';
  const { error } = await untyped.from('fyc_inspections').update({ status: 'fetched', error: null, updated_at: new Date().toISOString() }).eq('id', row.id);
  return error ? error.message : null;
}

/** Demande au worker la traduction des valeurs du rapport dans une langue (traitée en moins d'une minute). */
export async function requestTranslation(id: string, lang: string): Promise<string | null> {
  const { error } = await untyped.from('fyc_inspections').update({ translate_to: lang, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

/** La ligne à jour (pour attendre une traduction). */
export async function getInspection(id: string): Promise<FycInspection | null> {
  const { data } = await untyped.from('fyc_inspections').select('*').eq('id', id).maybeSingle();
  return data ? normalize(data as Record<string, unknown>) : null;
}

/** PHOTOS (11/11) : celles du PDF (pdf.js) ou celles que la page du .docx référence (adresses publiques), rangées
 *  dans le storage à côté du rapport. Fail-open : une photo illisible n'empêche pas la lecture du rapport. */
async function storePhotos(id: string, blobs: Blob[]): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const path = `fyc/${id}/photo_${i + 1}.jpg`;
    const up = await supabase.storage.from(ADMIN_BUCKET).upload(path, blobs[i], { contentType: 'image/jpeg', upsert: true });
    if (!up.error) paths.push(path);
  }
  return paths;
}
async function fetchPhotos(urls: string[]): Promise<Blob[]> {
  const out: Blob[] = [];
  for (const u of urls.slice(0, 8)) {
    try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) { const b = await r.blob(); if (b.size > 5_000) out.push(b); } } catch { /* photo non lisible depuis le navigateur */ }
  }
  return out;
}

/** DÉPÔT D'UN FICHIER (10/11 soir, Channing : « ajouter un docx à la place d'une URL ») : PDF ou .docx (export GIS@WEB
 *  de VWFS) rangé dans le storage, ligne « fetched » lue aussitôt par le navigateur — le worker n'intervient pas. */
export async function addInspectionFile(file: File): Promise<{ id: string | null; error: string | null }> {
  const ext = /\.docx$/i.test(file.name) ? 'docx' : /\.pdf$/i.test(file.name) ? 'pdf' : null;
  if (!ext) return { id: null, error: 'Fichier PDF ou .docx seulement.' };
  if (file.size > 40_000_000) return { id: null, error: 'Fichier trop lourd (40 Mo au plus).' };
  const { userId, displayName, email } = useAuth.getState();
  const id = crypto.randomUUID();
  const path = `fyc/${id}.${ext}`;
  const up = await supabase.storage.from(ADMIN_BUCKET).upload(path, file, { contentType: ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: true });
  if (up.error) return { id: null, error: `Dépôt en échec : ${up.error.message}` };
  const { error } = await untyped.from('fyc_inspections').insert({ id, source_url: `fichier:${file.name}`, status: 'fetched', pdf_path: path, created_by: userId, created_by_name: displayName || email || '' });
  if (error) return { id: null, error: missing(error.message) ? FYC_SQL_HINT : error.message };
  return { id, error: null };
}

/** PHOTOS D'UN PDF DÉJÀ LU PAR LE WORKER (12/11) : le worker lit les champs mais n'a pas de canvas ; le navigateur
 *  ajoute les photos une fois (marque `_photos` dans raw_fields : 'ok', 'aucune' ou l'erreur), sans jamais mettre la
 *  ligne en échec — un navigateur qui ne sait pas lire le PDF (Safari) laisse simplement la fiche sans photos. */
export const photosPending = (r: FycInspection): boolean => r.status === 'read' && !!r.pdf_path && /\.pdf$/i.test(r.pdf_path) && r.photos.length === 0 && !r.raw_fields._photos;
export async function attachPhotos(row: FycInspection): Promise<void> {
  let mark = 'ok';
  let photos: string[] = [];
  try {
    const res = await fetch(await signedUrl(row.pdf_path!));
    if (!res.ok) throw new Error(`fichier illisible (HTTP ${res.status})`);
    const blobs = await extractPdfPhotos(await res.blob(), { maxCount: 40, minWidth: 180, maxRatio: 2.2 });
    photos = blobs.length ? await storePhotos(row.id, blobs) : [];
    if (!photos.length) mark = 'aucune';
  } catch (e) { mark = `échec : ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`; }
  await untyped.from('fyc_inspections').update({ ...(photos.length ? { photos } : {}), raw_fields: { ...row.raw_fields, _photos: mark }, updated_at: new Date().toISOString() }).eq('id', row.id);
}

/** Le rapport est dans le storage (worker, ou dépôt direct) : le navigateur en lit les champs et les enregistre. */
export async function readInspection(row: FycInspection): Promise<string | null> {
  if (!row.pdf_path) return 'PDF absent';
  try {
    const res = await fetch(await signedUrl(row.pdf_path));
    if (!res.ok) throw new Error(`fichier illisible (HTTP ${res.status})`);
    const blob = await res.blob();
    const isDocx = /\.docx$/i.test(row.pdf_path);
    const isHtml = /\.html?$/i.test(row.pdf_path);
    const docx = isDocx ? await docxToLinesEx(blob) : null;
    // Page HTML (DEKRA, 11/11) : lecteur dédié ; photos déjà rangées par le worker (hébergeur sans CORS).
    const html = isHtml ? await blob.text() : null;
    // PDF : rapport DEKRA « fleetbox » (lecteur dédié, 11/11) ou rapport VTI / VWFS (lecteur générique).
    const pdfLines = html == null && !docx ? (await pdfToLinesEx(blob)).lines : null;
    const fields = html != null
      ? (isDekraReport(html) ? parseDekraReport(html).fields : isMacadamReport(html) ? parseMacadamReport(html).fields : parseFycReport(htmlToLines(html)))
      : docx ? parseFycReport(docx.lines)
        : isFleetboxReport(pdfLines!) ? parseFleetboxReport(pdfLines!).fields : parseFycReport(pdfLines!);
    if (!fields.brand && !fields.vin) throw new Error('rapport lu mais sans marque ni VIN : format inconnu');
    // Prix demandé par la plateforme (VWFS) : proposé comme prix d'achat tant qu'aucun n'est saisi.
    const patch: Record<string, unknown> = { ...fields, status: 'read', error: null, updated_at: new Date().toISOString() };
    if (row.purchase_price == null && fields.asking_price != null) patch.purchase_price = fields.asking_price;
    // Photos (11/11) : du PDF, ou des adresses de la page .docx. Une traduction déjà faite reste valable (mêmes valeurs).
    try {
      if (html == null) {
        // Vignettes 200×150 des PDF fleetbox acceptées (≥ 180 px) ; bandeaux-logos écartés par leur proportion (> 2,2).
        const blobs = docx ? await fetchPhotos(docx.photoUrls) : await extractPdfPhotos(blob, { maxCount: 40, minWidth: 180, maxRatio: 2.2 });
        if (blobs.length) patch.photos = await storePhotos(row.id, blobs);
      }
    } catch (e) { console.warn('[FYC] photos non extraites :', e instanceof Error ? e.message : e); }
    const { error } = await untyped.from('fyc_inspections').update(patch).eq('id', row.id);
    return error ? error.message : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await untyped.from('fyc_inspections').update({ status: 'failed', error: msg.slice(0, 800), updated_at: new Date().toISOString() }).eq('id', row.id);
    return msg;
  }
}

/** Filtres MI proposés depuis le rapport : marque, modèle, énergie, boîte, l'année exacte de la voiture (Channing 10/11 soir),
 *  km jusqu'à 1,5 ×. */
export function filtersFromInspection(r: FycInspection, country?: string): MarketFilters {
  const fuel = fuelTokenOf(r.fuel);
  const gb = /auto|dsg|dct|cvt/i.test(r.gearbox ?? '') ? 'automatique' : /manu|schalt|handgesch/i.test(r.gearbox ?? '') ? 'manuelle' : undefined;
  return {
    country: country || undefined,
    brand: r.brand ? r.brand.toUpperCase() : undefined,
    model: r.model ? r.model.toUpperCase() : undefined,
    fuel: fuel || undefined,
    gearbox: gb,
    yearMin: r.year ?? null,
    yearMax: r.year ?? null,
    mileageMax: r.km != null ? Math.round((r.km * 1.5) / 1000) * 1000 : null,
  };
}

export function fuelTokenOf(raw: string | null | undefined): MarketFilters['fuel'] {
  const s = (raw ?? '').toLowerCase();
  if (!s) return '';
  if (/plug|recharge|phev/.test(s)) return 'phev';
  if (/hybr|ibrid/.test(s)) return 'hybrid';
  if (/elec|élec|strom/.test(s)) return 'electric';
  if (/diesel|gasoil|gazole/.test(s)) return 'diesel';
  if (/petrol|essence|benzin|gasolin/.test(s)) return 'petrol';
  if (/gpl|lpg/.test(s)) return 'lpg';
  if (/cng|gnv/.test(s)) return 'cng';
  return '';
}
