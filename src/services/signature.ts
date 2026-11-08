/**
 * MA SIGNATURE E-MAIL EN IMAGE (08/11, Channing : « ma signature mail en image n'est toujours pas
 * intégrée, voici l'image de base à intégrer dans le mail »).
 *
 * Une image par compte, dans le storage (admin-documents/signatures/<adresse>.png|jpg). Le worker
 * l'ajoute en ligne sous le texte de chaque e-mail envoyé au nom de ce compte (dossiers, relances Carte,
 * réponses aux demandes du site). Le chemin est déduit de l'adresse : pas de table, rien à coller.
 */
import { supabase } from '../lib/supabase';
import { ADMIN_BUCKET, signedUrl } from './storageAccess';

const MAX_BYTES = 1_500_000;

/** Même règle que le worker (worker/mailer.ts) : adresse en minuscules, caractères sûrs seulement. */
export const signatureBase = (email: string) => `signatures/${email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')}`;

export async function findSignature(email: string): Promise<{ path: string; url: string } | null> {
  const base = signatureBase(email);
  const { data } = await supabase.storage.from(ADMIN_BUCKET).list('signatures', { search: base.slice('signatures/'.length) });
  const file = (data ?? []).find((f) => `signatures/${f.name}` === `${base}.png` || `signatures/${f.name}` === `${base}.jpg`);
  if (!file) return null;
  const path = `signatures/${file.name}`;
  return { path, url: `${await signedUrl(path)}${'&'}v=${Date.now()}` };
}

export async function uploadSignature(email: string, file: File): Promise<{ path: string | null; error: string | null }> {
  const type = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : null;
  if (!type) return { path: null, error: 'Image PNG ou JPEG seulement.' };
  if (file.size > MAX_BYTES) return { path: null, error: 'Image trop lourde (1,5 Mo au plus) : réduis-la avant de la déposer.' };
  const base = signatureBase(email);
  // Une seule image par compte : l'autre format, s'il existe, est retiré.
  await supabase.storage.from(ADMIN_BUCKET).remove([`${base}.png`, `${base}.jpg`]);
  const path = `${base}.${type}`;
  const up = await supabase.storage.from(ADMIN_BUCKET).upload(path, file, { contentType: file.type, upsert: true });
  if (up.error) return { path: null, error: `Dépôt en échec : ${up.error.message}` };
  return { path, error: null };
}

export async function removeSignature(email: string): Promise<string | null> {
  const base = signatureBase(email);
  const { error } = await supabase.storage.from(ADMIN_BUCKET).remove([`${base}.png`, `${base}.jpg`]);
  return error ? error.message : null;
}
