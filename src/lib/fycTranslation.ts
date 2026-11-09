/**
 * FYC — TRADUCTION DES VALEURS DU RAPPORT (11/11, Channing : « sur les PDF il y a beaucoup de français, pas de
 * possibilité de traduire ? »). Les libellés de la fiche sont déjà dans la langue du pays cible (fycPdf.ts) ; ce
 * module couvre les VALEURS venues du rapport (énergie, boîte, carrosserie, couleur, équipements, pneus, constats),
 * traduites une fois par langue par le worker (Claude) et gardées sur l'inspection (colonne translations).
 * Module pur : partagé par le navigateur et le worker.
 */
export const FYC_LANG_NAMES: Record<string, string> = { fr: 'français', en: 'anglais', nl: 'néerlandais', de: 'allemand', da: 'danois', sv: 'suédois', es: 'espagnol', it: 'italien' };

/** Ce qui part à la traduction, et ce qui en revient (même forme, mêmes longueurs de listes). */
export interface FycTranslation {
  fuel: string | null; gearbox: string | null; body: string | null; color: string | null;
  equipment: string[]; tyres: string[]; devaluation: string[]; usage: string[];
}
export interface FycTranslatable {
  fuel: string | null; gearbox: string | null; body: string | null; color: string | null;
  equipment: string[]; tyres: string[]; damages: { devaluation: Array<{ raw: string }>; usage: Array<{ raw: string }> };
}

export function translationSource(r: FycTranslatable): FycTranslation {
  return {
    fuel: r.fuel ?? null, gearbox: r.gearbox ?? null, body: r.body ?? null, color: r.color ?? null,
    equipment: [...r.equipment], tyres: [...r.tyres],
    devaluation: r.damages.devaluation.map((d) => d.raw), usage: r.damages.usage.map((d) => d.raw),
  };
}

export const FYC_TRANSLATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    fuel: { type: ['string', 'null'] }, gearbox: { type: ['string', 'null'] }, body: { type: ['string', 'null'] }, color: { type: ['string', 'null'] },
    equipment: { type: 'array', items: { type: 'string' } }, tyres: { type: 'array', items: { type: 'string' } },
    devaluation: { type: 'array', items: { type: 'string' } }, usage: { type: 'array', items: { type: 'string' } },
  },
  required: ['fuel', 'gearbox', 'body', 'color', 'equipment', 'tyres', 'devaluation', 'usage'],
};

export function translationSystem(lang: string): string {
  const name = FYC_LANG_NAMES[lang] ?? lang;
  return `Tu traduis en ${name} les valeurs d'un rapport d'inspection automobile (énergie, boîte de vitesses, carrosserie, couleur, liste d'équipements, pneus montés, constats de dommages) pour une fiche véhicule destinée à un acheteur professionnel. Règles : vocabulaire automobile du pays, concis, pas d'explication ; les listes gardent EXACTEMENT le même nombre d'éléments et le même ordre ; les noms de marques, de systèmes propriétaires (Virtual Cockpit, MMI, quattro, DSG, S tronic…), les dimensions de pneus, les codes et les nombres restent tels quels ; une valeur déjà dans la langue cible est recopiée ; null reste null. Réponds uniquement par le JSON demandé.`;
}

/** Une traduction est COMPLÈTE si ses listes ont la longueur de la source (sinon on garde la source). */
export function translationFits(src: FycTranslation, t: Partial<FycTranslation> | null | undefined): t is FycTranslation {
  if (!t || typeof t !== 'object') return false;
  const same = (a: string[], b: unknown) => Array.isArray(b) && b.length === a.length && b.every((x) => typeof x === 'string');
  return same(src.equipment, t.equipment) && same(src.tyres, t.tyres) && same(src.devaluation, t.devaluation) && same(src.usage, t.usage);
}
