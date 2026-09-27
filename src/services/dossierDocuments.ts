/**
 * PIÈCES D'UN DOSSIER (27/09, chantier e-mails — étape 1).
 *
 * Tout ce qui circule pour une voiture, rangé dans le dossier et jamais
 * purgé : carte grise scannée, certificats de cession (achat / revente,
 * signés ou non), déclaration d'achat, Kbis de l'acheteur, récépissé de DA et
 * accusé de DC renvoyés par le prestataire. Fichiers dans le bucket privé
 * admin-documents sous dossiers/{transaction_id}/, lignes dans
 * dossier_documents (migration 20260927100000).
 *
 * Les « packs » disent ce qu'il manque avant un envoi : d'après les envois
 * réels à Carte grise du Moun (27/08 et 09/09 pour GF-922-WT).
 */
import { supabase } from '../lib/supabase';
import { ADMIN_BUCKET } from './storageAccess';

export type DossierDocKind =
  | 'carte_grise' | 'cession_achat' | 'declaration_achat' | 'cession_vente' | 'kbis_acheteur'
  | 'da_recepisse' | 'dc_accuse' | 'autre';

export const DOSSIER_DOC_KINDS: Array<{ kind: DossierDocKind; label: string; hint: string }> = [
  { kind: 'carte_grise', label: 'Carte grise', hint: 'recto et verso, barrée « vendu le … »' },
  { kind: 'cession_achat', label: "Certificat de cession d'achat", hint: 'particulier → MC Export, signé des deux' },
  { kind: 'declaration_achat', label: "Déclaration d'achat", hint: 'cerfa 13751 signé, avec le certificat de vente' },
  { kind: 'cession_vente', label: 'Certificat de cession de revente', hint: 'MC Export → acheteur, signé et tamponné des deux' },
  { kind: 'kbis_acheteur', label: 'Kbis / KvK de l\'acheteur', hint: 'extrait du registre de l\'acheteur pro' },
  { kind: 'da_recepisse', label: 'Récépissé de DA (ANTS)', hint: 'renvoyé par le prestataire' },
  { kind: 'dc_accuse', label: 'Accusé de DC (ANTS)', hint: 'renvoyé par le prestataire' },
  { kind: 'autre', label: 'Autre pièce', hint: '' },
];

export const kindLabel = (k: string) => DOSSIER_DOC_KINDS.find((d) => d.kind === k)?.label ?? k;

/** Ce que Carte grise du Moun reçoit pour faire DA et DC en une fois. */
export const PACK_PRESTATAIRE: DossierDocKind[] = ['carte_grise', 'cession_achat', 'declaration_achat', 'cession_vente', 'kbis_acheteur'];
/** Ce que le prestataire renvoie. */
export const PACK_RETOUR: DossierDocKind[] = ['da_recepisse', 'dc_accuse'];

export interface DossierDocument {
  id: string; transaction_id: string; kind: DossierDocKind; label: string; path: string;
  content_type: string | null; size_bytes: number | null; source: 'depose' | 'genere' | 'recu';
  created_at: string;
}

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missingTable = (msg: string) => /does not exist|relation|schema cache/i.test(msg);

export async function listDossierDocuments(transactionId: string): Promise<{ docs: DossierDocument[]; error: string | null }> {
  const { data, error } = await untyped.from('dossier_documents').select('*').eq('transaction_id', transactionId).order('created_at', { ascending: true });
  if (error) return { docs: [], error: missingTable(error.message) ? 'SQL du 27/09 (dossier_documents) à coller.' : error.message };
  return { docs: (data ?? []) as DossierDocument[], error: null };
}

export async function uploadDossierDocument(transactionId: string, file: File, kind: DossierDocKind, label?: string): Promise<{ doc: DossierDocument | null; error: string | null }> {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const safe = file.name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'piece';
  const path = `dossiers/${transactionId}/${Date.now().toString(36)}_${kind}_${safe}.${ext}`;
  const up = await supabase.storage.from(ADMIN_BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (up.error) return { doc: null, error: `Dépôt en échec : ${up.error.message}` };
  const { data, error } = await untyped.from('dossier_documents')
    .insert({ transaction_id: transactionId, kind, label: (label ?? '').trim() || kindLabel(kind), path, content_type: file.type || null, size_bytes: file.size, source: 'depose' })
    .select('*').single();
  if (error) {
    await supabase.storage.from(ADMIN_BUCKET).remove([path]);
    return { doc: null, error: missingTable(error.message) ? 'SQL du 27/09 (dossier_documents) à coller avant de déposer des pièces.' : error.message };
  }
  return { doc: data as DossierDocument, error: null };
}

export async function updateDossierDocument(id: string, patch: { label?: string; kind?: DossierDocKind }): Promise<string | null> {
  const { error } = await untyped.from('dossier_documents').update(patch).eq('id', id);
  return error ? error.message : null;
}

export async function deleteDossierDocument(doc: DossierDocument): Promise<string | null> {
  const { error } = await untyped.from('dossier_documents').delete().eq('id', doc.id);
  if (error) return error.message;
  await supabase.storage.from(ADMIN_BUCKET).remove([doc.path]);
  return null;
}

/** Pièces manquantes d'un pack, dans l'ordre du pack. */
export function missingForPack(docs: DossierDocument[], pack: DossierDocKind[]): DossierDocKind[] {
  const have = new Set(docs.map((d) => d.kind));
  return pack.filter((k) => !have.has(k));
}
