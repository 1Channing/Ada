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
import { isExternalReport } from '../lib/fycLinks';

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CandidatePhoto { path: string; url: string; kind: 'photo' | 'dommage'; caption: string | null }
export interface PhotoCandidates { inspection: FycInspection | null; photos: CandidatePhoto[]; why: string | null }

/** L'inspection d'une bonne affaire : par VIN (la plus récente lue), sinon par le lien du rapport fournisseur. */
export async function inspectionOfDeal(item: IntraItem): Promise<FycInspection | null> {
  const vin = (item.vehicle.vin ?? '').trim().toUpperCase();
  if (vin.length >= 11) {
    const { data } = await untyped.from('fyc_inspections').select('*').ilike('vin', vin).is('archived_at', null).order('created_at', { ascending: false }).limit(1);
    const r = (data ?? [])[0];
    if (r) return r as FycInspection;
  }
  const url = item.vehicle.report_url?.trim().replace(/&amp;/gi, '&') ?? '';
  if (isExternalReport(url)) {
    const { data } = await untyped.from('fyc_inspections').select('*').eq('source_url', url).order('created_at', { ascending: false }).limit(1);
    const r = (data ?? [])[0];
    if (r) return r as FycInspection;
  }
  return null;
}

/** Les photos qu'on peut publier pour cette bonne affaire (URL signées pour l'aperçu, 1 h). */
export async function candidatePhotos(item: IntraItem): Promise<PhotoCandidates> {
  let insp = await inspectionOfDeal(item);
  if (!insp) return { inspection: null, photos: [], why: item.vehicle.vin || item.vehicle.report_url ? 'aucune inspection lue pour ce véhicule (VIN ou lien du rapport)' : 'ni VIN ni lien de rapport : pas d\'inspection à chercher' };
  const row = { ...insp, photos: Array.isArray(insp.photos) ? insp.photos : [], defect_photos: Array.isArray(insp.defect_photos) ? insp.defect_photos : [], raw_fields: insp.raw_fields ?? {} } as FycInspection;
  // Le worker a lu le PDF mais n'a pas de canvas : le navigateur extrait les photos maintenant, une fois.
  if (photosPending(row)) {
    await attachPhotos(row);
    const { data } = await untyped.from('fyc_inspections').select('*').eq('id', row.id).maybeSingle();
    if (data) insp = data as FycInspection;
  }
  const paths = (Array.isArray(insp.photos) ? insp.photos : []).filter((p) => typeof p === 'string');
  const defects = (Array.isArray(insp.defect_photos) ? insp.defect_photos : []).filter((p) => p && typeof p.path === 'string');
  if (insp.status !== 'read' && paths.length === 0) return { inspection: insp, photos: [], why: `inspection ${insp.status === 'failed' ? 'en échec' : 'pas encore lue'} : pas de photo` };
  const photos: CandidatePhoto[] = [];
  for (const p of paths) { try { photos.push({ path: p, url: await signedUrl(p), kind: 'photo', caption: null }); } catch { /* photo absente du storage */ } }
  for (const d of defects) { if (paths.includes(d.path)) continue; try { photos.push({ path: d.path, url: await signedUrl(d.path), kind: 'dommage', caption: d.caption || null }); } catch { /* idem */ } }
  return { inspection: insp, photos, why: photos.length ? null : 'inspection lue, mais sans photo exploitable' };
}

/** Copie les photos choisies (chemins du storage) dans la bonne affaire : lues signées, réenvoyées dans intra-photos. */
export async function publishInspectionPhotos(item: IntraItem, picked: CandidatePhoto[], onProgress?: (done: number) => void): Promise<{ added: number; error: string | null }> {
  const files: File[] = [];
  const errors: string[] = [];
  for (const [i, p] of picked.entries()) {
    try {
      const res = await fetch(await signedUrl(p.path));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = /png/.test(blob.type) ? 'png' : /webp/.test(blob.type) ? 'webp' : 'jpg';
      files.push(new File([blob], `inspection_${i + 1}.${ext}`, { type: blob.type || 'image/jpeg' }));
    } catch (e) { errors.push(`${p.path.split('/').pop()} : ${e instanceof Error ? e.message : String(e)}`); }
    onProgress?.(i + 1);
  }
  if (files.length === 0) return { added: 0, error: errors.length ? errors.join(' · ') : 'aucune photo lisible' };
  const r = await addShowcasePhotos(item, files);
  return { added: Math.max(0, r.photos.length - (item.photos ?? []).length), error: [r.error, ...errors].filter(Boolean).join(' · ') || null };
}
