/**
 * DOCUMENTS DES CONTACTS PROFESSIONNELS (26/09, demande Channing) : Kbis,
 * pièce d'identité du gérant, RIB, mandat… rangés dans ADA (bucket
 * admin-documents, chemin contacts/{contact_id}/), listés dans
 * contact_documents, et imprimables à côté des certificats de cession et
 * déclarations d'achat d'un dossier — un seul PDF fusionné, dans l'ordre.
 *
 * Fail-open tant que le SQL du 26/09 n'est pas collé : la liste est vide et
 * l'upload dit pourquoi, rien ne casse ailleurs.
 */
import { supabase } from '../lib/supabase';

const BUCKET = 'admin-documents';

export interface ContactDocument {
  id: string; contact_id: string; label: string; path: string;
  content_type: string | null; size_bytes: number | null; created_at: string;
}

export type ContactCategory = 'pro' | 'particulier';

/** Pro ou particulier : la catégorie enregistrée, sinon déduite (société ou SIREN → pro). */
export function contactCategory(c: { category?: string | null; company_name?: string | null; siren?: string | null }): ContactCategory {
  if (c.category === 'pro' || c.category === 'particulier') return c.category;
  return (c.company_name ?? '').trim() || (c.siren ?? '').trim() ? 'pro' : 'particulier';
}

/** Clé de doublon : mots du nom canonisés et triés + code postal (« Roudier
 *  Lionel 25150 » ≡ « LIONEL ROUDIER 25150 »). Sans nom → '' (jamais fusionné). */
export function contactDuplicateKey(c: { company_name?: string | null; first_name?: string | null; last_name?: string | null; postal_code?: string | null }): string {
  const name = (c.company_name ?? '').trim() || `${c.first_name ?? ''} ${c.last_name ?? ''}`;
  const words = name.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort();
  if (words.length === 0) return '';
  return `${words.join('')}|${(c.postal_code ?? '').replace(/\s+/g, '')}`;
}

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function listContactDocuments(contactId: string): Promise<{ docs: ContactDocument[]; error: string | null }> {
  const { data, error } = await untyped.from('contact_documents').select('*').eq('contact_id', contactId).order('created_at', { ascending: true });
  if (error) return { docs: [], error: /does not exist|relation/i.test(error.message) ? 'SQL du 26/09 (contact_documents) à coller.' : error.message };
  return { docs: (data ?? []) as ContactDocument[], error: null };
}

export async function listContactDocumentsFor(contactIds: string[]): Promise<Record<string, ContactDocument[]>> {
  const ids = contactIds.filter(Boolean);
  if (ids.length === 0) return {};
  const { data, error } = await untyped.from('contact_documents').select('*').in('contact_id', ids).order('created_at', { ascending: true });
  if (error) return {};
  const out: Record<string, ContactDocument[]> = {};
  for (const d of (data ?? []) as ContactDocument[]) (out[d.contact_id] ??= []).push(d);
  return out;
}

export function contactDocumentUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Dépose un fichier (PDF, JPG, PNG) pour un contact — le libellé par défaut est le nom du fichier sans extension. */
export async function uploadContactDocument(contactId: string, file: File, label?: string): Promise<{ doc: ContactDocument | null; error: string | null }> {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const safe = file.name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'document';
  const path = `contacts/${contactId}/${Date.now().toString(36)}_${safe}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (up.error) return { doc: null, error: `Dépôt en échec : ${up.error.message}` };
  const { data, error } = await untyped.from('contact_documents')
    .insert({ contact_id: contactId, label: (label ?? '').trim() || safe.replace(/_/g, ' '), path, content_type: file.type || null, size_bytes: file.size })
    .select('*').single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { doc: null, error: /does not exist|relation/i.test(error.message) ? 'SQL du 26/09 (contact_documents) à coller avant de déposer des documents.' : error.message };
  }
  return { doc: data as ContactDocument, error: null };
}

export async function deleteContactDocument(doc: ContactDocument): Promise<string | null> {
  const { error } = await untyped.from('contact_documents').delete().eq('id', doc.id);
  if (error) return error.message;
  await supabase.storage.from(BUCKET).remove([doc.path]);
  return null;
}

export async function renameContactDocument(id: string, label: string): Promise<string | null> {
  const { error } = await untyped.from('contact_documents').update({ label: label.trim() }).eq('id', id);
  return error ? error.message : null;
}

/**
 * Un seul PDF avec toutes les pièces, dans l'ordre : les PDF sont recopiés
 * page à page, les images (JPG/PNG) prennent une page à leur taille. Un
 * fichier illisible est sauté et nommé dans `skipped`.
 */
export async function mergeContactDocumentsPdf(docs: ContactDocument[]): Promise<{ blob: Blob; pages: number; skipped: string[] }> {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const skipped: string[] = [];
  for (const d of docs) {
    try {
      const resp = await fetch(contactDocumentUrl(d.path));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const ct = (d.content_type ?? '').toLowerCase();
      const isPdf = ct.includes('pdf') || d.path.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      } else {
        const img = ct.includes('png') || d.path.toLowerCase().endsWith('.png') ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const page = out.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
    } catch {
      skipped.push(d.label);
    }
  }
  const pages = out.getPageCount();
  const bytes = await out.save();
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), pages, skipped };
}
