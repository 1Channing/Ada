import { ReactNode } from 'react';
import { useActiveUsersCount } from '../hooks/useActiveUsersCount';

type LayoutProps = {
  children: ReactNode;
};

export function Layout({ children }: LayoutProps) {
  const activeCount = useActiveUsersCount();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="fixed top-4 right-4 text-xs text-zinc-600 font-mono z-10 bg-zinc-900/50 px-2 py-1 rounded-md">
        Active users: {activeCount ?? '—'}
      </div>

      <main className="min-h-screen overflow-auto">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
