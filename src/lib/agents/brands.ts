/**
 * LES MARQUES À COCHER (18/10, Channing : « que les marques dans les réglages
 * soient des marques à cocher, via un menu déroulant plutôt que des marques à
 * écrire : cela évite les erreurs humaines de précipitation »). Les marques
 * courantes du marché européen du VO récent, celles que MC Export achète et
 * vend surtout d'abord ; une marque déjà enregistrée qui n'y figure pas reste
 * proposée (elle n'est jamais perdue).
 */
export const CAR_BRANDS = [
  'Toyota', 'Suzuki', 'Peugeot', 'Opel', 'Renault', 'Citroën', 'Dacia', 'Volkswagen', 'Skoda', 'Seat', 'Cupra', 'Audi', 'BMW', 'Mercedes-Benz',
  'Ford', 'Fiat', 'Kia', 'Hyundai', 'Nissan', 'Mazda', 'Honda', 'Mitsubishi', 'Lexus', 'MG', 'Volvo', 'Mini', 'Jeep', 'DS', 'Tesla', 'BYD',
  'Alfa Romeo', 'Subaru', 'Smart', 'Land Rover', 'Porsche',
];
export const VAN_BRANDS = ['Ford', 'Mercedes-Benz', 'Renault', 'Volkswagen', 'Peugeot', 'Citroën', 'Fiat', 'Opel', 'Toyota', 'Nissan', 'Iveco', 'Dacia'];

const key = (b: string) => b.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Les choix du menu : la liste, plus les marques déjà enregistrées qui n'y sont pas ; une marque enregistrée prend l'orthographe de la liste. */
export function brandChoices(base: string[], saved: string[]): { options: string[]; selected: string[] } {
  const byKey = new Map(base.map((b) => [key(b), b]));
  const selected = [...new Map(saved.map((b) => b.trim()).filter(Boolean).map((b) => [key(b), byKey.get(key(b)) ?? b])).values()];
  const extra = selected.filter((b) => !byKey.has(key(b)));
  return { options: [...base, ...extra], selected };
}
