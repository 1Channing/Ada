/**
 * QUI CONTACTER, ET COMMENT LE TROUVER (19/10, Channing après le test DMD :
 * « elle n'a pas tort sur ce qu'elle donne, mais ce n'est pas le contact
 * parfait » — Dana avait trouvé le directeur commercial de la plateforme, il
 * fallait le commercial qui vend les lots aux marchands ; « si on n'a pas le
 * contact qui traite, le contact qui décide est déjà excellent » ; et la
 * façon dont l'équipe l'avait eu : « c'est un commercial d'une concession qui
 * nous a donné le contact »).
 *
 * Deux contacts par entreprise : POUR DÉMARRER — la personne qui traite au
 * quotidien (celle qui envoie les listes, qui répond aux marchands) — et
 * POUR DÉCIDER — son responsable. Le mail part à la première ; à défaut, à
 * la seconde. Et une troisième, l'AIGUILLEUR : quelqu'un de joignable dans
 * l'entreprise (un commercial d'une de ses concessions) qui peut donner le
 * bon contact quand il n'est pas public.
 * Le carnet des intitulés de postes, par type d'entreprise et par langue, et
 * la méthode de recherche des personnes qui part dans les consignes de la
 * fiche et de « Chercher plus loin ». Logique pure ; testée par
 * test/agents-memoire.test.ts.
 */

export type RoleSide = 'ada' | 'dana';
export interface ContactRoles { start: string; decide: string }

/** Par type de compte (recherche web) : qui traite, qui décide. Dana vend-elle ? Non : Dana ACHÈTE, ses interlocuteurs VENDENT. */
export const ROLES_BY_SEGMENT: Record<RoleSide, Record<string, ContactRoles>> = {
  dana: {
    leasing: { start: 'chargé(e) de remarketing, responsable des ventes de VO aux professionnels (B2B)', decide: 'directeur remarketing, directeur des ventes VO' },
    loueur: { start: 'responsable defleet ou remarketing, chargé(e) des ventes de véhicules aux professionnels', decide: 'directeur remarketing ou defleet' },
    flotte: { start: 'gestionnaire de parc (fleet manager)', decide: 'responsable des achats, directeur des services généraux' },
    groupe: { start: 'commercial VO marchands (négoce B2B), vendeur VO aux professionnels, acheteur-vendeur VO, responsable de la plateforme VO pour les professionnels', decide: 'directeur VO du groupe, directeur de la plateforme B2B, directeur commercial' },
    negociant_b2b: { start: 'commercial B2B, responsable des ventes aux professionnels', decide: 'dirigeant' },
  },
  ada: {
    groupe: { start: 'acheteur VO (du groupe ou d\'un site), responsable des achats VO, gestionnaire de stock VO', decide: 'directeur VO du groupe' },
    revendeur: { start: 'acheteur VO, chef des ventes VO', decide: 'gérant' },
    flotte: { start: 'fleet manager, responsable des achats de véhicules', decide: 'directeur des achats, gérant' },
  },
};

/** Par nature de fiche (garages de l'annuaire), quand l'entreprise ne vient pas d'une recherche web. */
export function rolesForKind(side: RoleSide, kind: string | null | undefined): ContactRoles {
  const k = String(kind ?? '');
  if (side === 'dana') {
    if (k === 'loueur_ou_leasing') return ROLES_BY_SEGMENT.dana.leasing;
    if (k === 'flotte_entreprise') return ROLES_BY_SEGMENT.dana.flotte;
    if (k === 'negociant_vo') return ROLES_BY_SEGMENT.dana.negociant_b2b;
    if (k === 'groupe') return ROLES_BY_SEGMENT.dana.groupe;
    return { start: 'chef des ventes VO, commercial VO qui vend aux marchands (négoce)', decide: 'directeur de la concession, gérant' };
  }
  if (k === 'groupe') return ROLES_BY_SEGMENT.ada.groupe;
  if (k === 'flotte_entreprise') return ROLES_BY_SEGMENT.ada.flotte;
  return { start: 'acheteur VO, chef des ventes VO', decide: 'directeur de la concession, gérant' };
}

/** Les mêmes postes, dans la langue du pays (pour les recherches et pour lire les pages). */
const LOCAL: Record<string, Record<RoleSide, ContactRoles>> = {
  fr: {
    dana: { start: '« commercial VO marchands », « vendeur VO B2B », « responsable négoce VO », « acheteur-vendeur VO », « chargé de remarketing »', decide: '« directeur VO », « directeur remarketing », « directeur commercial »' },
    ada: { start: '« acheteur VO », « responsable achats VO », « gestionnaire stock VO »', decide: '« directeur VO », « chef des ventes VO »' },
  },
  nl: {
    dana: { start: '« B2B verkoop occasions », « handelsverkoop », « verkoper handel », « remarketing specialist »', decide: '« manager occasions », « directeur remarketing »' },
    ada: { start: '« inkoper occasions », « inkoop gebruikte auto\'s »', decide: '« manager occasions », « bedrijfsleider »' },
  },
  de: {
    dana: { start: '« Händlerverkauf », « Gebrauchtwagen Großhandel », « B2B Gebrauchtwagenverkauf », « Remarketing »', decide: '« Leiter Gebrauchtwagen », « Leiter Remarketing »' },
    ada: { start: '« Gebrauchtwageneinkäufer », « Einkauf Gebrauchtwagen »', decide: '« Leiter Gebrauchtwagen », « Geschäftsführer »' },
  },
  es: {
    dana: { start: '« venta VO a profesionales », « comercial B2B vehículos de ocasión », « remarketing »', decide: '« director de vehículos de ocasión »' },
    ada: { start: '« comprador de vehículos de ocasión », « compras VO »', decide: '« jefe de VO »' },
  },
  it: {
    dana: { start: '« vendita usato a commercianti », « commerciale B2B usato », « remarketing »', decide: '« responsabile usato »' },
    ada: { start: '« acquisti usato », « buyer usato »', decide: '« responsabile usato »' },
  },
  da: {
    dana: { start: '« B2B salg brugtvogne », « remarketing »', decide: '« brugtvognschef »' },
    ada: { start: '« indkøber brugte biler »', decide: '« brugtvognschef »' },
  },
  sv: {
    dana: { start: '« B2B-försäljning begagnade bilar », « remarketing »', decide: '« begagnatchef »' },
    ada: { start: '« inköpare begagnade bilar »', decide: '« begagnatchef »' },
  },
  pl: {
    dana: { start: '« sprzedaż B2B samochodów używanych », « remarketing »', decide: '« kierownik działu samochodów używanych »' },
    ada: { start: '« zakupy samochodów używanych »', decide: '« kierownik działu samochodów używanych »' },
  },
  pt: {
    dana: { start: '« venda de usados a profissionais », « remarketing »', decide: '« diretor de usados »' },
    ada: { start: '« compras de usados »', decide: '« diretor de usados »' },
  },
  en: {
    dana: { start: '« trade sales », « B2B used car sales », « remarketing executive »', decide: '« head of used cars », « head of remarketing »' },
    ada: { start: '« used car buyer »', decide: '« used car manager »' },
  },
};
const LANG_OF: Record<string, string> = {
  FR: 'fr', BE: 'fr', LU: 'fr', CH: 'de', NL: 'nl', DE: 'de', AT: 'de', ES: 'es', IT: 'it', DK: 'da', SE: 'sv', PL: 'pl', PT: 'pt',
};
/** Les intitulés dans la langue du pays (et en néerlandais pour la Belgique, en français pour la Suisse romande). */
export function localTitles(side: RoleSide, country: string | null | undefined): Array<{ lang: string; roles: ContactRoles }> {
  const c = String(country ?? '').toUpperCase();
  const langs = [LANG_OF[c] ?? 'en', ...(c === 'BE' ? ['nl'] : c === 'CH' ? ['fr'] : []), 'en'];
  return [...new Set(langs)].map((lang) => ({ lang, roles: LOCAL[lang][side] }));
}

/**
 * LA MÉTHODE (19/10) — ce qui part dans la consigne de la fiche et de « Chercher plus loin ». Dans
 * l'ordre : ce que l'équipe sait (fourni, à ne pas refaire), la porte B2B de l'entreprise, qui traite puis
 * qui décide, les bonnes sources de noms, la fraîcheur, et l'aiguilleur.
 */
export function methodText(side: RoleSide): string {
  const dana = side === 'dana';
  return `La méthode pour trouver la bonne personne, dans cet ordre :
a. Ce que l'équipe MC Export sait déjà de l'entreprise (fourni plus bas, s'il y en a) : ne le refais pas, complète-le.
b. La porte ${dana ? 'pour les professionnels' : 'des achats'} de l'entreprise : ${dana ? 'sa plateforme ou son espace « marchands » / « professionnels », sa page « vente aux professionnels » ou « remarketing »' : 'sa page « achats », « reprise » ou « fournisseurs »'} — qui y est nommé, et ce qu'on obtient en s'y inscrivant (un commercial attitré).
c. Deux personnes, pas une : POUR DÉMARRER, la personne qui ${dana ? 'vend aux marchands' : 'achète les véhicules d\'occasion'} au quotidien (celle qui ${dana ? 'envoie les listes et les lots' : 'passe les commandes'}) ; POUR DÉCIDER, son responsable. Cherche d'abord la première ; à défaut, la seconde est déjà un excellent contact.
d. Les bonnes sources de noms : la page « équipe » ou « contact » de CHAQUE site ou concession (on y trouve souvent le chef des ventes VO et les commerciaux, avec leur adresse), les nominations dans la presse professionnelle, les offres d'emploi de l'entreprise, les vendeurs nommés sur ses annonces, les profils LinkedIn qui apparaissent dans les résultats. Recherche avec les intitulés du métier, dans la langue du pays.
e. La fraîcheur : pour chaque personne, l'année de la page qui la cite si elle est écrite. Un nom tiré d'une page de plus d'un an, sans rien de récent qui le confirme dans ce poste, reste « à confirmer ».
f. L'aiguilleur : si la personne qui traite n'est pas joignable directement, repère quelqu'un de joignable dans l'entreprise — un commercial ou le chef des ventes d'une de ses concessions, avec son adresse publiée — qui peut nous donner le bon contact (c'est souvent ainsi que l'équipe obtient le bon interlocuteur).`;
}

/** Les postes à chercher, pour la consigne : par type de compte ou par nature, avec les intitulés du pays. */
export function rolesPromptLines(side: RoleSide, roles: ContactRoles, country: string | null | undefined): string[] {
  return [
    `Pour démarrer (qui traite au quotidien) : ${roles.start}.`,
    `Pour décider : ${roles.decide}.`,
    ...localTitles(side, country).map((x) => `Intitulés à chercher (${x.lang}) — pour démarrer : ${x.roles.start} ; pour décider : ${x.roles.decide}.`),
  ];
}

/** « 2024 », « mars 2023 », « 2023-05-12 » → l'année, ou null. */
export function yearOf(date: string | null | undefined): number | null {
  const m = String(date ?? '').match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, january: 1, fevrier: 2, fevr: 2, fev: 2, feb: 2, february: 2, mars: 3, mar: 3, march: 3, avril: 4, avr: 4, apr: 4, april: 4, mai: 5, may: 5,
  juin: 6, jun: 6, june: 6, juillet: 7, juil: 7, jul: 7, july: 7, aout: 8, aug: 8, august: 8, septembre: 9, sept: 9, sep: 9, september: 9, octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11, decembre: 12, dec: 12, december: 12,
};
/** Le mois de la date s'il est écrit (« mars 2025 », « 2025-03-12 », « 03/2025 »), sinon null. */
function monthOf(date: string): number | null {
  const d = date.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const iso = d.match(/\b(?:19|20)\d{2}-(\d{1,2})\b/) ?? d.match(/\b(\d{1,2})[/.](?:19|20)\d{2}\b/);
  if (iso) { const m = Number(iso[1]); return m >= 1 && m <= 12 ? m : null; }
  const word = d.split(/[^a-z]+/).find((w) => MONTHS[w]);
  return word ? MONTHS[word] : null;
}

/**
 * À confirmer : une source de plus d'un an (au mois près s'il est écrit ; sinon, l'année d'avant l'an
 * dernier ou plus vieille), et rien de récent qui confirme la personne dans ce poste.
 */
export function staleSource(date: string | null | undefined, confirmedRecently: boolean, now = new Date()): boolean {
  const y = yearOf(date);
  if (confirmedRecently || y == null) return false;
  const m = monthOf(String(date));
  if (m == null) return y <= now.getFullYear() - 2;
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m) > 12;
}

/** Le premier intitulé « pour démarrer » du pays, sans guillemets (pour une recherche LinkedIn toute prête). */
export function startTitle(side: RoleSide, country: string | null | undefined): string {
  const first = localTitles(side, country)[0]?.roles.start ?? '';
  return first.match(/«\s*([^»]+?)\s*»/)?.[1] ?? (side === 'dana' ? 'remarketing' : 'acheteur VO');
}

/** Une recherche LinkedIn de la personne qui traite, dans l'entreprise (à ouvrir connecté : LinkedIn montre ce que les moteurs ne montrent pas). */
export const linkedinPeopleSearch = (company: string, side: RoleSide, country: string | null | undefined): string =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${startTitle(side, country)} ${company}`.trim())}`;
