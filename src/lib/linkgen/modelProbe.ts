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
  const brandTokens = new Set(deburr(brand).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  const words = deburr(label).trim().split(/\s+/).filter(Boolean);
  let k = 0;
  while (k < words.length - 1) {
    const w = words[k];
    const tokens = w.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    if (brandKeyOf(w) !== brandKeyOf(brand) && !(tokens.length > 0 && tokens.every((t) => brandTokens.has(t)))) break;
    k++;
  }
  return refModelKey(brand, words.slice(k).join(' '));
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
