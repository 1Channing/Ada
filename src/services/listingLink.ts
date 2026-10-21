/**
 * OUVRIR UNE ANNONCE QUAND SON LIEN NE S'OUVRE PLUS (21/10, Channing : « je ne peux
 * plus accéder à aucune annonce Gaspedaal que me fournit Ada »). Les annonces
 * Gaspedaal n'ont qu'un lien « api.gaspedaal.nl/redirect/vehicle/<n> » vers la
 * fiche du vendeur ; depuis le 21/10 il répond « Access Denied » à un navigateur.
 * Le worker le suit à notre place (mode resolve_link de ingest-url) et rend la
 * fiche chez le vendeur. L'onglet s'ouvre tout de suite (sinon le navigateur
 * bloque la fenêtre), puis reçoit l'adresse résolue — ou le lien d'origine si
 * rien n'a pu être résolu (fail-open). Une adresse résolue est gardée en mémoire.
 */
import { supabase } from '../lib/supabase';
import { humanListingUrl } from './marketData';

export const isBlockedRedirect = (u: string | null | undefined): boolean => /^https?:\/\/api\.gaspedaal\.nl\/redirect\//i.test(u ?? '');

const cache = new Map<string, string | null>();

export async function resolveListingLink(url: string): Promise<string | null> {
  if (!isBlockedRedirect(url)) return null;
  if (cache.has(url)) return cache.get(url) ?? null;
  try {
    const { data, error } = await supabase.functions.invoke('ingest-url', { body: { mode: 'resolve_link', url } });
    const resolved = !error && data && typeof (data as { resolved?: unknown }).resolved === 'string' ? String((data as { resolved: string }).resolved) : null;
    cache.set(url, resolved);
    return resolved;
  } catch {
    return null;
  }
}

/** Ouvre l'annonce dans un nouvel onglet : tout de suite pour un lien normal, après résolution pour un lien bloqué. */
export function openListing(url: string): void {
  const human = humanListingUrl(url);
  if (!isBlockedRedirect(human)) { window.open(human, '_blank', 'noopener'); return; }
  const w = window.open('', '_blank');
  if (w) { try { w.document.title = 'Ouverture de l\'annonce…'; w.document.body.innerHTML = '<p style="font-family:sans-serif;color:#475569;padding:24px">Ouverture de l\'annonce chez le vendeur (Gaspedaal)…</p>'; } catch { /* onglet d\'une autre origine : rien à écrire */ } }
  void resolveListingLink(human).then((resolved) => {
    const target = resolved ?? human;
    if (w) w.location.href = target; else window.open(target, '_blank', 'noopener');
  });
}
