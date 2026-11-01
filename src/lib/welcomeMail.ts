/**
 * MAIL DE BIENVENUE (01/11, Channing : « à la création d'un compte, envoyer un e-mail à la personne,
 * depuis la boîte d'Ada avec sa signature : identifiants, lien, mot de passe en clair avec la
 * possibilité de le changer ; je choisis les onglets au moment de la création et je visualise le
 * mail »). Texte PUR : le même sert à l'aperçu dans Admin et à l'envoi par le worker. Le paragraphe
 * « ce que vous trouverez » suit les droits réellement donnés au compte.
 */
import { APP_TABS, OPT_IN_TABS, grantedTabs, type AppTabKey } from './appTabs';

export const ADA_URL = 'https://ada.mc-export.com';

/** Une ligne par onglet, dans l'ordre du bandeau. */
const TAB_LINES: Partial<Record<AppTabKey, string>> = {
  'wf:etudes': 'Études quotidiennes : vos recherches programmées, relues chaque matin par ADA.',
  'wf:resultats': 'Résultats : les annonces trouvées (et les leads partagés par votre manager), à prendre en négociation d\'un clic.',
  'wf:archives': 'Archives : les annonces traitées et les négociations archivées de votre organisation.',
  'wf:negociations': 'Négociations : vos dossiers en cours, les notes, les rappels, l\'Open space de votre équipe.',
  'wf:ventes': 'Ventes : les ventes de l\'équipe et leur historique.',
  atelier: 'Atelier : campagnes, ingestion d\'annonces et générateur de liens.',
  historique: 'Historique : le journal des ingestions.',
  market: 'Market Intelligence : les études de marché multi-pays.',
  veille: 'Veille : la veille légale et fiscale par pays.',
  carte: 'Carte du réseau : les contacts acheteurs et vendeurs en Europe.',
  offres: 'Offres fournisseur : importer une liste, poser nos prix, rééditer Excel et PDF.',
  agents: 'Agents : les boîtes d\'Ada et Dana, les messages à valider, le journal.',
};

export interface WelcomeInput {
  firstName: string; email: string; password: string; organisation: string;
  /** Onglets du compte (null = tous, sauf ceux sur autorisation explicite). */
  tabs: string[] | null;
  isManager?: boolean;
}

export function welcomeTabLines(input: Pick<WelcomeInput, 'tabs' | 'organisation' | 'isManager'>): string[] {
  const granted = new Set(grantedTabs(input.tabs));
  const lines = APP_TABS.filter((t) => granted.has(t.key) && !(OPT_IN_TABS.includes(t.key) && !granted.has(t.key))).map((t) => TAB_LINES[t.key]).filter((x): x is string => !!x);
  if (input.organisation !== 'MC Export') lines.push('Score : les leads pris et les rendez-vous de chacun dans votre organisation.');
  if (input.isManager) lines.push('Statistiques : la prospection de vos commerciaux, et vos études quotidiennes partagées en leads.');
  return lines;
}

export function welcomeMail(input: WelcomeInput): { subject: string; body: string } {
  const first = input.firstName.trim() || 'et bienvenue';
  const lines = welcomeTabLines(input);
  const body = [
    `Bonjour ${first},`,
    '',
    'Bienvenue sur ADA, l\'outil de prospection et de suivi de MC Export.',
    `Un compte vient d'être ouvert à votre nom pour ${input.organisation}.`,
    '',
    'Vos identifiants de connexion :',
    `  Adresse : ${input.email.trim()}`,
    `  Mot de passe : ${input.password}`,
    '',
    `Connectez-vous ici : ${ADA_URL}`,
    '',
    'Dès la première connexion, vous pouvez changer ce mot de passe via « Mot de passe oublié » sur la page de connexion, ou le garder tel quel.',
    '',
    ...(lines.length ? ['Ce que vous trouverez dans ADA :', ...lines.map((l) => `  • ${l}`), ''] : []),
    'Pour toute question, répondez simplement à ce message.',
    '',
    'Bonne prospection,',
  ].join('\n');
  return { subject: 'Bienvenue sur ADA — vos accès', body };
}
