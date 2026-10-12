/**
 * CLÉ D'IDENTITÉ D'UNE ANNONCE (12/10, prospection Weecars : « leur éviter
 * les doublons de prospection sur Leboncoin »).
 *
 * Deux URLs d'une même annonce ne sont pas toujours égales : paramètres de
 * suivi, version mobile, « .htm » ou pas, /ad/voitures/ID contre /vi/ID.htm.
 * La clé réduit l'URL à ce qui identifie l'annonce chez le site :
 *   - Leboncoin : l'identifiant numérique (leboncoin:3012345678) ;
 *   - AutoScout24 : l'UUID de l'offre ;
 *   - mobile.de : le paramètre id ;
 *   - Gaspedaal : chemin + identifiant du fragment (#oc…) ;
 *   - ailleurs : hôte (sans www./m.) + chemin, sans requête ni fragment.
 * Fail-open : URL illisible → la chaîne telle quelle, en minuscules.
 */
export function listingKey(url: string | null | undefined): string {
  const raw = (url ?? '').trim();
  if (!raw) return '';
  let u: URL;
  try { u = new URL(raw); } catch { return raw.toLowerCase(); }
  const host = u.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
  const path = u.pathname.replace(/\/+$/, '').replace(/\.html?$/i, '').toLowerCase();
  if (host.endsWith('leboncoin.fr')) {
    const id = path.match(/\/(\d{7,})(?:\/|$)/)?.[1] ?? u.searchParams.get('id');
    if (id) return `leboncoin:${id}`;
  }
  if (host.includes('autoscout24')) {
    const uuid = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1];
    if (uuid) return `autoscout24:${uuid}`;
  }
  if (host.endsWith('mobile.de')) {
    const id = u.searchParams.get('id');
    if (id) return `mobile.de:${id}`;
  }
  if (host.endsWith('gaspedaal.nl')) {
    const frag = u.hash.match(/(\d{6,})/)?.[1];
    return `${host}${path}${frag ? `#${frag}` : ''}`;
  }
  return `${host}${path}`;
}

/** Même annonce ? (clé non vide des deux côtés et identique) */
export function sameListing(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = listingKey(a);
  return ka !== '' && ka === listingKey(b);
}
