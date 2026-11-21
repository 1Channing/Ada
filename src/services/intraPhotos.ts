/**
 * PHOTOS DE L'INSPECTION POUR UNE BONNE AFFAIRE (21/11, Channing : « quand je publie via l'Intra, il faudrait que ça
 * uploade automatiquement les photos disponibles sur l'inspection ou le PDF, et qu'on puisse choisir celles qui
 * apparaissent »). L'inspection d'un véhicule publié : celle qui porte son VIN, sinon celle lue depuis son lien de
 * rapport (fyc_inspections.source_url). Ses photos (storage admin-documents, extraites du rapport par le navigateur,
 * voir services/fyc.ts) sont proposées à la publication ; les photos de dommages (DEKRA) aussi, décochées par défaut.
 * La publication copie les photos choisies dans le bucket public intra-photos (addShowcasePhotos) : l'Accueil et
 * mc-export.com les montrent. Fail-open : sans inspection ou sans photo, rien n'est proposé et on le dit.
 */
import { supabase } from '../lib/supabase';
import { signedUrl } from './storageAccess';
import { attachPhotos, photosPending, type FycInspection } from './fyc';
import { addShowcasePhotos, type IntraItem } from './intra';
import { isExternalReport, isOwnFiche } from '../lib/fycLinks';
import { extractPdfPhotos } from '../lib/pdfImages';

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Une photo proposée : dans le storage (`path`), ou extraite à l'instant d'un PDF (`blob`). */
export interface CandidatePhoto { key: string; url: string; kind: 'photo' | 'dommage'; caption: string | null; path?: string; blob?: Blob }
export interface PhotoCandidates { inspection: FycInspection | null; photos: CandidatePhoto[]; why: string | null }

/**
 * L'inspection d'une bonne affaire : par VIN (archivée ou non — ses photos restent bonnes ; 21/11, Channing :
 * « il ne trouve pas les photos sur les Captur alors que les PDF sont bien là » — les inspections venaient d'être
 * archivées), aussi par la ligne « unité:<VIN> » d'une single unit, sinon par le lien du rapport fournisseur.
 */
export async function inspectionOfDeal(item: IntraItem): Promise<FycInspection | null> {
  const vin = (item.vehicle.vin ?? '').trim().toUpperCase();
  const pick = (rows: unknown[]): FycInspection | null => {
    const list = (rows ?? []) as FycInspection[];
    // Une inspection lue avec des photos d'abord, non archivée de préférence, puis la plus récente.
    const score = (r: FycInspection) => (Array.isArray(r.photos) && r.photos.length ? 4 : 0) + (r.status === 'read' ? 2 : 0) + (r.archived_at ? 0 : 1);
    return [...list].sort((a, b) => score(b) - score(a) || String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
  };
  if (vin.length >= 11) {
    const { data } = await untyped.from('fyc_inspections').select('*').or(`vin.ilike.${vin},source_url.eq.unité:${vin}`).order('created_at', { ascending: false }).limit(10);
    const r = pick(data);
    if (r) return r;
  }
  const url = item.vehicle.report_url?.trim().replace(/&amp;/gi, '&') ?? '';
  if (isExternalReport(url)) {
    const { data } = await untyped.from('fyc_inspections').select('*').eq('source_url', url).order('created_at', { ascending: false }).limit(10);
    const r = pick(data);
    if (r) return r;
  }
  return null;
}

/**
 * Sans inspection : les photos du PDF lié au véhicule, lues dans le navigateur — le dossier photos ou la fiche
 * MC Export d'une single unit (bucket public fyc-fiches), ou un rapport fournisseur en PDF quand son hébergeur
 * laisse le navigateur le lire (sinon, on le dit).
 */
async function photosFromPdf(url: string): Promise<{ photos: CandidatePhoto[]; why: string | null }> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!/pdf/i.test(blob.type) && !/\.pdf(\?|$)/i.test(url)) return { photos: [], why: 'le lien du rapport n\'est pas un PDF' };
    const blobs = await extractPdfPhotos(blob, { maxCount: 40, minWidth: 180, maxRatio: 3.5 });
    const photos = blobs.map((b, i) => ({ key: `pdf:${i}`, url: URL.createObjectURL(b), kind: 'photo' as const, caption: null, blob: b }));
    return { photos, why: photos.length ? null : 'PDF lu, mais sans photo exploitable' };
  } catch (e) {
    return { photos: [], why: `le PDF du rapport n'a pas pu être lu depuis le navigateur (${e instanceof Error ? e.message : String(e)}) — déposez-le dans FYC` };
  }
}

/** Les photos qu'on peut publier pour cette bonne affaire (URL signées pour l'aperçu, 1 h). */
export async function candidatePhotos(item: IntraItem): Promise<PhotoCandidates> {
  let insp = await inspectionOfDeal(item);
  const reportUrl = item.vehicle.report_url?.trim().replace(/&amp;/gi, '&') ?? '';
  if (!insp) {
    if (isOwnFiche(reportUrl) || isExternalReport(reportUrl)) {
      const r = await photosFromPdf(reportUrl);
      return { inspection: null, photos: r.photos, why: r.photos.length ? null : `aucune inspection lue pour ce véhicule ; ${r.why}` };
    }
    return { inspection: null, photos: [], why: item.vehicle.vin ? 'aucune inspection lue pour ce véhicule (VIN), et pas de lien de rapport' : 'ni VIN ni lien de rapport : pas d\'inspection à chercher' };
  }
  const row = { ...insp, photos: Array.isArray(insp.photos) ? insp.photos : [], defect_photos: Array.isArray(insp.defect_photos) ? insp.defect_photos : [], raw_fields: insp.raw_fields ?? {} } as FycInspection;
  // Le worker a lu le PDF mais n'a pas de canvas : le navigateur extrait les photos maintenant, une fois.
  if (photosPending(row)) {
    await attachPhotos(row);
    const { data } = await untyped.from('fyc_inspections').select('*').eq('id', row.id).maybeSingle();
    if (data) insp = data as FycInspection;
  }
  const paths = (Array.isArray(insp.photos) ? insp.photos : []).filter((p) => typeof p === 'string');
  const defects = (Array.isArray(insp.defect_photos) ? insp.defect_photos : []).filter((p) => p && typeof p.path === 'string');
  const photos: CandidatePhoto[] = [];
  for (const p of paths) { try { photos.push({ key: p, path: p, url: await signedUrl(p), kind: 'photo', caption: null }); } catch { /* photo absente du storage */ } }
  for (const d of defects) { if (paths.includes(d.path)) continue; try { photos.push({ key: d.path, path: d.path, url: await signedUrl(d.path), kind: 'dommage', caption: d.caption || null }); } catch { /* idem */ } }
  if (photos.length) return { inspection: insp, photos, why: null };
  // Inspection sans photo : le PDF lié au véhicule, s'il y en a un.
  if (isOwnFiche(reportUrl) || isExternalReport(reportUrl)) {
    const r = await photosFromPdf(reportUrl);
    if (r.photos.length) return { inspection: insp, photos: r.photos, why: null };
    return { inspection: insp, photos: [], why: `inspection ${insp.status === 'read' ? 'lue' : insp.status === 'failed' ? 'en échec' : 'pas encore lue'} sans photo ; ${r.why}` };
  }
  return { inspection: insp, photos: [], why: `inspection ${insp.status === 'read' ? 'lue, mais sans photo exploitable' : insp.status === 'failed' ? 'en échec' : 'pas encore lue'}` };
}

/** Copie les photos choisies (chemins du storage) dans la bonne affaire : lues signées, réenvoyées dans intra-photos. */
export async function publishInspectionPhotos(item: IntraItem, picked: CandidatePhoto[], onProgress?: (done: number) => void): Promise<{ added: number; error: string | null }> {
  const files: File[] = [];
  const errors: string[] = [];
  for (const [i, p] of picked.entries()) {
    try {
      let blob: Blob;
      if (p.blob) blob = p.blob;
      else {
        const res = await fetch(await signedUrl(p.path!));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
      }
      const ext = /png/.test(blob.type) ? 'png' : /webp/.test(blob.type) ? 'webp' : 'jpg';
      files.push(new File([blob], `inspection_${i + 1}.${ext}`, { type: blob.type || 'image/jpeg' }));
    } catch (e) { errors.push(`${(p.path ?? p.key).split('/').pop()} : ${e instanceof Error ? e.message : String(e)}`); }
    onProgress?.(i + 1);
  }
  if (files.length === 0) return { added: 0, error: errors.length ? errors.join(' · ') : 'aucune photo lisible' };
  const r = await addShowcasePhotos(item, files);
  return { added: Math.max(0, r.photos.length - (item.photos ?? []).length), error: [r.error, ...errors].filter(Boolean).join(' · ') || null };
}
