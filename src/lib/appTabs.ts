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
  // Le Workflow (une entrée de bandeau) porte CINQ onglets, chacun son droit
  // (demande Channing 07/09 : « sélectionner à quelles pages ont accès les
  // utilisateurs »). Les clés historiques `workflow` (= les trois onglets
  // d'études) et `ventes` (= Négociations + Ventes) restent COMPRISES dans
  // les listes déjà enregistrées (legacyGrants) et sont converties en clés
  // fines à la prochaine sauvegarde depuis Équipe (normalizeTabs).
  { key: 'wf:etudes', label: 'Workflow · Études quotidiennes', hint: 'Onglet Études quotidiennes (créer et suivre ses études)' },
  { key: 'wf:resultats', label: 'Workflow · Résultats', hint: 'Onglet Résultats (annonces trouvées, médianes, contact vendeur)' },
  { key: 'wf:archives', label: 'Workflow · Archives', hint: 'Onglet Archives (études passées)' },
  { key: 'wf:negociations', label: 'Workflow · Négociations', hint: 'Onglet Négociations, Open space compris' },
  { key: 'wf:ventes', label: 'Workflow · Ventes', hint: 'Onglet Ventes et historique des ventes' },
  { key: 'atelier', label: 'Atelier', hint: 'Campagnes, ingestion et générateur de liens' },
  { key: 'historique', label: 'Historique', hint: 'Historique des ingestions' },
  { key: 'market', label: 'Market Intelligence', hint: 'Études de marché multi-pays' },
  { key: 'veille', label: 'Veille', hint: 'Veille légale et fiscale' },
  // Carte Europe du réseau (07/09) : lecture pour l'équipe, ÉDITION sur
  // autorisation explicite (la politique RLS lit ce même droit).
  { key: 'carte', label: 'Carte du réseau', hint: 'Carte Europe des contacts acheteurs et vendeurs' },
  { key: 'carte:edition', label: 'Carte du réseau · édition', hint: 'Ajouter, modifier, déplacer et supprimer des contacts — sur autorisation explicite' },
  // Pas un onglet : le PANNEAU « Opportunités à contrôler » (Accueil + MI)
  // — même mécanisme de droits, le composant s'auto-masque (demande 30/08).
  { key: 'opportunites', label: 'Opportunités à contrôler', hint: 'Panneau de l’Accueil et du Market Intelligence — sur autorisation explicite, personne ne l’a par défaut' },
] as const;

export type AppTabKey = (typeof APP_TABS)[number]['key'];

/** Les cinq droits du Workflow, dans l'ordre des onglets. */
export const WORKFLOW_TAB_KEYS: AppTabKey[] = ['wf:etudes', 'wf:resultats', 'wf:archives', 'wf:negociations', 'wf:ventes'];

/** Clés historiques (avant le 07/09) → droits fins qu'elles accordaient. */
const LEGACY_GRANTS: Record<string, AppTabKey[]> = {
  workflow: ['wf:etudes', 'wf:resultats', 'wf:archives'],
  ventes: ['wf:negociations', 'wf:ventes'],
};

/** Droits SUR AUTORISATION EXPLICITE (demande Channing 07/09 : « je ne veux
 *  pas que tout le monde ait accès aux opportunités ») : « rien d'enregistré
 *  = tout » ne les inclut PAS — seule une liste qui les nomme les accorde. */
export const OPT_IN_TABS: AppTabKey[] = ['opportunites', 'carte:edition'];

/** Droits effectifs d'un compte non admin : NULL = tout sauf les droits sur
 *  autorisation explicite ; liste = ses clés fines (historiques développées). */
export function grantedTabs(tabs: string[] | null): string[] {
  if (tabs == null) return APP_TABS.map((t) => t.key as string).filter((k) => !OPT_IN_TABS.includes(k as AppTabKey));
  return normalizeTabs(tabs) ?? [];
}

/** Liste enregistrée → liste en clés fines (les clés historiques sont
 *  développées, les inconnues retirées). NULL reste NULL (= tout). */
export function normalizeTabs(tabs: string[] | null): string[] | null {
  if (tabs == null) return null;
  const known = new Set<string>(APP_TABS.map((t) => t.key));
  const out = new Set<string>();
  for (const k of tabs) {
    if (known.has(k)) out.add(k);
    for (const g of LEGACY_GRANTS[k] ?? []) out.add(g);
  }
  return [...out];
}

/** Clé d'onglet gouvernant une page du keep-alive (App.pageKeyOf) — null =
 *  page toujours accessible (accueil) ou gardée ailleurs (admin, Workflow :
 *  ouvert dès qu'un de ses cinq droits est accordé). */
export function tabKeyOfPageKey(pageKey: string): AppTabKey | null {
  switch (pageKey) {
    case 'admin-history': return 'wf:ventes';
    case 'atelier-linkgen':
    case 'atelier-ingestion': return 'atelier';
    case 'ingestion-history': return 'historique';
    case 'market': return 'market';
    case 'veille': return 'veille';
    case 'carte': return 'carte';
    default: return null;
  }
}

export function canSeeTab(allowedTabs: string[] | null, isAdmin: boolean, key: AppTabKey): boolean {
  if (isAdmin) return true;
  return grantedTabs(allowedTabs).includes(key);
}

/** Le Workflow s'ouvre dès qu'un de ses cinq onglets est permis. */
export function canSeeWorkflow(allowedTabs: string[] | null, isAdmin: boolean): boolean {
  return WORKFLOW_TAB_KEYS.some((k) => canSeeTab(allowedTabs, isAdmin, k));
}
