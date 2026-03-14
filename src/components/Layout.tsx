import { ReactNode } from 'react';
import { useActiveUsersCount } from '../hooks/useActiveUsersCount';

type LayoutProps = {
  children: ReactNode;
};

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="fixed top-4 right-4 text-xs text-zinc-600 font-mono z-10 bg-zinc-900/50 px-2 py-1 rounded-md">
        Active users: {activeCount ?? '—'}
      </div>

      <nav className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-1 px-8 py-4">
          <button
            onClick={() => navigateTo('/')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              isActive('/')
                ? 'bg-blue-600 text-white'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            Studies
          </button>
          <button
            onClick={() => navigateTo('/admin')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              isActive('/admin')
                ? 'bg-blue-600 text-white'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            Administrative
          </button>
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
