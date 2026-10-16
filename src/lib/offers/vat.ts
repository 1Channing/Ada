/** TVA standard du pays où l'on revend : le prix affiché d'une annonce est TTC. */
export const COUNTRY_VAT: Record<string, number> = {
  FR: 0.2, DE: 0.19, NL: 0.21, BE: 0.21, DK: 0.25, SE: 0.25, ES: 0.21, IT: 0.22, LT: 0.21, HU: 0.27,
};
export const countryVat = (country: string) => COUNTRY_VAT[country] ?? 0.2;
