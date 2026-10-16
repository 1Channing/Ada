/**
 * L'ANNONCE D'UNE BONNE AFFAIRE SUR mc-export.com (16/10, Channing : « dans
 * l'accueil, lorsqu'on clique sur un véhicule dans les bonnes affaires, cela
 * redirige vers le lien de l'annonce sur le site MC Export »).
 *
 * Le site lit ses fiches par site_good_deals() (SQL du 13/10), qui rend
 * l'adresse ada_slug(marque modèle année) + « - » +
 * les 8 premiers caractères de l'id ; la fiche se retrouve par ces 8
 * caractères. Ce module refait le même calcul, caractère pour caractère, pour
 * que le lien d'ADA soit l'adresse canonique de la fiche. Pur : aucun import,
 * testé par test/site-deal-url.test.ts.
 */
export const SITE_URL = 'https://mc-export.com';

// Les mêmes tables que translate() dans public.ada_slug — l'ordre compte.
const FROM = 'àáâãäåāçćčèéêëēìíîïłñńòóôõöøùúûüýÿžšß';
const TO = 'aaaaaaaccceeeeeiiiilnnoooooouuuuyyzss';

/** public.ada_slug : minuscules, accents retirés, tout le reste devient « - », sans tiret aux bords. */
export function adaSlug(p: string | null | undefined): string {
  const plain = Array.from((p ?? '').toLowerCase(), (c) => {
    const k = FROM.indexOf(c);
    return k >= 0 ? TO[k] : c;
  }).join('');
  return plain.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export interface SiteDealVehicle { brand?: string | null; model?: string | null; year?: number | string | null }

/** Le slug de la fiche, tel que site_good_deals() le rend. */
export function siteDealSlug(id: string, v: SiteDealVehicle): string {
  const n = v.year == null || v.year === '' ? NaN : Number(v.year);
  const year = Number.isFinite(n) ? String(Math.round(n)) : null;
  // concat_ws(' ', …) saute les valeurs nulles.
  const words = [v.brand, v.model, year].filter((w): w is string => w != null);
  return `${adaSlug(words.join(' '))}-${id.replace(/-/g, '').slice(0, 8)}`;
}

/** L'annonce sur mc-export.com, en français : la langue des vendeurs d'ADA. */
export const siteDealUrl = (id: string, v: SiteDealVehicle) => `${SITE_URL}/bonnes-affaires/${siteDealSlug(id, v)}`;
