/**
 * Onglets pilotables par compte (page admin Équipe, 30/08/2026).
 * Une seule source de vérité pour : le bandeau (Layout), la garde de route
 * (App) et l'UI admin (Equipe). Accueil n'est jamais désactivable (page
 * d'atterrissage) ; Truth Center et Télémétrie restent gouvernés par
 * is_admin, hors de cette liste.
 *
 * Convention : profiles.allowed_tabs NULL = TOUT (défaut — un onglet ajouté
 * plus tard apparaît de lui-même) ; liste = seulement ces clés. Les admins
 * ne sont jamais restreints.
 */

export const APP_TABS = [
  // Depuis le 05/09 le bandeau n'a plus qu'une entrée « Workflow » : ses
  // cinq onglets internes sont gouvernés par DEUX droits (clés inchangées,
  // les listes déjà enregistrées gardent leur sens) :
  //   workflow → Études quotidiennes, Résultats, Archives
  //   ventes   → Négociations (Open space compris), Ventes (+ historique)
  { key: 'workflow', label: 'Workflow · Études', hint: 'Onglets Études quotidiennes, Résultats et Archives' },
  { key: 'ventes', label: 'Workflow · Négociations & Ventes', hint: 'Onglets Négociations (avec l’Open space) et Ventes, historique des ventes compris' },
  { key: 'atelier', label: 'Atelier', hint: 'Campagnes, ingestion et générateur de liens' },
  { key: 'historique', label: 'Historique', hint: 'Historique des ingestions' },
  { key: 'market', label: 'Market Intelligence', hint: 'Études de marché multi-pays' },
  { key: 'veille', label: 'Veille', hint: 'Veille légale et fiscale' },
  // Pas un onglet : le PANNEAU « Opportunités à contrôler » (Accueil + MI)
  // — même mécanisme de droits, le composant s'auto-masque (demande 30/08).
  { key: 'opportunites', label: 'Opportunités à contrôler', hint: 'Panneau de l’Accueil et du Market Intelligence, pas une page' },
] as const;

export type AppTabKey = (typeof APP_TABS)[number]['key'];

/** Clé d'onglet gouvernant une page du keep-alive (App.pageKeyOf) — null =
 *  page toujours accessible (accueil) ou gardée ailleurs (admin). */
export function tabKeyOfPageKey(pageKey: string): AppTabKey | null {
  switch (pageKey) {
    case 'workflow': return 'workflow';
    case 'ventes':
    case 'admin-history': return 'ventes';
    case 'atelier-linkgen':
    case 'atelier-ingestion': return 'atelier';
    case 'ingestion-history': return 'historique';
    case 'market': return 'market';
    case 'veille': return 'veille';
    default: return null;
  }
}

export function canSeeTab(allowedTabs: string[] | null, isAdmin: boolean, key: AppTabKey): boolean {
  if (isAdmin) return true;
  if (allowedTabs == null) return true;
  return allowedTabs.includes(key);
}
