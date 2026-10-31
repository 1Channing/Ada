/**
 * ADA CHERCHE ELLE-MÊME L'ADRESSE D'UN MODÈLE (31/10). L'extension Claude masque tout ce qui suit le « ? » d'une
 * adresse : Claude ne peut ni lire ni recopier les paramètres d'une recherche. Il n'en a plus besoin. À partir
 * d'un NOM (celui d'ADA, ou le nom exact que Claude lit sur le site), ADA construit les adresses possibles « page
 * marque + modèle », TOUTES de la même forme que la page de départ (rien d'autre ne change), puis le worker les
 * scrape et ne garde que celle dont les annonces sont conformes à 100 % (worker/taxonomyLearning.ts).
 */
import type { SiteAdapter } from '../study-core/marketplaces/types';
import { setQueryParamRaw } from './grammar';
import { brandKeyOf } from './learning';
import { refModelKey } from '../../services/marketData';

const deburr = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');

/**
 * La clé d'un nom LU SUR LE SITE, comparable à celle du modèle d'ADA (refModelKey), la marque en tête retirée
 * (« MG ZS » pour MG/MG MOTOR → ZS ; « Mercedes-Benz GLS » → GLS ; « Classe cls » → CLS ; « Enyaq iV » → ENYAQ).
 * Une clé DIFFÉRENTE (31/10) : le nom est plus précis que le modèle — « Countryman Cooper », « GLS 350 » — une
 * VERSION du modèle, dont l'adresse ne couvrirait qu'une partie du marché : jamais validée sans un administrateur.
 */
export function siteLabelKey(brand: string, label: string): string {
  return refModelKey(brand, stripBrand(brand, label).rest);
}

/** Le nom lu sur le site sans la marque en tête (« MG ZS » → « ZS ») ; `stripped` : la marque y figurait. */
function stripBrand(brand: string, label: string): { rest: string; stripped: boolean } {
  const brandTokens = new Set(deburr(brand).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  const words = deburr(label).trim().split(/\s+/).filter(Boolean);
  let k = 0;
  while (k < words.length - 1) {
    const w = words[k];
    const tokens = w.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    if (brandKeyOf(w) !== brandKeyOf(brand) && !(tokens.length > 0 && tokens.every((t) => brandTokens.has(t)))) break;
    k++;
  }
  return { rest: words.slice(k).join(' '), stripped: k > 0 };
}

/** Une entrée de la liste moissonnée d'un site (linkgen_enum_mappings). */
export interface VocabEntry { field: string; code: string; label: string }
/** Les champs qui portent des MODÈLES (pas les marques, carburants, filtres, finitions). */
const MODEL_FIELD = /(^|:)(model|modelcode|modelid|cat)(:|$)|^u_car_model$|^model_facet$/;
/** Les champs qui portent les MARQUES d'un site (code → libellé), pour lire la marque d'un code « 17200;268 ». */
const BRAND_FIELD = /^(as:make|ms:make|cn:make|sb:brand|lc:make|gp:brand|jf:brand|bl:brand|bl:brandcode|u_car_brand)$/;
/** « MG/MG MOTOR » : l'une ou l'autre écriture de la marque (clés canoniques, MERCEDES-BENZ = MERCEDES). */
const brandKeys = (brand: string) => new Set(brand.split('/').map((b) => brandKeyOf(b.trim())).filter(Boolean));

/**
 * La marque d'une entrée de la liste, selon la façon dont le site la range : dans le nom du champ (« sb:model:renault »,
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

/**
 * LA LISTE DU SITE (31/10, Channing : « apprendre directement les noms avec les listes présentes et ainsi gagner du
 * temps »). Parmi les modèles déjà moissonnés sur ce site, ceux de CETTE marque dont la clé est celle du modèle d'ADA
 * (`exact` : « MG ZS » pour ZS, « Classe CLS » pour CLS-CLASS) ou la prolonge (`versions` : « GLS 350 », « GLS 400 »
 * pour GLS-CLASS — le site découpe le modèle). Un exact n'est retenu que si l'adaptateur sait l'écrire pour cette
 * marque SANS deviner : l'adresse en sera construite, puis prouvée par scrape (jamais apprise sur la seule liste).
 */
export function vocabularyMatches(adapter: SiteAdapter, brand: string, model: string, entries: ReadonlyArray<VocabEntry>): { exact: string[]; versions: string[] } {
  const key = refModelKey(brand, model);
  const out = { exact: [] as string[], versions: [] as string[] };
  if (!key || !brand.trim()) return out;
  const wanted = brandKeys(brand);
  const makes = new Map(entries.filter((e) => BRAND_FIELD.test(e.field)).map((e) => [e.code, e.label]));
  const seen = new Set<string>();
  for (const e of entries) {
    if (!MODEL_FIELD.test(e.field)) continue;
    const label = e.label.trim();
    if (!label || seen.has(label)) continue;
    const owner = entryBrand(e, makes);
    const { rest, stripped } = stripBrand(brand, label);
    // Appartenance à la marque : lue dans le champ ou le code ; sinon la marque doit ouvrir le libellé.
    if (owner !== null ? !wanted.has(brandKeyOf(owner)) : !stripped) continue;
    const k = refModelKey(brand, rest);
    if (k === key) {
      const r = adapter.buildSearchUrl({ brand, model: label });
      if (r.url && r.modelExpressed !== false && !r.modelGuessed) { out.exact.push(label); seen.add(label); }
    } else if (k.startsWith(key) && k.length > key.length) { out.versions.push(label); seen.add(label); }
  }
  return out;
}

/** Les écritures d'un nom de modèle à essayer : telle quelle, et les formes « Classe X » / « Série N » des sites. */
export function modelLabelForms(model: string): string[] {
  const m = model.trim().replace(/\s+/g, ' ');
  if (!m) return [];
  const out = [m];
  const cls = m.match(/^([a-z]{1,3})[- ]?(?:class|classe|klasse)$/i) ?? m.match(/^(?:classe|class|klasse)\s+([a-z]{1,3})$/i);
  if (cls) out.push(`Classe ${cls[1].toUpperCase()}`, cls[1].toUpperCase());
  const ser = m.match(/^(\d)[- ]?(?:series|serie|er)$/i) ?? m.match(/^(?:serie|série|series)\s+(\d)$/i);
  if (ser) out.push(`Serie ${ser[1]}`, `Série ${ser[1]}`);
  return [...new Set(out)];
}

/** Les adresses candidates pour ce nom sur ce site (au plus 3) : la page marque de départ, plus le modèle seul. */
export function modelCandidates(adapter: SiteAdapter, brand: string, name: string): string[] {
  const base = adapter.buildSearchUrl({ brand, model: '' }).url;
  if (!base) return [];
  const out: string[] = [];
  const add = (u: string | null | undefined) => { if (u && u !== base && u.includes(adapter.domain) && !out.includes(u)) out.push(u); };
  for (const form of modelLabelForms(name)) {
    if (adapter.key === 'LACENTRALE') {
      // Le site attend « MARQUE::LIBELLÉ COMMERCIAL » (corpus d'URLs Channing du 29/08 : TOYOTA::RAV 4).
      add(setQueryParamRaw(base, 'makesModelsCommercialNames', `${deburr(brand.trim().toUpperCase())}::${deburr(form).toUpperCase()}`));
      continue;
    }
    // Les autres : l'adaptateur lui-même, en mode découverte (slug dérivé du nom) — sa grammaire, rien d'inventé.
    const r = adapter.buildSearchUrl({ brand, model: form, derivedModelSlug: true });
    if (r.url && r.modelExpressed !== false) add(r.url);
  }
  return out.slice(0, 3);
}
