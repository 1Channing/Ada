/**
 * La recherche LinkedIn dédiée (20/10, Channing, le profil de Florent
 * Jabouille sous les yeux : « tu avais dit que Jabouille n'était pas sur
 * LinkedIn, il y est et sa position est clairement notée… fais en sorte de
 * pouvoir les trouver » ; puis : « pour 99 % nous n'avons pas le nom du
 * contact… il faut bien chercher sur LinkedIn en fonction du poste »).
 * La partie pure : qui chercher par nom (l'équipe d'abord), les intitulés
 * par poste dans la langue du pays, les consignes, ce qui est gardé (vu dans
 * un résultat, adresse qui porte le nom, entreprise citée, pas un ancien,
 * pas déjà sur la fiche) et la trace écrite sur la fiche.
 */
import {
  linkedinLookupCandidates, applyLinkedinLookup, displayName, linkedinLookupPrompt, lookupNote, LINKEDIN_LOOKUP_MAX,
  discoveryTitles, linkedinDiscoveryPrompt, acceptDiscovered, LINKEDIN_DISCOVERY_SEARCHES,
} from '../src/lib/agents/linkedinLookup';
import { acceptedLinkedin } from '../src/lib/agents/qualification';
import type { DeepPerson } from '../src/lib/agents/deepResearch';

let failed = 0;
const ok = (cond: unknown, label: string, got?: unknown) => { if (cond) console.log(`✓ ${label}`); else { failed++; console.log(`✗ ${label}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); } };
const AT = '2026-10-20T06:00:00Z';

// --- Par nom ------------------------------------------------------------------------------------------
const people: DeepPerson[] = [
  { nom: 'Christophe Delteil', fonction: 'directeur commercial', email: null, source: 'presse', linkedin: 'https://www.linkedin.com/in/christophe-delteil-b0835b65', niveau: 'decider' },
  { nom: 'Christian Digoin', fonction: 'Dirigeant', email: null, source: 'site', linkedin: null },
  { nom: 'Christophe Cormier', fonction: 'directeur des ventes', email: null, source: 'site', linkedin: null, niveau: 'demarrer' },
  { nom: 'FLORENT JABOUILLE', fonction: 'contact de l\'équipe', email: null, source: 'carte', via: 'carte', connu: true, linkedin: null },
  { nom: 'Alexandre Digoin', fonction: 'DG', email: null, source: 'presse', linkedin: null, niveau: 'decider' },
  { nom: 'Prénom', fonction: 'x', email: null, source: 'x', linkedin: null },
  { nom: 'Déjà Cherché', fonction: 'x', email: null, source: 'x', linkedin: null, linkedin_recherche: 'cherché sur LinkedIn le 19/10/2026 : rien trouvé' },
];
const cands = linkedinLookupCandidates(people, { nom: 'Christophe Cormier', fonction: null, email: null, pourquoi: '' });
ok(cands.map((x) => x.nom).join('|') === 'FLORENT JABOUILLE|Christophe Cormier|Alexandre Digoin|Christian Digoin',
  'par nom : l\'équipe d\'abord, puis le meilleur contact, ceux qui décident, les autres ; jamais un prénom seul, ni un profil déjà là, ni une personne déjà cherchée', cands.map((x) => x.nom));
ok(cands.length <= LINKEDIN_LOOKUP_MAX, `au plus ${LINKEDIN_LOOKUP_MAX} personnes cherchées par fiche`, cands.length);
ok(displayName('FLORENT JABOUILLE') === 'Florent Jabouille' && displayName("JEAN-PIERRE D'ARC") === "Jean-Pierre D'Arc" && displayName('Florent Jabouille') === 'Florent Jabouille',
  'un nom en capitales (tableur) cherché tel que les gens l\'écrivent', [displayName('FLORENT JABOUILLE'), displayName("JEAN-PIERRE D'ARC")]);
const prompt = linkedinLookupPrompt(people[3], 'Centre VO@PRO (Groupe DMD – Mustière Automobiles)', 'Groupe DMD', 'FR');
ok(prompt.includes('« Florent Jabouille » Centre VO@PRO') && prompt.includes('groupe Groupe DMD') && !prompt.includes('contact de l\'équipe'), 'consigne : « Prénom Nom » entreprise linkedin, le groupe, sans la fonction vide', prompt);

const seen = ['https://fr.linkedin.com/in/florent-jabouille-1a2b3c?trk=public_profile', 'https://www.linkedin.com/in/someone-else'];
const accepted = acceptedLinkedin('https://fr.linkedin.com/in/florent-jabouille-1a2b3c', 'FLORENT JABOUILLE', seen, '');
ok(accepted === 'https://www.linkedin.com/in/florent-jabouille-1a2b3c', 'gardé : vu dans un résultat, adresse qui porte le nom, normalisée en www', accepted);
ok(acceptedLinkedin('https://www.linkedin.com/in/someone-else', 'FLORENT JABOUILLE', seen, '') === null, 'refusé : un homonyme dont l\'adresse ne porte pas le nom');
ok(acceptedLinkedin('https://www.linkedin.com/in/florent-jabouille-zzz', 'FLORENT JABOUILLE', seen, '') === null, 'refusé : une adresse plausible mais jamais vue dans un résultat (inventée)');
const found = applyLinkedinLookup(people[3], accepted, { linkedin: accepted, titre: 'Acheteur chez Groupe DMD', entreprise_vue: true, source: null }, AT);
ok(found.linkedin === accepted && found.fonction === 'Acheteur chez Groupe DMD (LinkedIn)' && found.linkedin_recherche === 'cherché sur LinkedIn le 20/10/2026 : profil trouvé (« Acheteur chez Groupe DMD »)' && found.connu === true,
  'trouvé : le profil, la fonction lue sur LinkedIn (marquée) pour un contact de l\'équipe sans fonction, la trace datée', found);
const none = applyLinkedinLookup(people[1], null, { linkedin: null, titre: null, entreprise_vue: false, source: null }, AT);
ok(none.linkedin === null && none.fonction === 'Dirigeant' && none.linkedin_recherche === 'cherché sur LinkedIn le 20/10/2026 : rien trouvé', 'rien trouvé : la fiche le dit (cherché, pas deviné), la fonction connue reste', none);
ok(linkedinLookupCandidates([none], null).length === 0, 'une personne cherchée n\'est pas recherchée à chaque passage');
ok(lookupNote(true, null, AT) === 'cherché sur LinkedIn le 20/10/2026 : profil trouvé', 'trace sans titre');

// --- Par poste, sans nom --------------------------------------------------------------------------------
const fr = discoveryTitles('dana', 'FR');
ok(fr.map((t) => t.titre).join('|') === 'commercial VO marchands|directeur VO|vendeur VO B2B|directeur remarketing' && fr[0].niveau === 'demarrer' && fr[1].niveau === 'decider',
  'France, Dana : les intitulés français d\'abord (qui traite, qui décide, en alternance), pas d\'anglais tant qu\'il y a du français', fr);
ok(discoveryTitles('ada', 'NL').map((t) => t.titre).join('|') === 'inkoper occasions|manager occasions|inkoop gebruikte auto\'s|bedrijfsleider', 'Pays-Bas, Ada : les intitulés néerlandais', discoveryTitles('ada', 'NL'));
ok(discoveryTitles('dana', 'DK').some((t) => t.titre === 'trade sales'), 'Danemark : peu d\'intitulés danois, l\'anglais complète', discoveryTitles('dana', 'DK'));
ok(discoveryTitles('ada', 'GB').map((t) => t.titre).join('|') === 'used car buyer|used car manager', 'pays sans carnet local : l\'anglais seul', discoveryTitles('ada', 'GB'));
ok(discoveryTitles('dana', 'FR').length <= LINKEDIN_DISCOVERY_SEARCHES, `au plus ${LINKEDIN_DISCOVERY_SEARCHES} recherches par fiche`);
const dp = linkedinDiscoveryPrompt('Centre VO@PRO (Groupe DMD – Mustière Automobiles)', 'Groupe DMD', 'FR', fr);
ok(dp.includes('1. « commercial VO marchands » Groupe DMD linkedin') && dp.includes('(pour décider)') && dp.includes('dans l\'entreprise aujourd\'hui'), 'consigne par poste : un intitulé par recherche, sur le nom du groupe', dp);

const seen2 = ['https://fr.linkedin.com/in/florent-jabouille-1a2b3c', 'https://www.linkedin.com/in/jean-dupont-x', 'https://www.linkedin.com/in/paul-martin-y', 'https://www.linkedin.com/in/anne-leroy-vo'];
const out = { profils: [
  { nom: 'Florent Jabouille', titre: 'Acheteur chez Groupe DMD', linkedin: 'https://fr.linkedin.com/in/florent-jabouille-1a2b3c', entreprise_vue: true, niveau: 'demarrer' as const },
  { nom: 'Jean Dupont', titre: 'Ex-directeur VO Groupe DMD', linkedin: 'https://www.linkedin.com/in/jean-dupont-x', entreprise_vue: true, niveau: 'decider' as const },
  { nom: 'Paul Martin', titre: 'Directeur VO chez Autre Groupe', linkedin: 'https://www.linkedin.com/in/paul-martin-y', entreprise_vue: false, niveau: 'decider' as const },
  { nom: 'Anne Leroy', titre: 'Directrice VO — Mustière Automobiles', linkedin: 'https://www.linkedin.com/in/anne-leroy-vo', entreprise_vue: false, niveau: 'decider' as const },
  { nom: 'Marie Invent', titre: 'Acheteuse VO Groupe DMD', linkedin: 'https://www.linkedin.com/in/marie-invent', entreprise_vue: true, niveau: 'demarrer' as const },
  { nom: 'Christophe Delteil', titre: 'Directeur commercial VO@Pro', linkedin: 'https://www.linkedin.com/in/christophe-delteil-b0835b65', entreprise_vue: true, niveau: 'decider' as const },
  { nom: 'Mono', titre: 'Acheteur Groupe DMD', linkedin: 'https://www.linkedin.com/in/mono', entreprise_vue: true, niveau: 'autre' as const },
] };
const added = acceptDiscovered(out, [people[0]], 'Centre VO@PRO (Groupe DMD – Mustière Automobiles)', 'Groupe DMD', (u, n) => acceptedLinkedin(u, n, seen2, ''), AT);
ok(added.map((x) => x.nom).join('|') === 'Florent Jabouille|Anne Leroy',
  'par poste : gardés Jabouille (vu, entreprise citée) et Leroy (le titre nomme Mustière) ; écartés l\'ancien (« Ex- »), l\'autre entreprise, le profil jamais vu, celui déjà sur la fiche, le nom sans prénom', added.map((x) => x.nom));
ok(added[0].linkedin === 'https://www.linkedin.com/in/florent-jabouille-1a2b3c' && added[0].fonction === 'Acheteur chez Groupe DMD' && added[0].niveau === 'demarrer' && added[0].via === 'linkedin' && added[0].source === 'LinkedIn (recherche par poste)'
  && added[0].linkedin_recherche === 'trouvé par recherche LinkedIn par poste le 20/10/2026 (« Acheteur chez Groupe DMD »)' && added[0].date_source === '2026' && added[0].a_confirmer === false,
  'une personne trouvée par poste : nom, titre, profil, niveau, source et trace', added[0]);
ok(acceptDiscovered(null, [], 'X', null, () => null, AT).length === 0 && acceptDiscovered({ profils: [] }, [], 'X', null, () => null, AT).length === 0, 'réponse vide ou illisible : rien d\'ajouté');

console.log(failed ? `\n❌ ${failed} TEST(S) FAILED` : '\n✅ ALL TESTS PASSED');
process.exit(failed ? 1 : 0);
