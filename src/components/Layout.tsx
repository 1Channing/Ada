import { ReactNode } from 'react';
import { Upload, History, LineChart, Home, ClipboardList, Handshake, Scale, LogOut } from 'lucide-react';
import { useActiveUsersCount } from '../hooks/useActiveUsersCount';
import { NotificationCenter } from './NotificationCenter';
import { FeedbackCenter } from './FeedbackCenter';
import { useAuth, signOut } from '../services/auth';

type LayoutProps = {
  children: ReactNode;
};

/**
 * Coquille « Direction B » (validée 26/07) : bandeau dégradé marine → azur
 * MC Export, logo de marque, libellés français, contenu sur fond clair.
 * Habillage pur — navigation, routes et comportements inchangés.
 */
export function Layout({ children }: LayoutProps) {
  const activeCount = useActiveUsersCount();
  const currentPath = window.location.pathname;

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    window.location.reload();
  };

  const isActive = (path: string) => {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
  };

  const items: Array<{ path: string; label: string; icon?: ReactNode; exact?: boolean; also?: string[] }> = [
    { path: '/', label: 'Accueil', icon: <Home className="w-4 h-4" /> },
    // Workflow personnel : études quotidiennes + résultats (ex-Études).
    { path: '/workflow', label: 'Workflow', icon: <ClipboardList className="w-4 h-4" />, also: ['/etudes'] },
    // Ventes : négociations (perso) + ventes équipe (ex-Administratif).
    { path: '/ventes', label: 'Ventes', icon: <Handshake className="w-4 h-4" />, also: ['/admin'] },
    // Atelier = campagnes + ingestion + link gen fusionnés (une seule page).
    { path: '/ingestion', label: 'Atelier', icon: <Upload className="w-4 h-4" />, exact: true, also: ['/link-generator'] },
    { path: '/ingestion/history', label: 'Historique', icon: <History className="w-4 h-4" /> },
    { path: '/market', label: 'Market Intelligence', icon: <LineChart className="w-4 h-4" /> },
    { path: '/veille', label: 'Veille', icon: <Scale className="w-4 h-4" /> },
  ];

  const activeFor = (it: { path: string; exact?: boolean; also?: string[] }) =>
    (it.exact ? currentPath === it.path : isActive(it.path)) ||
    (it.also ?? []).some((p) => currentPath.startsWith(p));

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <nav className="bg-gradient-to-r from-brand-encre via-brand-ocean to-[#3F85C2] shadow-md">
        <div className="flex items-center gap-2 px-6 py-2.5">
          {/* Logo : /logo-mark.png (version sans texte) — repli sur la
              marque « orbite » si le fichier n'est pas encore déposé. */}
          <div className="flex items-center gap-3 pr-4 mr-1 border-r border-white/20">
            <span className="w-9 h-9 rounded-lg bg-white/95 grid place-items-center overflow-hidden shadow-sm">
              <img
                src="/logo-mark.png"
                alt=""
                className="w-7 h-7 object-contain"
                onError={(e) => {
                  const el = e.currentTarget;
                  el.style.display = 'none';
                  el.nextElementSibling?.removeAttribute('hidden');
                }}
              />
              <svg hidden width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <ellipse cx="11" cy="11" rx="8.5" ry="5" transform="rotate(-24 11 11)" stroke="#2C5F9E" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="21 7" />
                <circle cx="11" cy="11" r="2.6" fill="#22346E" />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="block text-white font-bold tracking-wide text-sm">ADA</span>
              <span className="block text-white/60 text-[10px] uppercase tracking-widest">MC Export</span>
            </span>
          </div>

          {items.map((it) => (
            <button
              key={it.path}
              onClick={() => navigateTo(it.path)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeFor(it)
                  ? 'bg-white/15 text-white shadow-inner'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              {it.icon}
              {it.label}
            </button>
          ))}

          {/* À droite : présence + signalements + notifications + compte. */}
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden md:flex items-center gap-1.5 text-[11px] text-white/60 font-mono mr-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              {activeCount ?? '—'} connecté{(activeCount ?? 0) > 1 ? 's' : ''}
            </span>
            <FeedbackCenter />
            <NotificationCenter />
            <UserChip />
          </div>
        </div>
      </nav>

      <main className="min-h-screen overflow-auto">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

/** Compte connecté : prénom + déconnexion. */
function UserChip() {
  const { displayName, email } = useAuth();
  return (
    <div className="flex items-center gap-1.5 ml-1 pl-3 border-l border-white/20">
      <span className="w-7 h-7 rounded-full bg-white/15 text-white text-xs font-semibold grid place-items-center uppercase">
        {(displayName || email || '?').slice(0, 1)}
      </span>
      <span className="hidden lg:block text-white/80 text-xs font-medium max-w-[90px] truncate">
        {displayName || email || ''}
      </span>
      <button
        onClick={() => { void signOut().then(() => window.location.reload()); }}
        title="Se déconnecter"
        className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}
