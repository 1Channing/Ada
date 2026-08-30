/**
 * CARROSSERIES — canon ADA (acté Channing 30/08/2026).
 *
 * La nomenclature de référence est celle de Leboncoin, PROUVÉE par ses deux
 * URLs humaines du 30/08 :
 *   vehicle_type=4x4
 *   vehicle_type=4x4,berline,cabriolet,break,citadine,coupe,monospace,voituresociete
 * (liste à VIRGULES LITTÉRALES — même famille que u_car_model, la pose
 * chirurgicale du registre les préserve.)
 *
 * canonicalizeBody est le pendant carrosserie de canonicalizeFuel : lecture
 * TOLÉRANTE multilingue des labels structurés que les sites déclarent
 * (moissons réelles : LBC vehicle_type ×9, Skelbiu sk:body ×15 lituaniens,
 * La Centrale category SUV_4X4_CROSSOVER). Poser une URL, en revanche,
 * reste réservé aux grammaires PROUVÉES site par site.
 * Fail-open : illisible = '' (jamais un rejet).
 */

export type BodyToken =
  | 'suv' | 'berline' | 'break' | 'citadine' | 'monospace'
  | 'coupe' | 'cabriolet' | 'societe' | '';

/** Les 8 carrosseries du canon, labels d'affichage FR (nomenclature LBC). */
export const BODY_TYPES: Array<{ token: Exclude<BodyToken, ''>; label: string }> = [
  { token: 'suv', label: '4x4, SUV & Crossover' },
  { token: 'berline', label: 'Berline' },
  { token: 'break', label: 'Break' },
  { token: 'citadine', label: 'Citadine' },
  { token: 'monospace', label: 'Monospace' },
  { token: 'coupe', label: 'Coupé' },
  { token: 'cabriolet', label: 'Cabriolet' },
  { token: 'societe', label: 'Voiture société' },
];

export function bodyLabel(token: string): string {
  return BODY_TYPES.find((b) => b.token === token)?.label ?? token;
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Label structuré (déclaré par le site) → token canon. Sources réelles :
 * LBC (slugs + labels FR), Skelbiu (labels LT moissonnés le 30/08),
 * La Centrale (category vue à la dissection), + génériques EN/DE/NL/IT
 * répandus pour les sites qui déclarent en anglais. Hatchback ≈ citadine
 * (choix canon : la nomenclature FR n'a pas de case hatchback séparée).
 * Pickup / utilitaires lourds : hors canon → '' (fail-open).
 */
export function canonicalizeBody(raw: string | null | undefined): BodyToken {
  const t = norm(raw ?? '');
  if (!t) return '';
  if (/4x4|suv|crossover|visureigis|todoterreno|fuoristrada|gelandewagen|offroad|terreinwagen|tout ?terrain|terepjaro/.test(t)) return 'suv';
  if (/berline|sedan|saloon|limousine|limuzinas|sedanas|berlina|stufenheck/.test(t)) return 'berline';
  if (/break|estate|station ?wagon|kombi|universalas|touring|familiale|giardinetta|stationcar|sw\b/.test(t)) return 'break';
  if (/citadine|hatchback|hatch|hecbekas|compacte?|kleinwagen|city ?car|utilitaria/.test(t)) return 'citadine';
  // « van » nu banni : « caravan » finirait en monospace — minivan suffit.
  if (/monospace|mpv|minivan|vienaturis|people ?carrier|ruimtewagen/.test(t)) return 'monospace';
  if (/coupe|kupe|sportwagen/.test(t)) return 'coupe';
  if (/cabriolet|cabrio|convertible|kabrioletas|roadster|spider|spyder|decapotable/.test(t)) return 'cabriolet';
  if (/societe|commercial|komercinis|company ?car|bedrijfswagen/.test(t)) return 'societe';
  return '';
}
