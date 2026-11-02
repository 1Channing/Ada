/** TVA standard du pays où l'on revend : le prix affiché d'une annonce est TTC. */
export const COUNTRY_VAT: Record<string, number> = {
  FR: 0.2, DE: 0.19, NL: 0.21, BE: 0.21, DK: 0.25, SE: 0.25, ES: 0.21, IT: 0.22, LT: 0.21, HU: 0.27,
  // Pays des contacts de la carte (02/11, comparateur) : Finlande 25,5 % depuis le 01/09/2024.
  FI: 0.255, NO: 0.25, PL: 0.23, CZ: 0.21, AT: 0.2, PT: 0.23, CH: 0.081, IE: 0.23, GB: 0.2, LU: 0.17, EE: 0.24, LV: 0.21,
};
export const countryVat = (country: string) => COUNTRY_VAT[country] ?? 0.2;
