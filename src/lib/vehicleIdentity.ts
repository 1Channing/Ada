/**
 * IDENTITÉ D'UNE VOITURE LUE DANS UN TITRE D'ANNONCE (05/11, Channing : « un T-Roc La Centrale en doublon avec un
 * GLA Leboncoin » — la règle « même voiture » des veilles ne comparait que l'année, le kilométrage et le prix).
 *
 * Marque = premier mot (ou deux pour Alfa Romeo, Land Rover…) quand c'est une marque connue ; modèle = ce qui suit,
 * coupé à la cylindrée / puissance / énergie / finition (guessModel), ramené à la clé du référentiel.
 * Fail-open : titre sans marque connue en tête → marque et modèle inconnus, la comparaison ne tranche pas.
 */
import { guessModel } from './offers/parseSupplierFile';
import { brandKey, refModelKey } from '../services/marketData';

const KNOWN_BRANDS = ['ABARTH', 'ALFA ROMEO', 'ALPINE', 'ASTON MARTIN', 'AUDI', 'BENTLEY', 'BMW', 'BYD', 'CITROEN', 'CUPRA', 'DACIA', 'DS', 'FERRARI', 'FIAT', 'FORD', 'HONDA', 'HYUNDAI', 'INFINITI', 'JAGUAR', 'JEEP', 'KIA', 'LAMBORGHINI', 'LANCIA', 'LAND ROVER', 'LEXUS', 'LOTUS', 'LYNK & CO', 'MASERATI', 'MAZDA', 'MERCEDES', 'MERCEDES-BENZ', 'MG', 'MINI', 'MITSUBISHI', 'NISSAN', 'OPEL', 'PEUGEOT', 'POLESTAR', 'PORSCHE', 'RENAULT', 'ROLLS ROYCE', 'SEAT', 'SKODA', 'SMART', 'SSANGYONG', 'SUBARU', 'SUZUKI', 'TESLA', 'TOYOTA', 'VOLKSWAGEN', 'VOLVO', 'XPENG', 'LEAPMOTOR', 'MAXUS', 'CHANGAN', 'OMODA', 'JAECOO', 'DR', 'LYNK', 'VW'];
const BRAND_KEYS = new Map(KNOWN_BRANDS.map((b) => [brandKey(b), b]));

export interface TitleIdentity { brand: string | null; model: string | null }

export function titleIdentity(title: string | null | undefined): TitleIdentity {
  const up = (title ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[*]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!up) return { brand: null, model: null };
  const words = up.split(' ');
  let brand: string | null = null;
  let rest: string[] = [];
  const two = words.length >= 2 ? brandKey(`${words[0]} ${words[1]}`) : '';
  if (two && BRAND_KEYS.has(two)) { brand = BRAND_KEYS.get(two)!; rest = words.slice(2); }
  else if (BRAND_KEYS.has(brandKey(words[0]))) { brand = BRAND_KEYS.get(brandKey(words[0]))!; rest = words.slice(1); }
  if (!brand) return { brand: null, model: null };
  const guess = guessModel(brand, rest.join(' '), []);
  const model = guess ? refModelKey(brand, guess) : null;
  return { brand: brandKey(brand), model: model || null };
}

/** Deux titres peuvent-ils désigner la même voiture ? Faux seulement quand marque ou modèle sont CONNUS des deux
 *  côtés et différents ; inconnu d'un côté → on ne tranche pas (true). */
export function compatibleTitles(a: string | null | undefined, b: string | null | undefined): boolean {
  const ia = titleIdentity(a), ib = titleIdentity(b);
  if (ia.brand && ib.brand && ia.brand !== ib.brand) return false;
  // Modèle : l'un doit commencer l'autre (« GLA » et « GLA200 », « YARIS » et « YARISCROSS » restent compatibles ;
  // « 308 » et « 3008 », « TROC » et « GLA » non) — le kilométrage et le prix font le reste.
  if (ia.model && ib.model && !ia.model.startsWith(ib.model) && !ib.model.startsWith(ia.model)) return false;
  return true;
}
