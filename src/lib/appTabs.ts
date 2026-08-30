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
  { key: 'workflow', label: 'Workflow' },
  { key: 'ventes', label: 'Ventes' },
  { key: 'atelier', label: 'Atelier' },
  { key: 'historique', label: 'Historique' },
  { key: 'market', label: 'Market Intelligence' },
  { key: 'veille', label: 'Veille' },
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
