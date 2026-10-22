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
import { gaspedaalAdapter } from '../lib/study-core/marketplaces/gaspedaal';

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

/**
 * LE REPLI SÛR (21/10) : la page de résultats Gaspedaal où l'annonce figure — même marque, même modèle,
 * même année, kilométrage au plus légèrement supérieur. Elle s'ouvre toujours, et depuis cette page le
 * clic sur la carte mène chez le vendeur (Gaspedaal accepte ses propres clics). Deux clics au lieu d'un,
 * mais jamais « Access Denied ». Null si la marque ou le modèle manquent.
 */
export function gaspedaalSearchFallback(x: { brand?: string | null; model?: string | null; fuel?: string | null; year?: number | null; mileage?: number | null; url?: string | null }): string | null {
  const brand = (x.brand ?? '').trim(), model = (x.model ?? '').trim();
  if (!brand) return null;
  // Identifiant de la carte quand le lien en porte un (forme « …#<id> » des annonces sans portail) : la page s'ouvre POSITIONNÉE
  // sur l'annonce (#oc<id>, les cartes portent id="oc…"). Sans lui : la page de résultats, en haut.
  const card = (x.url ?? '').match(/#(?:oc)?(\d{6,})$/)?.[1];
  try {
    const km = x.mileage != null && x.mileage > 0 ? Math.ceil((x.mileage * 1.05) / 5000) * 5000 : undefined;
    const base = { brand, model, fuel: x.fuel ?? undefined, yearFrom: x.year ?? undefined, yearTo: x.year ?? undefined, mileage: km, sort: 'relevance' as const };
    let r = gaspedaalAdapter.buildSearchUrl(base);
    // Côté navigateur, le dictionnaire des slugs modèle (moissonné par le worker) est vide : le chemin
    // n'exprime alors que la marque. Le modèle passe par la barre de recherche du site (trefw=, grammaire
    // prouvée) — toujours une page valide, jamais un slug deviné qui ferait un 404.
    if (model && !r.modelExpressed) r = gaspedaalAdapter.buildSearchUrl({ ...base, trim: model });
    return r.url ? `${r.url}${card ? `#oc${card}` : ''}` : null;
  } catch { return null; }
}

/** Au plus 8 s pour la résolution par le worker : au-delà, le repli. */
const RESOLVE_TIMEOUT_MS = 8000;

/**
 * Ouvre l'annonce dans un nouvel onglet : tout de suite pour un lien normal. Pour un lien bloqué : la page
 * de résultats Gaspedaal (repli) quand on sait la construire ; sinon la fiche chez le vendeur résolue par le
 * worker, ou le lien d'origine.
 */
export function openListing(url: string, fallback?: string | null): void {
  const human = humanListingUrl(url);
  if (!isBlockedRedirect(human)) { window.open(human, '_blank', 'noopener'); return; }
  if (fallback) { window.open(fallback, '_blank', 'noopener'); return; }
  const w = window.open('', '_blank');
  if (w) { try { w.document.title = 'Ouverture de l\'annonce…'; w.document.body.innerHTML = '<p style="font-family:sans-serif;color:#475569;padding:24px">Ouverture de l\'annonce chez le vendeur (Gaspedaal)…</p>'; } catch { /* onglet d\'une autre origine : rien à écrire */ } }
  const timeout = new Promise<string | null>((r) => setTimeout(() => r(null), RESOLVE_TIMEOUT_MS));
  void Promise.race([resolveListingLink(human), timeout]).then((resolved) => {
    const target = resolved ?? human;
    if (w) w.location.href = target; else window.open(target, '_blank', 'noopener');
  });
}
