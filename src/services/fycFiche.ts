/**
 * FICHE PDF CLIENT D'UNE INSPECTION — construction complète (11/11) : photos du storage (JPEG tel quel, PNG/WebP
 * ré-encodés), valeurs traduites par le worker (demandées si la langue manque, attente ≤ 90 s, sinon valeurs
 * d'origine et on le dit), puis mise en page (src/lib/fycPdf.ts). Partagé par le bouton « Fiche PDF client » du
 * dossier et par le transfert vers Offres (Channing 11/11 : « le lien de l'inspection version PDF MC Export »),
 * qui publie la fiche dans le bucket PUBLIC fyc-fiches pour que le client de l'offre l'ouvre sans compte.
 */
import { supabase } from '../lib/supabase';
import { signedUrl } from './storageAccess';
import { buildFycPdf, langOfCountry, type FycLang, type FycPdfContact } from '../lib/fycPdf';
import { translationSource, translationFits, type FycTranslation } from '../lib/fycTranslation';
import { getInspection, requestTranslation, type FycInspection } from './fyc';

export const FICHES_BUCKET = 'fyc-fiches';
export const FICHES_SQL_HINT = 'Fiches publiques : colle le SQL du 11/11 (bucket fyc-fiches).';

/** Une photo du storage en data URL : JPEG tel quel ; PNG/WebP (DEKRA, 400 Ko) ré-encodés en JPEG. */
export async function photoData(path: string): Promise<string | null> {
  try {
    const r = await fetch(await signedUrl(path)); if (!r.ok) return null;
    const b = await r.blob();
    if (b.type === 'image/jpeg') return await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(b); });
    const bmp = await createImageBitmap(b);
    const canvas = document.createElement('canvas'); canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext('2d')?.drawImage(bmp, 0, 0); bmp.close();
    const out = canvas.toDataURL('image/jpeg', 0.85); canvas.width = 0; canvas.height = 0;
    return out;
  } catch { return null; }
}

/** La traduction des valeurs dans `lang` : celle déjà faite, sinon demandée au worker et attendue (≤ 90 s). */
export async function translationFor(insp: FycInspection, lang: FycLang, onStatus?: (s: string) => void): Promise<{ translation: FycTranslation | null; note: string | null }> {
  const src = translationSource(insp);
  if (translationFits(src, insp.translations[lang])) return { translation: insp.translations[lang], note: null };
  // Relue fraîche : une traduction demandée d'avance (transfert groupé) est peut-être déjà là, ou en cours.
  const fresh0 = await getInspection(insp.id);
  if (fresh0 && translationFits(src, fresh0.translations[lang])) return { translation: fresh0.translations[lang], note: null };
  const err = fresh0?.translate_to === lang ? null : await requestTranslation(insp.id, lang);
  if (err) return { translation: null, note: `Traduction non demandée (${err}) : fiche avec les valeurs du rapport.` };
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    onStatus?.(`traduction ${lang.toUpperCase()}… ${Math.ceil((until - Date.now()) / 1000)} s`);
    await new Promise((r) => setTimeout(r, 4000));
    const fresh = await getInspection(insp.id);
    if (fresh && translationFits(src, fresh.translations[lang])) return { translation: fresh.translations[lang], note: null };
    if (fresh && fresh.translate_to == null) return { translation: null, note: `Traduction ${lang.toUpperCase()} refusée par le worker${fresh.error ? ` (${fresh.error})` : ''} : fiche avec les valeurs du rapport.` };
  }
  return { translation: null, note: `Traduction ${lang.toUpperCase()} non reçue (worker arrêté ?) : fiche avec les valeurs du rapport. Réessaie dans une minute.` };
}

/** Demande d'avance les traductions manquantes de plusieurs inspections (le worker en traite 3 par 20 s) : un transfert
 *  de 10 véhicules n'attend plus 10 fois de suite. */
export async function prefetchTranslations(items: Array<{ insp: FycInspection; lang: FycLang }>): Promise<void> {
  await Promise.all(items.map(async ({ insp, lang }) => {
    if (translationFits(translationSource(insp), insp.translations[lang])) return;
    const fresh = await getInspection(insp.id);
    if (!fresh || translationFits(translationSource(fresh), fresh.translations[lang]) || fresh.translate_to) return;
    await requestTranslation(insp.id, lang);
  }));
}

/** Langue de la fiche d'une inspection : celle du pays cible de son marché, sinon le français. */
export const ficheLangOf = (insp: FycInspection): FycLang => langOfCountry(insp.market_filters?.country);

export const ficheFileName = (insp: FycInspection, lang: FycLang) => `MC-Export-${[insp.brand, insp.model].filter(Boolean).join('-').replace(/[^A-Za-z0-9-]+/g, '-') || 'vehicule'}-${lang.toUpperCase()}-${new Date().toISOString().slice(0, 10)}.pdf`;

/** La fiche complète (photos, dommages, traduction) ; `note` dit ce qui a manqué. */
export async function buildFiche(insp: FycInspection, lang: FycLang, contact: FycPdfContact, onStatus?: (s: string) => void): Promise<{ blob: Blob; note: string | null }> {
  onStatus?.('photos…');
  const photos: string[] = [];
  for (const p of insp.photos.slice(0, 40)) { const d = await photoData(p); if (d) photos.push(d); }
  const defects: Array<{ data: string; caption: string; list: 'devaluation' | 'usage' | null; idx: number | null }> = [];
  for (const d of insp.defect_photos.slice(0, 40)) { const data = await photoData(d.path); if (data) defects.push({ data, caption: d.caption, list: d.list, idx: d.idx }); }
  const { translation, note } = await translationFor(insp, lang, onStatus);
  onStatus?.('mise en page…');
  const blob = await buildFycPdf(insp, lang, contact, { photos, defects, translation });
  return { blob, note };
}

/** Publie la fiche dans le bucket public : adresse ouvrable sans compte (offres envoyées aux clients). */
export async function publishFiche(insp: FycInspection, lang: FycLang, blob: Blob): Promise<{ url: string | null; error: string | null }> {
  const path = `${insp.id}/${ficheFileName(insp, lang)}`;
  const up = await supabase.storage.from(FICHES_BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (up.error) return { url: null, error: /bucket|not found|row-level|policy/i.test(up.error.message) ? `${FICHES_SQL_HINT} (${up.error.message})` : up.error.message };
  return { url: supabase.storage.from(FICHES_BUCKET).getPublicUrl(path).data.publicUrl, error: null };
}
