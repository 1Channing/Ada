/**
 * LE LIVRE D'UN SITE (01/11, Channing : « chaque site a un livre unique… le Truth Center, c'est notre vérité »).
 * Les marques et modèles que le site emploie, moissonnés dans linkgen_enum_mappings, lus d'UNE seule façon pour
 * tout ADA :
 *  - le générateur : le modèle que l'adaptateur ne sait pas écrire seul (« ENYAQ » sur Gaspedaal, « ZS » sur
 *    Skelbiu) est écrit avec le nom exact du livre (« Enyaq iV », « MG ZS ») — jamais deviné ;
 *  - le Truth Center › Lacunes : ce que le livre sait, et ce qui lui manque face au référentiel.
 * Les noms se comparent par leur clé canonique, comme partout ailleurs (refModelKey, brandKey) : « RAV 4 » = RAV4,
 * « Classe CLS » = CLS-CLASS, « Enyaq iV » = ENYAQ ; une marque « MG/MG MOTOR » vaut MG comme MG MOTOR.
 */
import type { SiteAdapter } from '../study-core/marketplaces/types';
import { brandKey, refModelKey } from '../../services/marketData';

/** Une entrée du livre d'un site (linkgen_enum_mappings). */
export interface VocabEntry { field: string; code: string; label: string }

const deburr = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');

/** Les clés d'une marque, une par écriture : « MG/MG MOTOR » → MG, MGMOTOR ; « Mercedes-Benz » → MERCEDES. */
export function brandKeys(brand: string): string[] {
  const out: string[] = [];
  for (const b of String(brand ?? '').split('/')) { const k = brandKey(b.trim()); if (k && !out.includes(k)) out.push(k); }
  return out;
}

/** Le nom lu sur le site sans la marque en tête (« MG ZS » → « ZS ») ; `stripped` : la marque y figurait. */
function stripBrand(brand: string, label: string): { rest: string; stripped: boolean } {
  const wanted = new Set(brandKeys(brand));
  const brandTokens = new Set(deburr(brand).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  const words = deburr(label).trim().split(/\s+/).filter(Boolean);
  let k = 0;
  while (k < words.length - 1) {
    const w = words[k];
    const tokens = w.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    if (!wanted.has(brandKey(w)) && !(tokens.length > 0 && tokens.every((t) => brandTokens.has(t)))) break;
    k++;
  }
  return { rest: words.slice(k).join(' '), stripped: k > 0 };
}

/**
 * La clé d'un nom LU SUR LE SITE, comparable à celle du modèle d'ADA (refModelKey), la marque en tête retirée
 * (« MG ZS » pour MG/MG MOTOR → ZS ; « Mercedes-Benz GLS » → GLS ; « Classe cls » → CLS ; « Enyaq iV » → ENYAQ).
 * Une clé plus longue (« Countryman Cooper », « GLS 350 ») est une VERSION du modèle, pas le modèle.
 */
export function siteLabelKey(brand: string, label: string): string {
  return refModelKey(brand, stripBrand(brand, label).rest);
}

/**
 * La motorisation que porte un nom du site (« Scénic Electric », « Mazda2 Hybrid », « Leon e-Hybrid ») : un nom de
 * VARIANTE, qui ne vaut que pour cette motorisation — jamais pour le modèle tout court (01/11 : sur Subito, « Scénic
 * Electric » est le seul Scénic du livre ; l'employer pour un Scénic diesel ne chercherait que des électriques).
 */
const MOTOR_NAMES: Array<[RegExp, string]> = [
  [/\b(?:PLUG[- ]?IN|PHEV|E-?HYBRID)\b/i, 'PLUG_IN_HYBRID'],
  [/\b(?:MHEV|MILD[- ]?HYBRID)\b/i, 'MILD_HYBRID'],
  [/\b(?:EV|BEV|ELECTRIC|ELECTRIQUE|ELETTRICA|ELEKTRISCH)\b/i, 'ELECTRIQUE'],
  [/\b(?:HEV|FHEV|HYBRIDE?|HYBRID)\b/i, 'HYBRIDE'],
];
export function motorisationOf(name: string): string | null {
  const n = deburr(String(name ?? ''));
  for (const [re, fuel] of MOTOR_NAMES) if (re.test(n)) return fuel;
  return null;
}
/** Le carburant demandé ramené aux mêmes familles (« Hybride rechargeable », PLUG_IN_HYBRID, « électrique »…). */
function fuelFamily(fuel: string | null | undefined): string | null {
  const f = deburr(String(fuel ?? '')).toUpperCase();
  if (!f) return null;
  if (/PLUG|PHEV|RECHARGEABLE/.test(f)) return 'PLUG_IN_HYBRID';
  if (/MILD|MHEV|MICRO/.test(f)) return 'MILD_HYBRID';
  if (/ELEC/.test(f)) return 'ELECTRIQUE';
  if (/HYBR/.test(f)) return 'HYBRIDE';
  return f;
}

/** Les champs qui portent des MODÈLES (pas les marques, carburants, filtres, finitions). */
const MODEL_FIELD = /(^|:)(model|modelcode|modelid|cat)(:|$)|^u_car_model$|^model_facet$/;
/** Les champs qui portent les MARQUES d'un site (code → libellé), pour lire la marque d'un code « 17200;268 ». */
const BRAND_FIELD = /^(as:make|ms:make|cn:make|sb:brand|lc:make|gp:brand|jf:brand|bl:brand|bl:brandcode|u_car_brand)$/;

/**
 * La marque d'une entrée du livre, selon la façon dont le site la range : dans le nom du champ (« sb:model:renault »,
 * « cn:model:1 » → ALFA ROMEO), en tête du code (« 17200;268 » → Mercedes-Benz, « mini;countryman-cooper »,
 * « NISSAN_Navara »). null : la marque n'est que dans le libellé (Skelbiu « MG ZS »).
 */
function entryBrand(e: VocabEntry, makes: Map<string, string>): string | null {
  const seg = /^[a-z_]+:(?:model|modelcode|modelid):(.+)$/i.exec(e.field)?.[1];
  if (seg) return makes.get(seg) ?? seg;
  if (e.field === 'u_car_model') return e.code.split('_')[0] || null;
  if (e.code.includes(';')) { const b = e.code.split(';')[0]; return makes.get(b) ?? b; }
  return null;
}

const makesOf = (entries: ReadonlyArray<VocabEntry>) => new Map(entries.filter((e) => BRAND_FIELD.test(e.field)).map((e) => [e.code, e.label]));

/**
 * Les noms du livre pour CE modèle d'ADA : ceux de cette marque dont la clé est celle du modèle (`exact` : « MG ZS »
 * pour ZS, « Classe CLS » pour CLS-CLASS) ou la prolonge (`versions` : « GLS 350 », « GLS 400 » pour GLS-CLASS — le
 * site découpe le modèle). Un exact n'est retenu que si l'adaptateur sait l'écrire pour cette marque SANS deviner,
 * et un nom de variante (« Scénic Electric ») seulement pour sa motorisation (`fuel` demandé, ou le modèle lui-même).
 */
export function vocabularyMatches(adapter: SiteAdapter, brand: string, model: string, entries: ReadonlyArray<VocabEntry>, fuel?: string | null): { exact: string[]; versions: string[] } {
  const key = refModelKey(brand, model);
  const out = { exact: [] as string[], versions: [] as string[] };
  if (!key || !brand.trim()) return out;
  const wanted = new Set(brandKeys(brand));
  const makes = makesOf(entries);
  const seen = new Set<string>();
  for (const e of entries) {
    if (!MODEL_FIELD.test(e.field)) continue;
    const label = e.label.trim();
    if (!label || seen.has(label)) continue;
    const owner = entryBrand(e, makes);
    const { rest, stripped } = stripBrand(brand, label);
    // Appartenance à la marque : lue dans le champ ou le code ; sinon la marque doit ouvrir le libellé.
    if (owner !== null ? !wanted.has(brandKey(owner)) : !stripped) continue;
    const motor = motorisationOf(rest);
    if (motor && motor !== motorisationOf(model) && motor !== fuelFamily(fuel)) continue;
    const k = refModelKey(brand, rest);
    if (k === key) {
      const r = adapter.buildSearchUrl({ brand, model: label });
      if (r.url && r.modelExpressed !== false && !r.modelGuessed) { out.exact.push(label); seen.add(label); }
    } else if (k.startsWith(key) && k.length > key.length) { out.versions.push(label); seen.add(label); }
  }
  return out;
}

/**
 * LE nom du livre à employer pour ce modèle, quand l'adaptateur ne sait pas l'écrire seul : un seul nom exact
 * (deux noms pour la même clé = le livre hésite, rien n'est choisi au hasard).
 */
export function bookModelLabel(adapter: SiteAdapter, brand: string, model: string, entries: ReadonlyArray<VocabEntry>, fuel?: string | null): string | null {
  const { exact } = vocabularyMatches(adapter, brand, model, entries, fuel);
  return exact.length === 1 ? exact[0] : null;
}

/** Ce que le livre d'un site sait, rangé par marque — clés canoniques, libellés du site. */
export interface SiteBook {
  /** clé de marque → libellé du site */
  brands: Map<string, string>;
  /** clé de marque → (clé de modèle → libellé du site) */
  models: Map<string, Map<string, string>>;
}

/**
 * Le livre d'un site lu pour le Truth Center. `knownBrands` (le référentiel) sert à deux choses : ranger une marque
 * « X/Y » sous la clé que le référentiel connaît, et retrouver la marque d'un libellé qui la porte en tête (Skelbiu
 * « MG ZS »). Les modèles se comparent ensuite par clé canonique : rien ne manque pour une simple graphie.
 */
export function readSiteBook(entries: ReadonlyArray<VocabEntry>, knownBrands: Iterable<string>): SiteBook {
  const known = new Map<string, string>(); // clé → libellé
  for (const b of knownBrands) for (const k of brandKeys(b)) if (!known.has(k)) known.set(k, b);
  const keyOf = (brand: string) => { const ks = brandKeys(brand); return ks.find((k) => known.has(k)) ?? ks[0] ?? ''; };
  const brands = new Map<string, string>();
  const models = new Map<string, Map<string, string>>();
  const addModel = (brand: string, label: string, rest: string) => {
    const bk = keyOf(brand);
    // Un nom de variante (« Scénic Electric ») ne vaut pas le modèle tout court : rangé à part, le modèle reste à
    // trouver tant que le livre n'a pas son nom simple — exactement ce que le générateur sait écrire.
    const motor = motorisationOf(rest);
    const mk = motor ? `${refModelKey(brand, rest)}·${motor}` : refModelKey(brand, rest);
    if (!bk || !mk) return;
    if (!brands.has(bk)) brands.set(bk, brand);
    const m = models.get(bk) ?? models.set(bk, new Map()).get(bk)!;
    if (!m.has(mk)) m.set(mk, label.trim());
  };
  const makes = makesOf(entries);
  for (const e of entries) if (BRAND_FIELD.test(e.field) && e.label.trim()) { const bk = keyOf(e.label); if (bk && !brands.has(bk)) brands.set(bk, e.label.trim()); }
  for (const e of entries) {
    if (!MODEL_FIELD.test(e.field) || !e.label.trim()) continue;
    const owner = entryBrand(e, makes);
    if (owner !== null) { addModel(owner, e.label, stripBrand(owner, e.label).rest); continue; }
    // Marque seulement dans le libellé (Skelbiu) : le libellé EST une marque (« Toyota », « Land Rover »), ou la
    // plus longue marque connue l'ouvre (« Land Rover Defender » → Defender).
    const whole = keyOf(e.label);
    if (known.has(whole)) { if (!brands.has(whole)) brands.set(whole, e.label.trim()); continue; }
    const words = deburr(e.label).trim().split(/\s+/).filter(Boolean);
    for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
      const brand = known.get(brandKey(words.slice(0, n).join(' ')));
      if (brand) { addModel(brand, e.label, words.slice(n).join(' ')); break; }
    }
  }
  return { brands, models };
}

/** La clé de marque d'une étude rangée comme le livre la range (« MG/MG MOTOR » → MG si le référentiel dit MG). */
export function brandKeyAmong(brand: string, keys: { has(k: string): boolean }): string {
  const ks = brandKeys(brand);
  return ks.find((k) => keys.has(k)) ?? ks[0] ?? '';
}
