/**
 * LA RECHERCHE LINKEDIN DÉDIÉE (20/10, Channing, profil de Florent Jabouille
 * sous les yeux : « tu avais dit que Jabouille n'était pas sur LinkedIn, il
 * y est et sa position est clairement notée… fais en sorte de pouvoir les
 * trouver »).
 *
 * Constat : la recherche approfondie ne gardait un profil que s'il
 * APPARAISSAIT par hasard dans l'un de ses 8 résultats ; les personnes
 * connues de l'équipe (carte, Workflow) entraient sur la fiche APRÈS la
 * recherche, sans jamais être cherchées. « Pas de profil LinkedIn vu » ne
 * voulait donc pas dire « pas de profil ».
 *
 * Désormais, pour chaque personne de la fiche sans profil — l'équipe
 * d'abord, puis le meilleur contact, ceux qui décident, ceux qui
 * démarrent — une recherche web ciblée (« Prénom Nom » entreprise
 * linkedin), à part, bon marché. Le profil n'est gardé que s'il a été VU
 * dans un résultat et que son adresse porte le nom (même règle qu'avant,
 * acceptedLinkedin). Dans tous les cas la fiche garde la trace de ce qui a
 * été cherché : « cherché sur LinkedIn le … : trouvé » ou « : rien »,
 * pour que l'on sache ce qui a été fait, et non deviné.
 *
 * La partie pure (candidats, consigne, schéma, application) ; l'appel à
 * l'IA et la vérification : worker/agents/linkedin.ts.
 */
import type { DeepPerson, DeepBest } from './deepResearch';

/** Au plus N personnes cherchées par fiche (une recherche web chacune, ~0,01 $). */
export const LINKEDIN_LOOKUP_MAX = 4;

const rank = (x: DeepPerson, best: DeepBest | null): number => {
  if (x.connu) return 0;
  if (best?.nom && x.nom.trim().toLowerCase() === best.nom.trim().toLowerCase()) return 1;
  if (x.niveau === 'decider') return 2;
  if (x.niveau === 'demarrer') return 3;
  return 4;
};

/** Les personnes à chercher : sans profil, jamais cherchées, dans l'ordre d'intérêt, N au plus. */
export function linkedinLookupCandidates(people: DeepPerson[], best: DeepBest | null, max = LINKEDIN_LOOKUP_MAX): DeepPerson[] {
  return people
    .filter((x) => x.nom.trim().split(/\s+/).length >= 2 && !x.linkedin && !x.linkedin_recherche)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => rank(a.x, best) - rank(b.x, best) || a.i - b.i)
    .slice(0, max)
    .map((r) => r.x);
}

export const LINKEDIN_LOOKUP_SYSTEM = [
  'Tu cherches le profil LinkedIn public d\'une personne précise, chez une entreprise précise, avec UNE recherche web (deux au plus).',
  'Tu ne rends un profil que s\'il apparaît dans un résultat de recherche : son adresse exacte (https://www.linkedin.com/in/…) et le titre affiché dans ce résultat.',
  'Un profil d\'un homonyme dans une autre entreprise ou un autre métier n\'est pas le bon : rends null. N\'invente ni adresse ni titre.',
].join(' ');

export interface LinkedinLookupOutput { linkedin: string | null; titre: string | null; entreprise_vue: boolean; source: string | null }

export const LINKEDIN_LOOKUP_SCHEMA = {
  type: 'object',
  properties: {
    linkedin: { type: ['string', 'null'], description: 'L\'adresse du profil vue dans un résultat (https://www.linkedin.com/in/…), sinon null.' },
    titre: { type: ['string', 'null'], description: 'Le titre affiché dans le résultat (« Acheteur chez Groupe DMD »), tel quel, sinon null.' },
    entreprise_vue: { type: 'boolean', description: 'true si le résultat cite bien l\'entreprise cherchée (ou son groupe).' },
    source: { type: ['string', 'null'], description: 'L\'adresse de la page de résultats ou de la page qui l\'a montré, sinon null.' },
  },
  required: ['linkedin', 'titre', 'entreprise_vue', 'source'],
  additionalProperties: false,
} as const;

/** Un nom écrit en capitales par le tableur (« FLORENT JABOUILLE ») cherché tel que les gens l'écrivent. */
export function displayName(nom: string): string {
  const t = nom.trim();
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, c: string) => `${sep}${c.toUpperCase()}`);
}

export function linkedinLookupPrompt(x: DeepPerson, company: string, group: string | null, country: string | null): string {
  const who = displayName(x.nom);
  const where = group && group.trim().toLowerCase() !== company.trim().toLowerCase() ? `${company} (groupe ${group})` : company;
  return [
    `Personne : ${who}${x.fonction && x.fonction !== 'contact de l\'équipe' ? ` — ${x.fonction}` : ''}.`,
    `Entreprise : ${where}${country ? ` (${country})` : ''}.`,
    `Cherche « ${who} » ${company} linkedin (si rien : « ${who} » linkedin), et rends le profil vu dans les résultats, ou null.`,
  ].join('\n');
}

/** La trace, lisible sur la fiche. */
export function lookupNote(found: boolean, titre: string | null, at: string): string {
  const day = at.slice(0, 10).split('-').reverse().join('/');
  return found ? `cherché sur LinkedIn le ${day} : profil trouvé${titre ? ` (« ${titre} »)` : ''}` : `cherché sur LinkedIn le ${day} : rien trouvé`;
}

/**
 * La fiche après une recherche : le profil accepté (ou rien), la trace, et — pour un contact de l'équipe
 * sans fonction — la fonction lue sur LinkedIn, marquée comme telle.
 */
export function applyLinkedinLookup(x: DeepPerson, accepted: string | null, out: LinkedinLookupOutput | null, at: string): DeepPerson {
  const titre = accepted ? (out?.titre ?? '').trim() || null : null;
  const next: DeepPerson = { ...x, linkedin: accepted ?? x.linkedin ?? null, linkedin_recherche: lookupNote(!!accepted, titre, at) };
  if (accepted && titre && (!x.fonction || x.fonction === 'contact de l\'équipe')) next.fonction = `${titre} (LinkedIn)`;
  return next;
}

// --- Par poste, sans nom (20/10, Channing : « pour 99 % nous n'avons pas le nom du contact… il faut
//     bien chercher sur LinkedIn en fonction du poste ») -------------------------------------------------

import { localTitles, type RoleSide } from './roles';

/** Au plus N recherches web par fiche (un intitulé chacune), N profils gardés. */
export const LINKEDIN_DISCOVERY_SEARCHES = 4;
export const LINKEDIN_DISCOVERY_MAX = 5;

const inQuotes = (s: string): string[] => [...s.matchAll(/«\s*([^»]+?)\s*»/g)].map((m) => m[1].trim());

/** Les intitulés à chercher, dans la langue du pays puis en anglais : ceux qui traitent d'abord, puis ceux qui décident. */
export function discoveryTitles(side: RoleSide, country: string | null | undefined, max = LINKEDIN_DISCOVERY_SEARCHES): Array<{ titre: string; niveau: 'demarrer' | 'decider' }> {
  const out: Array<{ titre: string; niveau: 'demarrer' | 'decider' }> = [];
  const seen = new Set<string>();
  const push = (titre: string, niveau: 'demarrer' | 'decider') => { const k = titre.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push({ titre, niveau }); } };
  // La langue du pays d'abord (« commercial VO marchands », « directeur VO », « vendeur VO B2B »…) ; l'anglais
  // seulement s'il reste de la place : « trade sales » ne trouve personne chez un groupe français.
  const langs = localTitles(side, country);
  const local = langs.filter((l) => l.lang !== 'en' || langs.length === 1);
  for (const l of local) {
    const st = inQuotes(l.roles.start), de = inQuotes(l.roles.decide);
    for (let i = 0; i < Math.max(st.length, de.length); i++) { if (st[i]) push(st[i], 'demarrer'); if (de[i]) push(de[i], 'decider'); }
  }
  const en = langs.find((l) => l.lang === 'en');
  if (en && local.length) { const st = inQuotes(en.roles.start), de = inQuotes(en.roles.decide); if (st[0]) push(st[0], 'demarrer'); if (de[0]) push(de[0], 'decider'); }
  return out.slice(0, max);
}

export const LINKEDIN_DISCOVERY_SYSTEM = [
  'Tu cherches, sur LinkedIn, QUI occupe certains postes dans une entreprise précise, avec des recherches web ciblées (un intitulé par recherche, « intitulé » entreprise linkedin).',
  'Tu ne rends que des profils vus dans les résultats : l\'adresse exacte (https://www.linkedin.com/in/…), le nom et le titre tels qu\'affichés dans le résultat, et si ce résultat cite bien l\'entreprise (ou son groupe).',
  'Les profils d\'anciens salariés (« ex- », « ancien », dates passées) ou d\'une autre entreprise ne comptent pas. N\'invente rien ; si rien n\'apparaît, rends une liste vide.',
].join(' ');

export interface LinkedinDiscoveryOutput { profils: Array<{ nom: string; titre: string; linkedin: string; entreprise_vue: boolean; niveau: 'demarrer' | 'decider' | 'autre' }> }

export const LINKEDIN_DISCOVERY_SCHEMA = {
  type: 'object',
  properties: {
    profils: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nom: { type: 'string', description: 'Le nom tel qu\'affiché dans le résultat.' },
          titre: { type: 'string', description: 'Le titre affiché (« Acheteur chez Groupe DMD »), tel quel.' },
          linkedin: { type: 'string', description: 'L\'adresse du profil vue dans le résultat (https://www.linkedin.com/in/…).' },
          entreprise_vue: { type: 'boolean', description: 'true si le résultat cite l\'entreprise cherchée ou son groupe.' },
          niveau: { type: 'string', enum: ['demarrer', 'decider', 'autre'], description: 'demarrer = traite au quotidien ; decider = son responsable ; autre.' },
        },
        required: ['nom', 'titre', 'linkedin', 'entreprise_vue', 'niveau'],
        additionalProperties: false,
      },
    },
  },
  required: ['profils'],
  additionalProperties: false,
} as const;

export function linkedinDiscoveryPrompt(company: string, group: string | null, country: string | null, titles: Array<{ titre: string; niveau: string }>): string {
  const where = group && group.trim().toLowerCase() !== company.trim().toLowerCase() ? `${company} (groupe ${group})` : company;
  return [
    `Entreprise : ${where}${country ? ` (${country})` : ''}.`,
    'Postes à trouver, un par recherche, dans cet ordre :',
    ...titles.map((t, i) => `${i + 1}. « ${t.titre} » ${group?.trim() ? group.trim() : company} linkedin  (${t.niveau === 'decider' ? 'pour décider' : 'pour démarrer'})`),
    'Rends tous les profils vus dans ces résultats qui sont dans l\'entreprise aujourd\'hui, avec leur niveau.',
  ].join('\n');
}

const deburrLc = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nameKey = (x: string) => deburrLc(x).replace(/[^a-z]+/g, ' ').trim().split(' ').filter((t) => t.length >= 3).sort().join(' ');
const companyTokens = (...names: Array<string | null | undefined>) =>
  [...new Set(names.flatMap((n) => deburrLc(n ?? '').split(/[^a-z0-9]+/)).filter((t) => t.length >= 4 && !['groupe', 'group', 'automobiles', 'automobile', 'automotive', 'france', 'centre', 'motors', 'auto', 'cars'].includes(t)))];

/**
 * Les profils gardés : vus dans un résultat et adresse qui porte le nom (acceptedLinkedin), entreprise citée
 * dans le résultat ou dans le titre ; pas déjà sur la fiche. Chacun entre comme personne, avec sa trace.
 */
export function acceptDiscovered(
  out: LinkedinDiscoveryOutput | null, existing: DeepPerson[], company: string, group: string | null,
  accept: (url: string, nom: string) => string | null, at: string, max = LINKEDIN_DISCOVERY_MAX,
): DeepPerson[] {
  const known = new Set(existing.map((x) => nameKey(x.nom)));
  const tokens = companyTokens(company, group);
  const day = at.slice(0, 10).split('-').reverse().join('/');
  const added: DeepPerson[] = [];
  for (const pr of out?.profils ?? []) {
    const nom = String(pr.nom ?? '').trim();
    if (nom.split(/\s+/).length < 2 || known.has(nameKey(nom))) continue;
    const url = accept(String(pr.linkedin ?? ''), nom);
    if (!url) continue;
    const titre = String(pr.titre ?? '').trim();
    const t = deburrLc(titre);
    if (!pr.entreprise_vue && !tokens.some((k) => t.includes(k))) continue;
    if (/\b(ex|ancien|ancienne|former|voormalig|ehemalig)\b/.test(t)) continue;
    known.add(nameKey(nom));
    added.push({
      nom, fonction: titre || 'poste vu sur LinkedIn', email: null, telephone: null, source: 'LinkedIn (recherche par poste)', linkedin: url, via: 'linkedin',
      niveau: pr.niveau === 'decider' ? 'decider' : pr.niveau === 'demarrer' ? 'demarrer' : null, date_source: at.slice(0, 4), a_confirmer: false,
      linkedin_recherche: `trouvé par recherche LinkedIn par poste le ${day}${titre ? ` (« ${titre} »)` : ''}`,
    });
    if (added.length >= max) break;
  }
  return added;
}
