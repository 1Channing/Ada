/**
 * RAPPROCHER UN GARAGE (17/10) — les mêmes clés que la base (SQL
 * ada_name_key / ada_phone_key, 20261017100000_agents_annuaire.sql) pour
 * qu'Ada ne mette pas sur la carte un garage qui y est déjà, et le pays d'une
 * fiche saisie à la main (« Pays-Bas », « netherlands », « NL ») en code ISO.
 * Logique pure ; testée par test/agents-qualification.test.ts.
 */

const ACCENTS_FROM = 'àáâãäåāçćčèéêëēìíîïłñńòóôõöøùúûüýÿžšß';
const ACCENTS_TO = 'aaaaaaaccceeeeeiiiilnnoooooouuuuyyzss';
const GENERIC = /\b(sarl|sas|sasu|sa|eurl|snc|bv|nv|vof|bvba|sprl|srl|spa|sl|gmbh|ag|kg|ltd|aps|ab|oy|automobiles?|autos?|garage|cars?)\b/g;

/** Nom comparable : minuscules, sans accents, sans forme juridique ni mots génériques (« Garage Martin SARL » = « Martin Automobiles »). */
export function nameKey(p: string | null | undefined): string {
  let s = (p ?? '').toLowerCase();
  s = [...s].map((ch) => { const i = ACCENTS_FROM.indexOf(ch); return i >= 0 ? ACCENTS_TO[i] : ch; }).join('');
  return s.replace(GENERIC, ' ').replace(/[^a-z0-9]+/g, '');
}

/** Téléphone comparable : les 9 derniers chiffres (indicatif et zéro initial ignorés). */
export const phoneKey9 = (p: string | null | undefined): string => (p ?? '').replace(/\D/g, '').slice(-9);

/** Même garage : même nom (hors mots génériques) ou même téléphone. */
export function sameDealer(a: { name: string | null; phone: string | null }, b: { name: string | null; phone: string | null }): boolean {
  const na = nameKey(a.name);
  const pa = phoneKey9(a.phone);
  return (na !== '' && na === nameKey(b.name)) || (pa.length === 9 && pa === phoneKey9(b.phone));
}

const ISO_OF: Record<string, string> = {
  france: 'FR', fr: 'FR', allemagne: 'DE', germany: 'DE', deutschland: 'DE', de: 'DE', 'pays-bas': 'NL', 'pays bas': 'NL', netherlands: 'NL', nederland: 'NL', nl: 'NL', hollande: 'NL',
  belgique: 'BE', belgium: 'BE', belgie: 'BE', be: 'BE', espagne: 'ES', spain: 'ES', espana: 'ES', es: 'ES', italie: 'IT', italy: 'IT', italia: 'IT', it: 'IT',
  danemark: 'DK', denmark: 'DK', danmark: 'DK', dk: 'DK', suede: 'SE', sweden: 'SE', sverige: 'SE', autriche: 'AT', austria: 'AT', osterreich: 'AT',
  luxembourg: 'LU', suisse: 'CH', switzerland: 'CH', schweiz: 'CH', pologne: 'PL', poland: 'PL', portugal: 'PT', lituanie: 'LT', lithuania: 'LT', hongrie: 'HU', hungary: 'HU',
};

/** Pays d'une fiche (« Pays-Bas », « netherlands », « NL ») → code ISO, ou null. */
export function isoOfCountry(c: string | null | undefined): string | null {
  const t = (c ?? '').trim();
  if (!t) return null;
  const k = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return ISO_OF[k] ?? (/^[a-z]{2}$/i.test(t) ? t.toUpperCase() : null);
}
