/**
 * CE QUE LA VITRINE DOIT PORTER POUR CHAQUE VÉHICULE (27/11, Channing : « JP.cars scrape notre vitrine pour l'intégrer à
 * leur plateforme, il faut que ces infos soient présentes ; mets une petite notif rouge lorsqu'il manque des infos à
 * compléter sur l'onglet Intra »). Mail de Malik (JP.cars) : kilométrage, marque, modèle, carburant, transmission,
 * type de carrosserie, date de première immatriculation, puissance, photo. Pur : partagé par l'onglet Intra et l'Accueil.
 */
export interface ShowcaseLike {
  vehicle: { brand?: string | null; model?: string | null; km?: number | null; fuel?: string | null; gearbox?: string | null; body?: string | null; reg_date?: string | null; power_ch?: number | null };
  photos?: string[] | null;
}

export const SHOWCASE_REQUIRED: Array<{ key: string; label: string; has: (it: ShowcaseLike) => boolean }> = [
  { key: 'brand', label: 'marque', has: (it) => !!(it.vehicle.brand ?? '').trim() },
  { key: 'model', label: 'modèle', has: (it) => !!(it.vehicle.model ?? '').trim() },
  { key: 'km', label: 'kilométrage', has: (it) => it.vehicle.km != null && Number.isFinite(Number(it.vehicle.km)) },
  { key: 'fuel', label: 'énergie', has: (it) => !!(it.vehicle.fuel ?? '').trim() },
  { key: 'gearbox', label: 'boîte', has: (it) => !!(it.vehicle.gearbox ?? '').trim() },
  { key: 'body', label: 'carrosserie', has: (it) => !!(it.vehicle.body ?? '').trim() },
  { key: 'reg_date', label: '1re immatriculation', has: (it) => /^\d{4}-\d{2}/.test(it.vehicle.reg_date ?? '') },
  { key: 'power_ch', label: 'puissance', has: (it) => it.vehicle.power_ch != null && Number(it.vehicle.power_ch) > 0 },
  { key: 'photos', label: 'photo', has: (it) => (it.photos ?? []).length > 0 },
];

/** Les libellés de ce qui manque pour le site (vide = complet). */
export function missingForSite(it: ShowcaseLike): string[] {
  return SHOWCASE_REQUIRED.filter((r) => !r.has(it)).map((r) => r.label);
}
