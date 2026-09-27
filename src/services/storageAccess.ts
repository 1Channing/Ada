/**
 * ACCÈS AUX FICHIERS DU STORAGE (27/09, chantier « données protégées »).
 *
 * Constat : le bucket admin-documents était PUBLIC — la pièce d'identité du
 * gérant de SaleCar (2,2 Mo) se téléchargeait sans clé, avec la seule URL.
 * La migration 20260927100000 rend le bucket privé ; dès lors chaque fichier
 * s'ouvre par une URL SIGNÉE, valable une heure, délivrée à un compte
 * connecté. Les URL « publiques » déjà en base (photos de négociations
 * posées par le worker, historique des documents) restent des identifiants :
 * on en extrait le chemin et on signe.
 *
 * Fail-open : tant que le bucket est encore public ou si la signature
 * échoue, on rend l'URL publique — rien ne casse avant le collage du SQL.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export const ADMIN_BUCKET = 'admin-documents';
const TTL_S = 3600;
const cache = new Map<string, { url: string; exp: number }>();

/** Chemin dans le bucket, depuis une URL publique / signée ou un chemin nu. */
export function storagePathOf(pathOrUrl: string): string {
  const m = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/admin-documents\/([^?]+)/.exec(pathOrUrl);
  if (m) return decodeURIComponent(m[1]);
  return pathOrUrl.replace(/^\/+/, '');
}

export function publicUrlOf(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return supabase.storage.from(ADMIN_BUCKET).getPublicUrl(pathOrUrl).data.publicUrl;
}

export async function signedUrl(pathOrUrl: string): Promise<string> {
  const path = storagePathOf(pathOrUrl);
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now() + 60_000) return hit.url;
  try {
    const { data, error } = await supabase.storage.from(ADMIN_BUCKET).createSignedUrl(path, TTL_S);
    if (error || !data?.signedUrl) return publicUrlOf(pathOrUrl);
    cache.set(path, { url: data.signedUrl, exp: Date.now() + TTL_S * 1000 });
    return data.signedUrl;
  } catch {
    return publicUrlOf(pathOrUrl);
  }
}

/** Plusieurs fichiers d'un coup (photos d'une négociation) — un seul appel. */
export async function signedUrls(pathsOrUrls: string[]): Promise<string[]> {
  const paths = pathsOrUrls.map(storagePathOf);
  const missing = [...new Set(paths.filter((p) => { const h = cache.get(p); return !(h && h.exp > Date.now() + 60_000); }))];
  if (missing.length > 0) {
    try {
      const { data } = await supabase.storage.from(ADMIN_BUCKET).createSignedUrls(missing, TTL_S);
      for (const d of data ?? []) if (d.signedUrl && d.path) cache.set(d.path, { url: d.signedUrl, exp: Date.now() + TTL_S * 1000 });
    } catch { /* fail-open : URL publiques ci-dessous */ }
  }
  return pathsOrUrls.map((p, i) => cache.get(paths[i])?.url ?? publicUrlOf(p));
}

/** Hook : l'URL signée d'un fichier, l'URL publique en attendant / en repli. */
export function useSignedUrl(pathOrUrl: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (pathOrUrl ? cache.get(storagePathOf(pathOrUrl))?.url ?? null : null));
  useEffect(() => {
    let alive = true;
    if (!pathOrUrl) { setUrl(null); return; }
    void signedUrl(pathOrUrl).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [pathOrUrl]);
  return url;
}

/** Hook : plusieurs fichiers, dans l'ordre donné. */
export function useSignedUrls(pathsOrUrls: string[]): string[] {
  const key = pathsOrUrls.join('\n');
  const [urls, setUrls] = useState<string[]>(() => pathsOrUrls.map((p) => cache.get(storagePathOf(p))?.url ?? publicUrlOf(p)));
  useEffect(() => {
    let alive = true;
    if (pathsOrUrls.length === 0) { setUrls([]); return; }
    void signedUrls(pathsOrUrls).then((u) => { if (alive) setUrls(u); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}
