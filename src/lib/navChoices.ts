/**
 * Entrées du bandeau et droits (23/10) : partagées entre le bandeau (Layout) et la section « Mes onglets »
 * de la page Admin. Les icônes restent dans Layout.
 */
import type { ReactNode } from 'react';
import { canSeeTab, canSeeWorkflow, type AppTabKey } from './appTabs';
import { useAuth } from '../services/auth';
import type { NavChoice } from '../components/MyTabs';

export type NavItem = { path: string; label: string; icon?: ReactNode; exact?: boolean; also?: string[]; tab?: AppTabKey; workflow?: boolean; manager?: boolean };

export function permittedNavItems(all: NavItem[], allowedTabs: string[] | null | undefined, isAdmin: boolean, isManager: boolean): NavItem[] {
  return all.filter((it) => (it.workflow ? canSeeWorkflow(allowedTabs, isAdmin) : it.manager ? (isManager || isAdmin) : !it.tab || canSeeTab(allowedTabs, isAdmin, it.tab)));
}

/** Les entrées du bandeau que le compte connecté peut choisir de masquer (page Admin, section « Mes onglets »). */
export function useMyTabChoices(): NavChoice[] {
  const { allowedTabs, isAdmin, isManager } = useAuth();
  const all: NavItem[] = [
    { path: '/workflow', label: 'Workflow', workflow: true },
    { path: '/ingestion', label: 'Atelier', tab: 'atelier' },
    { path: '/ingestion/history', label: 'Historique', tab: 'historique' },
    { path: '/market', label: 'Market Intelligence', tab: 'market' },
    { path: '/veille', label: 'Veille', tab: 'veille' },
    { path: '/carte', label: 'Carte', tab: 'carte' },
    { path: '/offres', label: 'Offres', tab: 'offres' },
    { path: '/agents', label: 'Agents', tab: 'agents' },
    { path: '/statistiques', label: 'Statistiques', manager: true },
  ];
  return permittedNavItems(all, allowedTabs, isAdmin, isManager).map((it) => ({ path: it.path, label: it.label }));
}

