import { ReactNode } from 'react';
import { StudyRunsPanel } from './StudyRunsPanel';

type LayoutProps = {
  children: ReactNode;
};

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="fixed top-4 right-4 text-xs text-zinc-600 font-mono z-10">
        v123
      </div>

      <main className="min-h-screen overflow-auto">
        <div className="p-8">
          {children}
        </div>
      </main>

      <StudyRunsPanel />
    </div>
  );
}
